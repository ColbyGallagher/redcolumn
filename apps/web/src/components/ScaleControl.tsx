import { SCALE_PRESETS, type Scale } from '@nb/measure';
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
  const groups = SCALE_GROUPS[useSettings().unitSystem];
  const isPreset = !!scale && SCALE_PRESETS.some((p) => p.label === scale.label);
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
      {showAllPages && pageCount > 1 && (
        <button type="button" className="btn small" disabled={disabled || !scale} onClick={onApplyAll} title="Use this scale on every page">
          All pages
        </button>
      )}
    </label>
  );
}
