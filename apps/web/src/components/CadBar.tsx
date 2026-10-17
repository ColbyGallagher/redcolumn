import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { MARKUP_LABELS, type Markup } from '@nb/markup';
import { parseLength, type Scale } from '@nb/measure';
import { CAD_TOOL_LABELS, type CadTool } from '../markup/cadTools';
import { settings, useSettings, type Settings } from '../settings/settings';

interface Props {
  tool: CadTool | 'offset';
  /** What the next click does (CAD tools; Offset works its own out). */
  prompt: string | null;
  /** Why the last click did nothing. */
  error: string | null;
  /** Offset: the markup being offset, or null while the next click picks one. */
  source: Markup | null;
  /** The scale lengths are typed in: the markup's, else the page's. */
  scale: Scale;
  onCancel: () => void;
}

type LengthKey = 'moveDistance' | 'offsetDistance' | 'filletRadius' | 'chamferDistance' | 'lengthenValue' | 'divideSpacing';
type CountKey = 'offsetCount' | 'arrayCount' | 'divideCount';
type CheckKey = 'mirrorKeep' | 'arrayRotate' | 'arrayAlign' | 'alignScale';

/**
 * The options and next step of Offset and the CAD Modify tools (Trim, Fillet, Mirror, arrays...),
 * floating over the bottom of the view. Typing a number while one is in use jumps to its first field.
 */
