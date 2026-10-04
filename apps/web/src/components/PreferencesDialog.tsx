import { useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, settings, steppedZoom, useSettings, type Settings } from '../settings/settings';
import { personalWords, removeFromDictionary } from '../spelling/spell';
import { OfflinePrefs } from './OfflinePrefs';

type Section = 'general' | 'interface' | 'zoom' | 'display' | 'grid' | 'markup' | 'tools' | 'toolchest' | 'spelling' | 'snapshot' | 'offline';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'interface', label: 'Interface' },
  { id: 'zoom', label: 'Navigation & Zoom' },
  { id: 'display', label: 'Display' },
  { id: 'grid', label: 'Grid & Snap' },
  { id: 'markup', label: 'Markup' },
  { id: 'tools', label: 'Tools' },
  { id: 'toolchest', label: 'Tool Library' },
  { id: 'spelling', label: 'Spelling' },
  { id: 'snapshot', label: 'Snapshot' },
  { id: 'offline', label: 'Offline' },
];

interface Props {
  author: string;
  onAuthor: (name: string) => void;
  onClose: () => void;
}

function Slider({ label, hint, value, min, max, unit, onChange }: { label: string; hint?: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="pref-slider">
      <span className="pref-label">{label}</span>
      <span className="pref-slider-row">
        <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <input
          className="pref-num"
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const v = Math.round(Number(e.target.value));
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        <span className="unit">{unit}</span>
      </span>
      {hint && <span className="pref-hint">{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="pref-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="pref-label">{label}</span>
        {hint && <span className="pref-hint">{hint}</span>}
      </span>
    </label>
  );
}

/** "63% → 68% → 73%": what a few notches do from a typical zoom. */
function stepExample(step: number): string {
  const out = [63];
  for (let i = 0; i < 2; i++) out.push(Math.round(steppedZoom(out[out.length - 1]! / 100, step, 1) * 100));
  return out.map((z) => `${z}%`).join(' → ');
}

/** File → Preferences (Ctrl+K): how the app behaves. Changes apply as they are made. */
export function PreferencesDialog({ author, onAuthor, onClose }: Props) {
  const prefs = useSettings();
  const [section, setSection] = useState<Section>('zoom');
  const [name, setName] = useState(author);
  const [words, setWords] = useState(personalWords);
  const set = (patch: Partial<Settings>) => settings.set(patch);

  const body: Record<Section, ReactNode> = {
    general: (
      <>
        <h4>Identity</h4>
        <label className="pref-field">
          <span className="pref-label">Author name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== author && onAuthor(name.trim())} />
          <span className="pref-hint">Shown as the author of markups you create.</span>
        </label>
        <h4>Measurement</h4>
        <label className="pref-field">
          <span className="pref-label">Units</span>
          <select value={prefs.unitSystem} onChange={(e) => set({ unitSystem: e.target.value as Settings['unitSystem'] })}>
            <option value="imperial">Imperial (feet, inches)</option>
            <option value="metric">Metric (meters, millimeters)</option>
          </select>
          <span className="pref-hint">Scale and unit pickers offer only this system. A scale already set in the other system stays as it is.</span>
        </label>
        <h4>Editing</h4>
        <Toggle label="Confirm before deleting markups" hint="Ask before the Delete key removes selected markups." checked={prefs.confirmDelete} onChange={(v) => set({ confirmDelete: v })} />
      </>
    ),
    zoom: (
      <>
        <h4>Mouse wheel</h4>
        <Slider
          label="Ctrl + wheel zoom step"
          hint={`Each wheel notch scales the zoom by this step (5 → ×1.1, 10 → ×1.2): ${stepExample(prefs.ctrlWheelZoomStep)}. Trackpad pinch stays smooth.`}
          value={prefs.ctrlWheelZoomStep}
          min={1}
          max={50}
          unit="%"
          onChange={(v) => set({ ctrlWheelZoomStep: v })}
        />
        <Slider
          label="Wheel zoom step (single page view)"
          hint={`In single page view the wheel zooms without Ctrl: ${stepExample(prefs.wheelZoomStep)}. In continuous view it scrolls.`}
          value={prefs.wheelZoomStep}
          min={1}
          max={50}
          unit="%"
          onChange={(v) => set({ wheelZoomStep: v })}
        />
        <Toggle label="Invert wheel zoom" hint="Wheel up zooms out, wheel down zooms in." checked={prefs.invertWheelZoom} onChange={(v) => set({ invertWheelZoom: v })} />
        <h4>Buttons and keys</h4>
        <Slider
          label="Zoom in / out step"
          hint={`The zoom buttons and + / − keys: ${stepExample(prefs.buttonZoomStep)}.`}
          value={prefs.buttonZoomStep}
          min={1}
          max={100}
          unit="%"
          onChange={(v) => set({ buttonZoomStep: v })}
        />
      </>
    ),
    display: (
      <>
        <h4>Pages</h4>
        <label className="pref-field">
          <span className="pref-label">Page colours</span>
          <select value={prefs.pageFilter} onChange={(e) => set({ pageFilter: e.target.value as Settings['pageFilter'] })}>
            <option value="none">As printed</option>
            <option value="dark">Dark Mode (inverted)</option>
            <option value="dim">Dimmer</option>
          </select>
          <span className="pref-hint">On screen only; printing and saved files are unchanged.</span>
        </label>
        <Toggle label="Disable line weights" hint="Draw every line in the PDF as a hairline." checked={prefs.thinLines} onChange={(v) => set({ thinLines: v })} />
        <Toggle label="Rulers" checked={prefs.showRulers} onChange={(v) => set({ showRulers: v })} />
        <Toggle label="Full-screen crosshair" checked={prefs.crosshair} onChange={(v) => set({ crosshair: v })} />
        <h4>Markups</h4>
        <Toggle label="Always show reply indicators" hint="A bubble with the number of replies on markups that have them." checked={prefs.replyIndicators} onChange={(v) => set({ replyIndicators: v })} />
        <label className="pref-field">
          <span className="pref-label">Markups the list's filter leaves out</span>
          <select value={prefs.filteredMarkups} onChange={(e) => set({ filteredMarkups: e.target.value as Settings['filteredMarkups'] })}>
            <option value="show">Show them as usual</option>
            <option value="dim">Dim them</option>
            <option value="hide">Hide them</option>
          </select>
        </label>
        <Toggle label="Show Spaces" checked={prefs.showSpaces} onChange={(v) => set({ showSpaces: v })} />
      </>
    ),
    grid: (
      <>
        <h4>Grid</h4>
        <Toggle label="Show grid" checked={prefs.showGrid} onChange={(v) => set({ showGrid: v })} />
        <label className="pref-field">
          <span className="pref-label">Grid spacing</span>
          <span className="pref-slider-row">
            <input className="pref-num" type="number" min={0.01} step={prefs.gridUnit === 'in' ? 0.125 : 1} value={prefs.gridSize} onChange={(e) => Number(e.target.value) > 0 && set({ gridSize: Number(e.target.value) })} />
            <select value={prefs.gridUnit} onChange={(e) => set({ gridUnit: e.target.value as Settings['gridUnit'] })}>
              <option value="in">in</option>
              <option value="mm">mm</option>
            </select>
          </span>
          <span className="pref-hint">On the paper, whatever the drawing's scale.</span>
        </label>
        <h4>Snapping</h4>
        <Toggle label="Snap to grid" checked={prefs.snapToGrid} onChange={(v) => set({ snapToGrid: v })} />
        <Toggle label="Snap to content" hint="Lines, ends and intersections in the PDF (hold Alt to bypass)." checked={prefs.snapToGeometry} onChange={(v) => set({ snapToGeometry: v })} />
        <Toggle label="Snap to markup" hint="Corners and vertices of other markups." checked={prefs.snapToMarkup} onChange={(v) => set({ snapToMarkup: v })} />
      </>
    ),
    tools: (
      <>
        <h4>Drawing</h4>
        <Toggle label="Reuse tools" hint="Keep a markup tool active after placing a markup; off goes back to Select." checked={prefs.reuseTool} onChange={(v) => set({ reuseTool: v })} />
        <Toggle label="Draw to Scale" hint="Type exact lengths, angles and sizes while drawing." checked={prefs.sketchToScale} onChange={(v) => set({ sketchToScale: v })} />
        <h4>Eraser</h4>
        <label className="pref-field">
          <span className="pref-label">Size</span>
          <select value={prefs.eraserSize} onChange={(e) => set({ eraserSize: e.target.value as Settings['eraserSize'] })}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <Toggle label="Erase whole markups" hint="The annotation eraser deletes any markup it touches, instead of rubbing out parts of pen strokes." checked={prefs.eraserWhole} onChange={(v) => set({ eraserWhole: v })} />
      </>
    ),
    spelling: (
      <>
        <h4>Your dictionary</h4>
        <p className="pref-hint">Words added with Check Spelling (F7) › Add to Dictionary. Kept in this browser.</p>
        {words.length ? (
          <ul className="pref-words">
            {words.map((w) => (
              <li key={w}>
                <span>{w}</span>
                <button
                  className="btn small flat"
                  onClick={() => {
                    removeFromDictionary(w);
                    setWords(personalWords());
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No words added yet.</p>
        )}
      </>
    ),
    markup: (
      <>
        <h4>Drawing</h4>
        <Toggle label="Snap to drawing geometry" hint="Drawing and measuring tools snap to lines and points in the PDF (hold Alt to bypass)." checked={prefs.snapToGeometry} onChange={(v) => set({ snapToGeometry: v })} />
        <h4>Selecting</h4>
        <Toggle
          label="Drag on the page to select markups"
          hint="With Select, dragging on an empty part of the page draws a selection box instead of panning (the middle mouse button still pans). Shift+drag always draws a box."
          checked={prefs.dragToSelect}
          onChange={(v) => set({ dragToSelect: v })}
        />
        <h4>Hyperlinks</h4>
        <Toggle label="Show hyperlink areas" hint="Outline detected sheet and detail links. They stay clickable either way." checked={prefs.showHyperlinks} onChange={(v) => set({ showHyperlinks: v })} />
      </>
    ),
    interface: (
      <>
        <h4>Open Recent</h4>
        <Slider label="Documents listed" value={prefs.recentCount} min={1} max={50} unit="" onChange={(v) => set({ recentCount: v })} />
        <Slider label="Only those opened in the last" hint="0 lists them however long ago they were opened." value={prefs.recentDays} min={0} max={365} unit="days" onChange={(v) => set({ recentDays: v })} />
        <h4>Starting up</h4>
        <Toggle label="Reopen the documents that were open" hint="The tabs open when you left come back when the app starts." checked={prefs.restoreTabs} onChange={(v) => set({ restoreTabs: v })} />
      </>
    ),
    snapshot: (
      <>
        <h4>Snapshot</h4>
        <Slider label="Resolution" hint="Of the picture Snapshot copies (at most 4096 pixels across)." value={prefs.snapshotDpi} min={72} max={600} unit="dpi" onChange={(v) => set({ snapshotDpi: v })} />
      </>
    ),
    offline: <OfflinePrefs />,
    toolchest: (
      <>
        <h4>Clicking a saved tool</h4>
        <div className="choice-cards">
          <button className={`choice-card${prefs.toolChestMode === 'copy' ? ' active' : ''}`} onClick={() => set({ toolChestMode: 'copy' })}>
            <b>Place an exact copy</b>
            <span>The markup as it was saved — the same squiggle, text or polyline — placed where you click</span>
          </button>
          <button className={`choice-card${prefs.toolChestMode === 'style' ? ' active' : ''}`} onClick={() => set({ toolChestMode: 'style' })}>
            <b>Draw with its style</b>
            <span>Draw a new markup of the same type using the saved colours, line and text settings</span>
          </button>
        </div>
        <p className="pref-hint">Dragging a tool onto the page always places a copy. Right-click a tool to use the other mode once.</p>
        <Toggle label="Keep the tool active after placing" hint="Place several copies in a row; press Esc to stop." checked={prefs.toolChestSticky} onChange={(v) => set({ toolChestSticky: v })} />
      </>
    ),
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal prefs-dialog" role="dialog" aria-label="Preferences" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Preferences</h3>
        <div className="prefs-body">
          <nav className="prefs-nav" role="tablist" aria-orientation="vertical">
            {SECTIONS.map((s) => (
              <button key={s.id} role="tab" aria-selected={section === s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
          <section className="prefs-section" role="tabpanel">
            {body[section]}
          </section>
        </div>
        <div className="actions">
          <button
            className="btn"
            disabled={Object.entries(DEFAULT_SETTINGS).every(([k, v]) => prefs[k as keyof Settings] === v)}
            onClick={() => {
              if (confirm('Reset all preferences to their defaults?')) settings.reset();
            }}
          >
            Reset to Defaults
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
