import { msg } from '@nb/i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Assembly, Markup, MarkupStore } from '@nb/markup';
import { appliesTo, takesAssembly } from '../assemblies/assemblyChoice';
import { AssemblyInputFields, useAssemblyChoice } from './AssemblyInputs';
import type { MeasureDefaults } from './MeasurementsPanel';

/** Takeoff › Assembly: the document's assemblies and the assembly the next measurements are taken off as. */
export interface TakeoffAssemblyProps {
  assemblies: readonly Assembly[];
  defaults: MeasureDefaults;
  onDefaults: (next: MeasureDefaults) => void;
  /** Opens the Assemblies dialog. */
  onManage: () => void;
}

/**
 * Takeoff › Assembly: which assembly the selected measurements (or, with none selected, the next
 * ones drawn) are taken off as, and a drop-down of its variables (depth, width, waste...) to set
 * before or while drawing. The values feed the assembly's formulas: for the next measurements they
 * are the running tool's, for selected ones each measurement's own inputs (unset ones fall back to
 * the assembly's defaults). The Measurements panel edits the same choice.
 */
export function RibbonAssembly({ info, selection, enabled }: { info: TakeoffAssemblyProps | null | undefined; selection: { markups: readonly Markup[]; store: MarkupStore } | null | undefined; enabled: boolean }) {
  const chosen = (selection?.markups ?? []).filter(takesAssembly);
  const store = selection?.store ?? null;
  const mayEdit = !!info && (chosen.length ? !!store && chosen.every((m) => store.mayEdit(m)) : enabled);
  const { choice, pick, setInput, dialog } = useAssemblyChoice({
    chosen,
    selected: selection?.markups.length ?? 0,
    store,
    canEdit: mayEdit,
    defaults: info?.defaults ?? { subject: '', label: '' },
    onDefaults: (next) => info?.onDefaults(next),
    assemblies: info?.assemblies ?? [],
  });
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const { value, assembly } = choice;
  // A selection with no measurements in it is not edited (and not taken for "the next markups").
  const canEdit = mayEdit && choice.target !== 'none';
  const vars = assembly?.variables.length ?? 0;
  const applies = appliesTo(choice);
  // Quantities set by hand when a takeoff was approved stand, whatever the inputs.
  const setByHand = chosen.some((m) => Object.keys(m.assemblyOverrides ?? {}).length > 0);

  // Closes on a press outside it (not on the button, which toggles it) and on Escape. A value being
  // typed is applied first (the box hands it back when it loses focus).
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || button.current?.contains(t)) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && pop.current?.contains(active)) active.blur();
      setOpen(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  // Nothing left to edit (another assembly, or one without variables): it closes.
  useEffect(() => {
    if (open && !vars) setOpen(null);
  }, [open, vars]);

  const title =
    choice.target === 'none'
      ? msg('No measurements selected: select measurements, or nothing to set the next ones')
      : value === '*'
        ? msg('The selected measurements use different assemblies: pick one to edit its variables')
        : assembly
          ? msg('{assembly}: {count, plural, =0 {no variables} one {# variable} other {# variables}}', { assembly: assembly.name, count: vars })
          : msg('Pick an assembly first');
  return (
    <div className="rb-stack rb-assembly">
      <select
        aria-label={msg('Takeoff assembly')}
        title={choice.target === 'none' ? msg('No measurements selected') : chosen.length ? msg('The assembly the selected measurements are taken off as') : msg('The assembly the next measurements are taken off as')}
        value={value}
        disabled={!canEdit}
        onChange={(e) => (e.target.value === '__manage' ? info?.onManage() : pick(e.target.value))}
      >
        {value === '*' && <option value="*">{msg('(several)')}</option>}
        <option value="">{msg('None')}</option>
        {(info?.assemblies ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        {value && value !== '*' && !assembly && <option value={value}>{msg('(deleted assembly)')}</option>}
        <option value="__manage">{msg('Manage assemblies…')}</option>
      </select>
      <span className="rb-asm-row">
        <button
          ref={button}
          type="button"
          className={`btn tool rb-btn small${open ? ' active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={!!open}
          disabled={!canEdit || !vars}
          title={title}
          onClick={() => {
            if (open) return setOpen(null);
            const r = button.current!.getBoundingClientRect();
            setOpen({ x: Math.max(4, Math.min(r.left, window.innerWidth - 284)), y: r.bottom + 2 });
          }}
        >
          <span className="rb-label">{msg('Variables ▾')}</span>
        </button>
        <span className="rb-asm-applies" data-testid="assembly-applies" title={msg('Where a change of assembly or variable goes')}>
          {applies}
        </span>
      </span>
      {open &&
        assembly &&
        createPortal(
          <div ref={pop} className="rb-asm-pop" role="dialog" aria-label={msg('Assembly variables')} style={{ left: open.x, top: open.y }} onKeyDown={(e) => e.stopPropagation()}>
            <div className="rb-asm-head">
              <strong>{assembly.name}</strong>
              <span className="muted">{msg('Applies to: {target}', { target: applies })}</span>
            </div>
            <AssemblyInputFields key={`${chosen.map((m) => m.id).join(',')}:${assembly.id}`} assembly={assembly} values={choice.values} varies={choice.varies} disabled={!canEdit} commitOnBlur onChange={setInput} />
            <p className="muted rb-asm-note">{chosen.length ? msg('Changes these measurements’ inputs (Enter or Tab to apply); their quantities follow.') : msg('The next measurements you draw take these values (Enter or Tab to apply).')}</p>
            {setByHand && (
              <p className="warn rb-asm-note" role="note">
                {msg('Some quantities were set by hand when the takeoff was approved: they stay as set, whatever these inputs.')}
              </p>
            )}
          </div>,
          document.body,
        )}
      {dialog}
    </div>
  );
}
