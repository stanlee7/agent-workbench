// Exercise the real MCP registrations without a desktop or listening socket.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/mcpServer.js';
import { createSignIns } from '../src/signIn.js';

const handlers = {};
let received, request, profile = 'clean';
const signIns = createSignIns({
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  send: (ch, payload) => { if (ch === 'pane:signin') { request = payload; received?.(); } },
  isRenderer: event => event.trusted, isClean: () => profile === 'clean', keep: () => { profile = 'me'; }
});
let element = { type: 'password' };
const server = buildServer({ id: 'test', wc: () => ({ executeJavaScript: async () => element }) }, {
  onTool: () => {}, signingIn: id => signIns.waiting(id), signIn: (id, reason) => signIns.ask(id, reason), approve: async () => false
});
const client = new Client({ name: 'smoke', version: '0.3.0' });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
await client.connect(clientSide);
const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
try {
  const names = (await client.listTools()).tools.map(t => t.name);
  assert.ok(names.includes('ask_user_to_sign_in') && names.includes('upload_file'));
  const banner = new Promise(resolve => { received = resolve; });
  const result = call('ask_user_to_sign_in', { reason: 'Read a signed-in page' });
  await banner;
  assert.equal(request.clean, true);
  assert.match(await call('read_page'), /user is signing in/);
  assert.equal(await handlers['signin:keep']({ trusted: true }, request), true);
  assert.equal(profile, 'me');
  await handlers['signin:answer']({ trusted: true }, { ...request, result: 'signed in' });
  assert.equal(await result, 'signed in');
  assert.match(await call('type', { id: 0, text: 'dummy' }), /Refused/);
  element = { type: 'submit', label: 'Send' };
  assert.match(await call('click', { id: 0 }), /declined/);
  assert.match(await call('upload_file', { id: 0, path: path.join(os.homedir(), '.ssh', 'nonexistent-smoke') }), /Refused/);
  assert.match(await call('upload_file', { id: 0, path: path.join(os.tmpdir(), '.env') }), /Refused/);
  console.log('MCP smoke passed: tool registration, hand-off, blocked concurrent access, password/upload refusals and click approval.');
} finally {
  signIns.close();
  await client.close(); await server.close();
}
