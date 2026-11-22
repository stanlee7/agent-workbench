import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { startMcpHttp } from '../src/mcpServer.js';
import { createSignIns } from '../src/signIn.js';
import { type, uploadFile, click } from '../src/browserTools.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-smoke-'));
app.setPath('userData', dir);
// Electron emits ready only after an ESM entry finishes loading, so top-level await would hang.
app.whenReady().then(async () => {
let win, server;
try {
  win = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve('src/preload.cjs') } });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  let profile = 'clean', request;
  const send = (ch, payload) => {
    if (ch === 'pane:signin') request = payload;
    win.webContents.send(ch, payload);
  };
  const signIns = createSignIns({
    ipcMain, send, isRenderer: e => e.sender === win.webContents,
    isClean: () => profile === 'clean', keep: () => { profile = 'me'; }
  });
  const profiles = () => ({ profiles: [{ id: 'clean', label: 'Clean (nothing saved)' }, { id: 'me', label: 'My logins' }], assigned: { test: profile }, logins: {} });
  server = startMcpHttp({ port: 0, panes: { test: { id: 'test', wc: () => { throw new Error('Browser must stay untouched during sign-in'); } } }, hooks: {
    onTool: () => {}, signingIn: id => signIns.waiting(id), signIn: (id, reason) => signIns.ask(id, reason)
  } });
  await once(server, 'listening');
  assert.equal(server.address().address, '127.0.0.1');
  ipcMain.handle('config', () => ({ port: server.address().port, locale: 'en', firstRun: false, panes: [{ id: 'test', label: 'Test agent' }] }));
  ipcMain.handle('profiles:get', profiles);
  ipcMain.handle('setup:check', () => [{ id: 'test', found: true, ready: true, version: '1.0', binary: 'test' }]);
  ipcMain.handle('settings:language', () => {});
  ipcMain.handle('setup:seen', () => {});
  await win.loadFile(path.resolve('src/renderer/index.html'));
  const js = code => win.webContents.executeJavaScript(code);
  const until = async code => {
    const end = Date.now() + 5000;
    while (!await js(code)) { assert.ok(Date.now() < end, `Timed out: ${code}`); await new Promise(r => setTimeout(r, 20)); }
  };
  await until("!!document.querySelector('.pane') && document.querySelector('.profile').options.length > 0");
  const call = async (name, args = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    });
    assert.equal(response.status, 200);
    return (await response.json()).result.content[0].text;
  };
  let result = call('ask_user_to_sign_in', { reason: 'Read the private page' });
  await until("!document.querySelector('.signin').hidden");
  assert.equal(await js("document.querySelector('.signin input').checked"), false);
  assert.equal(await js("document.querySelector('.pane').dataset.status"), 'signin');
  assert.match(await call('read_page'), /user is signing in/);
  await js("document.querySelector('#language').value = 'ko'; document.querySelector('#language').dispatchEvent(new Event('change'))");
  await until("document.querySelector('.signin .primary').textContent === '완료, 계속하기'");
  await js("document.querySelector('#starters button').click()");
  assert.match(await js("document.querySelector('#task').value"), /상품 가격/);
  assert.equal(await js("document.querySelector('#followUp').checked"), false);
  assert.match(await js("document.querySelector('.signin strong').textContent"), /Read the private page/);
  await js("document.querySelector('.signin input').click()");
  await until("document.querySelector('.profile').value === 'me'");
  await js("document.querySelector('.signin .primary').click()");
  assert.equal(await result, 'signed in');
  await until("document.querySelector('.signin').hidden");
  result = call('ask_user_to_sign_in', { reason: 'Another page' });
  await until("!document.querySelector('.signin').hidden");
  assert.equal(await js("document.querySelector('.signin input') === null"), true);
  await js("document.querySelector('.signin .btns button:last-child').click()");
  assert.equal(await result, 'skipped');

  // Exercise expiration and stale replies with the same IPC handlers on a short clock.
  ipcMain.removeHandler('signin:answer'); ipcMain.removeHandler('signin:keep');
  const timed = createSignIns({ ipcMain, send: () => {}, isRenderer: () => true, isClean: () => true, keep: () => {}, timeout: 20 });
  assert.equal(await timed.ask('test', 'timeout'), 'timed out');
  assert.equal(await js(`window.wb.signInAnswer('test', ${request.requestId}, 'signed in')`), false);
  timed.close(); signIns.close();

  const fake = { executeJavaScript: async () => ({ type: 'password' }) };
  assert.match(await type(fake, 0, 'not-a-password', false, () => true), /Refused/);
  assert.match(await click({ executeJavaScript: async () => ({ type: 'submit', label: 'Send' }) }, 0, async () => false), /declined/);
  await assert.rejects(uploadFile({}, 0, path.join(os.homedir(), '.ssh', 'nonexistent-smoke'), () => true), /Refused/);
  await assert.rejects(uploadFile({}, 0, path.join(dir, '.env'), () => true), /Refused/);
  assert.deepEqual(errors, []);
  console.log('Smoke passed: MCP → banner → preload IPC; continue, skip, keep, timeout, stale answer, loopback and safety refusals.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  server?.close();
  win?.destroy();
  app.exit(process.exitCode ?? 0); // app.quit() drops the exit code
  fs.rmSync(dir, { recursive: true, force: true });
}
});
