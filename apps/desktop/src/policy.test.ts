import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { blockedRequests, loadPolicy, mergePolicy, NO_POLICY, parsePolicyJson, parsePolicyRegistry, parsePowerShellRegistry, parseRegQuery, policyFilePath, readPolicyFile, readRegistryPolicy, REGISTRY_KEY, SWITCHES, type Run } from './policy.ts';

test('a JSON policy sets switches and features; keys match without regard to case', () => {
  const part = parsePolicyJson('policy.json', JSON.stringify({ version: 1, disableAutoUpdate: true, DisableAssistant: false, disabledFeatures: ['tools.library', 'takeoff.*'] }));
  assert.deepEqual(part.switches, { disableAutoUpdate: true, disableAssistant: false });
  assert.deepEqual(part.disabledFeatures, ['tools.library', 'takeoff.*']);
  assert.deepEqual(part.problems, []);
});

test('unknown keys are ignored and logged', () => {
  const part = parsePolicyJson('policy.json', JSON.stringify({ disableTelemetry: true, disableExcelSync: true }));
  assert.deepEqual(part.switches, { disableExcelSync: true });
  assert.equal(part.problems.length, 1);
  assert.match(part.problems[0]!, /disableTelemetry is not a policy/);
});

test('a switch with the wrong type fails closed', () => {
  const part = parsePolicyJson('policy.json', JSON.stringify({ disableAutoUpdate: 'false', disableAssistant: 0 }));
  assert.deepEqual(part.switches, { disableAutoUpdate: true, disableAssistant: true });
  assert.equal(part.problems.length, 2);
});

test('a file that is not JSON, or not an object, turns every switch on', () => {
  for (const text of ['{ disableAutoUpdate: true', '[]', 'null', '"x"']) {
    const part = parsePolicyJson('policy.json', text);
    for (const s of SWITCHES) assert.equal(part.switches[s], true, `${text}: ${s}`);
    assert.equal(part.problems.length, 1);
  }
});

test('feature names that are not command ids are dropped; a non-list is ignored', () => {
  const part = parsePolicyJson('policy.json', JSON.stringify({ disabledFeatures: ['file.open', 7, '../x', 'a b', ' help.updates '] }));
  assert.deepEqual(part.disabledFeatures, ['file.open', 'help.updates']);
  assert.equal(part.problems.length, 3);
  const notList = parsePolicyJson('policy.json', JSON.stringify({ disabledFeatures: 'file.open' }));
  assert.deepEqual(notList.disabledFeatures, []);
  assert.equal(notList.problems.length, 1);
});

test('a byte order mark is allowed', () => {
  assert.deepEqual(parsePolicyJson('p', '﻿{"disableAssistant":true}').switches, { disableAssistant: true });
});

test('merging: the most restrictive source wins and features are the union', () => {
  const a = parsePolicyJson('a', JSON.stringify({ disableAutoUpdate: false, disabledFeatures: ['file.open'] }));
  const b = parsePolicyJson('b', JSON.stringify({ disableAutoUpdate: true, disabledFeatures: ['file.open', 'help.sponsor'] }));
  const merged = mergePolicy([a, b]);
  assert.equal(merged.managed, true);
  assert.equal(merged.disableAutoUpdate, true);
  assert.equal(merged.disableAssistant, false);
  assert.deepEqual(merged.disabledFeatures, ['file.open', 'help.sponsor']);
  assert.equal(mergePolicy([b, a]).disableAutoUpdate, true);
  assert.equal(mergePolicy([]).managed, false);
});

const REG_OUTPUT = [
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\redcolumn',
  '    DisableAutoUpdate    REG_DWORD    0x1',
  '    DisableAssistant    REG_DWORD    0x0',
  '    (Default)    REG_SZ    ',
  '    DisabledFeatures    REG_MULTI_SZ    help.sponsor\\0file.open',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\redcolumn\\DisabledFeatures',
  '    1    REG_SZ    tools.library',
  '    2    REG_SZ    takeoff.*',
  '',
].join('\r\n');

