import { useEffect, useRef, useState, type ReactNode } from 'react';
import { categoriesToXml, parseCategoriesXml } from '@nb/markup';
import { AREA_LABELS, VOLUME_LABELS, type LengthUnit } from '@nb/measure';
import { CONSTRUCTION_TEMPLATE, DEFAULT_SETTINGS, DEFAULT_UNIT_CHOICES, gridUnitOf, settings, switchUnitSystem, type SetTag, type SetTemplate, type Settings, type UnitSystem } from '../settings/settings';
import { addToDictionary, personalWords, removeFromDictionary } from '../spelling/spell';
import { askText } from './AskText';
import { AccessPrefs, ActivityPrefs } from './AccessPrefs';
import { McpPrefs } from './McpPrefs';
import { OfflinePrefs } from './OfflinePrefs';
import { desktop } from '../desktop/host';
import { profiles, updateWorkspace } from '../workspace/profiles';
import { listFiles, saveFile as saveToLibrary, type StoredFile } from '../storage/fileStore';
import { pickFilesToOpen } from '../storage/diskHandles';
import { digitalIds, restoreIdBackup, type IdBackup } from '../documents/digitalIds';

/**
 * File › Preferences (Ctrl+K): a search box across the top, categories down the left with each
 * one's sections opening beneath it, and the settings as cards of one-line rows (label left, control
 * right; on/off settings as switches). Changes are made to a draft and kept with Save; Cancel
 * discards them.
 */

export type Category = 'general' | 'account' | 'interface' | 'tools' | 'sets' | 'importExport' | 'advanced' | 'mcp';

