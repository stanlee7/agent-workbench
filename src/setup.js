import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { tokens, resolveShim } from './agents.js';

export const AGY_DOCS = 'https://antigravity.google/docs/getting-started?tab=cli';
const INSTALL = { claude: 'npm i -g @anthropic-ai/claude-code', codex: 'npm i -g @openai/codex' };

// Finder does not inherit the PATH from a terminal window.
export function addMacCliPaths() {
  if (process.platform !== 'darwin') return;
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']) {
    if (!dirs.includes(dir) && fs.existsSync(dir)) dirs.push(dir);
  }
  process.env.PATH = dirs.join(path.delimiter);
}

export function findBinary(binary, envPath = process.env.PATH || '') {
  const suffixes = process.platform === 'win32' ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  const dirs = /[\\/]/.test(binary) ? [''] : envPath.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) for (const suffix of suffixes) {
    const file = path.resolve(dir, binary + suffix);
    try {
      fs.accessSync(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return file;
    } catch {}
  }
  return null;
}

export function probe(binary, args, timeout = 5000) {
  return new Promise(resolve => {
    const shim = resolveShim(binary);
    execFile(shim?.cmd || binary, [...(shim?.pre || []), ...args], {
      timeout, killSignal: 'SIGKILL', maxBuffer: 256 * 1024, windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' }
    }, (error, stdout, stderr) => resolve({ ok: !error, timedOut: !!error?.killed, output: stdout || stderr || '' })).stdin.end();
  });
}

export async function checkAgent(agent, run = probe) {
  const binary = tokens(agent.command)[0] || '';
  const name = path.basename(binary).replace(/\.(cmd|exe|bat)$/i, '');
  const found = !!binary && !!findBinary(binary);
  const row = { id: agent.id, label: agent.label, binary, found, ready: false, version: '', install: INSTALL[name] || '', docs: name === 'agy' ? AGY_DOCS : '', mcp: null };
  if (!found) return row;
  const result = await run(binary, ['--version']);
  row.ready = result.ok;
  row.issue = result.ok ? '' : result.timedOut ? 'timeout' : 'versionFailed';
  row.version = result.ok ? result.output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim().split('\n')[0].slice(0, 160) : '';
  if (name === 'agy' && result.ok) {
    const list = await run(binary, ['mcp', 'list']);
    // Older versions may not have this subcommand. Do not guess or change their config.
    row.mcp = !list.ok ? 'unchecked' : /(?:^|[\s"'])wb(?:[\s"':]|$)/m.test(list.output) ? 'registered' : 'missing';
  }
  return row;
}

export const checkAgents = agents => Promise.all(agents.filter(a => a.enabled !== false).map(a => checkAgent(a)));

export async function registerAgy(agent, port) {
  const row = await checkAgent(agent);
  if (!row.ready || row.mcp !== 'missing' || path.basename(row.binary).replace(/\.(cmd|exe|bat)$/i, '') !== 'agy') return false;
  return (await probe(row.binary, ['mcp', 'add', 'wb', `http://127.0.0.1:${port}/mcp/agy`])).ok;
}
