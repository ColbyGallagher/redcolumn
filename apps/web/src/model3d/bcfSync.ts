import { DEFAULT_STYLES, type Markup, type MarkupStore, type Reply } from '@nb/markup';
import type { GeoRegion } from '@nb/measure';
import { gridToPage, pageToGrid } from '../geospatial/align';
import { markupStatusOf, topicStatusOf, type BcfLink, type BcfTopic } from './bcf';
import { fitOf, inside } from './links';

type Pt = [number, number];

/**
 * Keeps a 3D model's issues and their markups in step. Each issue shows on every sheet registered
 * to the map whose region holds its place, as a cloud around the place and a callout with its
 * title, both ordinary markups (subject "BCF") that other PDF tools keep. Its status and comments
 * ride on the callout, so the comment register exports and imports them like any comment.
 *
 * Both sides can change: a title, status or comment set on the sheet, or the markups moved, goes
 * back to the issue, and the issue's changes go to the markups. Each link keeps the values last
 * seen on both sides, so the side that differs from them is the one that changed (and nothing is
 * written when neither did, so syncing again settles).
 */

/** A sheet an issue can show on: a page's map registration in an open PDF. */
export interface SyncSheet {
  /** `fileId:pageIndex:regionId`. */
  key: string;
  region: GeoRegion;
  store: MarkupStore;
}

export const BCF_SUBJECT = 'BCF';
const CLOUD = 24;
const COLOUR = '#e03131';
/** Page points a markup must move by to count as moved (rounding of page and map points stays under it). */
const MOVED = 0.5;

/** Keeps one issue and its markups on these sheets in step; returns the issue (the same object when it did not change). */
export function syncTopic(topic: BcfTopic, sheets: readonly SyncSheet[], author: string, now = Date.now()): BcfTopic {
  let t = topic;
  const change = (patch: Partial<BcfTopic>) => (t = { ...t, ...patch });
  for (const sheet of sheets) {
    const placement = fitOf(sheet.region);
    if (!placement) continue;
    const { store, key } = sheet;
    const page = sheet.region.pageIndex;
    const link = t.links.find((l) => l.sheet === key);
    const markups = store.forPage(page).filter((m) => m.bcf?.guid === t.guid);
    const callout = markups.find((m) => m.bcf!.role === 'callout');
    const cloud = markups.find((m) => m.bcf!.role === 'cloud');
    const at = t.point ? (gridToPage(placement, [t.point[0], t.point[1]]) as Pt) : null;

    if (!markups.length) {
      if (link) {
        // Deleted on the sheet: the issue stays, and is not drawn there again.
        change({ links: t.links.filter((l) => l !== link), dismissed: [...t.dismissed, key] });
        continue;
      }
      if (!at || !inside(sheet.region.bounds, at) || t.dismissed.includes(key) || store.readOnly) continue;
      const made = issueMarkups(t, page, at, author, now);
      store.follow(() => made.forEach((m) => store.add(m)));
      change({ links: [...t.links, { sheet: key, markupIds: made.map((m) => m.id), synced: { title: t.title, status: markupStatusOf(t.status), at } }] });
      continue;
    }

    const mainOf = callout ?? cloud!;
    const markupAt = cloud ? centre(cloud.points) : (link?.synced.at ?? at ?? centre(mainOf.points));
    // Markups found without a link (the issue was imported again): they are what was last seen.
    const synced: BcfLink['synced'] = link?.synced ?? { title: callout?.text ?? t.title, status: mainOf.status, at: markupAt };

    let title = t.title;
    const markupTitle = callout?.text ?? synced.title;
    if (markupTitle !== synced.title) title = markupTitle;

    let status = t.status;
    if (mainOf.status !== synced.status) status = topicStatusOf(mainOf.status, t.status);

    let point = t.point;
    let target = at ?? markupAt;
    if (dist(markupAt, synced.at) > MOVED) {
      const [e, n] = pageToGrid(placement, markupAt);
      point = [e, n, t.point?.[2] ?? 0];
      target = markupAt;
    }

    // Comments and replies: each side gets the ones it lacks (a reply's id is its comment's GUID).
    const replies = callout?.replies ?? [];
    const comments = [...t.comments];
    for (const r of replies) if (!comments.some((c) => c.guid === r.id)) comments.push({ guid: r.id, author: r.author, date: new Date(r.createdAt).toISOString(), text: r.text });
    const missing: Reply[] = t.comments.filter((c) => !replies.some((r) => r.id === c.guid)).map((c) => ({ id: c.guid, author: c.author, text: c.text, createdAt: Date.parse(c.date) || now }));

    const fromSheet = title !== t.title || status !== t.status || point !== t.point || comments.length !== t.comments.length;
    if (fromSheet) change({ title, status, point, comments, modified: new Date(now).toISOString() });

    // The markups follow the issue.
    const wantStatus = markupStatusOf(t.status);
    const dx = target[0] - markupAt[0];
    const dy = target[1] - markupAt[1];
    const moveBy = Math.hypot(dx, dy) > MOVED;
    // A status the issue's status already means (Rejected for Closed) is left as set on the sheet.
    const mainStatus = topicStatusOf(mainOf.status, t.status) === t.status ? mainOf.status : wantStatus;
    store.follow(() => {
      for (const m of markups) {
        const patch: Partial<Markup> = {};
        const status = m === mainOf ? mainStatus : wantStatus;
        if (m.status !== status) patch.status = status;
        if (m === callout && m.text !== t.title) patch.text = t.title;
        if (m === callout && missing.length) patch.replies = [...replies, ...missing];
        if (moveBy) patch.points = m.points.map(([x, y]) => [x + dx, y + dy]);
        if (Object.keys(patch).length) store.update(m.id, patch);
      }
    });
    const nextSynced = { title: t.title, status: mainStatus, at: target };
    const nextLink: BcfLink = { sheet: key, markupIds: markups.map((m) => m.id), synced: nextSynced };
    if (!link || JSON.stringify(link) !== JSON.stringify(nextLink)) change({ links: [...t.links.filter((l) => l !== link), nextLink] });
  }
  return t;
}

