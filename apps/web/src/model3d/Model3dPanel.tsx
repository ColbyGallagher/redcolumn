import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { msg, msgc } from '@nb/i18n';
import type { ClassEntry, ColourAction, ColourProfile, ItemMap, ModelControls, ModelInfo, ModelState, ResolvedProfile, SavedView, SearchSet, SelectionInfo, SheetOverlay, TreeNode } from '@nb/model3d';
import { itemCount, paletteColour, parseSearchSets, searchable } from '@nb/model3d/controls';
import type { ModelView } from '../documents/openTabs';
import { lazy } from '../i18n/lazy';
import { exportSearchSets, updateModelLibrary, useModelLibrary } from './library';
import { Issues } from './Issues';
import { sheetsAt, type SheetHit } from './links';
import { sheetOverlay, type SheetSetting, type SheetSource } from './sheetOverlays';

/** The profile made by Colour by Class (not kept in the library). */
export const CLASS_PROFILE = '__classes';

/** The model in front's view state and controls, or nulls while it loads (or with no model in front). */
function useModel(view: ModelView | null): { state: ModelState | null; controls: ModelControls | null } {
  const state = useSyncExternalStore(
    (l) => view?.subscribe(l) ?? (() => {}),
    () => view?.controls()?.state() ?? null,
  );
  return { state, controls: state ? (view?.controls() ?? null) : null };
}

