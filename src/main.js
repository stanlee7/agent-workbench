import { app, BrowserWindow, WebContentsView, ipcMain, screen, shell, dialog, Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMcpHttp } from './mcpServer.js';
import { addMacCliPaths, checkAgents, registerAgy, AGY_DOCS } from './setup.js';
import { createSignIns } from './signIn.js';
import { startRecorder } from './recorder.js';
import { loadAgents, saveAgents, runAgent, newSession, slug, CONFIG_PATH } from './agents.js';
import { CLEAN, profileList, profileOf, setProfile, addProfile, partitionFor, signedInHosts } from './profiles.js';

addMacCliPaths();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WORKBENCH_PORT || 7788);
// Panes are built from the enabled agents in the config file; editing the list relaunches the app.
const ALL_AGENTS = loadAgents();
const AGENTS = Object.fromEntries(ALL_AGENTS.filter(a => a.enabled !== false).map(a => [a.id, a]));
const PANE_IDS = Object.keys(AGENTS);
const START_URL = 'https://www.google.com/';

const DATA_DIR = path.dirname(CONFIG_PATH);
const RUNS_DIR = path.join(DATA_DIR, 'runs');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const settings = readJson(SETTINGS_PATH, {});
const saveSettings = () => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2)); };

let win;
const views = {};      // paneId -> WebContentsView
const running = {};    // paneId -> child process
const pendingApprovals = new Map(); // approvalId -> resolve
let approvalSeq = 0;

const send = (ch, payload) => win && !win.isDestroyed() && win.webContents.send(ch, payload);

const bounds = {};    // paneId -> last layout rect from the renderer
const logins = {};    // paneId -> hosts the pane's browser looks signed in to

async function reportLogins(id) {
  const v = views[id]; if (!v) return;
  const hosts = await signedInHosts(v.webContents.session);
  if (views[id] !== v) return; // the pane was swapped while we looked
  logins[id] = hosts;
  send('pane:logins', { id, hosts });
}

// Each pane is a WebContentsView on the cookie jar of its profile. Changing the profile means a new
// view, because a partition is fixed when the view is made.
function createPane(id, url = START_URL) {
  const partition = partitionFor(id, profileOf(settings, id));
  const view = new WebContentsView({ webPreferences: { partition } });
  win.contentView.addChildView(view);
  if (bounds[id]) view.setBounds(bounds[id]);
  view.webContents.loadURL(url);
  const report = () => send('pane:url', { id, url: view.webContents.getURL(), title: view.webContents.getTitle() });
  view.webContents.on('did-navigate', report);
  view.webContents.on('did-navigate-in-page', report);
  view.webContents.on('page-title-updated', report);
  view.webContents.on('did-finish-load', () => reportLogins(id));
  // Popups open in the same pane so the agent never loses track of them.
  view.webContents.setWindowOpenHandler(({ url }) => { view.webContents.loadURL(url); return { action: 'deny' }; });
  views[id] = view;
  view.setVisible(panesShown && !collapsed[id]);
  reportLogins(id);
}

function createPanes() { for (const id of PANE_IDS) createPane(id); }

function replacePane(id) {
  const old = views[id];
  const url = old ? old.webContents.getURL() : START_URL;
  if (old) { win.contentView.removeChildView(old); old.webContents.close(); }
  createPane(id, url && !/^about:/.test(url) ? url : START_URL);
}

const panes = Object.fromEntries(PANE_IDS.map(id => [id, { id, wc: () => views[id].webContents }]));

const signIns = createSignIns({
  ipcMain, send,
  isRenderer: event => event.sender === win?.webContents,
  isClean: id => profileOf(settings, id) === CLEAN,
  keep: id => {
    if (profileOf(settings, id) !== CLEAN) return;
    const profiles = profileList(settings);
    if (!profiles.some(p => p.id === 'me')) profiles.push({ id: 'me', label: 'My logins' });
    setProfile(settings, id, 'me'); saveSettings();
    replacePane(id);
  }
});

startMcpHttp({
  port: PORT,
  panes,
  hooks: {
    signIn: (id, reason) => signIns.ask(id, reason),
    signingIn: id => signIns.waiting(id),
    onTool: (id, name, args) => send('pane:tool', { id, name, args }),
    approve: (id, question) => new Promise(resolve => {
      const approvalId = ++approvalSeq;
      pendingApprovals.set(approvalId, resolve);
      send('pane:approval', { id, approvalId, question });
    })
  }
});

