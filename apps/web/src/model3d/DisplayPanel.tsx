import { useSyncExternalStore } from 'react';
import { clampViewDistance, DEFAULT_DISPLAY_PREFS, LIGHTING_PRESETS, VIEW_DISTANCE_RANGE, type ModelBackground, type ModelLighting } from '@nb/model3d/controls';
import type { ModelView } from '../documents/openTabs';
import { settings, useSettings } from '../settings/settings';

const BACKGROUNDS: readonly [ModelBackground, string][] = [
  ['theme', 'Follow App Theme'],
  ['dark', 'Dark Studio'],
  ['light', 'Light Paper'],
  ['sky', 'Sky Gradient'],
  ['custom', 'Custom Colour'],
];

/** The view distance slider runs on a log scale, so it is as easy to set 200 m as 50 km. */
const LOG_MIN = Math.log10(VIEW_DISTANCE_RANGE.min);
const LOG_MAX = Math.log10(VIEW_DISTANCE_RANGE.max);
const fromSlider = (t: number) => {
  const m = 10 ** (LOG_MIN + (LOG_MAX - LOG_MIN) * t);
  // Rounded to two significant figures, so the slider lands on tidy distances.
  const k = 10 ** Math.max(0, Math.floor(Math.log10(m)) - 1);
  return clampViewDistance(Math.round(m / k) * k);
};
const toSlider = (m: number) => (Math.log10(clampViewDistance(m)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`);

const LIGHTINGS: readonly [ModelLighting, string][] = [
  ['daylight', 'Daylight'],
  ['overcast', 'Overcast'],
  ['contrast', 'High Contrast'],
  ['custom', 'Custom'],
];

/**
 * The 3D Display & Scene panel: live look-and-feel controls for background, lighting, render style,
 * ghost opacity, camera projection/FOV, grid, mini-map, and a shortcut to 3D Navigation Preferences.
 */
export function Model3dDisplayPanel({ view, onOpenNavPrefs }: { view: ModelView | null; onOpenNavPrefs: () => void }) {
  const s = useSettings();
  const state = useSyncExternalStore(
    (l) => view?.subscribe(l) ?? (() => {}),
    () => view?.controls()?.state() ?? null,
  );
  const controls = state ? (view?.controls() ?? null) : null;

  const setLighting = (preset: ModelLighting) => {
    if (preset === 'custom') return settings.set({ model3dLighting: 'custom' });
    const p = LIGHTING_PRESETS[preset];
    settings.set({
      model3dLighting: preset,
      model3dAmbientIntensity: p.ambientIntensity,
      model3dSunIntensity: p.sunIntensity,
      model3dSunAzimuth: p.sunAzimuth,
      model3dSunElevation: p.sunElevation,
    });
  };

  const resetDisplay = () => {
    settings.set({
      model3dBackground: DEFAULT_DISPLAY_PREFS.background,
      model3dBackgroundColour: DEFAULT_DISPLAY_PREFS.backgroundColour,
      model3dLighting: DEFAULT_DISPLAY_PREFS.lighting,
      model3dAmbientIntensity: DEFAULT_DISPLAY_PREFS.ambientIntensity,
      model3dSunIntensity: DEFAULT_DISPLAY_PREFS.sunIntensity,
      model3dSunAzimuth: DEFAULT_DISPLAY_PREFS.sunAzimuth,
      model3dSunElevation: DEFAULT_DISPLAY_PREFS.sunElevation,
      model3dFov: DEFAULT_DISPLAY_PREFS.fov,
      model3dGhostOpacity: DEFAULT_DISPLAY_PREFS.ghostOpacity,
      model3dWireframe: DEFAULT_DISPLAY_PREFS.wireframe,
      model3dViewDistance: DEFAULT_DISPLAY_PREFS.viewDistance,
    });
  };

  return (
    <div className="m3d-panel m3d-display">
      <details className="m3d-section" open>
        <summary>Background</summary>
        <div className="m3d-body m3d-display-grid">
          <label className="m3d-field">
            <span>Style</span>
            <select
              aria-label="Background style"
              value={s.model3dBackground}
              onChange={(e) => settings.set({ model3dBackground: e.target.value as ModelBackground })}
            >
              {BACKGROUNDS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {s.model3dBackground === 'custom' && (
            <label className="m3d-field">
              <span>Colour</span>
              <input
                type="color"
                aria-label="Background colour"
                value={s.model3dBackgroundColour}
                onChange={(e) => settings.set({ model3dBackgroundColour: e.target.value })}
              />
            </label>
          )}
        </div>
      </details>

      <details className="m3d-section" open>
        <summary>Lighting</summary>
        <div className="m3d-body m3d-display-grid">
          <label className="m3d-field">
            <span>Preset</span>
            <select
              aria-label="Lighting preset"
              value={s.model3dLighting}
              onChange={(e) => setLighting(e.target.value as ModelLighting)}
            >
              {LIGHTINGS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="m3d-slider">
            <span>
              Ambient <strong>{s.model3dAmbientIntensity.toFixed(1)}</strong>
            </span>
            <input
              type="range"
              min="0"
              max="4"
              step="0.1"
              aria-label="Ambient light"
              value={s.model3dAmbientIntensity}
              onChange={(e) => settings.set({ model3dLighting: 'custom', model3dAmbientIntensity: e.target.valueAsNumber })}
            />
          </label>
          <label className="m3d-slider">
            <span>
              Sun brightness <strong>{s.model3dSunIntensity.toFixed(1)}</strong>
            </span>
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              aria-label="Sun brightness"
              value={s.model3dSunIntensity}
              onChange={(e) => settings.set({ model3dLighting: 'custom', model3dSunIntensity: e.target.valueAsNumber })}
            />
          </label>
          <label className="m3d-slider">
            <span>
              Sun direction <strong>{Math.round(s.model3dSunAzimuth)}°</strong>
            </span>
            <input
              type="range"
              min="0"
              max="360"
              step="5"
              aria-label="Sun direction"
              value={s.model3dSunAzimuth}
              onChange={(e) => settings.set({ model3dLighting: 'custom', model3dSunAzimuth: e.target.valueAsNumber })}
            />
          </label>
          <label className="m3d-slider">
            <span>
              Sun height <strong>{Math.round(s.model3dSunElevation)}°</strong>
            </span>
            <input
              type="range"
              min="10"
              max="85"
              step="1"
              aria-label="Sun height"
              value={s.model3dSunElevation}
              onChange={(e) => settings.set({ model3dLighting: 'custom', model3dSunElevation: e.target.valueAsNumber })}
            />
          </label>
        </div>
      </details>

      <details className="m3d-section" open>
        <summary>Appearance &amp; Overlays</summary>
        <div className="m3d-body m3d-display-grid">
          <label className="m3d-check">
            <input
              type="checkbox"
              checked={s.model3dWireframe}
              onChange={(e) => settings.set({ model3dWireframe: e.target.checked })}
            />
            Wireframe
          </label>
          <label className="m3d-check">
            <input
              type="checkbox"
              checked={!!state?.ghost}
              disabled={!controls}
              onChange={() => controls?.run({ type: 'ghost' })}
            />
            Ghost hidden elements
          </label>
          <label className="m3d-slider">
            <span>
              Ghost opacity <strong>{Math.round(s.model3dGhostOpacity * 100)}%</strong>
            </span>
            <input
              type="range"
              min="0.05"
              max="0.6"
              step="0.01"
              aria-label="Ghost opacity"
              value={s.model3dGhostOpacity}
              onChange={(e) => settings.set({ model3dGhostOpacity: e.target.valueAsNumber })}
            />
          </label>
          <label className="m3d-check">
            <input
              type="checkbox"
              checked={!!state?.grid}
              disabled={!controls}
              onChange={() => controls?.run({ type: 'grid' })}
            />
            Reference grid
          </label>
          <label className="m3d-check">
            <input
              type="checkbox"
              checked={!!state?.miniMap}
              disabled={!controls}
              onChange={() => controls?.run({ type: 'miniMap' })}
            />
            Mini-map
          </label>
        </div>
      </details>

      <details className="m3d-section" open>
        <summary>Camera</summary>
        <div className="m3d-body m3d-display-grid">
          <div className="panel-toolbar">
            <button
              type="button"
              className="btn small"
              aria-pressed={state?.projection === 'Perspective'}
              disabled={!controls}
              onClick={() => controls?.run({ type: 'projection', projection: 'Perspective' })}
            >
              Perspective
            </button>
            <button
              type="button"
              className="btn small"
              aria-pressed={state?.projection === 'Orthographic'}
              disabled={!controls}
              onClick={() => controls?.run({ type: 'projection', projection: 'Orthographic' })}
            >
              Orthographic
            </button>
          </div>
          <label className="m3d-slider">
            <span>
              Field of view <strong>{Math.round(s.model3dFov)}°</strong>
            </span>
            <input
              type="range"
              min="25"
              max="95"
              step="1"
              aria-label="Field of view"
              disabled={state?.projection === 'Orthographic'}
              value={s.model3dFov}
              onChange={(e) => settings.set({ model3dFov: e.target.valueAsNumber })}
            />
          </label>
          <label className="m3d-slider" title="How far the camera sees: raise it to find a model a long way off">
            <span>
              View distance <strong>{formatDistance(clampViewDistance(s.model3dViewDistance))}</strong>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.005"
              aria-label="View distance"
              value={toSlider(s.model3dViewDistance)}
              onChange={(e) => settings.set({ model3dViewDistance: fromSlider(e.target.valueAsNumber) })}
            />
          </label>
          <label className="m3d-field">
            <span>View distance (m)</span>
            <input
              type="number"
              min={VIEW_DISTANCE_RANGE.min}
              max={VIEW_DISTANCE_RANGE.max}
              step="100"
              aria-label="View distance in metres"
              value={Math.round(clampViewDistance(s.model3dViewDistance))}
              onChange={(e) => {
                if (Number.isFinite(e.target.valueAsNumber)) settings.set({ model3dViewDistance: clampViewDistance(e.target.valueAsNumber) });
              }}
            />
          </label>
          <div className="panel-toolbar">
            <button type="button" className="btn small" onClick={onOpenNavPrefs}>
              Navigation settings…
            </button>
            <button type="button" className="btn small" onClick={resetDisplay}>
              Reset display
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