const CATEGORIES: { id: Category; label: string; tabs: { id: string; label: string }[] }[] = [
  {
    id: 'general',
    label: 'General',
    tabs: [
      { id: 'options', label: 'Options' },
      { id: 'document', label: 'Document' },
      { id: 'units', label: 'Units' },
      { id: 'navigation', label: 'Navigation' },
      { id: 'grid', label: 'Grid & Snap' },
      { id: 'spelling', label: 'Spelling' },
    ],
  },
  {
    id: 'interface',
    label: 'Interface',
    tabs: [
      { id: 'fileAccess', label: 'File Access' },
      { id: 'markupsList', label: 'Markups List' },
      { id: 'layers', label: 'Layers' },
      { id: 'display', label: 'Display' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    tabs: [
      { id: 'markup', label: 'Markup' },
      { id: 'sketch', label: 'Sketch' },
      { id: 'forms', label: 'Forms' },
      { id: 'signature', label: 'Signature' },
      { id: 'eraser', label: 'Eraser' },
      { id: 'toolLibrary', label: 'Tool Library' },
    ],
  },
  {
    id: 'sets',
    label: 'Sets',
    tabs: [
      { id: 'setOptions', label: 'Set Options' },
      { id: 'sorting', label: 'Sorting' },
      { id: 'categories', label: 'Categories' },
      { id: 'tags', label: 'Tags' },
    ],
  },
  {
    id: 'importExport',
    label: 'Import/Export',
    tabs: [{ id: 'images', label: 'Images' }],
  },
  { id: 'advanced', label: 'Advanced', tabs: [{ id: 'offline', label: 'Offline' }] },
  {
    id: 'account',
    label: 'Account',
    tabs: [
      { id: 'access', label: 'Access' },
      { id: 'activity', label: 'Activity' },
    ],
  },
  { id: 'mcp', label: 'MCP', tabs: [{ id: 'mcp', label: 'Enable MCP server' }] },
];

/** A 16 × 16 line icon beside each category in the sidebar. */
function catIcon(d: string): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const CATEGORY_ICONS: Record<Category, ReactNode> = {
  general: catIcon('M2.5 4h11M2.5 8h11M2.5 12h11M5 2.5v3M10.5 6.5v3M7 10.5v3'),
  interface: catIcon('M2 2.5h12v11H2zM2 5.5h12M5 5.5v8'),
  tools: catIcon('M10.5 2.5 13.5 5.5 6 13H3v-3zM9 4l3 3'),
  sets: catIcon('M4 2.5h8v8H4zM2 5v8.5h8.5'),
  importExport: catIcon('M5 2.5v8M2.5 8 5 10.5 7.5 8M11 13.5v-8M8.5 8 11 5.5 13.5 8'),
  advanced: catIcon('M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'),
  account: catIcon('M8 2.5a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5zM2.5 14c.6-2.8 2.8-4.5 5.5-4.5s4.9 1.7 5.5 4.5'),
  mcp: catIcon('M5.5 2.5v3M10.5 2.5v3M3.5 5.5h9v2.5a4.5 4.5 0 0 1-9 0zM8 12.5v1.5'),
};

/** Settings kept and exported but not used by RedColumn yet: marked in the dialog so nobody expects them to do anything. */
const STORED = new Set<keyof Settings>([
  'richTextComments',
]);
const STORED_TIP = 'Saved with your preferences; RedColumn does not use this yet.';

type KeysOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];
type BoolKey = KeysOf<boolean>;
type NumKey = KeysOf<number>;
type StrKey = KeysOf<string>;

const LENGTH_NAMES: Record<LengthUnit, string> = { mm: 'Millimetres (mm)', cm: 'Centimetres (cm)', m: 'Metres (m)', km: 'Kilometres (km)', in: 'Inches (in)', ft: 'Feet (ft)', yd: 'Yards (yd)', mi: 'Miles (mi)' };
const COLOURSPACE = [
  ['auto', 'Auto-Detect'],
  ['colour', 'Colour'],
  ['grey', 'Greyscale'],
  ['mono', 'Monochrome'],
] as const;
const RESOLUTION = [
  ['auto', 'Auto-Detect'],
  ['72', '72 dpi'],
  ['150', '150 dpi'],
  ['300', '300 dpi'],
  ['600', '600 dpi'],
] as const;
const ASSIGN_BY = ['Drawing Number', 'Sheet Number', 'Sheet Name', 'File Name'];

interface Props {
  author: string;
  onAuthor: (name: string) => void;
  onClose: () => void;
  /** Open on this category. MCP is the desktop assistant. */
  initialCategory?: Category;
  /** Open on this tab of the category. */
  initialTab?: string;
  /** Start with this in the search box (its matches are highlighted). */
  initialQuery?: string;
  /** Render nothing: report every preference's label and where it lives, for the menu bar search. */
  onIndex?: (entries: PrefEntry[]) => void;
}

/** One searchable preference: its label and the category and tab that show it. */
export interface PrefEntry {
  label: string;
  category: Category;
  categoryLabel: string;
  tab: string;
  tabLabel: string;
}

/** What Export writes and Import reads. */
interface PrefsFile {
  app: 'RedColumn';
  kind: 'preferences';
  version: 1;
  author?: string;
  words?: string[];
  settings: Settings;
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A PDF from disk: the native or browser file picker, or a plain file input where there is neither. */
async function pickPdf(): Promise<File | null> {
  const picked = await pickFilesToOpen();
  if (picked) return picked[0] ?? null;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.xml,application/json,text/xml,application/xml';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void f.text().then(resolve, () => resolve(null));
      else resolve(null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function PreferencesDialog({ author, onAuthor, onClose, initialCategory, initialTab, initialQuery, onIndex }: Props) {
  const [d, setD] = useState<Settings>(settings.get);
  const [name, setName] = useState(author);
  const [words, setWords] = useState(personalWords);
  const [category, setCategory] = useState<Category>(initialCategory ?? 'general');
  const [tabs, setTabs] = useState<Partial<Record<Category, string>>>(initialCategory && initialTab ? { [initialCategory]: initialTab } : {});
  const [query, setQuery] = useState(initialQuery ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [pickedWord, setPickedWord] = useState<string | null>(null);
  const [libraryFiles, setLibraryFiles] = useState<StoredFile[]>([]);
  /** Markups List › Wrap Comment Text is the list's own setting (also in its menu), kept with the profile. */
  const [wrapComments, setWrapComments] = useState(() => profiles.active().state.list.wrapComments !== false);
  useEffect(() => {
    if (!onIndex) void listFiles().then(setLibraryFiles, () => undefined);
  }, [onIndex]);
  const indexed = useRef<PrefEntry[]>([]);
  useEffect(() => {
    if (onIndex) onIndex(indexed.current);
  }, [onIndex]);
  const set = (patch: Partial<Settings>) => setD((x) => ({ ...x, ...patch }));

  useEffect(() => {
    if (onIndex) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onIndex]);

  // Labels shown on each tab, collected as the tabs are rendered, for the search box.
  const q = query.trim().toLowerCase();
  const labels: Record<string, string[]> = {};
  let collecting = '';
  const label = (text: string) => {
    (labels[collecting] ??= []).push(text);
    return text;
  };
  const hit = (text: string) => !!q && text.toLowerCase().includes(q);

  /** A label on the left of a row. */
  const L = (text: string, k?: keyof Settings) => (
    <span className={`pref-l${hit(text) ? ' pref-match' : ''}`} title={k && STORED.has(k) ? STORED_TIP : undefined}>
      {label(text)}
      {k && STORED.has(k) && <span className="pref-stored" aria-label="(not used yet)" />}
    </span>
  );

  const check = (k: BoolKey, text: string, o: { indent?: boolean; disabled?: boolean; title?: string } = {}) => (
    <label key={k} className={`pref-check${o.indent ? ' indent' : ''}${o.disabled ? ' disabled' : ''}`} title={STORED.has(k) ? STORED_TIP : o.title}>
      <input type="checkbox" checked={d[k]} disabled={o.disabled} onChange={(e) => set({ [k]: e.target.checked })} />
      <span className={hit(text) ? 'pref-match' : undefined}>
        {label(text)}
        {STORED.has(k) && <span className="pref-stored" aria-label="(not used yet)" />}
      </span>
    </label>
  );

  const select = <K extends StrKey>(k: K, text: string, options: readonly (readonly [string, string, boolean?])[], o: { disabled?: boolean } = {}) => (
    <Row>
      {L(text, k)}
      <select aria-label={text} value={d[k]} disabled={o.disabled} onChange={(e) => set({ [k]: e.target.value } as Partial<Settings>)}>
        {options.map(([v, t, off]) => (
          <option key={v} value={v} disabled={off}>
            {t}
          </option>
        ))}
      </select>
    </Row>
  );

  const num = (k: NumKey, text: string, o: { min: number; max: number; step?: number; unit?: string; disabled?: boolean }) => (
    <Row>
      {L(text, k)}
      <span className={`pref-spin${o.disabled ? ' disabled' : ''}`}>
        <input
          type="number"
          aria-label={text}
          min={o.min}
          max={o.max}
          step={o.step ?? 1}
          value={d[k]}
          disabled={o.disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(v)) set({ [k]: Math.min(o.max, Math.max(o.min, v)) });
          }}
        />
        {o.unit && <span className="unit">{o.unit}</span>}
      </span>
    </Row>
  );

  const colour = (k: StrKey, text: string, o: { disabled?: boolean } = {}) => (
    <Row>
      {L(text, k)}
      <span className={`pref-colour${o.disabled ? ' disabled' : ''}`}>
        <input type="color" aria-label={text} value={d[k]} disabled={o.disabled} onChange={(e) => set({ [k]: e.target.value } as Partial<Settings>)} />
      </span>
    </Row>
  );

  const text = (k: StrKey, t: string, o: { placeholder?: string } = {}) => (
    <Row>
      {L(t, k)}
      <input aria-label={t} value={d[k]} placeholder={o.placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<Settings>)} />
    </Row>
  );

  const head = (t: string) => <h4 className="pref-head">{label(t)}</h4>;

  const snapping = d.snapToGeometry;
  const template: SetTemplate = d.setTemplates[d.setDefaultTemplate] ?? CONSTRUCTION_TEMPLATE;
  const setTemplate = (t: SetTemplate) => set({ setTemplates: { ...d.setTemplates, [d.setDefaultTemplate]: t } });

  const body: Record<string, () => ReactNode> = {
    // General
    options: () => (
      <Grid>
        <Row>
          {L('User')}
          <input aria-label="User" value={name} onChange={(e) => setName(e.target.value)} />
        </Row>
        {select('tabTruncation', 'Tab Truncation', [
          ['start', 'Start'],
          ['middle', 'Middle'],
          ['end', 'End'],
        ])}
        <C>{check('crosshair', 'Show Full-Screen Crosshair')}</C>
        <Row>
          {L('Open PDF on Startup', 'startupFile')}
          <span className="pref-row">
            <select aria-label="Open PDF on Startup" value={d.startupFile} onChange={(e) => set({ startupFile: e.target.value })}>
              <option value="">None</option>
              {[...libraryFiles]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              {d.startupFile && !libraryFiles.some((f) => f.id === d.startupFile) && <option value={d.startupFile}>(Not in the Library)</option>}
            </select>
            <button
              type="button"
              className="btn"
              title="Pick a PDF; it is added to your Library"
              onClick={async () => {
                const f = await pickPdf();
                if (!f) return;
                try {
                  const stored = await saveToLibrary(f.name, await f.arrayBuffer());
                  setLibraryFiles((x) => [...x.filter((e) => e.id !== stored.id), stored]);
                  set({ startupFile: stored.id });
                } catch (err) {
                  setMessage(`That file could not be added: ${(err as Error).message}`);
                }
              }}
            >
              Browse…
            </button>
          </span>
        </Row>
        <C>{check('restoreTabs', 'Reopen Files from Last Session on Startup')}</C>
        <C>{check('startTips', 'Show a Tip on the Start Screen')}</C>
      </Grid>
    ),
    document: () => (
      <Grid>
        <C>{check('documentRecovery', 'Enable Document Recovery')}</C>
        {select('pageLayout', 'Page Layout', [
          ['auto', 'Auto-Detect by page size'],
          ['single', 'Single Page'],
          ['continuous', 'Continuous'],
          ['sideBySide', 'Side by Side'],
          ['continuousSideBySide', 'Continuous Side by Side'],
        ])}
        {num('maxZoom', 'Maximum Zoom', { min: 400, max: 12800, step: 100, unit: '%' })}
      </Grid>
    ),
    units: () => {
      const choices = DEFAULT_UNIT_CHOICES[d.unitSystem];
      const unitSelect = (k: 'lengthUnit' | 'areaUnit' | 'volumeUnit', t: string, units: readonly LengthUnit[], name: (u: LengthUnit) => string) => (
        <Row>
          {L(t, k)}
          <select aria-label={t} value={d[k]} onChange={(e) => set({ [k]: e.target.value as LengthUnit })}>
            {units.map((u) => (
              <option key={u} value={u}>
                {name(u)}
              </option>
            ))}
          </select>
        </Row>
      );
      return (
        <Grid>
          <Row>
            {L('Units', 'unitSystem')}
            <select aria-label="Units" value={d.unitSystem} onChange={(e) => set(switchUnitSystem(d, e.target.value as UnitSystem))}>
              <option value="metric">Metric</option>
              <option value="imperial">Imperial</option>
            </select>
          </Row>
          {unitSelect('lengthUnit', 'Length', choices.length, (u) => LENGTH_NAMES[u])}
          {unitSelect('areaUnit', 'Area', choices.area, (u) => AREA_LABELS[u])}
          {unitSelect('volumeUnit', 'Volume', choices.volume, (u) => VOLUME_LABELS[u])}
        </Grid>
      );
    },
    navigation: () => (
      <Grid>
        {select('singlePageWheel', 'Single Page Mode', [
          ['zoom', 'Zoom'],
          ['scroll', 'Scroll'],
        ])}
        {select('continuousWheel', 'Continuous Mode', [
          ['scroll', 'Scroll'],
          ['zoom', 'Zoom'],
        ])}
        <C>{check('invertWheelZoom', 'Reverse Mouse Wheel when Zooming')}</C>
        {num('wheelSensitivity', 'Sensitivity', { min: 1, max: 10 })}
        {head('Zoom Steps')}
        {num('ctrlWheelZoomStep', 'Ctrl + Wheel', { min: 1, max: 50, unit: '%' })}
        {num('wheelZoomStep', 'Wheel', { min: 1, max: 50, unit: '%' })}
        {num('buttonZoomStep', 'Zoom In / Out', { min: 1, max: 100, unit: '%' })}
      </Grid>
    ),
    grid: () => (
      <Grid>
        <C>{check('showGrid', 'Show Grid')}</C>
        <C>{check('snapToGrid', 'Snap to Grid')}</C>
        {num('gridSize', 'Grid Spacing', { min: 0.01, max: 1000, step: gridUnitOf(d.unitSystem) === 'in' ? 0.125 : 1, unit: gridUnitOf(d.unitSystem) === 'in' ? 'in (set by Units)' : 'mm (set by Units)' })}
        <C>{check('snapToGeometry', 'Snap to Content', { title: 'Lines, ends and intersections in the PDF (hold Alt to bypass)' })}</C>
        <C>{check('snapToMarkup', 'Snap to Markup')}</C>
        <C>{check('snapLines', 'Snap to Lines', { disabled: !snapping })}</C>
        <C>{check('snapCurves', 'Snap to Curves', { disabled: !snapping })}</C>
        <C>{check('snapMidpoints', 'Snap to Mid-Points', { disabled: !snapping })}</C>
        <C>{check('snapEndpoints', 'Snap to End-Points', { disabled: !snapping })}</C>
        <C>{check('snapIntersections', 'Snap to Intersections', { disabled: !snapping })}</C>
        <C>{check('snapCenters', 'Snap to Centres', { title: 'Centres of circles and arcs, in the drawing and in markups' })}</C>
        <C>{check('snapQuadrants', 'Snap to Quadrants', { title: 'The top, bottom, left and right of circles, arcs and ellipses' })}</C>
        <C>{check('snapGeoCenters', 'Snap to Geometric Centres', { title: 'The middle of closed markups: rectangles, polygons and areas' })}</C>
        <C>{check('snapPerpendicular', 'Snap Perpendicular', { title: 'Square off a line or circle from the point being drawn from' })}</C>
        <C>{check('snapTangent', 'Snap Tangent', { title: 'Touching a circle or arc from the point being drawn from' })}</C>
        <C>{check('snapApparent', 'Snap to Apparent Intersections', { disabled: !snapping, title: 'Where two lines would cross if they were extended' })}</C>
        {head('Tracking')}
        <C>{check('objectSnapTracking', 'Object Snap Tracking', { title: 'Rest the pointer on a snap point to pick it up (a small + marks it); move away and the pointer lines up with it straight across or up and down. Rest on it again to drop it.' })}</C>
        <C>{check('snapExtension', 'Extension', { title: 'Rest on the end of a line, then move on past it: the pointer follows the line on beyond its end' })}</C>
        <C>{check('snapParallel', 'Parallel', { title: 'While drawing a line, rest on another line, then move roughly parallel to it: the pointer follows that direction' })}</C>
        <C>{check('polarTracking', 'Polar Tracking', { title: 'While drawing, the pointer lines up at multiples of the polar angle from the last point' })}</C>
        <Row>
          {L('Polar Angle', 'polarAngle')}
          <select aria-label="Polar Angle" value={d.polarAngle} disabled={!d.polarTracking} onChange={(e) => set({ polarAngle: Number(e.target.value) })}>
            {[90, 45, 30, 22.5, 18, 15, 10, 5].map((v) => (
              <option key={v} value={v}>
                {v}°
              </option>
            ))}
          </select>
        </Row>
        <C>{check('polarForObjects', 'Track Objects at Polar Angles', { disabled: !d.polarTracking || !d.objectSnapTracking, title: 'Object snap tracking follows every polar angle from acquired points, not only straight across and up and down' })}</C>
        {num('snapSensitivity', 'Sensitivity', { min: 2, max: 30, disabled: !snapping && !d.snapToMarkup })}
        {colour('snapColour', 'Snap Colour', { disabled: !snapping && !d.snapToMarkup && !d.snapToGrid })}
      </Grid>
    ),
    spelling: () => spellingTab(),
    // Interface
    fileAccess: () => (
      <Grid>
        {num('recentCount', 'Recent Files', { min: 1, max: 50 })}
        {num('recentDays', 'Opened in the Last', { min: 0, max: 365, unit: 'days (0: any time)' })}
      </Grid>
    ),
    markupsList: () => (
      <Grid>
        <C>{check('zoomFitSelected', 'Zoom Fit Markups when selected')}</C>
        <C>{check('richTextComments', 'Use Rich Text for Comments')}</C>
        <C>
          <label className="pref-check">
            <input type="checkbox" checked={wrapComments} onChange={(e) => setWrapComments(e.target.checked)} />
            <span className={hit('Wrap Comment Text') ? 'pref-match' : undefined}>{label('Wrap Comment Text')}</span>
          </label>
        </C>
        <C>{check('excludeFilteredOnExport', 'Exclude Filtered Markups on Export')}</C>
        {select('filteredMarkups', 'Filtered Markups', [
          ['show', 'Show'],
          ['dim', 'Dim'],
          ['hide', 'Hide'],
        ])}
        {num('filteredDim', 'Filtered Annotation Dim', { min: 5, max: 95, unit: '%', disabled: d.filteredMarkups !== 'dim' })}
      </Grid>
    ),
    layers: () => (
      <Grid>
        <C>{check('hideChildLayers', 'Hide Child Layers when Hiding Parent Layers')}</C>
        <C>{check('layersOnPageOnly', 'Show Layers On Page Only')}</C>
        {select('layerDial', 'Dial', [
          ['isolate', 'Isolate'],
          ['fade', 'Fade'],
        ])}
      </Grid>
    ),
    display: () => (
      <Grid>
        {select('pageFilter', 'Page Colours', [
          ['none', 'As printed'],
          ['dark', 'Dark Mode (inverted)'],
          ['dim', 'Dimmer'],
        ])}
        <C>{check('thinLines', 'Disable Line Weights')}</C>
        <C>{check('showRulers', 'Show Rulers')}</C>
        <C>{check('showSpaces', 'Show Spaces')}</C>
        <C>{check('showHyperlinks', 'Show Hyperlink Areas')}</C>
      </Grid>
    ),
    // Tools
    markup: () => (
      <Grid>
        <C>{check('reuseTool', 'Reuse Tools')}</C>
        <C>{check('autoSizeText', 'Auto-size Text Box and Call-out Markups')}</C>
        <C>{check('retainLayerOnCopy', 'Retain Layer Information when copying Markups')}</C>
        <C>{check('replyIndicators', 'Always Show Reply Indicators')}</C>
        <C>{check('embedFonts', 'Embed Fonts')}</C>
        <C>{check('popupAuthorDate', 'Show Author and Date in Pop-Ups')}</C>
        {num('popupOpacity', 'Pop-Up Opacity', { min: 10, max: 100, unit: '%' })}
        <C>{check('copyHighlightedText', 'Copy Highlighted Text into Markup Comment')}</C>
        {select('imageEncoding', 'Default Image Encoding', [
          ['auto', 'Auto-Select'],
          ['jpeg', 'JPEG'],
          ['flate', 'Flate (lossless)'],
        ])}
        <Row>
          {L('Snapshot Resolution', 'snapshotDpi')}
          <select aria-label="Snapshot Resolution" value={d.snapshotDpi} onChange={(e) => set({ snapshotDpi: Number(e.target.value) })}>
            {[...new Set([72, 96, 150, 200, 300, 600, d.snapshotDpi])].sort((a, b) => a - b).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Row>
        <C>{check('confirmDelete', 'Confirm before Deleting Markups')}</C>
        <C>{check('dragToSelect', 'Drag on the Page to Select Markups', { title: 'With Select, dragging on an empty part of the page draws a selection box instead of panning' })}</C>
      </Grid>
    ),
    sketch: () => (
      <Grid>
        {select('rotationInput', 'Rotation Input', [
          ['absolute', 'Absolute'],
          ['relative', 'Relative'],
        ])}
        {select('sketchEllipse', 'Ellipse Mode', [
          ['radius', 'Radius'],
          ['diameter', 'Diameter'],
          ['ellipse', 'Width and Height'],
        ])}
        <C>{check('sketchToScale', 'Draw to Scale', { title: 'Type exact lengths, angles and sizes while drawing' })}</C>
      </Grid>
    ),
    forms: () => (
      <Grid>
        {colour('formHighlightColour', 'Highlight Colour')}
        {num('formHighlightOpacity', 'Highlight Opacity', { min: 0, max: 100 })}
        <C>{check('formSingleKeys', 'Enable Single Key Shortcuts')}</C>
      </Grid>
    ),
    signature: () => (
      <Grid>
        {num('signaturePasswordTimeout', 'Password Time-out', { min: 0, max: 120, unit: 'Minutes' })}
        <Row>
          {L('Digital ID Location')}
          <span className="pref-row">
            <input aria-label="Digital ID Location" value={desktop() ? 'This computer' : 'This browser'} readOnly title="Digital IDs are kept on this device, each locked by its password" />
            {backupButtons('digital-ids')}
          </span>
        </Row>
        <Row>
          {L('Trusted Identity Location')}
          <span className="pref-row">
            <input aria-label="Trusted Identity Location" value={desktop() ? 'This computer' : 'This browser'} readOnly title="Certificates you trust to identify signers are kept on this device" />
            {backupButtons('trusted-identities')}
          </span>
        </Row>
        {select('signatureAlgorithm', 'Algorithm', [
          ['SHA-256', 'SHA-256'],
          ['SHA-384', 'SHA-384'],
          ['SHA-512', 'SHA-512'],
        ])}
        <C>{check('restrictSignedChanges', 'Restrict changes that invalidate digital signatures')}</C>
      </Grid>
    ),
    eraser: () => (
      <Grid>
        {select('eraserSize', 'Size', [
          ['small', 'Small'],
          ['medium', 'Medium'],
          ['large', 'Large'],
        ])}
        <C>{check('eraserWhole', 'Erase Whole Markups', { title: 'The annotation eraser deletes any markup it touches, instead of rubbing out parts of pen strokes' })}</C>
      </Grid>
    ),
    toolLibrary: () => (
      <Grid>
        {select('toolChestMode', 'Clicking a Saved Tool', [
          ['copy', 'Places an exact copy'],
          ['style', 'Draws with its style'],
        ])}
        <C>{check('toolChestSticky', 'Keep the Tool Active after Placing', { title: 'Place several copies in a row; press Esc to stop' })}</C>
        <C>
          <span className="pref-note">Dragging a tool onto the page always places a copy. Right-click a tool to use the other mode once.</span>
        </C>
      </Grid>
    ),
    // Sets
    setOptions: () => (
      <Grid>
        {select('setOpenDocuments', 'Open Documents', [
          ['inPlace', 'Open in Place'],
          ['newTab', 'New Tab'],
        ])}
        {select('setOpenEdited', 'Open Edited Documents', [
          ['inPlace', 'Open in Place'],
          ['newTab', 'New Tab'],
        ])}
        {select('setShow', 'Show', [
          ['fileAndLabel', 'File Name and Page Label'],
          ['fileName', 'File Name'],
          ['pageLabel', 'Page Label'],
        ])}
        <C>{check('setPreview', 'Show preview of PDF')}</C>
        {select('setCategories', 'Categories', [
          ['auto', 'Auto'],
          ['manual', 'Manual'],
          ['none', 'None'],
        ])}
        {select(
          'setDefaultTemplate',
          'Default Template',
          Object.keys(d.setTemplates).map((n) => [n, n] as const),
        )}
        <C>{check('setPromptTemplate', 'Always Prompt for Template Selection')}</C>
      </Grid>
    ),
    sorting: () => (
      <Grid>
        {select('setSortBy', 'Sort By', [
          ['fileAndLabel', 'File Name, Page Label'],
          ['fileName', 'File Name'],
          ['pageLabel', 'Page Label'],
          ['sheetNumber', 'Sheet Number'],
        ])}
        <C>{check('setSortTagged', 'Sort Tagged Pages By Sheet Number')}</C>
        {select('setSortOrder', 'Sort Order', [
          ['asc', 'Alphanumeric Ascending'],
          ['desc', 'Alphanumeric Descending'],
        ])}
        <C>{check('setStackMultiPage', 'Stack Multi-Page Documents')}</C>
        {select('setRevisionFilter', 'Revision Filter', [
          ['auto', 'Auto'],
          ['wildcard', 'Wildcard'],
          ['none', 'None'],
        ])}
        <Row>
          {L('Stack Revisions By')}
          <select
            aria-label="Stack Revisions By"
            value={d.setRevisionFilter === 'wildcard' ? 'wildcard' : 'auto'}
            disabled={d.setRevisionFilter === 'none'}
            title="What makes two sheets revisions of each other"
            onChange={(e) => set({ setRevisionFilter: e.target.value as Settings['setRevisionFilter'] })}
          >
            <option value="auto">Sheet Number, Revision Number</option>
            <option value="wildcard">File Name (Wildcard Syntax)</option>
          </select>
        </Row>
        {text('setWildcard', 'Wildcard Syntax', { placeholder: '*_Rev#  (* the sheet, # its revision)' })}
        {select('setPreviousRevisions', 'Previous Revisions', [
          ['crossOut', 'Cross Out'],
          ['hide', 'Hide'],
          ['none', 'None'],
        ])}
        {select('setCurrentRevisions', 'Current Revisions', [
          ['stack', 'Stack'],
          ['none', 'None'],
        ])}
        <C>{check('setCopyMarkups', 'Copy markups from Previous to Current')}</C>
        <C>{check('setUnflatten', 'Unflatten Markups prior to Copy', { indent: true, disabled: !d.setCopyMarkups })}</C>
        <C>{check('setFlattenAfter', 'Flatten Markups after Copy', { indent: true, disabled: !d.setCopyMarkups })}</C>
        <C>{check('setStampSuperseded', "Stamp previous revisions as 'Superseded'")}</C>
      </Grid>
    ),
    categories: () => (
      <>
        <Grid>
          {select(
            'setDefaultTemplate',
            'Template',
            Object.keys(d.setTemplates).map((n) => [n, n] as const),
          )}
          <Row>
            {L('Assign to Categories by', 'setTemplates')}
            <select aria-label="Assign to Categories by" value={template.assignBy} onChange={(e) => setTemplate({ ...template, assignBy: e.target.value })}>
              {[...new Set([...ASSIGN_BY, template.assignBy])].map((v) => (
                <option key={v} value={v}>
                  Tag: {v}
                </option>
              ))}
            </select>
          </Row>
        </Grid>
        <EditTable
          columns={[label('Category'), label('Filter')]}
          rows={template.categories.map((c) => [c.name, c.filter])}
          onChange={(rows) => setTemplate({ ...template, categories: rows.map(([n, f]) => ({ name: n ?? '', filter: f ?? '' })) })}
          blank={['New Category', '']}
        />
        <div className="pref-buttons">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const n = (await askText('New Template', '', { label: 'Template name', confirm: 'Create' }))?.trim();
              if (n) set({ setTemplates: { ...d.setTemplates, [n]: { assignBy: template.assignBy, categories: [] } }, setDefaultTemplate: n });
            }}
          >
            New
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const raw = await pickFile();
              if (!raw) return;
              try {
                // A Revu categories file (.xml) is read as a template over the current Assign by tag.
                if (/^\uFEFF?\s*</.test(raw)) {
                  const revu = parseCategoriesXml(raw);
                  set({ setTemplates: { ...d.setTemplates, [revu.name]: { assignBy: template.assignBy, categories: revu.categories } }, setDefaultTemplate: revu.name });
                  return;
                }
                const t = JSON.parse(raw) as { name?: string; template?: SetTemplate };
                if (!t.name || !Array.isArray(t.template?.categories)) throw new Error('Not a Sets template');
                set({ setTemplates: { ...d.setTemplates, [t.name]: t.template }, setDefaultTemplate: t.name });
              } catch (err) {
                setMessage(`That file could not be loaded: ${(err as Error).message}`);
              }
            }}
          >
            Load…
          </button>
          <span className="spacer" />
          <button type="button" className="btn" title="Save this template to a file" onClick={() => saveFile(`${d.setDefaultTemplate}.sets-template.json`, JSON.stringify({ name: d.setDefaultTemplate, template }, null, 2))}>
            Save
          </button>
          <button type="button" className="btn" title="Save this template as a Bluebeam Revu categories file" onClick={() => saveFile(`${d.setDefaultTemplate}.xml`, categoriesToXml({ name: d.setDefaultTemplate, categories: template.categories }))}>
            Export for Revu
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const n = (await askText('Save Template As', `${d.setDefaultTemplate} copy`, { label: 'Template name', confirm: 'Save' }))?.trim();
              if (n) set({ setTemplates: { ...d.setTemplates, [n]: structuredClone(template) }, setDefaultTemplate: n });
            }}
          >
            Save As…
          </button>
        </div>
      </>
    ),
    tags: () => (
      <>
        <TagsTable tags={d.setTags} onChange={(setTags) => set({ setTags })} />
        <div className="pref-checks">
          {check('setAutoTagRevision', 'Automatically Tag Revision Number based on Sheet Number')}
          {check('setAutoTagDiscipline', 'Automatically Tag Discipline based on Sheet Number')}
          {check('setAutoTagSheetType', 'Automatically Tag Sheet Type based on Sheet Number')}
        </div>
      </>
    ),
    // Import/Export
    images: () => (
      <Grid>
        {select('photoResolution', 'Photo Resolution', [
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
        ])}
        {select('videoResolution', 'Video Resolution', [
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
        ])}
        {select('cameraOrientation', 'Camera Portrait Orientation', [
          ['none', 'Normal (none)'],
          ['rotate90', 'Rotate 90°'],
          ['rotate180', 'Rotate 180°'],
          ['rotate270', 'Rotate 270°'],
        ])}
        {select('importImageResolution', 'Import Image Resolution', [
          ['original', 'Original'],
          ['300', '300 dpi'],
          ['150', '150 dpi'],
          ['72', '72 dpi'],
        ])}
        {select('imageDrop', 'Image Drag/Drop Behaviour', [
          ['attachPhoto', 'Attach Photo'],
          ['image', 'Image Markup'],
          ['newPage', 'New Page'],
        ])}
        {select('importColourspace', 'Import Image as PDF Colourspace', COLOURSPACE)}
        {select('importResolution', 'Import Image as PDF Resolution', RESOLUTION)}
        <C>{check('scannedJpeg', 'Scanned Colour Images as JPEG')}</C>
        {select('exportColourspace', 'Export PDF as Image Colourspace', COLOURSPACE)}
        {select('exportResolution', 'Export PDF as Image Resolution', RESOLUTION)}
        {select('tiffCompression', 'TIFF Compression', [
          ['ccittG4', 'CCITT G4'],
          ['lzw', 'LZW'],
          ['none', 'None'],
        ])}
        <C>{check('multiPageTiff', 'Create Multi-Page TIFFs')}</C>
        {text('imagePageNumber', 'Page Number')}
      </Grid>
    ),
    // Advanced
    offline: () => (
      <div className="pref-free">
        <span className="pref-search-words">{label('Offline storage OCR languages device')}</span>
        <OfflinePrefs />
      </div>
    ),
    // Account
    access: () => (
      <div className="pref-free">
        <span className="pref-search-words">{label('Access sign in sign out Microsoft OneDrive permission token stay signed in')}</span>
        <AccessPrefs />
      </div>
    ),
    activity: () => (
      <div className="pref-free">
        <span className="pref-search-words">{label('Activity cloud actions log OneDrive uploaded shared deleted')}</span>
        <ActivityPrefs />
      </div>
    ),
    mcp: () => <McpPrefs />,
  };

  /** Back Up… and Restore… for the Digital IDs or trusted certificates kept on this device (applied at once). */
  function backupButtons(kind: IdBackup['kind']) {
    const ids = kind === 'digital-ids';
    return (
      <>
        <button
          type="button"
          className="btn"
          title={ids ? 'Save your Digital IDs to a file (each stays locked by its password)' : 'Save the certificates you trust to a file'}
          onClick={() => {
            const backup: IdBackup = ids ? { app: 'RedColumn', kind, ids: digitalIds.list() } : { app: 'RedColumn', kind, trusted: digitalIds.trustedByHand() };
            saveFile(ids ? 'RedColumn Digital IDs.json' : 'RedColumn Trusted Identities.json', JSON.stringify(backup, null, 2));
          }}
        >
          Back Up…
        </button>
        <button
          type="button"
          className="btn"
          title="Add the ones in a backup file to this device"
          onClick={async () => {
            const raw = await pickFile();
            if (!raw) return;
            try {
              const n = restoreIdBackup(raw, kind);
              setMessage(`${n} ${ids ? `Digital ID${n === 1 ? '' : 's'}` : `trusted certificate${n === 1 ? '' : 's'}`} added.`);
            } catch (err) {
              setMessage(err instanceof SyntaxError ? 'That file is not a backup.' : (err as Error).message);
            }
          }}
        >
          Restore…
        </button>
      </>
    );
  }

  // The Spelling tab's custom words are part of the draft, applied with OK.
  function spellingTab() {
    const picked = pickedWord;
    const setPicked = setPickedWord;
    return (
      <>
        <Grid>
          <C>{check('spellCheck', 'Enable Spell Check')}</C>
          <C>{check('spellUpperCase', 'Include Upper Case Words', { indent: true, disabled: !d.spellCheck })}</C>
          {select('dictionary', 'Active Dictionary', [
            ['en-AU', 'English (Australia)'],
            ['en-GB', 'English (UK)'],
            ['en-US', 'English (US)'],
          ])}
        </Grid>
        <div className="pref-table" role="listbox" aria-label="Custom Words">
          <div className="pref-table-head">
            <span>{label('Custom Words')}</span>
          </div>
          <div className="pref-table-body">
            {words.map((w) => (
              <div key={w} role="option" aria-selected={picked === w} className={`pref-table-row${picked === w ? ' selected' : ''}`} onClick={() => setPicked(w)}>
                <span>{w}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="pref-buttons">
          <button
            type="button"
            className="pref-icon"
            title="Add a word"
            onClick={async () => {
              const w = (await askText('Add Custom Word', '', { label: 'Word', confirm: 'Add' }))?.trim();
              if (w && !words.includes(w)) setWords([...words, w]);
            }}
          >
            +
          </button>
          <button type="button" className="pref-icon" title="Remove the selected word" disabled={!picked} onClick={() => setWords(words.filter((w) => w !== picked))}>
            ×
          </button>
        </div>
      </>
    );
  }

  // Which tabs match the search: render every tab's labels once.
  const listed = desktop() ? CATEGORIES : CATEGORIES.filter((c) => c.id !== 'mcp');
  if (onIndex) {
    const entries: PrefEntry[] = [];
    for (const c of listed) {
      for (const t of c.tabs) {
        collecting = t.id;
        labels[t.id] = [];
        body[t.id]?.();
        const base = { category: c.id, categoryLabel: c.label, tab: t.id, tabLabel: t.label };
        entries.push({ label: t.label, ...base });
        for (const l of new Set(labels[t.id])) if (l.trim() && l !== t.label) entries.push({ label: l, ...base });
      }
    }
    indexed.current = entries;
  }
  const matches = new Set<string>();
  if (q) {
    for (const c of listed) {
      for (const t of c.tabs) {
        collecting = t.id;
        body[t.id]?.();
        if (t.label.toLowerCase().includes(q) || c.label.toLowerCase().includes(q) || (labels[t.id] ?? []).some((l) => l.toLowerCase().includes(q))) matches.add(t.id);
      }
    }
  }
  const visibleCats = q ? listed.filter((c) => c.tabs.some((t) => matches.has(t.id))) : listed;
  const cat = visibleCats.find((c) => c.id === category) ?? visibleCats[0] ?? CATEGORIES[0]!;
  const catTabs = q ? cat.tabs.filter((t) => matches.has(t.id)) : cat.tabs;
  const tab = catTabs.find((t) => t.id === tabs[cat.id]) ?? catTabs[0];
  collecting = tab?.id ?? '';

  const apply = async () => {
    settings.set(d);
    if (wrapComments !== (profiles.active().state.list.wrapComments !== false)) updateWorkspace((s) => ({ ...s, list: { ...s.list, wrapComments } }));
    const n = name.trim();
    if (n && n !== author) onAuthor(n);
    const before = personalWords();
    for (const w of before) if (!words.includes(w)) removeFromDictionary(w);
    for (const w of words) if (!before.includes(w)) await addToDictionary(w).catch(() => undefined);
    onClose();
  };

  const exportPrefs = () => {
    const file: PrefsFile = { app: 'RedColumn', kind: 'preferences', version: 1, author: name.trim() || author, words, settings: d };
    saveFile('RedColumn Preferences.json', JSON.stringify(file, null, 2));
  };

  const importPrefs = async () => {
    const raw = await pickFile();
    if (!raw) return;
    try {
      const file = JSON.parse(raw) as Partial<PrefsFile>;
      if (file.app !== 'RedColumn' || file.kind !== 'preferences') throw new Error('This is not a RedColumn preferences file.');
      setD((x) => ({ ...x, ...settings.parse(raw) }));
      if (typeof file.author === 'string' && file.author.trim()) setName(file.author.trim());
      if (Array.isArray(file.words)) setWords([...new Set([...words, ...file.words.filter((w): w is string => typeof w === 'string')])]);
      setMessage('Preferences imported. Press OK to keep them.');
    } catch (err) {
      setMessage(err instanceof SyntaxError ? 'That file is not a preferences file.' : (err as Error).message);
    }
  };

  const changed = !same(d, settings.get()) || name.trim() !== author || !same(words, personalWords()) || wrapComments !== (profiles.active().state.list.wrapComments !== false);

  if (onIndex) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal prefs-dialog" role="dialog" aria-label="Preferences" onMouseDown={(e) => e.stopPropagation()}>
        <header className="prefs-header">
          <h3>Preferences</h3>
          <label className="prefs-search-box">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" />
            </svg>
            <input className="prefs-search" type="search" placeholder="Find a setting" aria-label="Search preferences" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="button" className="prefs-x" aria-label="Close" title="Close without saving" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="prefs-body">
          <nav className="prefs-nav" role="tablist" aria-orientation="vertical" aria-label="Categories">
            {visibleCats.map((c) => {
              const open = c.id === cat.id;
              return (
                <div key={c.id} className={`prefs-group${open ? ' open' : ''}`}>
                  <button type="button" role="tab" aria-selected={open} aria-expanded={open} className={open ? 'active' : ''} onClick={() => setCategory(c.id)}>
                    <span className="prefs-cat-icon">{CATEGORY_ICONS[c.id]}</span>
                    <span className="prefs-cat-label">{c.label}</span>
                    {q && <span className="prefs-count">{c.tabs.filter((t) => matches.has(t.id)).length}</span>}
                  </button>
                  {open && catTabs.length > 1 && (
                    <div className="prefs-tabs" role="tablist" aria-label={cat.label} aria-orientation="vertical">
                      {catTabs.map((t) => (
                        <button key={t.id} type="button" role="tab" aria-selected={t.id === tab?.id} className={t.id === tab?.id ? 'active' : ''} onClick={() => setTabs((x) => ({ ...x, [cat.id]: t.id }))}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!visibleCats.length && <span className="pref-note">Nothing matches that search</span>}
          </nav>
          <div className="prefs-frame">
            <div className="prefs-title">
              {cat.tabs.length > 1 && <span className="prefs-crumb">{cat.label}</span>}
              <h2>{tab && cat.tabs.length > 1 ? tab.label : cat.label}</h2>
            </div>
            <section className="prefs-section" role="tabpanel">
              {tab ? body[tab.id]?.() : <p className="pref-note">RedColumn has no {cat.label} preferences yet.</p>}
              {cat.id !== 'mcp' && (
                <p className="prefs-legend">
                  <span className="pref-stored" /> Saved with your preferences; not used by RedColumn yet.
                </p>
              )}
            </section>
          </div>
        </div>
        {message && (
          <p className="prefs-message" role="status" onClick={() => setMessage(null)}>
            {message}
          </p>
        )}
        <footer className="actions prefs-footer">
          <button type="button" className="prefs-link" title="Read preferences from a file" onClick={() => void importPrefs()}>
            Import
          </button>
          <button type="button" className="prefs-link" title="Save these preferences to a file" onClick={exportPrefs}>
            Export
          </button>
          <button
            type="button"
            className="prefs-link"
            title="Put every preference back to its default (press Save to keep)"
            disabled={same(d, DEFAULT_SETTINGS) && wrapComments}
            onClick={() => {
              setD({ ...DEFAULT_SETTINGS, setTemplates: structuredClone(DEFAULT_SETTINGS.setTemplates), setTags: structuredClone(DEFAULT_SETTINGS.setTags) });
              setWrapComments(true);
            }}
          >
            Reset to defaults
          </button>
          <span className="spacer" />
          {changed && <span className="prefs-dirty">Unsaved changes</span>}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void apply()} disabled={!changed} title={changed ? undefined : 'Nothing has changed'}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

/** A label and its control, side by side on one line of the settings list. */
function Row({ children }: { children: ReactNode }) {
  return <div className="pref-item">{children}</div>;
}

/** A card of settings, one per line: the label on the left, its control on the right. */
function Grid({ children }: { children: ReactNode }) {
  return <div className="pref-grid">{children}</div>;
}

/** A line of the card with no separate label (a switch carries its own). */
function C({ children }: { children: ReactNode }) {
  return <div className="pref-c">{children}</div>;
}

/** A two-column table of text cells with + and × below (Sets › Categories). */
function EditTable({ columns, rows, onChange, blank }: { columns: string[]; rows: string[][]; onChange: (rows: string[][]) => void; blank: string[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className="pref-table">
        <div className="pref-table-head">
          {columns.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="pref-table-body" ref={body}>
          {rows.map((r, i) => (
            <div key={i} className={`pref-table-row${picked === i ? ' selected' : ''}`} onFocus={() => setPicked(i)}>
              {r.map((cell, j) => (
                <input key={j} value={cell} aria-label={`${columns[j]} ${i + 1}`} onChange={(e) => onChange(rows.map((x, k) => (k === i ? x.map((y, m) => (m === j ? e.target.value : y)) : x)))} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="pref-buttons">
        <button
          type="button"
          className="pref-icon"
          title="Add"
          onClick={() => {
            onChange([...rows, blank]);
            setPicked(rows.length);
            requestAnimationFrame(() => {
              const el = body.current?.lastElementChild?.querySelector('input');
              el?.focus();
              el?.select();
            });
          }}
        >
          +
        </button>
        <button
          type="button"
          className="pref-icon"
          title="Remove the selected row"
          disabled={picked === null || picked >= rows.length}
          onClick={() => {
            onChange(rows.filter((_, k) => k !== picked));
            setPicked(null);
          }}
        >
          ×
        </button>
      </div>
    </>
  );
}

/** Sets › Tags: AutoMark, name and type per tag. */
function TagsTable({ tags, onChange }: { tags: SetTag[]; onChange: (tags: SetTag[]) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const edit = (i: number, patch: Partial<SetTag>) => onChange(tags.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  return (
    <>
      <div className="pref-table tags">
        <div className="pref-table-head">
          <span>AutoMark</span>
          <span>Tag Name</span>
          <span>Type</span>
        </div>
        <div className="pref-table-body">
          {tags.map((t, i) => (
            <div key={i} className={`pref-table-row${picked === i ? ' selected' : ''}`} onFocus={() => setPicked(i)} onClick={() => setPicked(i)}>
              <span>
                <input
                  type="checkbox"
                  checked={t.autoMark}
                  aria-label={`AutoMark ${t.name}`}
                  disabled={t.name !== 'Sheet Number' && t.name !== 'Sheet Name'}
                  title={t.name === 'Sheet Number' || t.name === 'Sheet Name' ? 'Read it off each page automatically' : 'Only sheet numbers and names are read off the pages; type this tag on each sheet (Sets panel › #)'}
                  onChange={(e) => edit(i, { autoMark: e.target.checked })}
                />
              </span>
              <input value={t.name} aria-label="Tag name" onChange={(e) => edit(i, { name: e.target.value })} />
              <select value={t.type} aria-label="Tag type" onChange={(e) => edit(i, { type: e.target.value as SetTag['type'] })}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
              </select>
            </div>
          ))}
        </div>
      </div>
      <div className="pref-buttons">
        <button type="button" className="pref-icon" title="Add a tag" onClick={() => onChange([...tags, { name: 'New Tag', type: 'text', autoMark: false }])}>
          +
        </button>
        <button
          type="button"
          className="pref-icon"
          title="Remove the selected tag"
          disabled={picked === null || picked >= tags.length}
          onClick={() => {
            onChange(tags.filter((_, k) => k !== picked));
            setPicked(null);
          }}
        >
          ×
        </button>
      </div>
    </>
  );
}
