import { useRef, useState } from 'react';
import { msg, msgc } from '@nb/i18n';
import { MarkupStore } from '@nb/markup';
import type { ModelControls, ModelState } from '@nb/model3d';
import { unzipFiles, zipFiles } from '../documents/zip';
import { affine, BCF_PRIORITIES, BCF_STATUSES, bcfFiles, dataUrlBytes, filterTopics, invertAffine, newTopic, readBcf, type BcfTopic, type IssueFilter } from './bcf';
import { removeTopicMarkups } from './bcfSync';
import { updateIssues } from './library';
import { modelGeoreference } from './onDrawing';
import type { SheetSource } from './sheetOverlays';

interface Props {
  controls: ModelControls;
  state: ModelState;
  fileHash: string | null;
  topics: BcfTopic[];
  sheets: readonly SheetSource[];
  onSaveFile: (name: string, data: Blob) => void;
  onNotice: (text: string) => void;
}

/** The title an untitled issue gets (and the box suggests): it is saved and exported in BCF, so it stays English. */
const defaultIssueTitle = (n: number) => `Issue ${n}`;

/** The longest side of an issue's snapshot, in pixels (kept with the issue). */
const SNAPSHOT_WIDTH = 480;

/**
 * Issues raised in the model (BCF topics): each with its place, camera and a snapshot, workflow
 * fields and comments, and shown as a cloud and callout on the sheets that hold its place.
 */
