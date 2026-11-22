import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkAgent, findBinary, probe } from '../src/setup.js';
import { createSignIns } from '../src/signIn.js';

assert.equal(findBinary('workbench-nonexistent-cli-9342'), null);
const missing = await checkAgent({ id: 'missing', command: 'workbench-nonexistent-cli-9342' });
assert.equal(missing.found, false);
assert.equal(missing.ready, false);
const found = await checkAgent({ id: 'node', command: `"${process.execPath}"` });
assert.equal(found.found, true);
assert.equal(found.ready, true);
assert.match(found.version, /^v\d/);
assert.equal((await probe(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 40)).timedOut, true);

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-cli-'));
try {
  const binary = path.join(fixtures, 'agy');
  fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const [list, expected] of [
    [{ ok: true, output: 'wb: http://127.0.0.1:7788/mcp/agy' }, 'registered'],
    [{ ok: true, output: 'other: http://127.0.0.1:9999' }, 'missing'],
    [{ ok: false, output: 'unknown command mcp' }, 'unchecked']
  ]) {
    const calls = [];
    const row = await checkAgent({ id: 'agy', command: `"${binary}"` }, async (_bin, args) => {
      calls.push(args); return args[0] === '--version' ? { ok: true, output: '1.4' } : list;
    });
    assert.equal(row.mcp, expected);
    assert.deepEqual(calls, [['--version'], ['mcp', 'list']]);
  }
} finally { fs.rmSync(fixtures, { recursive: true, force: true }); }

const handlers = {};
const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
let request, kept = false;
const signIns = createSignIns({ ipcMain, send: (name, payload) => { if (name === 'pane:signin') request = payload; }, isRenderer: event => event.trusted, isClean: () => true, keep: () => { kept = true; }, timeout: 30 });
let result = signIns.ask('test', 'Manual login');
assert.equal(await handlers['signin:answer']({}, { ...request, result: 'signed in' }), false);
assert.equal(await handlers['signin:keep']({ trusted: true }, request), true);
assert.equal(kept, true);
assert.equal(await handlers['signin:answer']({ trusted: true }, { ...request, result: 'signed in' }), true);
assert.equal(await result, 'signed in');
result = signIns.ask('test', 'Skip login');
await handlers['signin:answer']({ trusted: true }, { ...request, result: 'skipped' });
assert.equal(await result, 'skipped');
assert.equal(await signIns.ask('test', 'Expire login'), 'timed out');
result = signIns.ask('test', 'Cancelled task');
signIns.cancel('test');
assert.equal(await result, 'skipped');
signIns.close();
console.log('Node smoke passed: PATH, CLI version, timeout, trusted hand-off responses and cancellation.');
