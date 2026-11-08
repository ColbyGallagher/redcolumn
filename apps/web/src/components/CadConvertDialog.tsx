import { useRef, useState } from 'react';
import type { CadOptions } from '../cad/client';
import type { KeptConversion } from '../cad/session';
import type { CadFile } from '../cad/convert';
import { CAD_ACCEPT } from '../cad/files';
import type { ColorMode } from '../cad/render';
import { UNIT_CHOICES } from '../cad/units';

interface Props {
  conversion: KeptConversion;
  busy: boolean;
  onConvert: (options: CadOptions, references: CadFile[]) => void;
  onCancel: () => void;
}

const COLOR_MODES: [ColorMode, string][] = [
  ['auto', 'As plotted'],
  ['color', 'Colour'],
  ['grey', 'Greyscale'],
  ['mono', 'Black'],
];

/** Convert Again: which layouts become pages, how lines are drawn, and reference drawings to fill in. */
export function CadConvertDialog({ conversion, busy, onConvert, onCancel }: Props) {
  const { report, options } = conversion;
  const all = report.layouts;
  const [layouts, setLayouts] = useState<string[]>(options.layouts ? options.layouts.filter((l) => all.includes(l)) : all);
  const [model, setModel] = useState(!all.length || !!options.includeModel);
  const [colorMode, setColorMode] = useState<ColorMode>(options.colorMode ?? 'auto');
  const [lineweights, setLineweights] = useState(options.lineweights ?? true);
  const [references, setReferences] = useState<CadFile[]>(conversion.references);
  // Only a drawing that does not state its units has them chosen here.
  const [units, setUnits] = useState<number>(options.units ?? 4);
  const input = useRef<HTMLInputElement>(null);
  const missing = report.warnings.flatMap((w) => (w.kind === 'missing-xref' ? [w.path || w.name] : w.kind === 'missing-image' && w.path ? [w.path] : w.kind === 'plot-style-missing' ? [w.name] : []));
  const shortName = (p: string) => p.replace(/^.*[\\/]/, '');
  const valid = layouts.length > 0 || model;

  const addFiles = async (files: FileList | null) => {
    const added = await Promise.all([...(files ?? [])].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    setReferences((prev) => [...prev.filter((p) => !added.some((a) => a.name.toLowerCase() === p.name.toLowerCase())), ...added]);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal cad-convert-dialog"
        aria-label="Convert drawing again"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy) return;
          // All layouts chosen is the default, so a drawing with more layouts later gets them all.
          const chosen = layouts.length === all.length ? undefined : layouts;
          onConvert({ ...options, layouts: chosen, includeModel: all.length ? model : undefined, colorMode, lineweights, units: report.unitsStated ? options.units : units }, references);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Convert {conversion.source.name} Again</h3>
        <p>The result opens as a new PDF. The drawing itself is not changed.</p>

        <fieldset>
          <legend>Pages</legend>
          {all.map((name) => (
            <label key={name} className="check">
              <input type="checkbox" checked={layouts.includes(name)} onChange={(e) => setLayouts(e.target.checked ? all.filter((l) => l === name || layouts.includes(l)) : layouts.filter((l) => l !== name))} />
              {name}
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={model} disabled={!all.length} onChange={(e) => setModel(e.target.checked)} />
            Model space {all.length ? '(fitted to one page)' : '(the drawing has no layouts)'}
          </label>
        </fieldset>

        {!report.unitsStated && (
          <fieldset>
            <legend>Units</legend>
            <label>
              The drawing does not say its units. It is drawn in{' '}
              <select aria-label="Drawing units" value={units} onChange={(e) => setUnits(Number(e.target.value))}>
                {UNIT_CHOICES.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.label.split(':')[0]}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        )}

        <fieldset>
          <legend>Lines</legend>
          <div className="row" role="radiogroup" aria-label="Colour">
            {COLOR_MODES.map(([mode, label]) => (
              <label key={mode} className="check">
                <input type="radio" name="cad-colour" checked={colorMode === mode} onChange={() => setColorMode(mode)} />
                {label}
              </label>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={lineweights} onChange={(e) => setLineweights(e.target.checked)} />
            Use the drawing’s lineweights
          </label>
        </fieldset>

        <fieldset>
          <legend>Reference drawings, pictures and plot styles</legend>
          {missing.length > 0 ? (
            <p>Not found: {[...new Set(missing.map(shortName))].join(', ')}. Add them here: drawings as DWG or DXF, pictures as PNG or JPEG, plot styles as CTB, matched by file name.</p>
          ) : (
            <p>Add the drawings, pictures and plot style table (.ctb) this one uses.</p>
          )}
          {references.length > 0 && (
            <ul className="cad-ref-list">
              {references.map((r) => (
                <li key={r.name}>
                  {r.name}{' '}
                  <button type="button" className="btn small" onClick={() => setReferences(references.filter((x) => x !== r))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn" onClick={() => input.current?.click()}>
            Add Reference Files…
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={`${CAD_ACCEPT},.png,.jpg,.jpeg,.ctb`}
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </fieldset>

        <div className="row end">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid || busy}>
            {busy ? 'Converting…' : 'Convert'}
          </button>
        </div>
      </form>
    </div>
  );
}