/** Takes an issue's markups off every sheet (the issue is being deleted). */
export function removeTopicMarkups(topic: BcfTopic, stores: readonly MarkupStore[]): void {
  for (const store of new Set(stores)) {
    const ids = store.all().filter((m) => m.bcf?.guid === topic.guid).map((m) => m.id);
    if (ids.length) store.follow(() => store.remove(ids));
  }
}

/** An issue's cloud and callout at a page point. */
export function issueMarkups(t: BcfTopic, pageIndex: number, [x, y]: Pt, author: string, now: number): Markup[] {
  const groupId = crypto.randomUUID();
  const status = markupStatusOf(t.status);
  const base = { pageIndex, subject: BCF_SUBJECT, groupId, status, author, createdAt: now, modifiedAt: now };
  const h = CLOUD / 2;
  return [
    {
      ...base,
      id: crypto.randomUUID(),
      type: 'cloud',
      points: [
        [x - h, y - h],
        [x + h, y + h],
      ],
      style: { ...DEFAULT_STYLES.cloud, stroke: COLOUR },
      bcf: { guid: t.guid, role: 'cloud' },
    },
    {
      ...base,
      id: crypto.randomUUID(),
      type: 'callout',
      points: [
        [x + h, y - h],
        [x + 2 * CLOUD, y - 2 * CLOUD],
        [x + 2 * CLOUD, y - 2 * CLOUD - 22],
        [x + 2 * CLOUD + 170, y - 2 * CLOUD],
      ],
      text: t.title,
      style: { ...DEFAULT_STYLES.callout, stroke: COLOUR },
      ...(t.comments.length ? { replies: t.comments.map((c) => ({ id: c.guid, author: c.author, text: c.text, createdAt: Date.parse(c.date) || now })) } : {}),
      bcf: { guid: t.guid, role: 'callout' },
    },
  ];
}

function centre(points: readonly (readonly [number, number])[]): Pt {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
