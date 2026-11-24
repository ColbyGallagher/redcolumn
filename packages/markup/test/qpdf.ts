import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export interface QpdfOptions {
  /** Override the qpdf executable (defaults to `qpdf`). */
  binary?: string;
  /** Arguments passed before the temp PDF path (defaults to `['--check']`). */
  args?: readonly string[];
  /** Override `process.env.REQUIRE_QPDF_TESTS === '1'`. */
  requireQpdf?: boolean;
  /** Allow qpdf exit code 3 (warnings without errors). Defaults to `false`. */
  allowWarnings?: boolean;
}

const DEFAULT_BINARY = 'qpdf';
const DEFAULT_ARGS = ['--check'] as const;

// Cache missing-binary detection for the default `qpdf` binary so local runs without qpdf
// do not spawn a failing process on every assertion.
let defaultBinaryMissing = false;

function formatDiagnostics(label: string | undefined, stdout: string, stderr: string): string {
  const details = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  const prefix = label ? ` (${label})` : '';
  return details ? `${prefix}:\n${details}` : prefix;
}

/**
 * Validate PDF bytes structurally using `qpdf --check`.
 *
 * Returns `true` when `qpdf` ran and validated the PDF, or `false` when `qpdf` is not installed
 * and `REQUIRE_QPDF_TESTS` is not set to `'1'`.
 *
 * Exit codes from `qpdf --check`:
 * - `0`: valid PDF, no warnings or errors
 * - `3`: warnings only (fails unless `allowWarnings: true`)
 * - `2` (or any other non-zero status / signal): structural error
 */
export function assertValidPdf(bytes: Uint8Array, label?: string, options?: QpdfOptions): boolean {
  const binary = options?.binary ?? DEFAULT_BINARY;
  const args = options?.args ?? DEFAULT_ARGS;
  const required = options?.requireQpdf ?? process.env.REQUIRE_QPDF_TESTS === '1';
  const allowWarnings = options?.allowWarnings ?? false;

  if (binary === DEFAULT_BINARY && defaultBinaryMissing) {
    if (required) {
      throw new Error(`qpdf is not installed (REQUIRE_QPDF_TESTS=1)${label ? ` while checking ${label}` : ''}`);
    }
    return false;
  }

  const file = path.join(os.tmpdir(), `rc-qpdf-${process.pid}-${randomUUID()}.pdf`);
  writeFileSync(file, bytes);
  try {
    const result = spawnSync(binary, [...args, file], {
      encoding: 'utf8',
      windowsHide: true,
    });

    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        if (binary === DEFAULT_BINARY) defaultBinaryMissing = true;
        if (required) {
          throw new Error(
            `qpdf binary "${binary}" is not installed (REQUIRE_QPDF_TESTS=1)${label ? ` while checking ${label}` : ''}`,
          );
        }
        return false;
      }
      throw new Error(
        `Failed to execute "${binary}"${label ? ` for ${label}` : ''}: ${result.error.message}`,
      );
    }

    if (result.status === 0) return true;

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';

    if (result.status === 3) {
      if (allowWarnings) return true;
      throw new Error(
        `qpdf --check reported warnings (exit 3)${formatDiagnostics(label, stdout, stderr)}`,
      );
    }

    const reason = result.status !== null ? `exit ${result.status}` : `signal ${result.signal ?? 'unknown'}`;
    throw new Error(
      `qpdf --check failed (${reason})${formatDiagnostics(label, stdout, stderr)}`,
    );
  } finally {
    rmSync(file, { force: true });
  }
}
