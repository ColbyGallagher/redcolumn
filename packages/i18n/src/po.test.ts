import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCatalog, messageKey, parsePo, poHeader, writePo, type PoEntry } from './po.ts';

const SAMPLE = `msgid ""
msgstr ""
"Language: de\\n"
"Content-Type: text/plain; charset=UTF-8\\n"

#. Ribbon button
#: apps/web/src/components/Ribbon.tsx
msgid "Save all"
msgstr "Alle speichern"

msgctxt "noun"
msgid "Count"
msgstr "Anzahl"

msgctxt "verb"
msgid "Count"
msgstr "Zählen"

#, fuzzy
msgid "Takeoff"
msgstr "Aufmaß"

msgid "Line one\\nwith \\"quotes\\""
msgstr ""
"Zeile eins\\n"
"mit \\"Anführungszeichen\\""

msgid "Not yet"
msgstr ""

#~ msgid "Gone"
#~ msgstr "Weg"
`;

test('parses entries, contexts, comments and multi-line strings', () => {
  const entries = parsePo(SAMPLE);
  assert.equal(entries.length, 7);
  assert.match(entries[0]!.str, /Language: de/);
  assert.deepEqual(entries[1], { id: 'Save all', str: 'Alle speichern', notes: ['Ribbon button'], refs: ['apps/web/src/components/Ribbon.tsx'] });
  assert.equal(entries[2]!.context, 'noun');
  assert.equal(entries[3]!.str, 'Zählen');
  assert.deepEqual(entries[4]!.flags, ['fuzzy']);
  assert.equal(entries[5]!.id, 'Line one\nwith "quotes"');
  assert.equal(entries[5]!.str, 'Zeile eins\nmit "Anführungszeichen"');
});

test('compiles to a catalog without header, empty or fuzzy entries', () => {
  assert.deepEqual(compileCatalog(parsePo(SAMPLE)), {
    'Save all': 'Alle speichern',
    [messageKey('Count', 'noun')]: 'Anzahl',
    [messageKey('Count', 'verb')]: 'Zählen',
    'Line one\nwith "quotes"': 'Zeile eins\nmit "Anführungszeichen"',
  });
});

test('writes what it reads', () => {
  const entries: PoEntry[] = [poHeader('de'), { id: 'Tab\there "q" \\', str: 'x', context: 'c', notes: ['n'], refs: ['a.ts', 'b.ts'], flags: ['fuzzy'] }];
  assert.deepEqual(parsePo(writePo(entries)), entries);
});

test('handles CRLF and a byte-order mark', () => {
  assert.deepEqual(parsePo('﻿msgid "A"\r\nmsgstr "B"\r\n'), [{ id: 'A', str: 'B' }]);
});
