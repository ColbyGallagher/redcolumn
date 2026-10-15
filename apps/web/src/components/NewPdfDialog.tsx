import { useRef, useState } from 'react';
import { PAGE_SIZES, presetFor } from '../documents/pageSizes';
import { BUILTIN_TEMPLATES } from '../documents/builtinTemplates';

export interface BlankPagesRequest {
  width: number;
  height: number;
  count: number;
  /** Blank pages mode: insert before this page index (the page count appends). */
  at: number;
}

/** A new PDF from a template: a built-in one (as many pages as asked), or a copy of one in the library. */
export type TemplateRequest = { kind: 'builtin'; id: string; count: number } | { kind: 'library'; id: string };

interface Props {
  /** `new`: File → New PDF. `blank`: Document → Insert → Blank Pages. */
  mode: 'new' | 'blank';
  /** The current page (blank mode): its size is offered, and pages go before or after it. */
  current?: { index: number; count: number; width: number; height: number };
  onApply: (req: BlankPagesRequest) => void;
  onCancel: () => void;
  /** New mode: the library's templates (documents marked Use as Template). */
  templates?: readonly { id: string; name: string }[];
  /** New mode: the open document, which can be kept as a template unless it is one already. */
  openDoc?: { id: string; name: string; template: boolean } | null;
  onTemplate?: (req: TemplateRequest) => void;
  /** Marks the open document as a template; resolves to its id, which is then chosen. */
  onKeepOpenDoc?: () => Promise<string | null>;
  /** Adds a PDF from disk to the library as a template; resolves to its id, which is then chosen. */
  onImport?: (file: File) => Promise<string | null>;
  /** Stops a library document being a template (the document itself stays). */
  onRemoveTemplate?: (id: string) => void;
}

const CUSTOM = 'custom';
const SAME = 'same';
const BLANK = 'blank';

