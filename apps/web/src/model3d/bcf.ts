import type { PlaceCamera } from '@nb/model3d';
import { parseXml, type XmlElement } from '../geospatial/xml';

/**
 * Issues raised in a 3D model, as BCF topics (BIM Collaboration Format 2.1): a title and workflow
 * fields, a comment thread, a camera and a snapshot. Each is also shown as an ordinary markup on
 * the sheets that show its place (see bcfSync.ts). Plain data: the viewer is not needed to read,
 * change, import or export them.
 */

type Vec3 = [number, number, number];

export const BCF_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'] as const;
export const BCF_PRIORITIES = ['Low', 'Normal', 'High', 'Critical'] as const;

export interface BcfComment {
  guid: string;
  author: string;
  /** ISO 8601. */
  date: string;
  text: string;
}

export interface BcfTopic {
  guid: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  /** Who is to act on it (BCF AssignedTo). */
  assignee: string;
  /** YYYY-MM-DD, or empty. */
  dueDate: string;
  labels: string[];
  author: string;
  /** ISO 8601. */
  created: string;
  modified: string;
  comments: BcfComment[];
  /** Where the issue is: grid easting, northing and height. Null when imported without one. */
  point: Vec3 | null;
  /** The camera it was raised with, on the map. */
  camera: PlaceCamera | null;
  /** A picture of the view (a data URL), or null. */
  snapshot: string | null;
  /** The markups showing it, by sheet (`fileId:pageIndex:regionId`). */
  links: BcfLink[];
  /** Sheets where its markups were deleted: it is not drawn there again. */
  dismissed: string[];
}

export interface BcfLink {
  sheet: string;
  markupIds: string[];
  /** The values last written to or read from the markups, to tell which side changed since. */
  synced: { title: string; status: string; at: [number, number] };
}

export function newTopic(fields: { title: string; author: string; point: Vec3 | null; camera: PlaceCamera | null; snapshot: string | null }, now = new Date()): BcfTopic {
  const at = now.toISOString();
  return {
    guid: crypto.randomUUID(),
    title: fields.title,
    description: '',
    status: 'Open',
    priority: 'Normal',
    assignee: '',
    dueDate: '',
    labels: [],
    author: fields.author,
    created: at,
    modified: at,
    comments: [],
    point: fields.point,
    camera: fields.camera,
    snapshot: fields.snapshot,
    links: [],
    dismissed: [],
  };
}

// --- status: a topic's status and its markups' review status ---

/** The markup status that shows a topic status: open issues are None, resolved ones Completed, closed ones Accepted. */
export function markupStatusOf(status: string): string {
  const s = status.trim().toLowerCase();
  if (s === 'resolved') return 'completed';
  if (s === 'closed') return 'accepted';
  return 'none';
}

/** The topic status a markup status set on the sheet means; the topic's own when it already shows that way (or the status is not one of the review statuses). */
export function topicStatusOf(markupStatus: string, current: string): string {
  if (markupStatusOf(current) === markupStatus) return current;
  switch (markupStatus) {
    case 'none':
      return 'Open';
    case 'completed':
      return 'Resolved';
    case 'accepted':
    case 'rejected':
    case 'cancelled':
      return 'Closed';
    default:
      return current;
  }
}

// --- filters for the Issues list ---

export interface IssueFilter {
  status: string;
  assignee: string;
  text: string;
}

export function filterTopics(topics: readonly BcfTopic[], f: IssueFilter): BcfTopic[] {
  const text = f.text.trim().toLowerCase();
  return topics.filter(
    (t) =>
      (!f.status || t.status === f.status) &&
      (!f.assignee || t.assignee === f.assignee) &&
      (!text || [t.title, t.description, t.assignee, ...t.labels, ...t.comments.map((c) => c.text)].some((v) => v.toLowerCase().includes(text))),
  );
}

// --- coordinates: grid (the map) and the model's own (IFC) ---

/** A 4x4 affine map (column-major, as IfcMapConversion is kept) applied to points and to directions. */
export interface Affine {
  point(p: Vec3): Vec3;
  direction(d: Vec3): Vec3;
}

const IDENTITY: Affine = { point: (p) => [...p], direction: (d) => [...d] };

export function affine(m: readonly number[]): Affine {
  const at = (r: number, c: number) => m[c * 4 + r]!;
  const lin = (v: Vec3): Vec3 => [0, 1, 2].map((r) => at(r, 0) * v[0] + at(r, 1) * v[1] + at(r, 2) * v[2]) as Vec3;
  return { point: (p) => lin(p).map((v, r) => v + at(r, 3)) as Vec3, direction: lin };
}