test('reg.exe output parses into values per key', () => {
  const keys = parseRegQuery(REG_OUTPUT);
  const main = keys.get(REGISTRY_KEY.toLowerCase())!;
  assert.deepEqual(main.get('disableautoupdate'), { type: 'dword', value: 1 });
  assert.deepEqual(main.get('disabledfeatures'), { type: 'multi', value: ['help.sponsor', 'file.open'] });
  assert.equal(main.has('(default)'), false);
  assert.deepEqual([...keys.get(`${REGISTRY_KEY}\\DisabledFeatures`.toLowerCase())!.values()], [
    { type: 'string', value: 'tools.library' },
    { type: 'string', value: 'takeoff.*' },
  ]);
});

test('registry values: DWORD 0/1 switches, REG_MULTI_SZ and the Group Policy list subkey', () => {
  const part = parsePolicyRegistry('reg', {
    values: new Map([
      ['disableautoupdate', { type: 'dword', value: 1 }],
      ['disableassistant', { type: 'dword', value: 0 }],
      ['disablecommunitylibrary', { type: 'string', value: '1' }],
      ['disableexcelsync', { type: 'dword', value: 2 }],
      ['disabledfeatures', { type: 'multi', value: ['help.sponsor'] }],
      ['somethingelse', { type: 'dword', value: 1 }],
    ]),
    list: [{ type: 'string', value: 'tools.library' }],
  });
  assert.deepEqual(part.switches, { disableAutoUpdate: true, disableAssistant: false, disableCommunityLibrary: true, disableExcelSync: true });
  assert.deepEqual(part.disabledFeatures, ['help.sponsor', 'tools.library']);
  assert.equal(part.problems.length, 3);
});

test('a REG_SZ feature list may be separated by semicolons, commas or spaces', () => {
  const part = parsePolicyRegistry('reg', { values: new Map([['disabledfeatures', { type: 'string', value: 'file.open; help.sponsor,tools.library' }]]), list: null });
  assert.deepEqual(part.disabledFeatures, ['file.open', 'help.sponsor', 'tools.library']);
});

test('PowerShell fallback output converts to the same shape', () => {
  const reg = parsePowerShellRegistry(JSON.stringify({ main: { DisableAutoUpdate: { kind: 'DWord', value: 1 }, DisabledFeatures: { kind: 'MultiString', value: ['a.b'] } }, list: { '1': { kind: 'String', value: 'c.d' } } }))!;
  assert.deepEqual(reg.values.get('disableautoupdate'), { type: 'dword', value: 1 });
  assert.deepEqual(reg.values.get('disabledfeatures'), { type: 'multi', value: ['a.b'] });
  assert.deepEqual(reg.list, [{ type: 'string', value: 'c.d' }]);
  assert.equal(parsePowerShellRegistry(JSON.stringify({ main: null, list: null })), null);
});

/** A stand-in for reg.exe and PowerShell: answers by the tool and the key asked for. */
function fakeExec(answers: { parent: { code: number; stdout: string }; key?: { code: number; stdout: string }; ps?: { code: number; stdout: string } }): { exec: Run; calls: string[] } {
  const calls: string[] = [];
  const exec: Run = async (file, args) => {
    const tool = path.win32.basename(file).toLowerCase();
    calls.push(tool);
    if (tool === 'powershell.exe') return answers.ps ?? { code: 1, stdout: '' };
    if (args[1] === REGISTRY_KEY) return answers.key ?? { code: 1, stdout: '' };
    return answers.parent;
  };
  return { exec, calls };
}

test('registry: no redcolumn key under Policies means no registry policy, and nothing else runs', async () => {
  const { exec, calls } = fakeExec({ parent: { code: 0, stdout: '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\r\n' } });
  assert.deepEqual(await readRegistryPolicy(exec), { reg: null });
  assert.deepEqual(calls, ['reg.exe']);
});

