import { SCALE_PRESETS, type Scale } from '@nb/measure';
import { SCALE_GROUPS, useSettings } from '../settings/settings';

interface Props {
  scale: Scale | null;
  disabled: boolean;
  onPreset: (scale: Scale) => void;
  /** Opens the custom scale dialog, from the Custom option at the end of the dropdown. */
  onCustom: () => void;
  /** Opens the Bulk Scales dialog. */
  onBulk?: () => void;
}

const CURRENT = '__current__';
const CUSTOM = '__custom__';

/** Page scale picker: presets, the current (e.g. calibrated) scale, and a Custom option. */
export function ScaleControl({ scale, disabled, onPreset, onCustom, onBulk }: Props) {
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
          if (e.target.value === CUSTOM) onCustom();
          else if (preset) onPreset(preset.scale);
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
        <option value={CUSTOM}>Custom…</option>
      </select>
      {onBulk && (
        <button type="button" className="btn small" disabled={disabled} onClick={onBulk} title="Review and set the scale of many pages at once">
          Bulk Scales
        </button>
      )}
    </label>
  );
}