export function Issues({ controls, state, fileHash, topics, sheets, onSaveFile, onNotice }: Props) {
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState<IssueFilter>({ status: '', assignee: '', text: '' });
  const [openId, setOpenId] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const set = (change: (t: BcfTopic[]) => BcfTopic[]) => fileHash && updateIssues(fileHash, change);
  const edit = (guid: string, patch: Partial<BcfTopic>) => set((all) => all.map((t) => (t.guid === guid ? { ...t, ...patch, modified: new Date().toISOString() } : t)));
  const shown = filterTopics(topics, filter);
  const assignees = [...new Set(topics.map((t) => t.assignee).filter(Boolean))].sort();

  const raise = async () => {
    const camera = controls.cameraPlace();
    if (!camera) return;
    const point = (await controls.selectionPlace()) ?? camera.target;
    const topic = newTopic({ title: title.trim() || defaultIssueTitle(topics.length + 1), author: MarkupStore.author, point, camera, snapshot: controls.snapshot(SNAPSHOT_WIDTH) });
    set((all) => [...all, topic]);
    setTitle('');
    setOpenId(topic.guid);
  };

  /** Grid to the model's own coordinates and back, from its map conversion. */
  const transforms = async () => {
    if (!fileHash) return null;
    const geo = await modelGeoreference({ hash: fileHash }).catch(() => null);
    const inverse = geo?.georeferenced ? invertAffine(geo.matrix) : null;
    return geo && inverse ? { toGrid: affine(geo.matrix), toIfc: affine(inverse) } : null;
  };

  const exportBcf = async () => {
    const t = await transforms();
    const pngs = new Map<string, Uint8Array>();
    for (const topic of topics) if (topic.snapshot) pngs.set(topic.guid, await pngOf(topic.snapshot));
    const zip = zipFiles(bcfFiles(topics, t?.toIfc, pngs));
    onSaveFile('issues.bcfzip', new Blob([zip as BlobPart], { type: 'application/zip' }));
  };

  const importBcf = async (file: File) => {
    try {
      const t = await transforms();
      const read = readBcf(await unzipFiles(new Uint8Array(await file.arrayBuffer())), t?.toGrid, topics);
      if (!read.length) return onNotice(msg('That file has no issues in it.'));
      set((all) => [...all.filter((x) => !read.some((r) => r.guid === x.guid)), ...read]);
      onNotice(msg('{count, plural, one {# issue} other {# issues}} imported.', { count: read.length }));
    } catch (err) {
      onNotice(msg('That file could not be read as BCF: {error}', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const remove = (t: BcfTopic) => {
    const n = t.links.length;
    if (!confirm(n ? msg('Delete “{title}” and its markups on {count, plural, one {# sheet} other {# sheets}}?', { title: t.title, count: n }) : msg('Delete “{title}”?', { title: t.title }))) return;
    removeTopicMarkups(t, sheets.map((s) => s.store));
    set((all) => all.filter((x) => x.guid !== t.guid));
  };

  return (
    <details className="m3d-section" open>
      <summary>
        {msg('Issues')}
        <span className="m3d-count">{topics.length}</span>
      </summary>
      <div className="m3d-body">
        {!state.georeferenced && <p className="empty">{msg('Issues need the model’s position on the map (an IFC map conversion), so they can be shown on sheets.')}</p>}
        <form
          className="m3d-form"
          onSubmit={(e) => {
            e.preventDefault();
            void raise();
          }}
        >
          <input aria-label={msg('Issue title')} placeholder={defaultIssueTitle(topics.length + 1)} value={title} onChange={(e) => setTitle(e.target.value)} disabled={!fileHash || !state.georeferenced} />
          <button type="submit" className="btn small" disabled={!fileHash || !state.georeferenced} title={msg('Raise an issue at the selected element (or what the camera looks at), with this view')}>
            {msg('New issue')}
          </button>
        </form>
        <div className="panel-toolbar">
          <button type="button" className="btn small" disabled={!fileHash} onClick={() => importInput.current?.click()}>
            {msg('Import BCF…')}
          </button>
          <button type="button" className="btn small" disabled={!topics.length} onClick={() => void exportBcf()}>
            {msg('Export BCF…')}
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".bcfzip,.bcf,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importBcf(f);
            }}
          />
        </div>
        {topics.length > 0 && (
          <div className="m3d-issue-filters">
            <select aria-label={msg('Filter issues by status')} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">{msg('Any status')}</option>
              {statusesOf(topics).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select aria-label={msg('Filter issues by assignee')} value={filter.assignee} onChange={(e) => setFilter({ ...filter, assignee: e.target.value })}>
              <option value="">{msg('Anyone')}</option>
              {assignees.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <input type="search" aria-label={msg('Search issues')} placeholder={msg('Search')} value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
          </div>
        )}
        <ul className="m3d-list" aria-label={msg('Issues')}>
          {shown.map((t) => (
            <li key={t.guid} className="m3d-issue">
              <div className="m3d-row">
                <button type="button" className="m3d-name" aria-expanded={openId === t.guid} title={msg('Show this issue')} onClick={() => {
                  setOpenId(openId === t.guid ? null : t.guid);
                  if (t.camera) controls.run({ type: 'lookAtPlace', camera: t.camera });
                }}>
                  {t.title}
                </button>
                <span className="m3d-class">{t.status}</span>
                {t.links.length > 0 && <span className="m3d-count" title={msg('Sheets it shows on')}>{t.links.length}</span>}
                <button type="button" className="icon-btn" aria-label={msg('Delete {name}', { name: t.title })} title={msg('Delete')} onClick={() => remove(t)}>
                  ×
                </button>
              </div>
              {openId === t.guid && <IssueDetail topic={t} onEdit={(patch) => edit(t.guid, patch)} />}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function statusesOf(topics: readonly BcfTopic[]): string[] {
  return [...new Set([...BCF_STATUSES, ...topics.map((t) => t.status)])];
}

function IssueDetail({ topic: t, onEdit }: { topic: BcfTopic; onEdit: (patch: Partial<BcfTopic>) => void }) {
  const [comment, setComment] = useState('');
  return (
    <div className="m3d-issue-detail">
      {t.snapshot && <img className="m3d-snapshot" src={t.snapshot} alt={msg('Snapshot of {title}', { title: t.title })} />}
      <label>
        {msg('Title')}
        <input value={t.title} onChange={(e) => onEdit({ title: e.target.value })} />
      </label>
      <label>
        {msg('Status')}
        <select value={t.status} onChange={(e) => onEdit({ status: e.target.value })}>
          {statusesOf([t]).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        {msg('Priority')}
        <select value={t.priority} onChange={(e) => onEdit({ priority: e.target.value })}>
          {[...new Set([...BCF_PRIORITIES, t.priority].filter(Boolean))].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        {msg('Assigned to')}
        <input value={t.assignee} onChange={(e) => onEdit({ assignee: e.target.value })} />
      </label>
      <label>
        {msg('Due')}
        <input type="date" value={t.dueDate} onChange={(e) => onEdit({ dueDate: e.target.value })} />
      </label>
      <label>
        {msg('Labels')}
        <input value={t.labels.join(', ')} title={msg('Separated by commas')} onChange={(e) => onEdit({ labels: e.target.value.split(',').map((l) => l.trim()).filter(Boolean) })} />
      </label>
      <label>
        {msg('Description')}
        <textarea rows={3} value={t.description} onChange={(e) => onEdit({ description: e.target.value })} />
      </label>
      <ul className="m3d-comments" aria-label={msg('Comments')}>
        {t.comments.map((c) => (
          <li key={c.guid}>
            <span className="m3d-class">
              {c.author || msg('Someone')} · {c.date ? new Date(c.date).toLocaleString() : ''}
            </span>
            <p>{c.text}</p>
          </li>
        ))}
      </ul>
      <form
        className="m3d-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!comment.trim()) return;
          onEdit({ comments: [...t.comments, { guid: crypto.randomUUID(), author: MarkupStore.author, date: new Date().toISOString(), text: comment.trim() }] });
          setComment('');
        }}
      >
        <input aria-label={msg('Comment')} placeholder={msg('Add a comment')} value={comment} onChange={(e) => setComment(e.target.value)} />
        <button type="submit" className="btn small">
          {msgc('button: add the typed comment', 'Comment')}
        </button>
      </form>
    </div>
  );
}

/** A snapshot as PNG bytes (BCF 2.1 snapshots are PNG). */
async function pngOf(dataUrl: string): Promise<Uint8Array> {
  if (dataUrl.startsWith('data:image/png')) return dataUrlBytes(dataUrl);
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
}
