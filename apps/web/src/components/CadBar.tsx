import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { type Markup } from '@nb/markup';
import { msg, msgc, parseNumber } from '@nb/i18n';
import { parseLength, type Scale } from '@nb/measure';
import type { CadTool } from '../markup/cadTools';
import { cadToolName, markupName } from '../i18n/names';
import { parseRotationInput } from '../markup/rotationInput';
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
type CheckKey = 'mirrorKeep' | 'mirrorPictures' | 'arrayRotate' | 'arrayAlign' | 'alignScale';

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
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.getAttribute('role') === 'combobox' || t.isContentEditable)) return;
      if (/^[0-9.,-]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && first.current) {
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
    return !!t && !((parseLength(t, scale.unit) ?? 0) > 0) && parseNumber(t) !== 0;
  };
  let bad = false;
  const rotateParse = s.rotateAngle.trim() ? parseRotationInput(s.rotateAngle, 'ccw') : undefined;

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
          {length('offsetDistance', msg('Distance'), msg('through point'), msg('How far each copy is from the last. Leave empty to place the copy through the point you click.'), first)}
          {count('offsetCount', msg('Copies'), 1, 100, msg('Copies each click makes, each one the distance further out'), undefined)}
        </>
      );
      const typed = s.offsetDistance.trim() && !badLength(s.offsetDistance);
      step = source ? (typed ? msg('Click the side for the copies') : msg('Click where the copy goes through')) : msg('Click a line or shape to offset');
      break;
    }
    case 'move':
    case 'copy':
      fields = length('moveDistance', msg('Distance'), msg('to the point'), msg('Type a distance to go that far the way the pointer points. Leave empty to go to the point you click.'), first);
      break;
    case 'scale':
      fields = (
        <label title={msg('Times bigger (0.5 halves it). Leave empty to scale by reference points.')}>
          {msg('Factor')}
          <input ref={first} value={s.scaleFactor} onChange={(e) => settings.set({ scaleFactor: e.target.value })} placeholder={msg('by reference')} aria-label={msg('Scale factor')} />×
        </label>
      );
      if (s.scaleFactor.trim() && !((parseNumber(s.scaleFactor) ?? 0) > 0)) bad = true;
      break;
    case 'lengthen':
      fields = (
        <>
          <select value={s.lengthenMode} aria-label={msg('Lengthen by')} onChange={(e) => settings.set({ lengthenMode: e.target.value as Settings['lengthenMode'] })}>
            <option value="delta">{msg('Change by')}</option>
            <option value="total">{msg('Total length')}</option>
            <option value="percent">{msg('Percent')}</option>
          </select>
          {s.lengthenMode === 'percent' ? (
            <label title={msg('The new length as a percentage of the old')}>
              <input ref={first} value={s.lengthenValue} onChange={(e) => settings.set({ lengthenValue: e.target.value })} placeholder="100" aria-label={msg('Lengthen value')} />%
            </label>
          ) : (
            length('lengthenValue', msg('Length'), s.lengthenMode === 'delta' ? msg('+ or −') : '0', s.lengthenMode === 'delta' ? msg('How much longer (negative: shorter)') : msg('The length the line ends up'), first)
          )}
        </>
      );
      break;
    case 'fillet':
      fields = length('filletRadius', msg('Radius'), msg('0 (sharp)'), msg('The radius of the arc joining the lines. Empty or 0 meets them at a sharp corner.'), first);
      break;
    case 'chamfer':
      fields = length('chamferDistance', msg('Distance'), msg('0 (sharp)'), msg('How far back from the corner each line is cut. Empty or 0 meets them at a sharp corner.'), first);
      break;
    case 'mirror':
      fields = (
        <>
          {check('mirrorKeep', msg('Keep original'), msg('Make a mirrored copy; untick to flip the originals over instead'))}
          {check('mirrorPictures', msg('Mirror pictures'), msg('Reverse images and signatures too; untick to keep them unreversed and upright'))}
        </>
      );
      break;
    case 'rotateRef':
      fields = (
        <label title={msg('Counter-clockwise degrees, or a grade such as 2% or 1:50 (a positive grade rises to the right, a negative grade such as -2% falls to the right). Leave empty to rotate from a reference direction to a new one.')}>
          {msg('Angle')}
          <input ref={first} value={s.rotateAngle} onChange={(e) => settings.set({ rotateAngle: e.target.value })} placeholder={msg('by reference')} aria-label={msg('Rotate angle')} aria-invalid={rotateParse && !rotateParse.ok ? true : undefined} />{rotateParse?.ok && rotateParse.unit !== 'degrees' ? ` ${rotateParse.readout}` : '°'}
        </label>
      );
      if (rotateParse && !rotateParse.ok) bad = true;
      break;
    case 'align':
      fields = check('alignScale', msg('Scale to fit'), msg('Also grow or shrink so the second source point lands on its target'));
      break;
    case 'arrayPolar':
      fields = (
        <>
          {count('arrayCount', msg('Items'), 2, 500, msg('How many in all, the original included'), first)}
          <label title={msg('The angle the items spread through, counter-clockwise (360 for a full circle; negative goes clockwise)')}>
            {/* translators: the angle a polar array's copies spread through */}
            {msgc('polar array', 'Fill')}
            <input type="number" className="cad-count" min={-360} max={360} value={s.arrayAngle} onChange={(e) => settings.set({ arrayAngle: Math.max(-360, Math.min(360, Number(e.target.value) || 360)) })} aria-label={msg('Fill angle')} />°
          </label>
          {check('arrayRotate', msg('Rotate items'), msg('Turn each copy as it goes round; untick to keep them upright'))}
        </>
      );
      break;
    case 'arrayPath':
      fields = (
        <>
          {count('arrayCount', msg('Items'), 2, 500, msg('How many in all along the path, the original included'), first)}
          {check('arrayAlign', msg('Align to path'), msg('Turn each copy to follow the path'))}
        </>
      );
      break;
    case 'divide':
      fields = (
        <>
          <select value={s.divideMode} aria-label={msg('Divide by')} onChange={(e) => settings.set({ divideMode: e.target.value as Settings['divideMode'] })}>
            <option value="count">{msg('Equal parts')}</option>
            <option value="spacing">{msg('Every (Measure)')}</option>
          </select>
          {s.divideMode === 'count' ? count('divideCount', msg('Parts'), 2, 1000, msg('How many equal parts to mark the path into'), first) : length('divideSpacing', msg('Spacing'), '0', msg('A mark every this far along the path, from its start'), first)}
        </>
      );
      break;
    default:
      break;
  }

  const title = tool === 'offset' ? (source ? msg('Offset · {kind}', { kind: markupName(source.type) }) : msgc('tool', 'Offset')) : cadToolName(tool);
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
        {bad ? msg('Value not understood') : (error ?? step)}
      </span>
    </form>
  );
}
