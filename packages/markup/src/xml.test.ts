import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml } from './xml.ts';

test('elements, attributes, text, entities and CDATA', () => {
  const doc = parseXml(`<?xml version="1.0"?><!-- c --><!DOCTYPE a><a x="1 &amp; 2" y='q'><b/><c> hi &lt;there&#33; </c><d><![CDATA[<raw>]]></d></a>`);
  assert.equal(doc.tagName, 'a');
  assert.deepEqual(doc.attrs, { x: '1 & 2', y: 'q' });
  assert.deepEqual(
    doc.children.map((c) => [c.tagName, c.textContent]),
    [['b', ''], ['c', ' hi <there! '], ['d', '<raw>']],
  );
});

test('whitespace around attributes and before the closing bracket is fine', () => {
  const doc = parseXml('<a  p = "1"\n q="2" ></a >');
  assert.deepEqual(doc.attrs, { p: '1', q: '2' });
});

test('bad nesting and unfinished markup throw', () => {
  assert.throws(() => parseXml('<a><b></a>'), /Unexpected/);
  assert.throws(() => parseXml('<a>'), /not closed/);
  assert.throws(() => parseXml('<a x=1/>'), /Bad attribute/);
  assert.throws(() => parseXml('<a><!-- x </a>'), /Missing/);
  assert.throws(() => parseXml(''), /Empty/);
});

test('input built to make a regex slow is scanned in one pass', () => {
  const started = Date.now();
  for (const bad of ['<?'.repeat(50000), '<!--'.repeat(50000), '<![CDATA['.repeat(20000) + 'a', '<a ' + '-'.repeat(100000)]) assert.throws(() => parseXml(bad));
  assert.ok(Date.now() - started < 2000);
});
