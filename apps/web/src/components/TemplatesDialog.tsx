import { useEffect, useRef, useState } from 'react';
import type { Assembly, TakeoffTemplate } from '@nb/markup';
import { toolLabel, type Tool } from '../markup/MarkupTools';
import { loadEstimatingLibrary, writeEstimatingLibrary } from '../assemblies/estimatingLibrary';

interface Props {
  /** The document's templates. */
  initial: readonly TakeoffTemplate[];
  assemblies: readonly Assembly[];
  readOnly: boolean;
  onSave: (templates: TakeoffTemplate[]) => void;
  /** Arms a template's tool (a library one is copied into the document first). */
  onUse: (t: TakeoffTemplate) => void;
  /** Reads an estimating file: its templates and what they use are added to the document. */
  onImport: (file: File) => Promise<string>;
  /** Saves the document's templates, with the assemblies, items and lists they use, as a file. */
  onExport: () => void;
  onClose: () => void;
}

/**
 * Takeoff › Templates › Manage Templates: the document's takeoff templates (rename, delete), the
 * library's (in this browser, for every document), and an estimating file to share them
 * company-wide.
 */
export function TemplatesDialog({ initial, assemblies, readOnly, onSave, onUse, onImport, onExport, onClose }: Props) {
  const [list, setList] = useState<TakeoffTemplate[]>(() => structuredClone([...initial]));
  const [library, setLibrary] = useState(loadEstimatingLibrary);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // An import changes the document's templates (only possible with nothing unsaved): show them.
  useEffect(() => {
    setList(structuredClone([...initial]));
    setLibrary(loadEstimatingLibrary());
  }, [initial]);
  const libraryOnly = library.templates.filter((t) => !list.some((x) => x.id === t.id));
  const assemblyName = (t: TakeoffTemplate) => (t.assemblyId ? (assemblies.find((a) => a.id === t.assemblyId)?.name ?? '(assembly not in this document)') : 'None');
  const dirty = JSON.stringify(list) !== JSON.stringify(initial);
  const removeFromLibrary = (t: TakeoffTemplate) => {
    const next = { ...library, templates: library.templates.filter((x) => x.id !== t.id) };
    setLibrary(next);
    writeEstimatingLibrary(next);
  };
  const what = (t: TakeoffTemplate) => [toolLabel(t.tool as Tool), t.preset.subject && `“${t.preset.subject}”`, t.preset.layer && `layer ${t.preset.layer}`].filter(Boolean).join(', ');

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal columns-dialog estimating-dialog" role="dialog" aria-label="Takeoff Templates" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>Takeoff Templates</h3>
        </div>
        <p className="hint-text asm-intro">
          A template is a measuring tool set up for one kind of takeoff: its subject, layer, style, slope and depth, and an assembly with its inputs. Pick one from Takeoff › Templates to arm the tool; each measurement it places gets the assembly. Make one by right-clicking a measurement › Save as Template.
        </p>
        <table className="asm-table est-table" aria-label="Templates in this document">
          <thead>
            <tr>
              <th>Name</th>
              <th>Tool</th>
              <th>Assembly</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td>
                  <input aria-label="Template name" value={t.name} disabled={readOnly} style={{ width: 200 }} aria-invalid={!t.name.trim()} onChange={(e) => setList((l) => l.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))} />
                </td>
                <td>{what(t)}</td>
                <td>
                  {assemblyName(t)}
                  {t.inputs && <span className="muted"> ({Object.entries(t.inputs).map(([k, v]) => `${k} ${v}`).join(', ')})</span>}
                </td>
                <td className="nowrap">
                  <button type="button" className="btn small" disabled={readOnly || dirty} title={dirty ? 'Save your changes first' : undefined} onClick={() => onUse(t)}>
                    Use
                  </button>
                  <button type="button" className="ms-glyph" aria-label={`Delete ${t.name}`} title="Delete from this document" disabled={readOnly} onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={4} className="empty">
                  No templates in this document yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {libraryOnly.length > 0 && (
          <>
            <h4>In the library (this browser)</h4>
            <table className="asm-table est-table" aria-label="Templates in the library">
              <tbody>
                {libraryOnly.map((t) => (
                  <tr key={t.id}>
                    <td style={{ width: 210 }}>{t.name}</td>
                    <td>{what(t)}</td>
                    <td className="nowrap">
                      <button type="button" className="btn small" disabled={readOnly || dirty} title="Copy it, with its assembly, into this document and arm its tool" onClick={() => onUse(t)}>
                        Use
                      </button>
                      <button type="button" className="ms-glyph" aria-label={`Remove ${t.name} from the library`} title="Remove from the library" onClick={() => removeFromLibrary(t)}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {message && <p className="columns-message">{message}</p>}
        <div className="actions columns-actions">
          <button type="button" className="btn small" disabled={readOnly || dirty} title="Add templates (and the assemblies, items and lists they use) from an estimating file" onClick={() => fileRef.current?.click()}>
            Import…
          </button>
          <button type="button" className="btn small" disabled={!initial.length || dirty} title="Save this document's templates, with what they use, as a file to share company-wide" onClick={onExport}>
            Export
          </button>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button type="button" className="btn primary" disabled={list.some((t) => !t.name.trim())} onClick={() => onSave(list.map((t) => ({ ...t, name: t.name.trim() })))}>
              Save
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Import templates file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              setMessage(await onImport(f));
            } catch (err) {
              setMessage(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
    </div>
  );
}