/** The inverse of an affine 4x4 (column-major); null when it has none. */
export function invertAffine(m: readonly number[]): number[] | null {
  const a = (r: number, c: number) => m[c * 4 + r]!;
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = [a(0, 0), a(0, 1), a(0, 2), a(1, 0), a(1, 1), a(1, 2), a(2, 0), a(2, 1), a(2, 2)];
  const det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    [(a11 * a22 - a12 * a21) / det, (a02 * a21 - a01 * a22) / det, (a01 * a12 - a02 * a11) / det],
    [(a12 * a20 - a10 * a22) / det, (a00 * a22 - a02 * a20) / det, (a02 * a10 - a00 * a12) / det],
    [(a10 * a21 - a11 * a20) / det, (a01 * a20 - a00 * a21) / det, (a00 * a11 - a01 * a10) / det],
  ];
  const t = [a(0, 3), a(1, 3), a(2, 3)];
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[c * 4 + r] = inv[r]![c]!;
    out[12 + r] = -(inv[r]![0]! * t[0]! + inv[r]![1]! * t[1]! + inv[r]![2]! * t[2]!);
  }
  out[15] = 1;
  return out;
}

// --- .bcfzip ---

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const el = (name: string, text: string) => (text ? `<${name}>${esc(text)}</${name}>` : '');
const xyz = (name: string, v: Vec3) => `<${name}><X>${v[0]}</X><Y>${v[1]}</Y><Z>${v[2]}</Z></${name}>`;
const enc = new TextEncoder();
const HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** What a topic adds to a .bcfzip that the format has no place for: its point and camera target on the map. */
interface Extra {
  point: Vec3 | null;
  target: Vec3 | null;
}

const EXTRA = 'redcolumn.json';

/**
 * A .bcfzip's files for these topics. Cameras are written in the model's own coordinates
 * (`toIfc` takes grid to IFC); snapshots are PNG bytes by topic GUID.
 */
export function bcfFiles(topics: readonly BcfTopic[], toIfc: Affine = IDENTITY, snapshots: ReadonlyMap<string, Uint8Array> = new Map()): { name: string; data: Uint8Array }[] {
  const files: { name: string; data: Uint8Array }[] = [{ name: 'bcf.version', data: enc.encode(`${HEADER}<Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>\n`) }];
  for (const t of topics) {
    const vp = t.camera ? crypto.randomUUID() : null;
    const png = snapshots.get(t.guid);
    const markup =
      `${HEADER}<Markup>` +
      `<Topic Guid="${esc(t.guid)}" TopicType="Issue" TopicStatus="${esc(t.status)}">` +
      el('Title', t.title) +
      el('Priority', t.priority) +
      t.labels.map((l) => el('Labels', l)).join('') +
      el('CreationDate', t.created) +
      el('CreationAuthor', t.author) +
      el('ModifiedDate', t.modified) +
      el('AssignedTo', t.assignee) +
      el('DueDate', t.dueDate) +
      el('Description', t.description) +
      `</Topic>` +
      t.comments.map((c) => `<Comment Guid="${esc(c.guid)}">${el('Date', c.date)}${el('Author', c.author)}${el('Comment', c.text)}</Comment>`).join('') +
      (vp ? `<Viewpoints Guid="${vp}"><Viewpoint>viewpoint.bcfv</Viewpoint>${png ? '<Snapshot>snapshot.png</Snapshot>' : ''}</Viewpoints>` : '') +
      `</Markup>\n`;
    files.push({ name: `${t.guid}/markup.bcf`, data: enc.encode(markup) });
    if (t.camera && vp) files.push({ name: `${t.guid}/viewpoint.bcfv`, data: enc.encode(viewpointXml(vp, t.camera, toIfc)) });
    if (png) files.push({ name: `${t.guid}/snapshot.png`, data: png });
    const extra: Extra = { point: t.point, target: t.camera?.target ?? null };
    files.push({ name: `${t.guid}/${EXTRA}`, data: enc.encode(JSON.stringify(extra)) });
  }
  return files;
}

function viewpointXml(guid: string, c: PlaceCamera, toIfc: Affine): string {
  const position = toIfc.point(c.position);
  const dir = normal(toIfc.direction(sub(c.target, c.position)));
  // Up is the model's Z, tipped to be square to the view.
  const up = normal(sub([0, 0, 1], scale(dir, dir[2])));
  const upVec: Vec3 = Math.hypot(...up) > 1e-6 ? up : [0, 1, 0];
  const camera =
    c.projection === 'Orthographic'
      ? `<OrthogonalCamera>${xyz('CameraViewPoint', position)}${xyz('CameraDirection', dir)}${xyz('CameraUpVector', upVec)}<ViewToWorldScale>${Math.max(1, Math.hypot(...sub(c.target, c.position)))}</ViewToWorldScale></OrthogonalCamera>`
      : `<PerspectiveCamera>${xyz('CameraViewPoint', position)}${xyz('CameraDirection', dir)}${xyz('CameraUpVector', upVec)}<FieldOfView>${c.fov}</FieldOfView></PerspectiveCamera>`;
  return `${HEADER}<VisualizationInfo Guid="${guid}">${camera}</VisualizationInfo>\n`;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const normal = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return scale(a, 1 / l);
};

const child = (e: XmlElement | undefined, name: string) => e?.children.find((c) => c.name === name);
const text = (e: XmlElement | undefined, name: string) => child(e, name)?.text.trim() ?? '';
const vec = (e: XmlElement | undefined): Vec3 | null => {
  const v = [text(e, 'X'), text(e, 'Y'), text(e, 'Z')].map(Number);
  return e && v.every(Number.isFinite) ? (v as Vec3) : null;
};

