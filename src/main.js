import { app, BrowserWindow, WebContentsView, ipcMain, screen } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMcpHttp } from './mcpServer.js';
import { AGENTS, runAgent } from './agents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WORKBENCH_PORT || 7788);
const PANE_IDS = Object.keys(AGENTS);
const START_URL = 'https://www.google.com/';

let win;
const views = {};      // paneId -> WebContentsView
const running = {};    // paneId -> child process
const pendingApprovals = new Map(); // approvalId -> resolve
let approvalSeq = 0;

const send = (ch, payload) => win && !win.isDestroyed() && win.webContents.send(ch, payload);

function createPanes() {
  for (const id of PANE_IDS) {
    // Separate persistent profile per pane: logins you make in one pane stay in that pane.
    const view = new WebContentsView({ webPreferences: { partition: `persist:pane-${id}` } });
    win.contentView.addChildView(view);
    view.webContents.loadURL(START_URL);
    const report = () => send('pane:url', { id, url: view.webContents.getURL(), title: view.webContents.getTitle() });
    view.webContents.on('did-navigate', report);
    view.webContents.on('did-navigate-in-page', report);
    view.webContents.on('page-title-updated', report);
    // Popups open in the same pane so the agent never loses track of them.
    view.webContents.setWindowOpenHandler(({ url }) => { view.webContents.loadURL(url); return { action: 'deny' }; });
    views[id] = view;
  }
}

const panes = Object.fromEntries(PANE_IDS.map(id => [id, { id, wc: () => views[id].webContents }]));

startMcpHttp({
  port: PORT,
  panes,
  hooks: {
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
    views[id]?.setBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
  }
});

ipcMain.on('approval:answer', (_e, { approvalId, ok }) => {
  pendingApprovals.get(approvalId)?.(ok);
  pendingApprovals.delete(approvalId);
});

ipcMain.on('pane:go', (_e, { id, url }) => {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  views[id]?.webContents.loadURL(url);
});

ipcMain.on('task:run', (_e, { ids, task }) => {
  for (const id of ids) {
    if (running[id]) continue;
    send('pane:status', { id, status: 'working' });
    running[id] = runAgent(id, `http://127.0.0.1:${PORT}/mcp/${id}`, task, {
      onOut: text => send('pane:out', { id, text }),
      onExit: code => {
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

ipcMain.on('task:stop', (_e, { id }) => stop(running[id]));

ipcMain.handle('config', () => ({
  port: PORT,
  panes: PANE_IDS.map(id => ({ id, label: AGENTS[id].label }))
}));

app.whenReady().then(() => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(980, height),
    title: 'Agent Workbench',
    autoHideMenuBar: true,
    backgroundColor: '#f4f2ec',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') }
  });
  win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  createPanes();
});

app.on('window-all-closed', () => {
  Object.values(running).forEach(stop);
  app.quit();
});
