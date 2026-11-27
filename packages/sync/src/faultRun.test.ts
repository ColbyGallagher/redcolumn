/**
 * The randomised fault run over 1,000 fixed seeds. Each seed mixes edits, undo and redo, lost,
 * duplicated and reordered frames, broken connections, restarts, crashes, clock jumps of minutes
 * to days, access changes, a closing stage, inbox retries and a modified client, then heals the
 * network and checks that every client still allowed in matches the server, with nothing lost and
 * nothing applied twice. A failure names its seed, which replays the run exactly.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSeed } from './faultRun.ts';

const SEEDS = 1_000;

test(`fault run: ${SEEDS} random seeds converge with nothing lost or duplicated`, async () => {
  const failures: string[] = [];
  let accepted = 0;
  let undos = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const run = await runSeed(seed);
    accepted += run.accepted;
    undos += run.undos.ok + run.undos.changed + run.undos.other;
    if (run.problems.length) failures.push(`seed ${seed}: ${run.problems.join('; ')}`);
  }
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} of ${SEEDS} seeds failed`);
  // The run must actually exercise sync, not pass by doing nothing.
  assert.ok(accepted > SEEDS * 5, `only ${accepted} operations accepted`);
  assert.ok(undos > SEEDS / 2, `only ${undos} undo or redo calls`);
});
