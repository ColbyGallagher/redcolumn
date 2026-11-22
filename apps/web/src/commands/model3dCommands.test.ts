import { test } from 'node:test';
import assert from 'node:assert/strict';
import { model3dCommands } from './model3dCommands.ts';
import { INITIAL_STATE } from '../../../../packages/model3d/src/controls.ts';

test('with no model in front, every 3D command is disabled and says why', () => {
  const cmds = model3dCommands(() => {}, null);
  assert.ok(cmds.length > 20);
  assert.ok(cmds.every((c) => !c.enabled && c.hint && c.id.startsWith('model3d.')));
});

test('with a model, the camera and tool commands run their action and show what is on', () => {
  const runs: unknown[] = [];
  const cmds = new Map(model3dCommands((a) => runs.push(a), { ...INITIAL_STATE, tool: 'length' }).map((c) => [c.id, c]));
  assert.equal(cmds.get('model3d.orbit')!.checked, true);
  assert.equal(cmds.get('model3d.measureLength')!.checked, true);
  assert.equal(cmds.get('model3d.select')!.checked, false);
  cmds.get('model3d.plan')!.run();
  cmds.get('model3d.view.top')!.run();
  assert.deepEqual(runs, [{ type: 'nav', mode: 'Plan' }, { type: 'direction', direction: 'top' }]);
});

test('commands that need a selection, hidden elements or sections wait for them', () => {
  const cmds = (patch: object) => new Map(model3dCommands(() => {}, { ...INITIAL_STATE, ...patch }).map((c) => [c.id, c.enabled]));
  assert.equal(cmds({}).get('model3d.isolate'), false);
  assert.equal(cmds({ selected: 2 }).get('model3d.isolate'), true);
  assert.equal(cmds({}).get('model3d.showAll'), false);
  assert.equal(cmds({ hidden: true }).get('model3d.showAll'), true);
  assert.equal(cmds({ clipPlanes: 1 }).get('model3d.clearClips'), true);
});