export function CadBar({ tool, prompt, error, source, scale, onCancel }: Props) {
  const s = useSettings();
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (/^[0-9.-]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && first.current) {
        first.current.focus();
        first.current.select();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const unit = scale.unit === 'ft' && scale.feetInches ? 'ft-in' : scale.unit;
  const badLength = (text: string) => {
    const t = text.trim().replace(/^-/, '');
    return !!t && !((parseLength(t, scale.unit) ?? 0) > 0) && Number(t) !== 0;
  };
  let bad = false;

  const length = (key: LengthKey, label: string, placeholder: string, title: string, ref?: RefObject<HTMLInputElement | null>) => {
    if (badLength(s[key])) bad = true;
    return (
      <>
        <label title={title}>
          {label}
          <input ref={ref} value={s[key]} onChange={(e) => settings.set({ [key]: e.target.value } as Partial<Settings>)} placeholder={placeholder} aria-label={label} aria-invalid={badLength(s[key]) || undefined} />
        </label>
        <span className="unit">{unit}</span>
      </>
    );
  };
  const count = (key: CountKey, label: string, min: number, max: number, title: string, ref?: RefObject<HTMLInputElement | null>) => (
    <label title={title}>
      {label}
      <input
        ref={ref}
        type="number"
        className="cad-count"
        min={min}
        max={max}
        value={s[key]}
        onChange={(e) => settings.set({ [key]: Math.min(max, Math.max(min, Math.floor(Number(e.target.value)) || min)) } as Partial<Settings>)}
        aria-label={label}
      />
    </label>
  );
  const check = (key: CheckKey, label: string, title: string) => (
    <label title={title}>
      <input type="checkbox" checked={s[key]} onChange={(e) => settings.set({ [key]: e.target.checked } as Partial<Settings>)} aria-label={label} />
      {label}
    </label>
  );

  let fields: ReactNode = null;
  let step = prompt ?? '';
  switch (tool) {
    case 'offset': {
      fields = (
        <>
          {length('offsetDistance', 'Distance', 'through point', 'How far each copy is from the last. Leave empty to place the copy through the point you click.', first)}
          {count('offsetCount', 'Copies', 1, 100, 'Copies each click makes, each one the distance further out', undefined)}
        </>
      );
      const typed = s.offsetDistance.trim() && !badLength(s.offsetDistance);
      step = source ? (typed ? 'Click the side for the copies' : 'Click where the copy goes through') : 'Click a line or shape to offset';
      break;
    }
    case 'move':
    case 'copy':
      fields = length('moveDistance', 'Distance', 'to the point', 'Type a distance to go that far the way the pointer points. Leave empty to go to the point you click.', first);
      break;
    case 'scale':
      fields = (
        <label title="Times bigger (0.5 halves it). Leave empty to scale by reference points.">
          Factor
          <input ref={first} value={s.scaleFactor} onChange={(e) => settings.set({ scaleFactor: e.target.value })} placeholder="by reference" aria-label="Scale factor" />×
        </label>
      );
      if (s.scaleFactor.trim() && !(Number(s.scaleFactor) > 0)) bad = true;
      break;
    case 'lengthen':
      fields = (
        <>
          <select value={s.lengthenMode} aria-label="Lengthen by" onChange={(e) => settings.set({ lengthenMode: e.target.value as Settings['lengthenMode'] })}>
            <option value="delta">Change by</option>
            <option value="total">Total length</option>
            <option value="percent">Percent</option>
          </select>
          {s.lengthenMode === 'percent' ? (
            <label title="The new length as a percentage of the old">
              <input ref={first} value={s.lengthenValue} onChange={(e) => settings.set({ lengthenValue: e.target.value })} placeholder="100" aria-label="Lengthen value" />%
            </label>
          ) : (
            length('lengthenValue', 'Length', s.lengthenMode === 'delta' ? '+ or −' : '0', s.lengthenMode === 'delta' ? 'How much longer (negative: shorter)' : 'The length the line ends up', first)
          )}
        </>
      );
      break;
    case 'fillet':
      fields = length('filletRadius', 'Radius', '0 (sharp)', 'The radius of the arc joining the lines. Empty or 0 meets them at a sharp corner.', first);
      break;
    case 'chamfer':
      fields = length('chamferDistance', 'Distance', '0 (sharp)', 'How far back from the corner each line is cut. Empty or 0 meets them at a sharp corner.', first);
      break;
    case 'mirror':
      fields = check('mirrorKeep', 'Keep original', 'Make a mirrored copy; untick to flip the originals over instead');
      break;
    case 'rotateRef':
      fields = (
        <label title="Counter-clockwise degrees. Leave empty to rotate from a reference direction to a new one.">
          Angle
          <input ref={first} value={s.rotateAngle} onChange={(e) => settings.set({ rotateAngle: e.target.value })} placeholder="by reference" aria-label="Rotate angle" />°
        </label>
      );
      if (s.rotateAngle.trim() && !Number.isFinite(Number(s.rotateAngle))) bad = true;
      break;
    case 'align':
      fields = check('alignScale', 'Scale to fit', 'Also grow or shrink so the second source point lands on its target');
      break;
    case 'arrayPolar':
      fields = (
        <>
          {count('arrayCount', 'Items', 2, 500, 'How many in all, the original included', first)}
          <label title="The angle the items spread through, counter-clockwise (360 for a full circle; negative goes clockwise)">
            Fill
            <input type="number" className="cad-count" min={-360} max={360} value={s.arrayAngle} onChange={(e) => settings.set({ arrayAngle: Math.max(-360, Math.min(360, Number(e.target.value) || 360)) })} aria-label="Fill angle" />°
          </label>
          {check('arrayRotate', 'Rotate items', 'Turn each copy as it goes round; untick to keep them upright')}
        </>
      );
      break;
    case 'arrayPath':
      fields = (
        <>
          {count('arrayCount', 'Items', 2, 500, 'How many in all along the path, the original included', first)}
          {check('arrayAlign', 'Align to path', 'Turn each copy to follow the path')}
        </>
      );
      break;
    case 'divide':
      fields = (
        <>
          <select value={s.divideMode} aria-label="Divide by" onChange={(e) => settings.set({ divideMode: e.target.value as Settings['divideMode'] })}>
            <option value="count">Equal parts</option>
            <option value="spacing">Every (Measure)</option>
          </select>
          {s.divideMode === 'count' ? count('divideCount', 'Parts', 2, 1000, 'How many equal parts to mark the path into', first) : length('divideSpacing', 'Spacing', '0', 'A mark every this far along the path, from its start', first)}
        </>
      );
      break;
    default:
      break;
  }

  const title = tool === 'offset' ? `Offset${source ? ` · ${MARKUP_LABELS[source.type]}` : ''}` : CAD_TOOL_LABELS[tool];
  return (
    <form
      className="sketch-bar cad-bar"
      onSubmit={(e) => {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          onCancel();
        }
      }}
    >
      <span className="sketch-title">{title}</span>
      {fields}
      <span className={`sketch-title cad-step${error || bad ? ' cad-error' : ''}`} role="status">
        {bad ? 'Value not understood' : (error ?? step)}
      </span>
    </form>
  );
}
