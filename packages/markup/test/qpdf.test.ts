import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { assertValidPdf } from './qpdf.ts';

const MISSING_BINARY = 'rc-definitely-not-installed-qpdf-binary';
const SAMPLE_PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');

test('missing qpdf binary skips silently when REQUIRE_QPDF_TESTS is not set', () => {
  const ran = assertValidPdf(SAMPLE_PDF, 'missing-optional', {
    binary: MISSING_BINARY,
    requireQpdf: false,
  });
  assert.equal(ran, false);
});

test('missing qpdf binary throws a clear error when REQUIRE_QPDF_TESTS=1', () => {
  const prev = process.env.REQUIRE_QPDF_TESTS;
  process.env.REQUIRE_QPDF_TESTS = '1';
  try {
    assert.throws(
      () => assertValidPdf(SAMPLE_PDF, 'required-check', { binary: MISSING_BINARY }),
      /not installed.*REQUIRE_QPDF_TESTS=1.*required-check/,
    );
  } finally {
    if (prev === undefined) delete process.env.REQUIRE_QPDF_TESTS;
    else process.env.REQUIRE_QPDF_TESTS = prev;
  }
});

test('passes on exit 0, writes exact bytes to a temp file, and cleans it up', () => {
  // Script verifies the temp file starts with %PDF-, prints its path to stderr, and exits 0.
  let seenPath = '';
  const script = [
    'const fs = require("node:fs");',
    'const file = process.argv[1];',
    'const data = fs.readFileSync(file);',
    'if (data.toString("ascii", 0, 5) !== "%PDF-") process.exit(2);',
    'process.stdout.write(file);',
    'process.exit(0);',
  ].join(' ');
  const ran = assertValidPdf(SAMPLE_PDF, 'clean-pdf', {
    binary: process.execPath,
    args: ['-e', script],
  });
  assert.equal(ran, true);

  // Also verify cleanup when the check fails (exit 2).
  const failScript = [
    'process.stderr.write("FILE:" + process.argv[1] + "\\nmalformed xref");',
    'process.exit(2);',
  ].join(' ');
  assert.throws(
    () =>
      assertValidPdf(SAMPLE_PDF, 'broken-pdf', {
        binary: process.execPath,
        args: ['-e', failScript],
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /qpdf --check failed \(exit 2\) \(broken-pdf\)/);
      assert.match(err.message, /malformed xref/);
      const match = /FILE:([^\r\n]+)/.exec(err.message);
      assert.ok(match, 'diagnostic output includes temp file path');
      seenPath = match[1]!;
      return true;
    },
  );
  assert.equal(existsSync(seenPath), false, 'temp PDF file is removed in finally');
});

test('exit 3 (warnings) fails by default and passes when allowWarnings is true', () => {
  const warnScript = 'process.stderr.write("WARNING: minor xref issue"); process.exit(3);';
  assert.throws(
    () =>
      assertValidPdf(SAMPLE_PDF, 'warn-pdf', {
        binary: process.execPath,
        args: ['-e', warnScript],
      }),
    /qpdf --check reported warnings \(exit 3\) \(warn-pdf\)[\s\S]*minor xref issue/,
  );

  const ran = assertValidPdf(SAMPLE_PDF, 'warn-allowed', {
    binary: process.execPath,
    args: ['-e', warnScript],
    allowWarnings: true,
  });
  assert.equal(ran, true);
});

test('validates a real pdf-lib document when qpdf is installed', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  const ran = assertValidPdf(bytes, 'real-pdf-lib-doc');
  if (ran) {
    assert.throws(
      () => assertValidPdf(new TextEncoder().encode('not a pdf'), 'invalid-bytes'),
      /qpdf --check failed/,
    );
  }
});