ipcMain.on('layout', (_e, rects) => {
  for (const [id, r] of Object.entries(rects)) {
    bounds[id] = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    collapsed[id] = bounds[id].width < 2 || bounds[id].height < 2;
    views[id]?.setVisible(panesShown && !collapsed[id]);
    if (!collapsed[id]) views[id]?.setBounds(bounds[id]);
  }
});

/* ---------- browser profiles ---------- */

const profilesPayload = () => ({
  profiles: [{ id: CLEAN, label: 'Clean (nothing saved)' }, ...profileList(settings)],
  assigned: Object.fromEntries(PANE_IDS.map(id => [id, profileOf(settings, id)])),
  logins
});
ipcMain.handle('profiles:get', () => profilesPayload());
ipcMain.handle('profile:set', (_e, { id, profileId }) => {
  if (!views[id] || signIns.waiting(id)) return profilesPayload();
  setProfile(settings, id, profileId); saveSettings();
  replacePane(id);
  return profilesPayload();
});
ipcMain.handle('profile:add', (_e, label) => { const id = addProfile(settings, label); saveSettings(); return { id, ...profilesPayload() }; });
// Wipes the pane's cookie jar. On a named profile this signs every pane on that profile out.
ipcMain.handle('profile:clear', async (_e, id) => {
  const v = views[id]; if (!v || signIns.waiting(id)) return profilesPayload();
  if (PANE_IDS.some(other => signIns.waiting(other) && views[other]?.webContents.session === v.webContents.session)) return profilesPayload();
  await v.webContents.session.clearStorageData();
  // Back to the start page rather than a reload: reloading the same site would set its cookies again at once.
  v.webContents.loadURL(START_URL);
  await reportLogins(id);
  for (const other of PANE_IDS) if (other !== id && profileOf(settings, other) === profileOf(settings, id)) reportLogins(other);
  return profilesPayload();
});

ipcMain.on('approval:answer', (_e, { approvalId, ok }) => {
  pendingApprovals.get(approvalId)?.(ok);
  pendingApprovals.delete(approvalId);
});

ipcMain.on('pane:go', (_e, { id, url }) => {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  views[id]?.webContents.loadURL(url);
});

// One session id per pane per task, so a follow-up question lands in the same CLI session.
const sessions = {};
let setupSnapshot = [], setupAt = 0;
async function inspectSetup() {
  setupSnapshot = await checkAgents(ALL_AGENTS);
  setupAt = Date.now();
  return setupSnapshot;
}

ipcMain.on('task:run', async (_e, { ids, task, followUp, previous }) => {
  const rows = Date.now() - setupAt < 5000 ? setupSnapshot : await inspectSetup();
  const ready = new Set(rows.filter(a => a.ready).map(a => a.id));
  for (const id of ids) {
    if (!AGENTS[id]) continue;
    if (!ready.has(id)) { send('pane:status', { id, status: 'unavailable' }); continue; }
    if (running[id]) continue;
    if (!followUp || !sessions[id]) sessions[id] = newSession();
    send('pane:status', { id, status: 'working' });
    const turn = { session: sessions[id], followUp: Boolean(followUp && previous?.[id] !== undefined), previous: previous?.[id] || '', logins: logins[id] || [] };
    running[id] = runAgent(AGENTS[id], `http://127.0.0.1:${PORT}/mcp/${id}`, task, turn, {
      onOut: (text, stream) => send('pane:out', { id, text, stream }),
      onExit: code => {
        signIns.cancel(id);
        delete running[id];
        send('pane:status', { id, status: code === 0 ? 'done' : 'error', code });
      }
    });
  }
});

function stop(child) {
  if (!child) return;
  // With shell:true on Windows the CLI is a grandchild; kill the whole tree.
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill();
}

// The browsers are native views drawn over the page, so the compare board hides them while it is open.
// A pane whose browser slot is collapsed reports a zero-size rect; its view stays hidden even when the panes return.
const collapsed = {};
let panesShown = true;
ipcMain.on('panes:visible', (_e, visible) => { panesShown = visible; for (const [id, v] of Object.entries(views)) v.setVisible(visible && !collapsed[id]); });

ipcMain.on('task:stop', (_e, { id }) => { signIns.cancel(id); stop(running[id]); });

