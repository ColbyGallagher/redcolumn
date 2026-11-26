/**
 * The 3D view's commands (issue #191), for the 3D ribbon tab, the command palette and shortcuts.
 * They are enabled only while a model is in front and has loaded.
 */
import { CORNER_DIRECTIONS, type ModelAction, type ModelState, type ModelTool, type ViewDirection } from '@nb/model3d/controls';
import type { Command } from './appCommands';

/** The views the ribbon's Views drop-down lists: the six sides, the default isometric, then the cube's eight corners. */
export const DIRECTIONS: readonly (readonly [ViewDirection, string])[] = [
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['front', 'Front'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['iso', 'Isometric'],
  ...CORNER_DIRECTIONS.map(([d, label]) => [d, `Isometric ${label}`] as const),
];

const TOOLS: [ModelTool, string, string][] = [
  ['select', 'select', 'Select Elements'],
  ['clip', 'clip', 'Clipping Plane'],
  ['length', 'measureLength', 'Measure Length'],
  ['area', 'measureArea', 'Measure Area'],
  ['angle', 'measureAngle', 'Measure Angle'],
  ['volume', 'measureVolume', 'Measure Volume'],
];

/** Every 3D command; `state` is null when no loaded model is in front. */
export function model3dCommands(run: (a: ModelAction) => void, state: ModelState | null): Command[] {
  const on = !!state;
  const cmd = (id: string, label: string, action: ModelAction, enabled = on, checked?: boolean): Command => ({
    id: `model3d.${id}`,
    category: 'View',
    label,
    run: () => run(action),
    enabled,
    ...(checked === undefined ? {} : { checked }),
    ...(on ? {} : { hint: 'Open an IFC model to use the 3D view' }),
  });
  const s = state;
  return [
    cmd('orbit', 'Orbit', { type: 'nav', mode: 'Orbit' }, on, s?.nav === 'Orbit'),
    cmd('firstPerson', 'First Person', { type: 'nav', mode: 'FirstPerson' }, on, s?.nav === 'FirstPerson'),
    cmd('plan', 'Plan View', { type: 'nav', mode: 'Plan' }, on, s?.nav === 'Plan'),
    cmd('walk', 'Walk', { type: 'nav', mode: 'Walk' }, on, s?.nav === 'Walk'),
    cmd('perspective', 'Perspective', { type: 'projection', projection: 'Perspective' }, on, s?.projection === 'Perspective'),
    cmd('orthographic', 'Orthographic', { type: 'projection', projection: 'Orthographic' }, on, s?.projection === 'Orthographic'),
    cmd('fitAll', 'Fit All', { type: 'fitAll' }),
    cmd('fitSelection', 'Fit Selection', { type: 'fitSelection' }, on && s!.selected > 0),
    ...DIRECTIONS.map(([direction, label]) => cmd(`view.${direction}`, `${label} View`, { type: 'direction', direction })),
    ...TOOLS.map(([tool, id, label]) => cmd(id, label, { type: 'tool', tool }, on, s?.tool === tool)),
    cmd('sectionBox', 'Section Box', { type: 'sectionBox' }, on, !!s?.sectionBox),
    cmd('clearClips', 'Remove Sections', { type: 'clearClips' }, on && s!.clipPlanes > 0),
    cmd('clearMeasurements', 'Clear Measurements', { type: 'clearMeasurements' }, on && s!.measurements > 0),
    cmd('isolate', 'Isolate', { type: 'isolate' }, on && s!.selected > 0),
    cmd('hide', 'Hide', { type: 'hide' }, on && s!.selected > 0),
    cmd('showAll', 'Show All', { type: 'showAll' }, on && s!.hidden),
    cmd('ghost', 'Ghost Hidden', { type: 'ghost' }, on, !!s?.ghost),
    cmd('grid', 'Grid', { type: 'grid' }, on, !!s?.grid),
    cmd('miniMap', 'Mini-Map', { type: 'miniMap' }, on, !!s?.miniMap),
    cmd('clearSelection', 'Clear Selection', { type: 'clearSelection' }, on && s!.selected > 0),
    cmd('closeView', 'Back to 3D', { type: 'openView', id: null }, on && !!s!.openView),
  ];
}