test('registry: the key is read when it is listed', async () => {
  const { exec } = fakeExec({ parent: { code: 0, stdout: `\r\n${REGISTRY_KEY}\r\n` }, key: { code: 0, stdout: REG_OUTPUT } });
  const { reg } = await readRegistryPolicy(exec);
  assert.deepEqual(reg?.values.get('disableautoupdate'), { type: 'dword', value: 1 });
  assert.equal(reg?.list?.length, 2);
});

test('registry: when reg.exe cannot run, PowerShell reads the key; when neither can, a problem is logged', async () => {
  const ps = { code: 0, stdout: JSON.stringify({ main: { DisableAssistant: { kind: 'DWord', value: 1 } }, list: null }) };
  const viaPs = await readRegistryPolicy(fakeExec({ parent: { code: 1, stdout: '' }, ps }).exec);
  assert.deepEqual(viaPs.reg?.values.get('disableassistant'), { type: 'dword', value: 1 });
  const neither = await readRegistryPolicy(fakeExec({ parent: { code: 1, stdout: '' } }).exec);
  assert.equal(neither.reg, null);
  assert.match(neither.problem!, /could not be read/);
});

test('policy files: missing is no policy, a folder or an oversized file fails closed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redcolumn-policy-'));
  assert.equal(await readPolicyFile(path.join(dir, 'policy.json')), null);
  assert.equal((await readPolicyFile(dir))?.switches.disableAutoUpdate, true);
  const big = path.join(dir, 'big.json');
  await fs.writeFile(big, `{"comment":"${'x'.repeat(70 * 1024)}"}`);
  assert.equal((await readPolicyFile(big))?.switches.disableAssistant, true);
  await fs.rm(dir, { recursive: true });
});

test('loadPolicy merges the registry and the files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redcolumn-policy-'));
  const file = path.join(dir, 'policy.json');
  const extra = path.join(dir, 'extra.json');
  await fs.writeFile(file, JSON.stringify({ disableCommunityLibrary: true, disabledFeatures: ['help.sponsor'] }));
  await fs.writeFile(extra, JSON.stringify({ disableMicrosoftSignIn: true }));
  const { exec } = fakeExec({ parent: { code: 0, stdout: `${REGISTRY_KEY}\r\n` }, key: { code: 0, stdout: REG_OUTPUT } });
  const policy = await loadPolicy({ platform: 'win32', files: [file], extraFile: extra, exec });
  assert.equal(policy.managed, true);
  assert.equal(policy.disableAutoUpdate, true);
  assert.equal(policy.disableAssistant, false);
  assert.equal(policy.disableCommunityLibrary, true);
  assert.equal(policy.disableMicrosoftSignIn, true);
  assert.equal(policy.disableExcelSync, false);
  assert.deepEqual(new Set(policy.disabledFeatures), new Set(['help.sponsor', 'file.open', 'tools.library', 'takeoff.*']));
  const none = await loadPolicy({ platform: 'linux', files: [path.join(dir, 'missing.json')] });
  assert.equal(none.managed, false);
  assert.equal(none.disableAutoUpdate, false);
  await fs.rm(dir, { recursive: true });
});

test('blocked requests follow the switches', () => {
  assert.deepEqual(blockedRequests(NO_POLICY), []);
  assert.deepEqual(blockedRequests({ ...NO_POLICY, disableCommunityLibrary: true }), ['https://raw.githubusercontent.com/ColbyGallagher/redcolumn-library/*']);
  assert.ok(blockedRequests({ ...NO_POLICY, disableMicrosoftSignIn: true }).includes('*://graph.microsoft.com/*'));
});

test('policy file locations', () => {
  assert.match(policyFilePath('win32'), /\\redcolumn\\policy\.json$/);
  assert.equal(policyFilePath('darwin'), '/Library/Application Support/redcolumn/policy.json');
  assert.equal(policyFilePath('linux'), '/etc/redcolumn/policy.json');
});
