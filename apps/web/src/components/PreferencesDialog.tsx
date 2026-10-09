import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CONSTRUCTION_TEMPLATE, DEFAULT_SETTINGS, settings, type SetTag, type SetTemplate, type Settings } from '../settings/settings';
import { addToDictionary, personalWords, removeFromDictionary } from '../spelling/spell';
import { askText } from './AskText';
import { OfflinePrefs } from './OfflinePrefs';

/**
 * File › Preferences (Ctrl+K), laid out after Bluebeam Revu's: categories down the left with a
 * search box, tabs along the top of each, and labelled settings in a column. Changes are made to a
 * draft and applied with OK; Cancel discards them.
 */

type Category = 'general' | 'interface' | 'tools' | 'studio' | 'window' | 'sets' | 'importExport' | 'advanced' | 'admin' | 'integrations';

const CATEGORIES: { id: Category; label: string; tabs: { id: string; label: string }[] }[] = [
  {
    id: 'general',
    label: 'General',
    tabs: [
      { id: 'options', label: 'Options' },
      { id: 'document', label: 'Document' },
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
      { id: 'measure', label: 'Measure' },
      { id: 'sketch', label: 'Sketch' },
      { id: 'forms', label: 'Forms' },
      { id: 'signature', label: 'Signature' },
      { id: 'eraser', label: 'Eraser' },
      { id: 'toolLibrary', label: 'Tool Library' },
    ],
  },
  { id: 'studio', label: 'Studio', tabs: [] },
  { id: 'window', label: 'Window', tabs: [] },
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
    tabs: [
      { id: 'word', label: 'Word' },
      { id: 'excel', label: 'Excel' },
      { id: 'powerpoint', label: 'PowerPoint' },
      { id: 'images', label: 'Images' },
    ],
  },
  { id: 'advanced', label: 'Advanced', tabs: [{ id: 'offline', label: 'Offline' }] },
  { id: 'admin', label: 'Admin', tabs: [] },
  { id: 'integrations', label: 'Integrations', tabs: [] },
];

/** Settings kept and exported but not used by RedColumn yet: marked in the dialog so nobody expects them to do anything. */
const STORED = new Set<keyof Settings>([
  'language', 'saveLanguageInDocs', 'theme', 'startupFile', 'openHomePage', 'showRecentOnStartup',
  'documentRecovery', 'saveMode', 'pageLayout', 'singleDisplay', 'continuousDisplay', 'rotateAllPages', 'autoReorderBookmarks', 'redirectLinksOnSlipSheet', 'promptIfLocked', 'findHyperlinks', 'rememberLastPage',
  'wheelSensitivity', 'horizontalScrollbar', 'horizontalMouseWheel', 'verticalScrollbar', 'scrollbarOnLeft', 'lockPanFitWidth', 'synchroniseViews', 'syncMode', 'enable3DMouse', 'keyboardAccelerators',
  'snapCurves', 'snapPageBounds', 'ignoreTinySegments',
  'autoComplete', 'spellColour', 'dictionary',
  'dominantMeasureOnly', 'richTextComments', 'wrapCommentText', 'excludeFilteredOnExport',
  'hideChildLayers', 'layersOnPageOnly', 'layerDial',
  'dynamicDefaults', 'selectionCycle', 'autoSizeText', 'scaleGroupAppearance', 'retainLayerOnCopy', 'embedFonts', 'popupAuthorDate', 'printPopups', 'popupOpacity', 'copyHighlightedText', 'imageEncoding', 'dragBehaviour', 'vectorSnapshots',
  'autoSplitCounts', 'dynamicFillDpi', 'hideMarkupsDuringFill', 'fillSize', 'fillSpeed', 'fillColour', 'boundarySize', 'boundaryColour', 'edgeSensitivity', 'legacySubjectLabel',
  'rotationInput', 'formHighlightColour', 'formHighlightOpacity', 'formSingleKeys', 'signaturePasswordTimeout', 'signatureAlgorithm', 'restrictSignedChanges',
  'setOpenDocuments', 'setOpenEdited', 'setRelativePaths', 'setShowPaths', 'setShow', 'setPreview', 'setCategories', 'setDefaultTemplate', 'setPromptTemplate',
  'setSortBy', 'setSortTagged', 'setSortOrder', 'setStackMultiPage', 'setRevisionFilter', 'setWildcard', 'setPreviousRevisions', 'setCurrentRevisions', 'setCopyMarkups', 'setUnflatten', 'setFlattenAfter', 'setStampSuperseded',
  'setTemplates', 'setTags', 'setAutoTagRevision', 'setAutoTagDiscipline', 'setAutoTagSheetType',
  'wordMode', 'wordHeaders', 'wordDetectLists', 'wordMarkups', 'excelWorkbook', 'excelNonTable', 'excelCombineTables', 'excelDetectNumbers', 'excelThousands', 'excelDecimal', 'pptDetectLists',
  'photoResolution', 'videoResolution', 'cameraOrientation', 'importImageResolution', 'imageDrop', 'importColourspace', 'importResolution', 'scannedJpeg', 'exportColourspace', 'exportResolution', 'tiffCompression', 'multiPageTiff', 'imagePageNumber',
]);
const STORED_TIP = 'Saved with your preferences; RedColumn does not use this yet.';

type KeysOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];
type BoolKey = KeysOf<boolean>;
type NumKey = KeysOf<number>;
type StrKey = KeysOf<string>;

const GRID_UNITS: Record<Settings['gridUnit'], string> = { in: 'Inches', cm: 'Centimetres', mm: 'Millimetres', pt: 'Points' };
const DISPLAY_FIT = [
  ['fitPage', 'Fit Page'],
  ['fitWidth', 'Fit Width'],
  ['actual', 'Actual Size'],
  ['last', 'Last View'],
] as const;
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

function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
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

export function PreferencesDialog({ author, onAuthor, onClose }: Props) {
  const [d, setD] = useState<Settings>(settings.get);
  const [name, setName] = useState(author);
  const [words, setWords] = useState(personalWords);
  const [category, setCategory] = useState<Category>('general');
  const [tabs, setTabs] = useState<Partial<Record<Category, string>>>({});
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pickedWord, setPickedWord] = useState<string | null>(null);
  const set = (patch: Partial<Settings>) => setD((x) => ({ ...x, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    <>
      {L(text, k)}
      <select aria-label={text} value={d[k]} disabled={o.disabled} onChange={(e) => set({ [k]: e.target.value } as Partial<Settings>)}>
        {options.map(([v, t, off]) => (
          <option key={v} value={v} disabled={off}>
            {t}
          </option>
        ))}
      </select>
    </>
  );

  const num = (k: NumKey, text: string, o: { min: number; max: number; step?: number; unit?: string; disabled?: boolean }) => (
    <>
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
    </>
  );

  const colour = (k: StrKey, text: string, o: { disabled?: boolean } = {}) => (
    <>
      {L(text, k)}
      <span className={`pref-colour${o.disabled ? ' disabled' : ''}`}>
        <input type="color" aria-label={text} value={d[k]} disabled={o.disabled} onChange={(e) => set({ [k]: e.target.value } as Partial<Settings>)} />
      </span>
    </>
  );

  const text = (k: StrKey, t: string, o: { placeholder?: string } = {}) => (
    <>
      {L(t, k)}
      <input aria-label={t} value={d[k]} placeholder={o.placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<Settings>)} />
    </>
  );

  const head = (t: string) => <h4 className="pref-head">{label(t)}</h4>;

  const snapping = d.snapToGeometry;
  const template: SetTemplate = d.setTemplates[d.setDefaultTemplate] ?? CONSTRUCTION_TEMPLATE;
  const setTemplate = (t: SetTemplate) => set({ setTemplates: { ...d.setTemplates, [d.setDefaultTemplate]: t } });

  const body: Record<string, () => ReactNode> = {
    // General
    options: () => (
      <Grid>
        {L('User')}
        <input aria-label="User" value={name} onChange={(e) => setName(e.target.value)} />
        {select('language', 'Language', [
          ['en-GB', 'English (UK)'],
          ['en-US', 'English (US)'],
          ['en-AU', 'English (Australia)'],
        ])}
        <C>{check('saveLanguageInDocs', 'Save Language Setting into Documents')}</C>
        {select('theme', 'Theme', [
          ['dark', 'Dark'],
          ['light', 'Light', true],
        ])}
        {select('tabTruncation', 'Tab Truncation', [
          ['start', 'Start'],
          ['middle', 'Middle'],
          ['end', 'End'],
        ])}
        <C>{check('crosshair', 'Show Full-Screen Crosshair')}</C>
        {L('Open PDF on Startup', 'startupFile')}
        <span className="pref-row">
          <input aria-label="Open PDF on Startup" value={d.startupFile} placeholder="A file in your Library" onChange={(e) => set({ startupFile: e.target.value })} />
          <button type="button" className="btn" disabled title="A web page cannot open a file on disk by itself">
            Browse
          </button>
        </span>
        <C>{check('restoreTabs', 'Reopen Files from Last Session on Startup')}</C>
        <C>{check('openHomePage', 'Open Home Page in WebTab on Startup')}</C>
        <C>{check('showRecentOnStartup', 'Show Recent Files on Startup')}</C>
        <C>
          <button type="button" className="btn" disabled title="RedColumn has no messages that can be hidden">
            {label('Reset Hidden Messages')}
          </button>
        </C>
      </Grid>
    ),
    document: () => (
      <Grid>
        <C>{check('documentRecovery', 'Enable Document Recovery')}</C>
        {select('saveMode', 'Save Mode', [
          ['publish', 'Publish Without Revisions'],
          ['incremental', 'Incremental'],
          ['full', 'Full Save'],
        ])}
        {select('pageLayout', 'Page Layout', [
          ['auto', 'Auto-Detect by page size'],
          ['single', 'Single Page'],
          ['continuous', 'Continuous'],
          ['sideBySide', 'Side by Side'],
          ['continuousSideBySide', 'Continuous Side by Side'],
        ])}
        {select('singleDisplay', 'Single Display', DISPLAY_FIT)}
        {select('continuousDisplay', 'Continuous Display', DISPLAY_FIT)}
        {num('maxZoom', 'Maximum Zoom', { min: 400, max: 12800, step: 100, unit: '%' })}
        <C>{check('rotateAllPages', 'Rotate all pages by default')}</C>
        <C>{check('autoReorderBookmarks', 'Automatically Reorder Bookmarks')}</C>
        <C>{check('redirectLinksOnSlipSheet', 'Redirect Links and Bookmarks when Inserting Pages with Slip Sheet')}</C>
        <C>{check('promptIfLocked', 'Prompt user if file is locked')}</C>
        <C>{check('findHyperlinks', 'Find Hyperlinks in PDF Content')}</C>
        <C>{check('rememberLastPage', 'Remember Last Page')}</C>
      </Grid>
    ),
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
        <C>{check('horizontalScrollbar', 'Enable Horizontal Scrollbar')}</C>
        <C>{check('horizontalMouseWheel', 'Enable Horizontal Mouse Wheel', { indent: true, disabled: !d.horizontalScrollbar })}</C>
        <C>{check('verticalScrollbar', 'Enable Vertical Scrollbar')}</C>
        <C>{check('scrollbarOnLeft', 'Show Vertical Scrollbar on Left', { indent: true, disabled: !d.verticalScrollbar })}</C>
        <C>{check('lockPanFitWidth', 'Lock Panning in Fit Width')}</C>
        <C>{check('synchroniseViews', 'Synchronise Views')}</C>
        {select('syncMode', 'Synchronisation Mode', [
          ['document', 'Document'],
          ['page', 'Page'],
          ['location', 'Location'],
        ])}
        <C>{check('enable3DMouse', 'Enable 3D Mouse')}</C>
        <C>{check('keyboardAccelerators', 'Access menus via Keyboard Accelerators')}</C>
        {head('Zoom Steps')}
        {num('ctrlWheelZoomStep', 'Ctrl + Wheel', { min: 1, max: 50, unit: '%' })}
        {num('wheelZoomStep', 'Wheel', { min: 1, max: 50, unit: '%' })}
        {num('buttonZoomStep', 'Zoom In / Out', { min: 1, max: 100, unit: '%' })}
      </Grid>
    ),
    grid: () => (
      <Grid>
        {L('Units', 'gridUnit')}
        <select aria-label="Units" value={d.gridUnit} onChange={(e) => set({ gridUnit: e.target.value as Settings['gridUnit'] })}>
          {Object.entries(GRID_UNITS).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
        <C>{check('showGrid', 'Show Grid')}</C>
        <C>{check('snapToGrid', 'Snap to Grid')}</C>
        {num('gridSize', 'Grid Spacing', { min: 0.01, max: 1000, step: d.gridUnit === 'in' ? 0.125 : d.gridUnit === 'cm' ? 0.25 : 1, unit: GRID_UNITS[d.gridUnit] })}
        <C>{check('snapToGeometry', 'Snap to Content', { title: 'Lines, ends and intersections in the PDF (hold Alt to bypass)' })}</C>
        <C>{check('snapToMarkup', 'Snap to Markup')}</C>
        <C>{check('snapLines', 'Snap to Lines', { disabled: !snapping })}</C>
        <C>{check('snapCurves', 'Snap to Curves', { disabled: !snapping })}</C>
        <C>{check('snapMidpoints', 'Snap to Mid-Points', { disabled: !snapping })}</C>
        <C>{check('snapEndpoints', 'Snap to End-Points', { disabled: !snapping })}</C>
        <C>{check('snapIntersections', 'Snap to Intersections', { disabled: !snapping })}</C>
        <C>{check('snapPageBounds', 'Snap to Page Boundaries', { disabled: !snapping })}</C>
        <C>{check('ignoreTinySegments', 'Ignore Tiny Line Segments', { disabled: !snapping })}</C>
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
        <C>{check('dominantMeasureOnly', 'Show Measurement Value for Dominant Markup Only')}</C>
        <C>{check('richTextComments', 'Use Rich Text for Comments')}</C>
        <C>{check('wrapCommentText', 'Wrap Comment Text')}</C>
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
        <C>{check('dynamicDefaults', 'Dynamically Set as Default Properties')}</C>
        <C>{check('reuseTool', 'Reuse Tools')}</C>
        <C>{check('selectionCycle', 'Enable Selection Cycle')}</C>
        <C>{check('autoSizeText', 'Auto-size Text Box and Call-out Markups')}</C>
        <C>{check('scaleGroupAppearance', 'Scale Appearance Properties for Grouped Markups')}</C>
        <C>{check('retainLayerOnCopy', 'Retain Layer Information when copying Markups')}</C>
        <C>{check('replyIndicators', 'Always Show Reply Indicators')}</C>
        <C>{check('embedFonts', 'Embed Fonts')}</C>
        <C>{check('popupAuthorDate', 'Show Author and Date in Pop-Ups')}</C>
        <C>{check('printPopups', 'Print Pop-Ups')}</C>
        {num('popupOpacity', 'Pop-Up Opacity', { min: 10, max: 100, unit: '%' })}
        <C>{check('copyHighlightedText', 'Copy Highlighted Text into Markup Comment')}</C>
        {select('imageEncoding', 'Default Image Encoding', [
          ['auto', 'Auto-Select'],
          ['jpeg', 'JPEG'],
          ['flate', 'Flate (lossless)'],
        ])}
        {select('dragBehaviour', 'Drag Behaviour for Shapes', [
          ['rectangle', 'Drag Rectangle'],
          ['center', 'Drag from Centre'],
        ])}
        {L('Snapshot Resolution', 'snapshotDpi')}
        <select aria-label="Snapshot Resolution" value={d.snapshotDpi} onChange={(e) => set({ snapshotDpi: Number(e.target.value) })}>
          {[...new Set([72, 96, 150, 200, 300, 600, d.snapshotDpi])].sort((a, b) => a - b).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <C>{check('vectorSnapshots', 'Take Vector Snapshots')}</C>
        <C>{check('confirmDelete', 'Confirm before Deleting Markups')}</C>
        <C>{check('dragToSelect', 'Drag on the Page to Select Markups', { title: 'With Select, dragging on an empty part of the page draws a selection box instead of panning' })}</C>
      </Grid>
    ),
    measure: () => (
      <Grid>
        <C>{check('autoSplitCounts', 'Automatically split count measurements by Space')}</C>
        {L('Dynamic Fill Input', 'dynamicFillDpi')}
        <select aria-label="Dynamic Fill Input" value={d.dynamicFillDpi} onChange={(e) => set({ dynamicFillDpi: Number(e.target.value) })}>
          {[150, 200, 300, 400].map((v) => (
            <option key={v} value={v}>
              {v} dpi
            </option>
          ))}
        </select>
        <C>{check('hideMarkupsDuringFill', 'Momentarily Hide Markups')}</C>
        {num('fillSize', 'Fill Size', { min: 10, max: 400, unit: '%' })}
        {num('fillSpeed', 'Fill Speed', { min: 1, max: 100, unit: '%' })}
        {colour('fillColour', 'Fill Colour')}
        {num('boundarySize', 'Boundary Size', { min: 10, max: 400, unit: '%' })}
        {colour('boundaryColour', 'Boundary Colour')}
        {select('edgeSensitivity', 'Edge Sensitivity', [
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
        ])}
        <C>{check('legacySubjectLabel', 'Use legacy persist behaviour for Subject and Label')}</C>
        {select('unitSystem', 'Measurement System', [
          ['imperial', 'Imperial (feet, inches)'],
          ['metric', 'Metric (metres, millimetres)'],
        ])}
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
        {L('Digital ID Location')}
        <span className="pref-row">
          <input aria-label="Digital ID Location" value="This browser" readOnly title="Digital IDs are kept in this browser's storage" />
          <button type="button" className="btn" disabled>
            …
          </button>
        </span>
        {L('Trusted Identity Location')}
        <span className="pref-row">
          <input aria-label="Trusted Identity Location" value="This browser" readOnly title="Trusted identities are kept in this browser's storage" />
          <button type="button" className="btn" disabled>
            …
          </button>
        </span>
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
        <C>{check('setRelativePaths', 'Use Relative Paths')}</C>
        <C>{check('setShowPaths', 'Show File Paths')}</C>
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
        {L('Stack Revisions By')}
        <select aria-label="Stack Revisions By" value="sheet" disabled>
          <option value="sheet">Sheet Number, Revision Number</option>
        </select>
        {text('setWildcard', 'Wildcard Syntax')}
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
          {L('Assign to Categories by', 'setTemplates')}
          <select aria-label="Assign to Categories by" value={template.assignBy} onChange={(e) => setTemplate({ ...template, assignBy: e.target.value })}>
            {[...new Set([...ASSIGN_BY, template.assignBy])].map((v) => (
              <option key={v} value={v}>
                Tag: {v}
              </option>
            ))}
          </select>
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
    word: () => (
      <Grid>
        {radios('wordMode', 'Reconstruction Mode', [['flowing', 'Flowing'], ['continuous', 'Continuous'], ['exact', 'Exact']])}
        {radios('wordHeaders', 'Headers & Footers', [['retain', 'Retain'], ['text', 'Add as Text'], ['remove', 'Remove']], true)}
        <C>{check('wordDetectLists', 'Detect Lists and Tables')}</C>
        <C>{check('wordMarkups', 'Include Markups')}</C>
      </Grid>
    ),
    excel: () => (
      <Grid>
        {radios('excelWorkbook', 'Workbook Settings', [['single', 'Single Worksheet'], ['perPage', 'Worksheet per Page']])}
        <C>{check('excelNonTable', 'Include non-Table Content')}</C>
        <C>{check('excelCombineTables', 'Combine Tables', { disabled: d.excelWorkbook === 'single' })}</C>
        <C>{check('excelDetectNumbers', 'Automatically Detect Numbers')}</C>
        {select('excelThousands', 'Thousands Separator', [
          ['comma', 'Comma'],
          ['fullStop', 'Full stop'],
          ['space', 'Space'],
          ['none', 'None'],
        ])}
        {select('excelDecimal', 'Decimal Symbol', [
          ['fullStop', 'Full stop'],
          ['comma', 'Comma'],
        ])}
      </Grid>
    ),
    powerpoint: () => (
      <Grid>
        <C>{check('pptDetectLists', 'Detect Lists and Tables')}</C>
      </Grid>
    ),
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
  };

  // The Spelling tab's custom words are part of the draft, applied with OK.
  function spellingTab() {
    const picked = pickedWord;
    const setPicked = setPickedWord;
    return (
      <>
        <Grid>
          <C>
            <span className="pref-row">
              {check('autoComplete', 'Enable Auto-Complete')}
              <button type="button" className="btn" disabled title="Auto-complete is not available yet">
                Manage…
              </button>
            </span>
          </C>
          <C>{check('spellCheck', 'Enable Spell Check')}</C>
          <C>{check('spellUpperCase', 'Include Upper Case Words', { indent: true, disabled: !d.spellCheck })}</C>
          {colour('spellColour', 'Spell Check Colour')}
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

  function radios(k: StrKey, t: string, options: readonly (readonly [string, string])[], boxed = false) {
    return (
      <>
        {L(t, k)}
        <div className={`pref-radios${boxed ? ' boxed' : ''}`} role="radiogroup" aria-label={t}>
          {options.map(([v, optionLabel]) => (
            <label key={v} className="pref-check">
              <input type="radio" name={k} checked={d[k] === v} onChange={() => set({ [k]: v } as Partial<Settings>)} />
              <span>{optionLabel}</span>
            </label>
          ))}
        </div>
      </>
    );
  }

  // Which tabs match the search: render every tab's labels once.
  const matches = new Set<string>();
  if (q) {
    for (const c of CATEGORIES) {
      for (const t of c.tabs) {
        collecting = t.id;
        body[t.id]?.();
        if (t.label.toLowerCase().includes(q) || c.label.toLowerCase().includes(q) || (labels[t.id] ?? []).some((l) => l.toLowerCase().includes(q))) matches.add(t.id);
      }
    }
  }
  const visibleCats = q ? CATEGORIES.filter((c) => c.tabs.some((t) => matches.has(t.id))) : CATEGORIES;
  const cat = visibleCats.find((c) => c.id === category) ?? visibleCats[0] ?? CATEGORIES[0]!;
  const catTabs = q ? cat.tabs.filter((t) => matches.has(t.id)) : cat.tabs;
  const tab = catTabs.find((t) => t.id === tabs[cat.id]) ?? catTabs[0];
  collecting = tab?.id ?? '';

  const apply = async () => {
    settings.set(d);
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

  const changed = !same(d, settings.get()) || name.trim() !== author || !same(words, personalWords());

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal prefs-dialog" role="dialog" aria-label="Preferences" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Preferences</h3>
        <div className="prefs-body">
          <div className="prefs-side">
            <input className="prefs-search" type="search" placeholder="Search" aria-label="Search preferences" value={query} onChange={(e) => setQuery(e.target.value)} />
            <nav className="prefs-nav" role="tablist" aria-orientation="vertical" aria-label="Categories">
              {visibleCats.map((c) => (
                <button key={c.id} type="button" role="tab" aria-selected={c.id === cat.id} className={c.id === cat.id ? 'active' : ''} onClick={() => setCategory(c.id)}>
                  {c.label}
                </button>
              ))}
              {!visibleCats.length && <span className="pref-note">No matches</span>}
            </nav>
          </div>
          <div className="prefs-frame">
            {catTabs.length > 0 && (
              <div className="prefs-tabs" role="tablist" aria-label={cat.label}>
                {catTabs.map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={t.id === tab?.id} className={t.id === tab?.id ? 'active' : ''} onClick={() => setTabs((x) => ({ ...x, [cat.id]: t.id }))}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <section className="prefs-section" role="tabpanel">
              {tab ? body[tab.id]?.() : <p className="pref-note">RedColumn has no {cat.label} preferences yet.</p>}
            </section>
            <p className="prefs-legend">
              <span className="pref-stored" /> Saved with your preferences; not used by RedColumn yet.
            </p>
          </div>
        </div>
        {message && (
          <p className="prefs-message" role="status" onClick={() => setMessage(null)}>
            {message}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" title="Read preferences from a file" onClick={() => void importPrefs()}>
            Import
          </button>
          <button type="button" className="btn" title="Save these preferences to a file" onClick={exportPrefs}>
            Export
          </button>
          <button
            type="button"
            className="btn"
            title="Put every preference back to its default (press OK to keep)"
            disabled={same(d, DEFAULT_SETTINGS)}
            onClick={() => setD({ ...DEFAULT_SETTINGS, setTemplates: structuredClone(DEFAULT_SETTINGS.setTemplates), setTags: structuredClone(DEFAULT_SETTINGS.setTags) })}
          >
            Defaults
          </button>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={() => void apply()} disabled={!changed} title={changed ? undefined : 'Nothing has changed'}>
            OK
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Labelled settings: labels in the left column, controls in the right. */
function Grid({ children }: { children: ReactNode }) {
  return <div className="pref-grid">{children}</div>;
}

/** A control in the right-hand column with no label of its own. */
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
                <input type="checkbox" checked={t.autoMark} aria-label={`AutoMark ${t.name}`} onChange={(e) => edit(i, { autoMark: e.target.checked })} />
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