/** Runs an async read of the view again whenever `controls` or `version` changes; null until the first answer. */
function useAsk<T>(controls: ModelControls | null, read: (c: ModelControls) => Promise<T>, version: number | undefined): T | null {
  // The answer keeps the view it came from: another model's answer is never shown, while a newer
  // answer for the same view replaces the last without flashing empty.
  const [answer, setAnswer] = useState<{ from: ModelControls; value: T } | null>(null);
  useEffect(() => {
    if (!controls) return;
    let live = true;
    read(controls).then(
      (value) => live && setAnswer({ from: controls, value }),
      (err: unknown) => console.warn('3D panel:', err),
    );
    return () => {
      live = false;
    };
    // `read` is a fresh closure each render; `controls` and `version` say when the answer can change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, version]);
  return answer && answer.from === controls ? answer.value : null;
}

function Section({ title, count, children, open = true }: { title: string; count?: number; children: ReactNode; open?: boolean }) {
  return (
    <details className="m3d-section" open={open}>
      <summary>
        {title}
        {count !== undefined && <span className="m3d-count">{count}</span>}
      </summary>
      <div className="m3d-body">{children}</div>
    </details>
  );
}

const EYE = 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z';
function Icon({ d, children }: { d?: string; children?: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
      {d && <path d={d} />}
      {children}
    </svg>
  );
}

/** Small buttons after a row: select, isolate, hide and show what it stands for. */
function ItemButtons({ controls, items, label }: { controls: ModelControls; items: ItemMap; label: string }) {
  const empty = !itemCount(items);
  return (
    <span className="m3d-actions">
      <button type="button" className="icon-btn" title={msg('Isolate {label}', { label })} aria-label={msg('Isolate {label}', { label })} disabled={empty} onClick={() => controls.run({ type: 'isolateItems', items })}>
        <Icon d="M5 5h6v6H5z">
          <path d="M1.5 3V1.5H3M13 1.5h1.5V3M14.5 13v1.5H13M3 14.5H1.5V13" />
        </Icon>
      </button>
      <button type="button" className="icon-btn" title={msg('Hide {label}', { label })} aria-label={msg('Hide {label}', { label })} disabled={empty} onClick={() => controls.run({ type: 'itemsVisible', items, visible: false })}>
        <Icon d={`${EYE}M2.5 2.5l11 11`} />
      </button>
      <button type="button" className="icon-btn" title={msg('Show {label}', { label })} aria-label={msg('Show {label}', { label })} disabled={empty} onClick={() => controls.run({ type: 'itemsVisible', items, visible: true })}>
        <Icon d={EYE}>
          <circle cx="8" cy="8" r="2" />
        </Icon>
      </button>
    </span>
  );
}

/** A node's own element and every element under it. */
function nodeItems(node: TreeNode): ItemMap {
  const ids: number[] = [];
  const walk = (n: TreeNode) => {
    if (n.localId !== null) ids.push(n.localId);
    n.children.forEach(walk);
  };
  walk(node);
  return ids.length ? { [node.modelId]: ids } : {};
}

const prettyClass = (c: string) => (c.startsWith('IFC') ? `Ifc${c.slice(3, 4)}${c.slice(4).toLowerCase()}` : c);

function TreeRow({ node, depth, controls }: { node: TreeNode; depth: number; controls: ModelControls }) {
  // Down to the storeys at first; elements open on request.
  const [open, setOpen] = useState(depth < 4 && node.children.length < 50);
  const items = useMemo(() => nodeItems(node), [node]);
  const label = node.name && node.name !== node.category ? node.name : prettyClass(node.category);
  return (
    <li>
      <div className="m3d-row" style={{ paddingLeft: depth * 12 }}>
        <button type="button" className="m3d-twisty" aria-label={open ? msg('Collapse') : msg('Expand')} aria-expanded={node.children.length ? open : undefined} disabled={!node.children.length} onClick={() => setOpen(!open)}>
          {node.children.length ? (open ? '▾' : '▸') : ''}
        </button>
        <button type="button" className="m3d-name" title={msg('{label} ({category}): select', { label, category: prettyClass(node.category) })} onClick={() => controls.run({ type: 'selectItems', items, fit: true })}>
          {label}
          {node.category && label !== prettyClass(node.category) && <span className="m3d-class">{prettyClass(node.category)}</span>}
        </button>
        <ItemButtons controls={controls} items={items} label={label} />
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((c, i) => (
            <TreeRow key={`${c.localId ?? c.category}-${i}`} node={c} depth={depth + 1} controls={controls} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** What a search set looks for, with its property test in the words given. */
const describeWith = (s: SearchSet, contains: (property: string, value: string) => string, has: (property: string) => string) =>
  [s.category && prettyClass(s.category.toUpperCase()), s.property && (s.value ? contains(s.property, s.value) : has(s.property))].filter(Boolean).join(', ');

/** The name an unnamed set is saved with: kept and exported with the set, so it stays English. */
const defaultSetName = (s: SearchSet) => describeWith(s, (property, value) => `${property} contains “${value}”`, (property) => `has ${property}`);

const describeSet = (s: SearchSet) => describeWith(s, (property, value) => msg('{property} contains “{value}”', { property, value }), (property) => msg('has {property}', { property }));

/** A colour profile's sets searched, ready for the view. */
async function resolve(profile: ColourProfile, sets: readonly SearchSet[], controls: ModelControls): Promise<ResolvedProfile> {
  const out: ResolvedProfile = [];
  for (const rule of profile.rules) {
    const set = sets.find((s) => s.id === rule.setId);
    if (set) out.push({ items: await controls.find(set), action: rule.action });
  }
  return out;
}

interface PanelProps {
  /** The model in front, or null. */
  view: ModelView | null;
  /** The model file's hash: its saved views are kept by it. */
  fileHash: string | null;
  /** Open sheets registered to the map, which can be shown in the model. */
  sheets: readonly SheetSource[];
  onDownload: (name: string, text: string) => void;
  onSaveFile: (name: string, data: Blob) => void;
  onNotice: (text: string) => void;
}

/**
 * The 3D panel: the models in the view, their spatial structure and classes, saved views, search
 * sets and colour profiles. Element properties are in the 3D Properties panel.
 */
export function Model3dPanel({ view, fileHash, sheets, onDownload, onSaveFile, onNotice }: PanelProps) {
  const { state, controls } = useModel(view);
  const lib = useModelLibrary();
  const models = useMemo<ModelInfo[]>(() => controls?.models() ?? [], [controls, state?.modelsVersion]);
  const tree = useAsk(controls, (c) => c.tree(), state?.modelsVersion);
  const classes = useAsk<ClassEntry[]>(controls, (c) => c.classes(), state?.modelsVersion);

  if (!view) return <p className="empty m3d-empty">{msg('Open an IFC model to see its structure, classes and saved views here.')}</p>;
  if (!controls || !state) return <p className="empty m3d-empty">{msg('The model is loading…')}</p>;

  const colourByClass = () => {
    if (state.profileId === CLASS_PROFILE) return controls.run({ type: 'applyProfile', id: null, profile: null });
    controls.run({ type: 'applyProfile', id: CLASS_PROFILE, profile: (classes ?? []).map((c, i) => ({ items: c.items, action: { kind: 'colour', colour: paletteColour(i) } })) });
  };

  return (
    <div className="m3d-panel">
      <Section title={msg('Models')} count={models.length}>
        <ul className="m3d-list">
          {models.map((m) => (
            <li key={m.id} className="m3d-row">
              <label className="m3d-name" title={m.name}>
                <input type="checkbox" checked={m.visible} onChange={(e) => controls.run({ type: 'modelVisible', modelId: m.id, visible: e.target.checked })} /> {m.name}
              </label>
              <span className="m3d-count">{m.elements.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={msg('Spatial tree')}>
        {tree ? (
          <ul className="m3d-tree" aria-label={msg('Spatial tree')}>
            {tree.map((n) => (
              <TreeRow key={n.modelId} node={n} depth={0} controls={controls} />
            ))}
          </ul>
        ) : (
          <p className="empty">{msg('Reading the model…')}</p>
        )}
      </Section>
      <Section title={msg('Classes')} count={classes?.length}>
        <div className="panel-toolbar">
          <button type="button" className="btn small" aria-pressed={state.profileId === CLASS_PROFILE} disabled={!classes?.length} onClick={colourByClass}>
            {msg('Colour by class')}
          </button>
          <button type="button" className="btn small" disabled={!state.hidden && !state.profileId} onClick={() => controls.run({ type: 'showAll' })}>
            {msg('Show all')}
          </button>
        </div>
        <ul className="m3d-list" aria-label={msg('Classes')}>
          {(classes ?? []).map((c, i) => (
            <li key={c.category} className="m3d-row">
              {state.profileId === CLASS_PROFILE && <span className="m3d-swatch" style={{ background: paletteColour(i) }} />}
              <button type="button" className="m3d-name" title={msg('Select every {category}', { category: prettyClass(c.category) })} onClick={() => controls.run({ type: 'selectItems', items: c.items })}>
                {prettyClass(c.category)}
              </button>
              <span className="m3d-count">{c.count.toLocaleString()}</span>
              <ItemButtons controls={controls} items={c.items} label={prettyClass(c.category)} />
            </li>
          ))}
        </ul>
      </Section>
      <SheetsInModel controls={controls} state={state} sheets={sheets} fileHash={fileHash} />
      <Issues controls={controls} state={state} fileHash={fileHash} topics={fileHash ? (lib.issues[fileHash] ?? []) : []} sheets={sheets} onSaveFile={onSaveFile} onNotice={onNotice} />
      <SavedViews controls={controls} fileHash={fileHash} views={fileHash ? (lib.views[fileHash] ?? []) : []} profiles={lib.profiles} sets={lib.sets} profileId={state.profileId} />
      <SetsAndColours controls={controls} sets={lib.sets} profiles={lib.profiles} profileId={state.profileId} classes={classes ?? []} onDownload={onDownload} onNotice={onNotice} />
    </div>
  );
}

/** The name an unnamed view is saved with (and the box suggests): it is kept data, so it stays English. */
const defaultViewName = (n: number) => `View ${n}`;

function SavedViews(props: { controls: ModelControls; fileHash: string | null; views: SavedView[]; profiles: ColourProfile[]; sets: SearchSet[]; profileId: string | null }) {
  const { controls, fileHash, views, profiles, sets, profileId } = props;
  const [name, setName] = useState('');
  const setViews = (change: (v: SavedView[]) => SavedView[]) =>
    fileHash && updateModelLibrary((lib) => ({ ...lib, views: { ...lib.views, [fileHash]: change(lib.views[fileHash] ?? []) } }));
  const save = async () => {
    // The class colouring is made on the spot, not kept, so a view keeps only library profiles.
    const keep = profiles.some((p) => p.id === profileId) ? profileId : null;
    const view = await controls.capture(name.trim() || defaultViewName(views.length + 1), keep);
    setViews((v) => [...v, view]);
    setName('');
  };
  const go = async (v: SavedView) => {
    const profile = profiles.find((p) => p.id === v.profileId);
    controls.run({ type: 'applyView', view: v, profile: profile ? await resolve(profile, sets, controls) : null });
  };
  return (
    <Section title={msg('Saved views')} count={views.length}>
      <form
        className="m3d-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input aria-label={msg('View name')} placeholder={defaultViewName(views.length + 1)} value={name} onChange={(e) => setName(e.target.value)} disabled={!fileHash} />
        <button type="submit" className="btn small" disabled={!fileHash} title={msg('Keep the camera, section box, hidden elements and colour profile')}>
          {msg('Save view')}
        </button>
      </form>
      <ul className="m3d-list" aria-label={msg('Saved views')}>
        {views.map((v) => (
          <li key={v.id} className="m3d-row">
            <button type="button" className="m3d-name" title={msg('Go to this view')} onClick={() => void go(v)}>
              {v.name}
            </button>
            {v.sectionBox && <span className="m3d-class">{msgc('saved view with a section box', 'section')}</span>}
            <button type="button" className="icon-btn" aria-label={msg('Delete {name}', { name: v.name })} title={msg('Delete')} onClick={() => setViews((all) => all.filter((x) => x.id !== v.id))}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const ACTIONS = lazy((): { value: ColourAction['kind']; label: string }[] => [
  { value: 'colour', label: msgc('colour rule action', 'Colour') },
  { value: 'ghost', label: msgc('colour rule action', 'Ghost') },
  { value: 'hide', label: msgc('colour rule action', 'Hide') },
]);

function SetsAndColours(props: {
  controls: ModelControls;
  sets: SearchSet[];
  profiles: ColourProfile[];
  profileId: string | null;
  classes: ClassEntry[];
  onDownload: (name: string, text: string) => void;
  onNotice: (text: string) => void;
}) {
  const { controls, sets, profiles, profileId, classes, onDownload, onNotice } = props;
  const blank: SearchSet = { id: '', name: '', category: '', property: '', value: '' };
  const [draft, setDraft] = useState<SearchSet>(blank);
  const [found, setFound] = useState<Record<string, number>>({});
  const importInput = useRef<HTMLInputElement>(null);
  const setSets = (next: SearchSet[]) => updateModelLibrary((lib) => ({ ...lib, sets: next }));
  const setProfiles = (next: ColourProfile[]) => updateModelLibrary((lib) => ({ ...lib, profiles: next }));

  const run = async (set: SearchSet, then: 'select' | 'isolate') => {
    const items = await controls.find(set);
    setFound((f) => ({ ...f, [set.id]: itemCount(items) }));
    if (!itemCount(items)) return onNotice(msg('Nothing in the model matches “{name}”.', { name: set.name }));
    controls.run(then === 'select' ? { type: 'selectItems', items, fit: true } : { type: 'isolateItems', items });
  };
  const add = () => {
    const set = { ...draft, id: crypto.randomUUID(), name: draft.name.trim() || defaultSetName(draft) };
    setSets([...sets, set]);
    setDraft(blank);
  };
  const updateProfile = (id: string, change: (p: ColourProfile) => ColourProfile) => setProfiles(profiles.map((p) => (p.id === id ? change(p) : p)));
  const show = async (p: ColourProfile) => {
    if (profileId === p.id) return controls.run({ type: 'applyProfile', id: null, profile: null });
    controls.run({ type: 'applyProfile', id: p.id, profile: await resolve(p, sets, controls) });
  };

  return (
    <>
      <Section title={msg('Search sets')} count={sets.length}>
        <form
          className="m3d-set-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (searchable(draft)) add();
          }}
        >
          <input aria-label={msg('Set name')} placeholder={msg('Name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input aria-label={msg('Class')} placeholder={msg('Class (e.g. IFCWALL)')} list="m3d-classes" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          <datalist id="m3d-classes">
            {classes.map((c) => (
              <option key={c.category} value={c.category} />
            ))}
          </datalist>
          <input aria-label={msg('Property')} placeholder={msg('Property (e.g. Status)')} value={draft.property} onChange={(e) => setDraft({ ...draft, property: e.target.value })} />
          <input aria-label={msg('Value contains')} placeholder={msg('Value contains')} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} disabled={!draft.property.trim()} />
          <button type="submit" className="btn small" disabled={!searchable(draft)} title={msg('Find elements by class, property or both')}>
            {msg('Add set')}
          </button>
        </form>
        <ul className="m3d-list" aria-label={msg('Search sets')}>
          {sets.map((s) => (
            <li key={s.id} className="m3d-row">
              <button type="button" className="m3d-name" title={msg('{set}: select', { set: describeSet(s) })} onClick={() => void run(s, 'select')}>
                {s.name}
              </button>
              {found[s.id] !== undefined && <span className="m3d-count">{found[s.id]!.toLocaleString()}</span>}
              <button type="button" className="icon-btn" title={msg('Isolate {label}', { label: s.name })} aria-label={msg('Isolate {label}', { label: s.name })} onClick={() => void run(s, 'isolate')}>
                <Icon d="M5 5h6v6H5z">
                  <path d="M1.5 3V1.5H3M13 1.5h1.5V3M14.5 13v1.5H13M3 14.5H1.5V13" />
                </Icon>
              </button>
              <button type="button" className="icon-btn" aria-label={msg('Delete {name}', { name: s.name })} title={msg('Delete')} onClick={() => setSets(sets.filter((x) => x.id !== s.id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="panel-toolbar">
          <button type="button" className="btn small" onClick={() => importInput.current?.click()}>
            {msg('Import…')}
          </button>
          <button type="button" className="btn small" disabled={!sets.length} onClick={() => onDownload('search sets.json', exportSearchSets(sets))}>
            {msg('Export…')}
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void file.text().then((text) => {
                try {
                  const read = parseSearchSets(text).filter((s) => !sets.some((x) => x.id === s.id));
                  setSets([...sets, ...read]);
                  onNotice(read.length ? msg('Added {count, plural, one {# search set} other {# search sets}}.', { count: read.length }) : msg('No new search sets in that file.'));
                } catch {
                  onNotice(msg('That file is not a search set export.'));
                }
              });
            }}
          />
        </div>
      </Section>
      <Section title={msg('Colour profiles')} count={profiles.length}>
        <div className="panel-toolbar">
          <button
            type="button"
            className="btn small"
            disabled={!sets.length}
            title={sets.length ? msg('Colour, ghost or hide elements set by set') : msg('Add a search set first')}
            onClick={() => setProfiles([...profiles, { id: crypto.randomUUID(), name: `Profile ${profiles.length + 1}`, rules: [{ setId: sets[0]!.id, action: { kind: 'colour', colour: '#e8590c' } }] }])}
          >
            {msg('New profile')}
          </button>
        </div>
        {profiles.map((p) => (
          <div key={p.id} className="m3d-profile" data-profile={p.id}>
            <div className="m3d-row">
              <input className="m3d-name" aria-label={msg('Profile name')} value={p.name} onChange={(e) => updateProfile(p.id, (x) => ({ ...x, name: e.target.value }))} />
              <button type="button" className="btn small" aria-pressed={profileId === p.id} onClick={() => void show(p)}>
                {profileId === p.id ? msg('Showing') : msg('Show')}
              </button>
              <button type="button" className="icon-btn" aria-label={msg('Delete {name}', { name: p.name })} title={msg('Delete')} onClick={() => setProfiles(profiles.filter((x) => x.id !== p.id))}>
                ×
              </button>
            </div>
            {p.rules.map((r, i) => (
              <div key={i} className="m3d-rule">
                <select aria-label={msg('Search set')} value={r.setId} onChange={(e) => updateProfile(p.id, (x) => ({ ...x, rules: x.rules.map((y, j) => (j === i ? { ...y, setId: e.target.value } : y)) }))}>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={msg('Action')}
                  value={r.action.kind}
                  onChange={(e) => {
                    const kind = e.target.value as ColourAction['kind'];
                    const action: ColourAction = kind === 'colour' ? { kind, colour: r.action.kind === 'colour' ? r.action.colour : '#e8590c' } : { kind };
                    updateProfile(p.id, (x) => ({ ...x, rules: x.rules.map((y, j) => (j === i ? { ...y, action } : y)) }));
                  }}
                >
                  {ACTIONS().map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {r.action.kind === 'colour' && (
                  <input
                    type="color"
                    aria-label={msg('Colour')}
                    value={r.action.colour}
                    onChange={(e) => updateProfile(p.id, (x) => ({ ...x, rules: x.rules.map((y, j) => (j === i ? { ...y, action: { kind: 'colour', colour: e.target.value } } : y)) }))}
                  />
                )}
                <button type="button" className="icon-btn" aria-label={msg('Remove rule')} title={msg('Remove rule')} onClick={() => updateProfile(p.id, (x) => ({ ...x, rules: x.rules.filter((_, j) => j !== i) }))}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="link-button" disabled={!sets.length} onClick={() => updateProfile(p.id, (x) => ({ ...x, rules: [...x.rules, { setId: sets[0]!.id, action: { kind: 'colour', colour: paletteColour(x.rules.length) } }] }))}>
              {msg('Add rule')}
            </button>
          </div>
        ))}
      </Section>
    </>
  );
}

/** The 3D Properties panel: the selected element's attributes and property and quantity sets. */
export function Model3dPropertiesPanel({ view, sheets, onOpenSheet }: { view: ModelView | null; sheets: readonly SheetSource[]; onOpenSheet: (hit: SheetHit) => void }) {
  const { state, controls } = useModel(view);
  const info = useAsk<SelectionInfo>(controls, (c) => c.selection(), state?.selectionVersion);
  // Where the selection lies on the map, asked again when it changes or the model is placed on the map.
  const place = useAsk(controls, (c) => c.selectionPlace(), state ? state.selectionVersion * 2 + (state.georeferenced ? 1 : 0) : undefined);
  const [filter, setFilter] = useState('');
  if (!view) return <p className="empty m3d-empty">{msg('Select an element in a 3D model to see its properties.')}</p>;
  if (!info?.first) return <p className="empty m3d-empty">{info?.count ? msg('Reading the element…') : msg('Click an element in the model to see its properties.')}</p>;
  const { first, count } = info;
  const f = filter.trim().toLowerCase();
  const groups = first.groups
    .map((g) => ({ ...g, rows: f ? g.rows.filter(([n, v]) => n.toLowerCase().includes(f) || v.toLowerCase().includes(f)) : g.rows }))
    .filter((g) => g.rows.length);
  return (
    <div className="m3d-props">
      <div className="m3d-props-head">
        <strong>{first.name || prettyClass(first.category)}</strong>
        <span className="m3d-class">{prettyClass(first.category)}</span>
        {count > 1 && <span className="m3d-count">{msg('1 of {count} selected', { count: String(count) })}</span>}
        {first.guid && <code className="m3d-guid" title={msg('IFC GlobalId')}>{first.guid}</code>}
      </div>
      <input className="m3d-filter" type="search" aria-label={msg('Filter properties')} placeholder={msg('Filter properties')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      {groups.map((g) => (
        <details key={g.title} className="m3d-section" open>
          <summary>{g.title}</summary>
          <table className="m3d-table">
            <tbody>
              {g.rows.map(([n, v], i) => (
                <tr key={`${n}-${i}`}>
                  <th scope="row">{n}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
      {!groups.length && <p className="empty">{msg('No property matches “{filter}”.', { filter })}</p>}
      {place && <OnDrawings hits={sheetsAt(sheets, place[0], place[1])} onOpen={onOpenSheet} />}
    </div>
  );
}

/** The open sheets showing where the selected element lies on the map, each opening the sheet there. */
function OnDrawings({ hits, onOpen }: { hits: SheetHit[]; onOpen: (hit: SheetHit) => void }) {
  return (
    <details className="m3d-section" open>
      <summary>{msg('On drawings')}</summary>
      {hits.length ? (
        <ul className="m3d-list" aria-label={msg('On drawings')}>
          {hits.map((h) => (
            <li key={h.source.key} className="m3d-row">
              <button type="button" className="btn small m3d-name" title={msg('Open {label} where this element is', { label: h.source.label })} onClick={() => onOpen(h)}>
                {h.source.label}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{msg('No open sheet registered to the map shows this element.')}</p>
      )}
    </details>
  );
}

/** Each model's sheet settings while the app is open, by model file hash, then sheet key. */
const sheetSettings = new Map<string, Record<string, SheetSetting>>();

/**
 * Sheets in the model: every open sheet registered to the map, shown where it lies as a picture on
 * a level plane or with its markups draped over the model. Pictures follow the sheet's markups.
 */
function SheetsInModel({ controls, state, sheets, fileHash }: { controls: ModelControls; state: ModelState; sheets: readonly SheetSource[]; fileHash: string | null }) {
  const [settings, setSettings] = useState<Record<string, SheetSetting>>(() => (fileHash ? (sheetSettings.get(fileHash) ?? {}) : {}));
  const [edits, setEdits] = useState(0);
  const shownKeys = sheets.filter((s) => settings[s.key]?.show).map((s) => s.key);
  const shownStores = [...new Set(sheets.filter((s) => settings[s.key]?.show).map((s) => s.store))];
  // Markups changed on a shown sheet: draw it again, a moment after the last change.
  useEffect(() => {
    let timer = 0;
    const offs = shownStores.map((store) =>
      store.subscribe(() => {
        clearTimeout(timer);
        timer = window.setTimeout(() => setEdits((n) => n + 1), 250);
      }),
    );
    return () => {
      clearTimeout(timer);
      offs.forEach((off) => off());
    };
    // The shown sheets' keys say which stores to watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKeys.join('|')]);
  useEffect(() => {
    if (fileHash) sheetSettings.set(fileHash, settings);
    const abort = new AbortController();
    void Promise.all(
      sheets.filter((s) => settings[s.key]?.show).map((s) => sheetOverlay(s, settings[s.key]!, abort.signal).catch(() => null)),
    ).then((overlays) => {
      if (!abort.signal.aborted) controls.run({ type: 'sheetOverlays', overlays: overlays.filter((o): o is SheetOverlay => !!o) });
    });
    return () => abort.abort();
    // `sheets` is new each render; its keys say when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, settings, edits, shownKeys.join('|'), fileHash]);

  const change = (key: string, patch: Partial<SheetSetting>) =>
    setSettings((all) => {
      const top = state.heights ? Math.round(state.heights[1] * 10) / 10 : 0;
      const was = all[key] ?? { show: false, mode: 'plane' as const, height: top, opacity: 0.85 };
      return { ...all, [key]: { ...was, ...patch } };
    });

  return (
    <Section title={msg('Sheets in the model')} count={shownKeys.length || undefined}>
      {!state.georeferenced ? (
        <p className="empty">{msg('This model has no position on the map (an IFC map conversion), so sheets cannot be placed in it.')}</p>
      ) : !sheets.length ? (
        <p className="empty">{msg('Open a sheet registered to the map (a geospatial PDF, or one registered in the Geospatial panel) to show it here.')}</p>
      ) : (
        <ul className="m3d-list" aria-label={msg('Sheets in the model')}>
          {sheets.map((s) => {
            const set = settings[s.key];
            return (
              <li key={s.key} className="m3d-sheet">
                <label className="m3d-row m3d-name" title={s.label}>
                  <input type="checkbox" checked={!!set?.show} onChange={(e) => change(s.key, { show: e.target.checked })} /> {s.label}
                </label>
                {set?.show && (
                  <div className="m3d-sheet-options">
                    <select aria-label={msg('How {label} shows', { label: s.label })} value={set.mode} onChange={(e) => change(s.key, { mode: e.target.value as SheetSetting['mode'] })}>
                      <option value="plane">{msg('On a plane')}</option>
                      <option value="drape">{msg('Draped on the model')}</option>
                    </select>
                    {set.mode === 'plane' && (
                      <label title={msg('The plane\'s height (metres, the map\'s height datum)')}>
                        {/* translators: Reduced Level, a height above the map's datum */}
                        {msg('RL')}{' '}
                        <input
                          type="number"
                          step="0.1"
                          aria-label={msg('{label} height', { label: s.label })}
                          value={set.height}
                          onChange={(e) => Number.isFinite(e.target.valueAsNumber) && change(s.key, { height: e.target.valueAsNumber })}
                        />
                      </label>
                    )}
                    <input type="range" min="0.1" max="1" step="0.05" aria-label={msg('{label} opacity', { label: s.label })} value={set.opacity} onChange={(e) => change(s.key, { opacity: e.target.valueAsNumber })} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {state.draping > 0 && <p className="empty">{msg('Laying markups over the model…')}</p>}
    </Section>
  );
}