/* ---------- run history, export, settings ---------- */


// The renderer sends the whole run record whenever it changes; the file name is the run's start time.
ipcMain.on('run:save', (_e, run) => {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNS_DIR, `${run.id}.json`), JSON.stringify(run, null, 2));
});

ipcMain.handle('runs:list', () => {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 200).map(f => {
    const r = readJson(path.join(RUNS_DIR, f), null);
    return r && { id: r.id, task: r.task, started: r.started, agents: Object.keys(r.agents || {}), turns: Math.max(1, ...Object.values(r.agents || {}).map(a => a.turns?.length || 0)) };
  }).filter(Boolean);
});

ipcMain.handle('runs:load', (_e, id) => readJson(path.join(RUNS_DIR, `${String(id).replace(/[^0-9T_-]/g, '')}.json`), null));
ipcMain.on('runs:open', () => { fs.mkdirSync(RUNS_DIR, { recursive: true }); shell.openPath(RUNS_DIR); });

// Export the compare board as Markdown; the folder picked last time is offered first.
ipcMain.handle('run:export', async (_e, { name, markdown }) => {
  const res = await dialog.showSaveDialog(win, {
    title: (settings.language || app.getLocale()).startsWith('ko') ? '비교판 저장' : 'Export compare board',
    defaultPath: path.join(settings.exportDir || app.getPath('documents'), name),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, markdown);
  settings.exportDir = path.dirname(res.filePath);
  saveSettings();
  return res.filePath;
});

// Desktop notification when the window is not in front: approvals and finished runs.
ipcMain.on('notify', (_e, { title, body }) => {
  if (!Notification.isSupported() || (win && win.isFocused())) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => { if (win) { win.show(); win.focus(); } });
  n.show();
});

// `npm start -- --task "..."` runs a task as soon as the window opens (handy for demos and scripts).
const taskArg = process.argv.indexOf('--task');
const START_TASK = taskArg > 0 ? process.argv[taskArg + 1] || '' : '';

ipcMain.handle('config', () => ({
  port: PORT,
  firstRun: !settings.setupSeen,
  locale: settings.language || (app.getLocale().startsWith('ko') ? 'ko' : 'en'),
  startTask: START_TASK,
  // While recording a demo, open the compare board by itself once every agent has finished.
  autoCompare: Boolean(process.env.WORKBENCH_RECORD),
  panes: PANE_IDS.map(id => ({ id, label: AGENTS[id].label, color: AGENTS[id].color }))
}));

ipcMain.handle('settings:language', (_e, language) => {
  if (!['ko', 'en'].includes(language)) return;
  settings.language = language; saveSettings();
});
ipcMain.handle('setup:check', inspectSetup);
ipcMain.handle('setup:seen', () => { settings.setupSeen = true; saveSettings(); });
ipcMain.handle('setup:register-agy', async (event, id) => {
  if (event.sender !== win?.webContents || !AGENTS[id]) return false;
  return registerAgy(AGENTS[id], PORT);
});
ipcMain.on('setup:docs', () => shell.openExternal(AGY_DOCS));

ipcMain.handle('agents:get', () => ({ path: CONFIG_PATH, agents: ALL_AGENTS }));
ipcMain.on('agents:open', () => shell.openPath(CONFIG_PATH));
ipcMain.on('agents:save', (_e, list) => {
  const seen = new Set();
  const clean = list.filter(a => a.label && a.command).map(a => {
    let id = slug(a.id || a.label);
    while (seen.has(id)) id += '-2';
    seen.add(id);
    return { id, label: String(a.label), color: a.color || '#666666', enabled: a.enabled !== false, command: String(a.command), followUp: String(a.followUp || '') };
  });
  if (!clean.length) return;
  saveAgents(clean);
  Object.values(running).forEach(stop);
  // Relaunch without --task so the startup task does not run a second time.
  app.relaunch({ args: process.argv.slice(1, taskArg > 0 ? taskArg : undefined) });
  app.exit(0);
});

app.whenReady().then(() => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(980, height),
    title: 'Agent Workbench',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#171717',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') }
  });
  win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  createPanes();
  if (process.env.WORKBENCH_RECORD) startRecorder(win, views, process.env.WORKBENCH_RECORD);
});

app.on('window-all-closed', () => {
  signIns.close();
  Object.values(running).forEach(stop);
  app.quit();
});
