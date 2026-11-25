import { useEffect, useRef, useState, type ReactNode } from 'react';
import { categoriesToXml, parseCategoriesXml } from '@nb/markup';
import { AREA_LABELS, VOLUME_LABELS, type LengthUnit } from '@nb/measure';
import { currentLocale, localeInfo, msg, msgParts, numberLocale, supportedNumberLocale } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import { keyed } from '../i18n/keyed';
import { THEMES } from '../theme/themes';
import { browserLanguages, NUMBER_FORMATS, numberSample, offeredLanguages, resolveLanguage, resolveNumberFormat, systemNumberLocale } from '../i18n/language';
import { lengthUnitName } from '../i18n/names';
import { CONSTRUCTION_TEMPLATE, DEFAULT_SETTINGS, DEFAULT_UNIT_CHOICES, gridUnitOf, settings, switchUnitSystem, type SetTag, type SetTemplate, type Settings, type UnitSystem } from '../settings/settings';
import { addToDictionary, personalWords, removeFromDictionary } from '../spelling/spell';
import { askText } from './AskText';
import { AccessPrefs, ActivityPrefs } from './AccessPrefs';
import { McpPrefs } from './McpPrefs';
import { OfflinePrefs } from './OfflinePrefs';
import { desktop } from '../desktop/host';
import { MANAGED_NOTE, managedPolicy, managedSummary } from '../desktop/policy';
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
    get label() { return msg('General'); },
    tabs: [
      { id: 'options', get label() { return msg('Options'); } },
      { id: 'document', get label() { return msg('Document'); } },
      { id: 'units', get label() { return msg('Units'); } },
      { id: 'navigation', get label() { return msg('Navigation'); } },
      { id: 'grid', get label() { return msg('Grid & Snap'); } },
      { id: 'spelling', get label() { return msg('Spelling'); } },
    ],
  },
  {
    id: 'interface',
    get label() { return msg('Interface'); },
    tabs: [
      { id: 'fileAccess', get label() { return msg('File Access'); } },
      { id: 'markupsList', get label() { return msg('Markups List'); } },
      { id: 'layers', get label() { return msg('Layers'); } },
      { id: 'display', get label() { return msg('Display'); } },
    ],
  },
  {
    id: 'tools',
    get label() { return msg('Tools'); },
    tabs: [
      { id: 'markup', get label() { return msg('Markup'); } },
      { id: 'sketch', get label() { return msg('Sketch'); } },
      { id: 'forms', get label() { return msg('Forms'); } },
      { id: 'signature', get label() { return msg('Signature'); } },
      { id: 'eraser', get label() { return msg('Eraser'); } },
      { id: 'toolLibrary', get label() { return msg('Tool Library'); } },
    ],
  },
  {
    id: 'sets',
    get label() { return msg('Sets'); },
    tabs: [
      { id: 'setOptions', get label() { return msg('Set Options'); } },
      { id: 'sorting', get label() { return msg('Sorting'); } },
      { id: 'categories', get label() { return msg('Categories'); } },
      { id: 'tags', get label() { return msg('Tags'); } },
    ],
  },
  {
    id: 'importExport',
    get label() { return msg('Import/Export'); },
    tabs: [{ id: 'images', get label() { return msg('Images'); } }],
  },
  {
    id: 'advanced',
    get label() { return msg('Advanced'); },
    tabs: [
      { id: 'offline', get label() { return msg('Offline'); } },
      { id: 'experimental', get label() { return msg('Experimental'); } },
    ],
  },
  {
    id: 'account',
    get label() { return msg('Account'); },
    tabs: [
      { id: 'access', get label() { return msg('Access'); } },
      { id: 'activity', get label() { return msg('Activity'); } },
    ],
  },
  { id: 'mcp', get label() { return msg('MCP'); }, tabs: [{ id: 'mcp', get label() { return msg('Enable MCP server'); } }] },
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
const storedTip = () => msg('Saved with your preferences; RedColumn does not use this yet.');

type KeysOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];
type BoolKey = KeysOf<boolean>;
type NumKey = KeysOf<number>;
type StrKey = KeysOf<string>;

const COLOURSPACE = () => [
  ['auto', msg('Auto-Detect')],
  ['colour', msg('Colour')],
  ['grey', msg('Greyscale')],
  ['mono', msg('Monochrome')],
] as const;
const RESOLUTION = () => [
  ['auto', msg('Auto-Detect')],
  ['72', '72 dpi'],
  ['150', '150 dpi'],
  ['300', '300 dpi'],
  ['600', '600 dpi'],
] as const;
/** Built-in ways to file sheets in Sets categories: stored in English (sets.ts reads them), shown translated. */
const ASSIGN_BY = ['Drawing Number', 'Sheet Number', 'Sheet Name', 'File Name'] as const;
const assignByLabel = (v: string) => (v === 'Drawing Number' ? msg('Drawing Number') : v === 'Sheet Number' ? msg('Sheet Number') : v === 'Sheet Name' ? msg('Sheet Name') : v === 'File Name' ? msg('File Name') : v);

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
  /** Restarts the app (the new language applies then), after asking about unsaved changes. */
  onRestart?: () => void | Promise<void>;
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