/** Choose a page size, orientation and count for a new PDF or for blank pages, or a template to start from. */
export function NewPdfDialog({ mode, current, onApply, onCancel, templates = [], openDoc, onTemplate, onKeepOpenDoc, onImport, onRemoveTemplate }: Props) {
  const [source, setSource] = useState(BLANK);
  const [size, setSize] = useState(current ? SAME : 'letter');
  const [landscape, setLandscape] = useState(false);
  const [custom, setCustom] = useState({ w: '8.5', h: '11', unit: 'in' as 'in' | 'mm' });
  const [count, setCount] = useState(1);
  const [where, setWhere] = useState<'after' | 'before' | 'end'>('after');
  const importRef = useRef<HTMLInputElement>(null);
  const pick = (id: string | null) => {
    if (id) setSource(`lib:${id}`);
  };

  const builtin = source.startsWith('builtin:') ? BUILTIN_TEMPLATES.find((t) => `builtin:${t.id}` === source) : undefined;
  const library = source.startsWith('lib:') ? templates.find((t) => `lib:${t.id}` === source) : undefined;
  // A library template that was removed meanwhile falls back to a blank page.
  const blank = !builtin && !library;

  const base = (() => {
    if (size === SAME && current) return { width: current.width, height: current.height };
    if (size === CUSTOM) {
      const k = custom.unit === 'in' ? 72 : 72 / 25.4;
      return { width: Number(custom.w) * k, height: Number(custom.h) * k };
    }
    const p = PAGE_SIZES.find((x) => x.id === size) ?? PAGE_SIZES[0]!;
    return { width: p.width, height: p.height };
  })();
  // The current page keeps its own orientation; presets follow the orientation choice.
  const turned = size !== SAME && landscape !== base.width > base.height;
  const width = turned ? base.height : base.width;
  const height = turned ? base.width : base.height;
  const countOk = count >= 1 && count <= 500;
  const valid = library ? true : builtin ? countOk : width >= 18 && height >= 18 && width <= 14400 && height <= 14400 && countOk;
  const at = !current ? 0 : where === 'before' ? current.index : where === 'after' ? current.index + 1 : current.count;
  const sameLabel = current ? `Same as page ${current.index + 1} (${presetFor(current.width, current.height)?.label ?? `${(current.width / 72).toFixed(2)} × ${(current.height / 72).toFixed(2)} in`})` : '';
  const withTemplates = mode === 'new' && !!onTemplate;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className={`modal new-pdf${withTemplates ? ' wide' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          if (library) onTemplate?.({ kind: 'library', id: library.id });
          else if (builtin) onTemplate?.({ kind: 'builtin', id: builtin.id, count });
          else onApply({ width, height, count, at });
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>{mode === 'new' ? 'New PDF' : 'Insert Blank Pages'}</h3>
        <div className="form-grid">
          {withTemplates && (
            <>
              <label htmlFor="np-source">Start from</label>
              <select id="np-source" value={blank ? BLANK : source} onChange={(e) => setSource(e.target.value)} autoFocus>
                <option value={BLANK}>Blank pages</option>
                <optgroup label="Built-in templates">
                  {BUILTIN_TEMPLATES.map((t) => (
                    <option key={t.id} value={`builtin:${t.id}`}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                {templates.length > 0 && (
                  <optgroup label="My templates">
                    {templates.map((t) => (
                      <option key={t.id} value={`lib:${t.id}`}>
                        {t.name.replace(/\.pdf$/i, '')}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <span />
              <div className="row wrap template-actions">
                {onKeepOpenDoc && openDoc && !openDoc.template && (
                  <button type="button" className="btn small" title={`Keep "${openDoc.name}" as a template, to start new documents from`} onClick={() => void onKeepOpenDoc().then(pick)}>
                    Save Open PDF as Template
                  </button>
                )}
                {onImport && (
                  <button type="button" className="btn small" title="Add a PDF from this computer as a template" onClick={() => importRef.current?.click()}>
                    Import Template…
                  </button>
                )}
                {library && onRemoveTemplate && (
                  <button type="button" className="btn small" title="Stop offering this document as a template (the document stays in the library)" onClick={() => onRemoveTemplate(library.id)}>
                    Remove Template
                  </button>
                )}
                <input
                  ref={importRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f && onImport) void onImport(f).then(pick);
                  }}
                />
              </div>
            </>
          )}
          {(builtin || library) && (
            <>
              <span />
              <p className="np-note">{builtin ? builtin.description : 'A copy of this template, with its markups and form fields, as a new document.'}</p>
            </>
          )}
          {blank && (
            <>
              <label htmlFor="np-size">Page size</label>
              <select id="np-size" value={size} onChange={(e) => setSize(e.target.value)} autoFocus={!withTemplates}>
                {current && <option value={SAME}>{sameLabel}</option>}
                {PAGE_SIZES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value={CUSTOM}>Custom…</option>
              </select>
              {size === CUSTOM && (
                <>
                  <label htmlFor="np-w">Size</label>
                  <div className="row size-row">
                    <input id="np-w" aria-label="Width" inputMode="decimal" value={custom.w} onChange={(e) => setCustom({ ...custom, w: e.target.value })} aria-invalid={!(Number(custom.w) > 0)} />
                    <span className="times">×</span>
                    <input aria-label="Height" inputMode="decimal" value={custom.h} onChange={(e) => setCustom({ ...custom, h: e.target.value })} aria-invalid={!(Number(custom.h) > 0)} />
                    <select aria-label="Unit" value={custom.unit} onChange={(e) => setCustom({ ...custom, unit: e.target.value as 'in' | 'mm' })}>
                      <option value="in">in</option>
                      <option value="mm">mm</option>
                    </select>
                  </div>
                </>
              )}
              {size !== SAME && (
                <>
                  <span>Orientation</span>
                  <div className="row">
                    <label className="check">
                      <input type="radio" name="np-orient" checked={!landscape} onChange={() => setLandscape(false)} /> Portrait
                    </label>
                    <label className="check">
                      <input type="radio" name="np-orient" checked={landscape} onChange={() => setLandscape(true)} /> Landscape
                    </label>
                  </div>
                </>
              )}
            </>
          )}
          {!library && (
            <>
              <label htmlFor="np-count">Pages</label>
              <input id="np-count" type="number" min={1} max={500} value={count} onChange={(e) => setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </>
          )}
          {mode === 'blank' && current && (
            <>
              <label htmlFor="np-where">Insert</label>
              <select id="np-where" value={where} onChange={(e) => setWhere(e.target.value as typeof where)}>
                <option value="after">After page {current.index + 1}</option>
                <option value="before">Before page {current.index + 1}</option>
                <option value="end">At the end</option>
              </select>
            </>
          )}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            {mode === 'new' ? 'Create' : 'Insert'}
          </button>
        </div>
      </form>
    </div>
  );
}