/** How far ahead of an imported camera its target is put, when the file does not say (metres). */
const DEFAULT_REACH = 20;

/**
 * Topics from a .bcfzip's files (2.0, 2.1 or 3.0 topics; their first viewpoint). Cameras come in
 * through `toGrid` (IFC to grid). Topics already here keep their links to markups: `known` gives them.
 */
export function readBcf(files: readonly { name: string; data: Uint8Array }[], toGrid: Affine = IDENTITY, known: readonly BcfTopic[] = []): BcfTopic[] {
  const dec = new TextDecoder();
  const byName = new Map(files.map((f) => [f.name.replace(/\\/g, '/'), f.data]));
  const topics: BcfTopic[] = [];
  for (const [name, data] of byName) {
    const m = /^(?:.*\/)?([^/]+)\/markup\.bcf$/i.exec(name);
    if (!m) continue;
    const folder = name.slice(0, -'markup.bcf'.length);
    const markup = child(parseXml(dec.decode(data)), 'Markup');
    const topic = child(markup, 'Topic');
    if (!topic) continue;
    const guid = topic.attrs.Guid || m[1]!;
    const labels = [...(topic.children.filter((c) => c.name === 'Labels').map((c) => c.text.trim()) ?? []), ...(child(topic, 'Labels')?.children.filter((c) => c.name === 'Label').map((c) => c.text.trim()) ?? [])].filter(Boolean);
    const comments = (markup!.children.filter((c) => c.name === 'Comment').concat(child(topic, 'Comments')?.children.filter((c) => c.name === 'Comment') ?? []))
      .map((c) => ({ guid: c.attrs.Guid || crypto.randomUUID(), author: text(c, 'Author'), date: text(c, 'Date'), text: text(c, 'Comment') }))
      .filter((c) => c.text);
    // 2.x lists viewpoints on the markup; 3.0 inside the topic.
    const vpEntry = child(markup, 'Viewpoints') ?? child(child(topic, 'Viewpoints'), 'ViewPoint');
    const vpFile = text(vpEntry, 'Viewpoint') || (vpEntry ? 'viewpoint.bcfv' : '');
    const snapFile = text(vpEntry, 'Snapshot');
    let extra: Extra = { point: null, target: null };
    const extraData = byName.get(folder + EXTRA);
    if (extraData) {
      try {
        extra = JSON.parse(dec.decode(extraData)) as Extra;
      } catch {
        // Not ours after all: read without it.
      }
    }
    const vpData = vpFile ? byName.get(folder + vpFile) : undefined;
    const camera = vpData ? readCamera(dec.decode(vpData), toGrid, extra.target) : null;
    const snap = snapFile ? byName.get(folder + snapFile) : undefined;
    const was = known.find((t) => t.guid === guid);
    topics.push({
      guid,
      title: text(topic, 'Title') || 'Untitled issue',
      description: text(topic, 'Description'),
      status: topic.attrs.TopicStatus || 'Open',
      priority: text(topic, 'Priority'),
      assignee: text(topic, 'AssignedTo'),
      dueDate: text(topic, 'DueDate').slice(0, 10),
      labels,
      author: text(topic, 'CreationAuthor'),
      created: text(topic, 'CreationDate'),
      modified: text(topic, 'ModifiedDate') || text(topic, 'CreationDate'),
      comments,
      point: validPoint(extra.point) ?? camera?.target ?? null,
      camera,
      snapshot: snap ? `data:image/${/\.jpe?g$/i.test(snapFile) ? 'jpeg' : 'png'};base64,${toBase64(snap)}` : null,
      links: was?.links ?? [],
      dismissed: was?.dismissed ?? [],
    });
  }
  return topics;
}

function validPoint(p: unknown): Vec3 | null {
  return Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (p as Vec3) : null;
}

function readCamera(xml: string, toGrid: Affine, target: Vec3 | null): PlaceCamera | null {
  const info = child(parseXml(xml), 'VisualizationInfo');
  const persp = child(info, 'PerspectiveCamera');
  const cam = persp ?? child(info, 'OrthogonalCamera');
  const pos = vec(child(cam, 'CameraViewPoint'));
  const dir = vec(child(cam, 'CameraDirection'));
  if (!cam || !pos || !dir) return null;
  const position = toGrid.point(pos);
  const reach = persp ? DEFAULT_REACH : Number(text(cam, 'ViewToWorldScale')) || DEFAULT_REACH;
  const fov = Number(text(cam, 'FieldOfView'));
  return {
    position,
    target: validPoint(target) ?? toGrid.point([pos[0] + dir[0] * reach, pos[1] + dir[1] * reach, pos[2] + dir[2] * reach]),
    projection: persp ? 'Perspective' : 'Orthographic',
    fov: Number.isFinite(fov) && fov > 0 ? fov : 60,
  };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The bytes of a data URL. */
export function dataUrlBytes(url: string): Uint8Array {
  const b = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