export function PreferencesDialog({ author, onAuthor, onClose, initialCategory, initialTab, initialQuery, onIndex, onRestart }: Props) {
  const [d, setD] = useState<Settings>(settings.get);
  const [name, setName] = useState(author);
  const [restarting, setRestarting] = useState(false);
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
    <span className={`pref-l${hit(text) ? ' pref-match' : ''}`} title={k && STORED.has(k) ? storedTip() : undefined}>
      {label(text)}
      {k && STORED.has(k) && <span className="pref-stored" aria-label={msg('(not used yet)')} />}
    </span>
  );

  const check = (k: BoolKey, text: string, o: { indent?: boolean; disabled?: boolean; title?: string } = {}) => (
    <label key={k} className={`pref-check${o.indent ? ' indent' : ''}${o.disabled ? ' disabled' : ''}`} title={STORED.has(k) ? storedTip() : o.title}>
      <input type="checkbox" checked={d[k]} disabled={o.disabled} onChange={(e) => set({ [k]: e.target.checked })} />
      <span className={hit(text) ? 'pref-match' : undefined}>
        {label(text)}
        {STORED.has(k) && <span className="pref-stored" aria-label={msg('(not used yet)')} />}
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
          {L(msg('User'))}
          <input aria-label={msg('User')} value={name} onChange={(e) => setName(e.target.value)} />
        </Row>
        <Row>
          {L(msg('Language'), 'uiLanguage')}
          <select aria-label={msg('Language')} value={d.uiLanguage} onChange={(e) => set({ uiLanguage: e.target.value })}>
            <option value="auto">{msg('Match the system ({language})', { language: localeInfo(resolveLanguage('auto', browserLanguages()))!.name })}</option>
            {offeredLanguages(import.meta.env.DEV, [d.uiLanguage, currentLocale().code]).map((l) => (
              <option key={l.code} value={l.code}>
                {l.name === l.english ? l.name : `${l.name} (${l.english})`}
                {l.status === 'preview' ? ` · ${msg('Preview: machine translated')}` : ''}
              </option>
            ))}
          </select>
        </Row>
        <Row>
          {L(msg('Number Format'), 'numberFormat')}
          <select aria-label={msg('Number Format')} value={d.numberFormat} onChange={(e) => set({ numberFormat: e.target.value })}>
            <option value="auto">{msg('Match the system ({sample})', { sample: numberSample(systemNumberLocale()) })}</option>
            {NUMBER_FORMATS.map((code) => (
              <option key={code} value={code}>
                {numberSample(code)}
              </option>
            ))}
          </select>
        </Row>
        {onRestart && (resolveLanguage(d.uiLanguage, browserLanguages()) !== currentLocale().code || supportedNumberLocale(resolveNumberFormat(d.numberFormat, systemNumberLocale())) !== numberLocale()) && (
          <C>
            <span className="pref-hint">
              {msg('The new language and number format apply when redcolumn restarts.')}{' '}
              <button
                type="button"
                disabled={restarting}
                onClick={async () => {
                  // Everything in the dialog is kept, as OK does, then the app restarts. A second
                  // click while that runs does nothing.
                  setRestarting(true);
                  try {
                    await apply();
                    await onRestart?.();
                  } finally {
                    setRestarting(false);
                  }
                }}
              >
                {msg('Restart Now')}
              </button>
            </span>
          </C>
        )}
        {select('tabTruncation', msg('Tab Truncation'), [
          ['start', msg('Start')],
          ['middle', msg('Middle')],
          ['end', msg('End')],
        ])}
        <C>{check('crosshair', msg('Show Full-Screen Crosshair'))}</C>
        {select('geoFormat', msg('Map Coordinates'), [
          ['decimal', msg('Decimal Degrees')],
          ['dms', msg('Degrees, Minutes, Seconds')],
        ])}
        <Row>
          {L(msg('Open PDF on Startup'), 'startupFile')}
          <span className="pref-row">
            <select aria-label={msg('Open PDF on Startup')} value={d.startupFile} onChange={(e) => set({ startupFile: e.target.value })}>
              <option value="">{msg('None')}</option>
              {[...libraryFiles]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              {d.startupFile && !libraryFiles.some((f) => f.id === d.startupFile) && <option value={d.startupFile}>{msg('(Not in the Library)')}</option>}
            </select>
            <button
              type="button"
              className="btn"
              title={msg('Pick a PDF; it is added to your Library')}
              onClick={async () => {
                const f = await pickPdf();
                if (!f) return;
                try {
                  const stored = await saveToLibrary(f.name, await f.arrayBuffer());
                  setLibraryFiles((x) => [...x.filter((e) => e.id !== stored.id), stored]);
                  set({ startupFile: stored.id });
                } catch (err) {
                  setMessage(msg('That file could not be added: {message}', { message: (err as Error).message }));
                }
              }}
            >
              {msg('Browse…')}
            </button>
          </span>
        </Row>
        <C>{check('restoreTabs', msg('Reopen Files from Last Session on Startup'))}</C>
        <C>{check('showThumbnailsOnOpen', msg('Show Thumbnails When Opening a File'))}</C>
        <C>{check('startTips', msg('Show a Tip on the Start Screen'))}</C>
      </Grid>
    ),
    document: () => (
      <Grid>
        <C>{check('documentRecovery', msg('Enable Document Recovery'))}</C>
        <C>{check('autosave', msg('Autosave Changes to the File in the Background'))}</C>
        {select('pageLayout', msg('Page Layout'), [
          ['auto', msg('Auto-Detect by page size')],
          ['single', msg('Single Page')],
          ['continuous', msg('Continuous')],
          ['sideBySide', msg('Side by Side')],
          ['continuousSideBySide', msg('Continuous Side by Side')],
        ])}
        {num('maxZoom', msg('Maximum Zoom'), { min: 400, max: 12800, step: 100, unit: '%' })}
        {select('optimiseDrawings', msg('Optimise Slow Drawings'), [
          ['ask', msg('Ask when a sheet is slow to draw')],
          ['always', msg('Always, without asking')],
          ['never', msg('Never')],
        ])}
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
            {L(msg('Units'), 'unitSystem')}
            <select aria-label={msg('Units')} value={d.unitSystem} onChange={(e) => set(switchUnitSystem(d, e.target.value as UnitSystem))}>
              <option value="metric">{msg('Metric')}</option>
              <option value="imperial">{msg('Imperial')}</option>
            </select>
          </Row>
          {unitSelect('lengthUnit', msg('Length'), choices.length, (u) => lengthUnitName(u))}
          {unitSelect('areaUnit', msg('Area'), choices.area, (u) => AREA_LABELS[u])}
          {unitSelect('volumeUnit', msg('Volume'), choices.volume, (u) => VOLUME_LABELS[u])}
        </Grid>
      );
    },
    navigation: () => (
      <Grid>
        {select('singlePageWheel', msg('Single Page Mode'), [
          ['zoom', msg('Zoom')],
          ['scroll', msg('Scroll')],
        ])}
        {select('continuousWheel', msg('Continuous Mode'), [
          ['scroll', msg('Scroll')],
          ['zoom', msg('Zoom')],
        ])}
        <C>{check('invertWheelZoom', msg('Reverse Mouse Wheel when Zooming'))}</C>
        {num('wheelSensitivity', msg('Sensitivity'), { min: 1, max: 10 })}
        {head(msg('Zoom Steps'))}
        {num('ctrlWheelZoomStep', msg('Ctrl + Wheel'), { min: 1, max: 50, unit: '%' })}
        {num('wheelZoomStep', msg('Wheel'), { min: 1, max: 50, unit: '%' })}
        {num('buttonZoomStep', msg('Zoom In / Out'), { min: 1, max: 100, unit: '%' })}
      </Grid>
    ),
    grid: () => (
      <Grid>
        <C>{check('showGrid', msg('Show Grid'))}</C>
        <C>{check('snapToGrid', msg('Snap to Grid'))}</C>
        {num('gridSize', msg('Grid Spacing'), { min: 0.01, max: 1000, step: gridUnitOf(d.unitSystem) === 'in' ? 0.125 : 1, unit: gridUnitOf(d.unitSystem) === 'in' ? msg('in (set by Units)') : msg('mm (set by Units)') })}
        <C>{check('snapToGeometry', msg('Snap to Content'), { title: msg('Lines, ends and intersections in the PDF (hold Alt to bypass)') })}</C>
        <C>{check('snapToMarkup', msg('Snap to Markup'))}</C>
        <C>{check('rightClickFinishes', msg('Right-click Finishes Markup'), { title: msg('While clicking out a measurement or shape, a right-click completes it instead of opening the menu (Enter, Space and double-click always do)') })}</C>
        <C>{check('snapLines', msg('Snap to Lines'), { disabled: !snapping })}</C>
        <C>{check('snapCurves', msg('Snap to Curves'), { disabled: !snapping })}</C>
        <C>{check('snapMidpoints', msg('Snap to Mid-Points'), { disabled: !snapping })}</C>
        <C>{check('snapEndpoints', msg('Snap to End-Points'), { disabled: !snapping })}</C>
        <C>{check('snapIntersections', msg('Snap to Intersections'), { disabled: !snapping })}</C>
        <C>{check('snapCenters', msg('Snap to Centres'), { title: msg('Centres of circles and arcs, in the drawing and in markups') })}</C>
        <C>{check('snapQuadrants', msg('Snap to Quadrants'), { title: msg('The top, bottom, left and right of circles, arcs and ellipses') })}</C>
        <C>{check('snapGeoCenters', msg('Snap to Geometric Centres'), { title: msg('The middle of closed markups: rectangles, polygons and areas') })}</C>
        <C>{check('snapPerpendicular', msg('Snap Perpendicular'), { title: msg('Square off a line or circle from the point being drawn from') })}</C>
        <C>{check('snapTangent', msg('Snap Tangent'), { title: msg('Touching a circle or arc from the point being drawn from') })}</C>
        <C>{check('snapApparent', msg('Snap to Apparent Intersections'), { disabled: !snapping, title: msg('Where two lines would cross if they were extended') })}</C>
        {head(msg('Tracking'))}
        <C>{check('objectSnapTracking', msg('Object Snap Tracking'), { title: msg('Rest the pointer on a snap point to pick it up (a small + marks it); move away and the pointer lines up with it straight across or up and down. Rest on it again to drop it.') })}</C>
        <C>{check('snapExtension', msg('Extension'), { title: msg('Rest on the end of a line, then move on past it: the pointer follows the line on beyond its end') })}</C>
        <C>{check('snapParallel', msg('Parallel'), { title: msg('While drawing a line, rest on another line, then move roughly parallel to it: the pointer follows that direction') })}</C>
        <C>{check('polarTracking', msg('Polar Tracking'), { title: msg('While drawing, the pointer lines up at multiples of the polar angle from the last point') })}</C>
        <Row>
          {L(msg('Polar Angle'), 'polarAngle')}
          <select aria-label={msg('Polar Angle')} value={d.polarAngle} disabled={!d.polarTracking} onChange={(e) => set({ polarAngle: Number(e.target.value) })}>
            {[90, 45, 30, 22.5, 18, 15, 10, 5].map((v) => (
              <option key={v} value={v}>
                {v}°
              </option>
            ))}
          </select>
        </Row>
        <C>{check('polarForObjects', msg('Track Objects at Polar Angles'), { disabled: !d.polarTracking || !d.objectSnapTracking, title: msg('Object snap tracking follows every polar angle from acquired points, not only straight across and up and down') })}</C>
        {num('snapSensitivity', msg('Sensitivity'), { min: 2, max: 30, disabled: !snapping && !d.snapToMarkup })}
        {colour('snapColour', msg('Snap Colour'), { disabled: !snapping && !d.snapToMarkup && !d.snapToGrid })}
      </Grid>
    ),
    spelling: () => spellingTab(),
    // Interface
    fileAccess: () => (
      <Grid>
        {num('recentCount', msg('Recent Files'), { min: 1, max: 50 })}
        {num('recentDays', msg('Opened in the Last'), { min: 0, max: 365, unit: msg('days (0: any time)') })}
      </Grid>
    ),
    markupsList: () => (
      <Grid>
        <C>{check('zoomFitSelected', msg('Zoom Fit Markups when selected'))}</C>
        <C>{check('richTextComments', msg('Use Rich Text for Comments'))}</C>
        <C>
          <label className="pref-check">
            <input type="checkbox" checked={wrapComments} onChange={(e) => setWrapComments(e.target.checked)} />
            <span className={hit(msg('Wrap Comment Text')) ? 'pref-match' : undefined}>{label(msg('Wrap Comment Text'))}</span>
          </label>
        </C>
        <C>{check('excludeFilteredOnExport', msg('Exclude Filtered Markups on Export'))}</C>
        {select('filteredMarkups', msg('Filtered Markups'), [
          ['show', msg('Show')],
          ['dim', msg('Dim')],
          ['hide', msg('Hide')],
        ])}
        {num('filteredDim', msg('Filtered Annotation Dim'), { min: 5, max: 95, unit: '%', disabled: d.filteredMarkups !== 'dim' })}
      </Grid>
    ),
    layers: () => (
      <Grid>
        <C>{check('hideChildLayers', msg('Hide Child Layers when Hiding Parent Layers'))}</C>
        <C>{check('layersOnPageOnly', msg('Show Layers On Page Only'))}</C>
        {select('layerDial', msg('Dial'), [
          ['isolate', msg('Isolate')],
          ['fade', msg('Fade')],
        ])}
      </Grid>
    ),
    display: () => (
      <Grid>
        {select('theme', msg('Theme'), [['system', msg('Match the system')], ...THEMES.map((t) => [t.id, t.label] as const)])}
        {select('pageFilter', msg('Page Colours'), [
          ['none', msg('As printed')],
          ['dark', msg('Dark Mode (inverted)')],
          ['dim', msg('Dimmer')],
        ])}
        <C>{check('showMenuBar', msg('Show Menu Bar'), { title: msg('Keep File, Edit, View and the other menus across the top bar instead of under the redcolumn button') })}</C>
        <C>{check('thinLines', msg('Disable Line Weights'))}</C>
        <C>{check('keepViewBetweenPages', msg('Keep View Between Pages'))}</C>
        <C>{check('showRulers', msg('Show Rulers'))}</C>
        <C>{check('showSpaces', msg('Show Spaces'))}</C>
        <C>{check('showHyperlinks', msg('Show Hyperlink Areas'))}</C>
        <C>{check('importShxText', msg('Import AutoCAD SHX Text Comments'), { title: msg('AutoCAD turns SHX-font text into hidden comments when plotting to PDF (PDFSHX). Off keeps them out of the markups list; search still finds the text. Applies to files opened afterwards.') })}</C>
        {select('linkClick', msg('Clicking a Sheet Link'), [
          ['preview', msg('Previews the sheet beside the plan')],
          ['jump', msg('Jumps to the sheet')],
        ])}
      </Grid>
    ),
    // Tools
    markup: () => (
      <Grid>
        <C>{check('reuseTool', msg('Reuse Tools'))}</C>
        <C>{check('toolPreviews', msg('Show a short animation when hovering over a tool'))}</C>
        <C>{check('autoSizeText', msg('Auto-size Text Box and Call-out Markups'))}</C>
        <C>{check('retainLayerOnCopy', msg('Retain Layer Information when copying Markups'))}</C>
        <C>{check('replyIndicators', msg('Always Show Reply Indicators'))}</C>
        <C>{check('embedFonts', msg('Embed Fonts'))}</C>
        <C>{check('popupAuthorDate', msg('Show Author and Date in Pop-Ups'))}</C>
        {num('popupOpacity', msg('Pop-Up Opacity'), { min: 10, max: 100, unit: '%' })}
        <C>{check('copyHighlightedText', msg('Copy Highlighted Text into Markup Comment'))}</C>
        {select('imageEncoding', msg('Default Image Encoding'), [
          ['auto', msg('Auto-Select')],
          ['jpeg', msg('JPEG')],
          ['flate', msg('Flate (lossless)')],
        ])}
        <Row>
          {L(msg('Snapshot Resolution'), 'snapshotDpi')}
          <select aria-label={msg('Snapshot Resolution')} value={d.snapshotDpi} onChange={(e) => set({ snapshotDpi: Number(e.target.value) })}>
            {[...new Set([72, 96, 150, 200, 300, 600, d.snapshotDpi])].sort((a, b) => a - b).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Row>
        <C>{check('snapshotVector', msg('Keep Snapshots Vector'), { title: msg('A rectangular Snapshot keeps the drawing as lines, so it stays sharp when zoomed in and can be snapped to') })}</C>
        <C>{check('confirmDelete', msg('Confirm before Deleting Markups'))}</C>
      </Grid>
    ),
    sketch: () => (
      <Grid>
        {select('rotationInput', msg('Rotation Input'), [
          ['absolute', msg('Absolute')],
          ['relative', msg('Relative')],
        ])}
        {select('sketchEllipse', msg('Ellipse Mode'), [
          ['radius', msg('Radius')],
          ['diameter', msg('Diameter')],
          ['ellipse', msg('Width and Height')],
        ])}
        <C>{check('sketchToScale', msg('Draw to Scale'), { title: msg('Type exact lengths, angles and sizes while drawing') })}</C>
      </Grid>
    ),
    forms: () => (
      <Grid>
        {colour('formHighlightColour', msg('Highlight Colour'))}
        {num('formHighlightOpacity', msg('Highlight Opacity'), { min: 0, max: 100 })}
        <C>{check('formSingleKeys', msg('Enable Single Key Shortcuts'))}</C>
      </Grid>
    ),
    signature: () => (
      <Grid>
        {num('signaturePasswordTimeout', msg('Password Time-out'), { min: 0, max: 120, unit: msg('Minutes') })}
        <Row>
          {L(msg('Digital ID Location'))}
          <span className="pref-row">
            <input aria-label={msg('Digital ID Location')} value={desktop() ? msg('This computer') : msg('This browser')} readOnly title={msg('Digital IDs are kept on this device, each locked by its password')} />
            {backupButtons('digital-ids')}
          </span>
        </Row>
        <Row>
          {L(msg('Trusted Identity Location'))}
          <span className="pref-row">
            <input aria-label={msg('Trusted Identity Location')} value={desktop() ? msg('This computer') : msg('This browser')} readOnly title={msg('Certificates you trust to identify signers are kept on this device')} />
            {backupButtons('trusted-identities')}
          </span>
        </Row>
        {select('signatureAlgorithm', msg('Algorithm'), [
          ['SHA-256', 'SHA-256'],
          ['SHA-384', 'SHA-384'],
          ['SHA-512', 'SHA-512'],
        ])}
        {select('signatureFormat', msg('Format'), [
          ['pades', msg('PAdES (ETSI.CAdES.detached)')],
          ['pkcs7', msg('PKCS #7 (adbe.pkcs7.detached, older readers)')],
        ])}
        <C>{check('restrictSignedChanges', msg('Restrict changes that invalidate digital signatures'))}</C>
      </Grid>
    ),
    eraser: () => (
      <Grid>
        {select('eraserSize', msg('Size'), [
          ['small', msg('Small')],
          ['medium', msg('Medium')],
          ['large', msg('Large')],
        ])}
        <C>{check('eraserWhole', msg('Erase Whole Markups'), { title: msg('The annotation eraser deletes any markup it touches, instead of rubbing out parts of pen strokes') })}</C>
      </Grid>
    ),
    toolLibrary: () => (
      <Grid>
        {select('toolChestMode', msg('Clicking a Saved Tool'), [
          ['copy', msg('Places an exact copy')],
          ['style', msg('Draws with its style')],
        ])}
        <C>{check('toolChestSticky', msg('Keep the Tool Active after Placing'), { title: msg('Place several copies in a row; press Esc to stop') })}</C>
        <C>
          <span className="pref-note">{msg('Dragging a tool onto the page always places a copy. Right-click a tool to choose Place Copy or Draw with Style for that tool; it keeps the choice.')}</span>
        </C>
      </Grid>
    ),
    // Sets
    setOptions: () => (
      <Grid>
        {select('setOpenDocuments', msg('Open Documents'), [
          ['inPlace', msg('Open in Place')],
          ['newTab', msg('New Tab')],
        ])}
        {select('setOpenEdited', msg('Open Edited Documents'), [
          ['inPlace', msg('Open in Place')],
          ['newTab', msg('New Tab')],
        ])}
        {select('setShow', msg('Show'), [
          ['fileAndLabel', msg('File Name and Page Label')],
          ['fileName', msg('File Name')],
          ['pageLabel', msg('Page Label')],
        ])}
        <C>{check('setPreview', msg('Show preview of PDF'))}</C>
        {select('setCategories', msg('Categories'), [
          ['auto', msg('Auto')],
          ['manual', msg('Manual')],
          ['none', msg('None')],
        ])}
        {select(
          'setDefaultTemplate',
          msg('Default Template'),
          Object.keys(d.setTemplates).map((n) => [n, n] as const),
        )}
        <C>{check('setPromptTemplate', msg('Always Prompt for Template Selection'))}</C>
      </Grid>
    ),
    sorting: () => (
      <Grid>
        {select('setSortBy', msg('Sort By'), [
          ['fileAndLabel', msg('File Name, Page Label')],
          ['fileName', msg('File Name')],
          ['pageLabel', msg('Page Label')],
          ['sheetNumber', msg('Sheet Number')],
        ])}
        <C>{check('setSortTagged', msg('Sort Tagged Pages By Sheet Number'))}</C>
        {select('setSortOrder', msg('Sort Order'), [
          ['asc', msg('Alphanumeric Ascending')],
          ['desc', msg('Alphanumeric Descending')],
        ])}
        <C>{check('setStackMultiPage', msg('Stack Multi-Page Documents'))}</C>
        {select('setRevisionFilter', msg('Revision Filter'), [
          ['auto', msg('Auto')],
          ['wildcard', msg('Wildcard')],
          ['none', msg('None')],
        ])}
        <Row>
          {L(msg('Stack Revisions By'))}
          <select
            aria-label={msg('Stack Revisions By')}
            value={d.setRevisionFilter === 'wildcard' ? 'wildcard' : 'auto'}
            disabled={d.setRevisionFilter === 'none'}
            title={msg('What makes two sheets revisions of each other')}
            onChange={(e) => set({ setRevisionFilter: e.target.value as Settings['setRevisionFilter'] })}
          >
            <option value="auto">{msg('Sheet Number, Revision Number')}</option>
            <option value="wildcard">{msg('File Name (Wildcard Syntax)')}</option>
          </select>
        </Row>
        {text('setWildcard', msg('Wildcard Syntax'), { placeholder: msg('*_Rev#  (* the sheet, # its revision)') })}
        {select('setPreviousRevisions', msg('Previous Revisions'), [
          ['crossOut', msg('Cross Out')],
          ['hide', msg('Hide')],
          ['none', msg('None')],
        ])}
        {select('setCurrentRevisions', msg('Current Revisions'), [
          ['stack', msg('Stack')],
          ['none', msg('None')],
        ])}
        <C>{check('setCopyMarkups', msg('Copy markups from Previous to Current'))}</C>
        <C>{check('setUnflatten', msg('Unflatten Markups prior to Copy'), { indent: true, disabled: !d.setCopyMarkups })}</C>
        <C>{check('setFlattenAfter', msg('Flatten Markups after Copy'), { indent: true, disabled: !d.setCopyMarkups })}</C>
        <C>{check('setStampSuperseded', msg('Stamp previous revisions as \'Superseded\''))}</C>
      </Grid>
    ),
    categories: () => (
      <>
        <Grid>
          {select(
            'setDefaultTemplate',
            msg('Template'),
            Object.keys(d.setTemplates).map((n) => [n, n] as const),
          )}
          <Row>
            {L(msg('Assign to Categories by'), 'setTemplates')}
            <select aria-label={msg('Assign to Categories by')} value={template.assignBy} onChange={(e) => setTemplate({ ...template, assignBy: e.target.value })}>
              {[...new Set<string>([...ASSIGN_BY, template.assignBy])].map((v) => (
                <option key={v} value={v}>
                  {msg('Tag: {tag}', { tag: assignByLabel(v) })}
                </option>
              ))}
            </select>
          </Row>
        </Grid>
        <EditTable
          columns={[label(msg('Category')), label(msg('Filter'))]}
          rows={template.categories.map((c) => [c.name, c.filter])}
          onChange={(rows) => setTemplate({ ...template, categories: rows.map(([n, f]) => ({ name: n ?? '', filter: f ?? '' })) })}
          blank={[msg('New Category'), '']}
        />
        <div className="pref-buttons">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const n = (await askText(msg('New Template'), '', { label: msg('Template name'), confirm: msg('Create') }))?.trim();
              if (n) set({ setTemplates: { ...d.setTemplates, [n]: { assignBy: template.assignBy, categories: [] } }, setDefaultTemplate: n });
            }}
          >
            {msg('New')}
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
                if (!t.name || !Array.isArray(t.template?.categories)) throw new Error(msg('Not a Sets template'));
                set({ setTemplates: { ...d.setTemplates, [t.name]: t.template }, setDefaultTemplate: t.name });
              } catch (err) {
                setMessage(msg('That file could not be loaded: {message}', { message: (err as Error).message }));
              }
            }}
          >
            {msg('Load…')}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" title={msg('Save this template to a file')} onClick={() => saveFile(`${d.setDefaultTemplate}.sets-template.json`, JSON.stringify({ name: d.setDefaultTemplate, template }, null, 2))}>
            {msg('Save')}
          </button>
          <button type="button" className="btn" title={msg('Save this template as a Bluebeam Revu categories file')} onClick={() => saveFile(`${d.setDefaultTemplate}.xml`, categoriesToXml({ name: d.setDefaultTemplate, categories: template.categories }))}>
            {msg('Export for Revu')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const n = (await askText(msg("Save Template As"), msg("{name} copy", { name: d.setDefaultTemplate }), { label: msg('Template name'), confirm: msg('Save') }))?.trim();
              if (n) set({ setTemplates: { ...d.setTemplates, [n]: structuredClone(template) }, setDefaultTemplate: n });
            }}
          >
            {msg('Save As…')}
          </button>
        </div>
      </>
    ),
    tags: () => (
      <>
        <TagsTable tags={d.setTags} onChange={(setTags) => set({ setTags })} />
        <div className="pref-checks">
          {check('setAutoTagRevision', msg('Automatically Tag Revision Number based on Sheet Number'))}
          {check('setAutoTagDiscipline', msg('Automatically Tag Discipline based on Sheet Number'))}
          {check('setAutoTagSheetType', msg('Automatically Tag Sheet Type based on Sheet Number'))}
        </div>
      </>
    ),
    // Import/Export
    images: () => (
      <Grid>
        {select('photoResolution', msg('Photo Resolution'), [
          ['low', msg('Low')],
          ['medium', msg('Medium')],
          ['high', msg('High')],
        ])}
        {select('videoResolution', msg('Video Resolution'), [
          ['low', msg('Low')],
          ['medium', msg('Medium')],
          ['high', msg('High')],
        ])}
        {select('cameraOrientation', msg('Camera Portrait Orientation'), [
          ['none', msg('Normal (none)')],
          ['rotate90', msg('Rotate 90°')],
          ['rotate180', msg('Rotate 180°')],
          ['rotate270', msg('Rotate 270°')],
        ])}
        {select('importImageResolution', msg('Import Image Resolution'), [
          ['original', msg('Original')],
          ['300', '300 dpi'],
          ['150', '150 dpi'],
          ['72', '72 dpi'],
        ])}
        {select('imageDrop', msg('Image Drag/Drop Behaviour'), [
          ['attachPhoto', msg('Attach Photo')],
          ['image', msg('Image Markup')],
          ['newPage', msg('New Page')],
        ])}
        {select('importColourspace', msg('Import Image as PDF Colourspace'), COLOURSPACE())}
        {select('importResolution', msg('Import Image as PDF Resolution'), RESOLUTION())}
        <C>{check('scannedJpeg', msg('Scanned Colour Images as JPEG'))}</C>
        {select('exportColourspace', msg('Export PDF as Image Colourspace'), COLOURSPACE())}
        {select('exportResolution', msg('Export PDF as Image Resolution'), RESOLUTION())}
        {select('tiffCompression', msg('TIFF Compression'), [
          ['ccittG4', msg('CCITT G4')],
          ['lzw', msg('LZW')],
          ['none', msg('None')],
        ])}
        <C>{check('multiPageTiff', msg('Create Multi-Page TIFFs'))}</C>
        {text('imagePageNumber', msg('Page Number'))}
      </Grid>
    ),
    // Advanced
    offline: () => (
      <div className="pref-free">
        <span className="pref-search-words">{label(msg('Offline storage OCR languages device'))}</span>
        <OfflinePrefs />
      </div>
    ),
    experimental: () => (
      <Grid>
        <C>{check('embedHostHooks', msg('Let an Embedding Application Set Document IDs and Turn Off Commands'))}</C>
        <C>
          <span className="pref-note">{msg('For applications that run RedColumn inside them. Experimental: how it works may change.')}</span>
        </C>
      </Grid>
    ),
    // Account
    access: () => (
      <div className="pref-free">
        <span className="pref-search-words">{label(msg('Access sign in sign out Microsoft OneDrive permission token stay signed in'))}</span>
        <AccessPrefs />
      </div>
    ),
    activity: () => (
      <div className="pref-free">
        <span className="pref-search-words">{label(msg('Activity cloud actions log OneDrive uploaded shared deleted'))}</span>
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
          title={ids ? msg('Save your Digital IDs to a file (each stays locked by its password)') : msg('Save the certificates you trust to a file')}
          onClick={() => {
            const backup: IdBackup = ids ? { app: 'RedColumn', kind, ids: digitalIds.list() } : { app: 'RedColumn', kind, trusted: digitalIds.trustedByHand() };
            saveFile(ids ? 'RedColumn Digital IDs.json' : 'RedColumn Trusted Identities.json', JSON.stringify(backup, null, 2));
          }}
        >
          {msg('Back Up…')}
        </button>
        <button
          type="button"
          className="btn"
          title={msg('Add the ones in a backup file to this device')}
          onClick={async () => {
            const raw = await pickFile();
            if (!raw) return;
            try {
              const n = restoreIdBackup(raw, kind);
              setMessage(ids ? msg('{count, plural, one {# Digital ID} other {# Digital IDs}} added.', { count: n }) : msg('{count, plural, one {# trusted certificate} other {# trusted certificates}} added.', { count: n }));
            } catch (err) {
              setMessage(err instanceof SyntaxError ? msg('That file is not a backup.') : (err as Error).message);
            }
          }}
        >
          {msg('Restore…')}
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
          <C>{check('spellCheck', msg('Enable Spell Check'))}</C>
          <C>{check('spellUpperCase', msg('Include Upper Case Words'), { indent: true, disabled: !d.spellCheck })}</C>
          {select('dictionary', msg('Active Dictionary'), [
            ['en-AU', 'English (Australia)'],
            ['en-GB', 'English (UK)'],
            ['en-US', 'English (US)'],
            ['de-DE', 'Deutsch'],
            ['fr-FR', 'Français'],
          ])}
        </Grid>
        <div className="pref-table" role="listbox" aria-label={msg('Custom Words')}>
          <div className="pref-table-head">
            <span>{label(msg('Custom Words'))}</span>
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
            title={msg('Add a word')}
            onClick={async () => {
              const w = (await askText(msg('Add Custom Word'), '', { label: msg('Word'), confirm: msg('Add') }))?.trim();
              if (w && !words.includes(w)) setWords([...words, w]);
            }}
          >
            +
          </button>
          <button type="button" className="pref-icon" title={msg('Remove the selected word')} disabled={!picked} onClick={() => setWords(words.filter((w) => w !== picked))}>
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
      if (file.app !== 'RedColumn' || file.kind !== 'preferences') throw new Error(msg('This is not a RedColumn preferences file.'));
      setD((x) => ({ ...x, ...settings.parse(raw) }));
      if (typeof file.author === 'string' && file.author.trim()) setName(file.author.trim());
      if (Array.isArray(file.words)) setWords([...new Set([...words, ...file.words.filter((w): w is string => typeof w === 'string')])]);
      setMessage(msg('Preferences imported. Press OK to keep them.'));
    } catch (err) {
      setMessage(err instanceof SyntaxError ? msg('That file is not a preferences file.') : (err as Error).message);
    }
  };

  const changed = !same(d, settings.get()) || name.trim() !== author || !same(words, personalWords()) || wrapComments !== (profiles.active().state.list.wrapComments !== false);

  if (onIndex) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal prefs-dialog" role="dialog" aria-label={msg('Preferences')} onMouseDown={(e) => e.stopPropagation()}>
        <header className="prefs-header">
          <h3>{msg('Preferences')}</h3>
          <label className="prefs-search-box">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" />
            </svg>
            <input className="prefs-search" type="search" placeholder={msg('Find a setting')} aria-label={msg('Search preferences')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="button" className="prefs-x" aria-label={msg('Close')} title={msg('Close without saving')} onClick={onClose}>
            ×
          </button>
        </header>
        {managedPolicy().managed && (
          <p className="prefs-managed" role="note">
            {MANAGED_NOTE} {managedSummary().length ? msg('Turned off on this computer: {list}.', { list: managedSummary().join('; ') }) : msg('Nothing is turned off on this computer.')}
          </p>
        )}
        <div className="prefs-body">
          <nav className="prefs-nav" role="tablist" aria-orientation="vertical" aria-label={msg('Categories')}>
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
            {!visibleCats.length && <span className="pref-note">{msg('Nothing matches that search')}</span>}
          </nav>
          <div className="prefs-frame">
            <div className="prefs-title">
              {cat.tabs.length > 1 && <span className="prefs-crumb">{cat.label}</span>}
              <h2>{tab && cat.tabs.length > 1 ? tab.label : cat.label}</h2>
            </div>
            <section className="prefs-section" role="tabpanel">
              {tab ? body[tab.id]?.() : <p className="pref-note">{msg('RedColumn has no {label} preferences yet.', { label: cat.label })}</p>}
              {cat.id !== 'mcp' && (
                <p className="prefs-legend">
                  {keyed(msgParts('{span} Saved with your preferences; not used by RedColumn yet.', { span: <span className="pref-stored" /> }))}
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
          <button type="button" className="prefs-link" title={msg('Read preferences from a file')} onClick={() => void importPrefs()}>
            {msg('Import')}
          </button>
          <button type="button" className="prefs-link" title={msg('Save these preferences to a file')} onClick={exportPrefs}>
            {msg('Export')}
          </button>
          <button
            type="button"
            className="prefs-link"
            title={msg('Put every preference back to its default (press Save to keep)')}
            disabled={same(d, DEFAULT_SETTINGS) && wrapComments}
            onClick={() => {
              setD({ ...DEFAULT_SETTINGS, setTemplates: structuredClone(DEFAULT_SETTINGS.setTemplates), setTags: structuredClone(DEFAULT_SETTINGS.setTags) });
              setWrapComments(true);
            }}
          >
            {msg('Reset to defaults')}
          </button>
          <span className="spacer" />
          {changed && <span className="prefs-dirty">{msg('Unsaved changes')}</span>}
          <button type="button" className="btn" onClick={onClose}>
            {msg('Cancel')}
          </button>
          <button type="button" className="btn primary" onClick={() => void apply()} disabled={!changed} title={changed ? undefined : msg('Nothing has changed')}>
            {msg('Save')}
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
          title={msg('Add')}
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
          title={msg('Remove the selected row')}
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
          <span>{msg('AutoMark')}</span>
          <span>{msg('Tag Name')}</span>
          <span>{msg('Type')}</span>
        </div>
        <div className="pref-table-body">
          {tags.map((t, i) => (
            <div key={i} className={`pref-table-row${picked === i ? ' selected' : ''}`} onFocus={() => setPicked(i)} onClick={() => setPicked(i)}>
              <span>
                <input
                  type="checkbox"
                  checked={t.autoMark}
                  aria-label={msg('AutoMark {name}', { name: t.name })}
                  disabled={t.name !== 'Sheet Number' && t.name !== 'Sheet Name'}
                  title={t.name === 'Sheet Number' || t.name === 'Sheet Name' ? msg('Read it off each page automatically') : msg('Only sheet numbers and names are read off the pages; type this tag on each sheet (Sets panel › #)')}
                  onChange={(e) => edit(i, { autoMark: e.target.checked })}
                />
              </span>
              <input value={t.name} aria-label={msg('Tag name')} onChange={(e) => edit(i, { name: e.target.value })} />
              <select value={t.type} aria-label={msg('Tag type')} onChange={(e) => edit(i, { type: e.target.value as SetTag['type'] })}>
                <option value="text">{msg('Text')}</option>
                <option value="number">{msg('Number')}</option>
                <option value="date">{msg('Date')}</option>
              </select>
            </div>
          ))}
        </div>
      </div>
      <div className="pref-buttons">
        <button type="button" className="pref-icon" title={msg('Add a tag')} onClick={() => onChange([...tags, { name: msg('New Tag'), type: 'text', autoMark: false }])}>
          +
        </button>
        <button
          type="button"
          className="pref-icon"
          title={msg('Remove the selected tag')}
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
