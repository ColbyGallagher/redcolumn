import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** RECOLUMN_SMOKE=1 launches the packaged app, checks the page renders, then exits. */
export function isSmokeRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RECOLUMN_SMOKE === '1';
}

/**
 * A fresh user-data folder for one smoke run. The single-instance lock and every saved file
 * live under user data, so a smoke run with its own folder never meets the person's running
 * app: without it the lock fails, the run quits before checking anything, and exits 0.
 */
export function smokeUserData(tmp: string = os.tmpdir()): string {
  return fs.mkdtempSync(path.join(tmp, 'redcolumn-smoke-'));
}

/** Said when a smoke run still cannot take the lock, so the run fails instead of passing silently. */
export function lockHeldMessage(userData: string): string {
  return `RECOLUMN_SMOKE: another redcolumn already holds the single-instance lock for ${userData}, so the smoke test cannot run.`;
}
