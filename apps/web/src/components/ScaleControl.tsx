import { useState } from 'react';
import { parseTypedScale, SCALE_PRESETS, type Scale } from '@nb/measure';
import { SCALE_GROUPS, useSettings } from '../settings/settings';

interface Props {
  scale: Scale | null;
  pageCount: number;
  disabled: boolean;
  onPreset: (scale: Scale) => void;
  onApplyAll: () => void;
  showAllPages?: boolean;
}

const CURRENT = '__current__';

/** Page scale picker: presets, the current (e.g. calibrated) scale, and apply-to-all. */
export function ScaleControl({ scale, pageCount, disabled, onPreset, onApplyAll, showAllPages = true }: Props) {
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const groups = SCALE_GROUPS[useSettings().unitSystem];
  // A preset from the other measurement system (e.g. 1:500 read from a title block while working in
  // imperial) has no option in the list, so it is shown like a custom scale.
  const isPreset = !!scale && SCALE_PRESETS.some((p) => p.label === scale.label && groups.includes(p.group));
  return (
    <label className="field scale" title="Drawing scale for this page">
      Scale
      <select
        disabled={disabled}
        value={scale ? (isPreset ? scale.label : CURRENT) : ''}
        onChange={(e) => {
          const preset = SCALE_PRESETS.find((p) => p.label === e.target.value);
          if (preset) onPreset(preset.scale);
        }}
      >
        <option value="" disabled>
          Scale Not Set
        </option>
        {scale && !isPreset && <option value={CURRENT}>{scale.label}</option>}
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {SCALE_PRESETS.filter((p) => p.group === group).map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <input
        type="text"
        className={bad ? 'scale-typed invalid' : 'scale-typed'}
        disabled={disabled}
        value={typed}
        placeholder={'Type a scale'}
        aria-label="Type a custom scale, such as 1/4 = 1' or 1:75"
        aria-invalid={bad}
        title={`Type a scale, such as 1/4" = 1'-0", 1" = 20' or 1:75, then press Enter`}
        onChange={(e) => {
          setTyped(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !typed.trim()) return;
          const parsed = parseTypedScale(typed);
          if (parsed) {
            onPreset(parsed);
            setTyped('');
          } else setBad(true);
        }}
      />
      {showAllPages && pageCount > 1 && (
        <button type="button" className="btn small" disabled={disabled || !scale} onClick={onApplyAll} title="Use this scale on every page">
          All pages
        </button>
      )}
    </label>
  );
}
