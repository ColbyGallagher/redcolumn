import { useMemo } from 'react';
import { documentLineStyles, LINE_DASHES, type CustomLine, type LineDash, type Markup, type MarkupStyle } from '@nb/markup';
import { lineSetLibrary, useWorkspace } from '../workspace/profiles';
import { openLineStyles } from './LineStylesDialog';

interface Props {
  style: MarkupStyle;
  /** The open document's markups, whose own line styles are offered beside the sets. */
  markups: readonly Markup[];
  onChange: (patch: Partial<MarkupStyle>) => void;
}

const sameLine = (a: CustomLine, b: CustomLine) => a.name === b.name && JSON.stringify(a.spec) === JSON.stringify(b.spec);

/**
 * The Line style picker: plain dashes, the built-in and imported line style sets, and the custom
 * styles a Revu document brings with it. A style's own pick shows as selected wherever it is listed.
 */
export function LineStyleSelect({ style, markups, onChange }: Props) {
  const ws = useWorkspace();
  const sets = useMemo(() => lineSetLibrary(ws), [ws]);
  const inDocument = useMemo(() => documentLineStyles(markups, sets.flatMap((s) => s.styles)), [markups, sets]);

  const current = style.lineStyle;
  let value = current || style.dashArray ? 'custom' : (style.dash ?? 'solid');
  if (current) {
    sets.forEach((set, si) =>
      set.styles.forEach((l, li) => {
        if (sameLine(l, current)) value = `line:${si}:${li}`;
      }),
    );
    inDocument.forEach((l, i) => {
      if (sameLine(l, current)) value = `doc:${i}`;
    });
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'custom') return;
        if (v === 'manage') {
          // The select snaps back to the current style: nothing is picked by opening the manager.
          e.target.value = value;
          openLineStyles();
          return;
        }
        // A style from a line set ('line:<set>:<style>') or from the document ('doc:<style>').
        const [kind, a, b] = v.split(':');
        const picked = kind === 'line' ? sets[Number(a)]?.styles[Number(b)] : kind === 'doc' ? inDocument[Number(a)] : undefined;
        if (picked) onChange({ lineStyle: structuredClone(picked), dash: undefined, dashArray: undefined });
        // A plain style replaces a custom (Bluebeam) one.
        else onChange({ dash: v === 'solid' ? undefined : (v as LineDash), dashArray: undefined, lineStyle: undefined });
      }}
    >
      {value === 'custom' && <option value="custom">{style.lineStyle ? style.lineStyle.name || 'Custom' : `Custom (${style.dashArray!.map((n) => Math.round(n * 100) / 100).join(' ')})`}</option>}
      {LINE_DASHES.map((d) => (
        <option key={d.value} value={d.value}>
          {d.label}
        </option>
      ))}
      {inDocument.length > 0 && (
        <optgroup label="In this document">
          {inDocument.map((l, i) => (
            <option key={`${l.name}:${i}`} value={`doc:${i}`}>
              {l.name || 'Custom'}
            </option>
          ))}
        </optgroup>
      )}
      {sets.map((set, si) => (
        <optgroup key={`${set.title}:${si}`} label={set.title}>
          {set.styles.map((l, li) => (
            <option key={`${l.name}:${li}`} value={`line:${si}:${li}`}>
              {l.name}
            </option>
          ))}
        </optgroup>
      ))}
      <option value="manage">Manage line styles…</option>
    </select>
  );
}
