// Demo recorder: saves frames of the app itself, not the screen, so other windows never end up in a demo.
// Enabled with WORKBENCH_RECORD=<folder>. The browser panes are separate native views, so each frame is
// the window plus every visible pane, composited in a hidden window.
//   WORKBENCH_RECORD_FPS     frames per second (default 4)
//   WORKBENCH_RECORD_SECONDS stop after this many seconds (default 150)

import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function startRecorder(win, views, dir) {
  const fps = Number(process.env.WORKBENCH_RECORD_FPS || 4);
  const seconds = Number(process.env.WORKBENCH_RECORD_SECONDS || 150);
  fs.mkdirSync(dir, { recursive: true });

  const canvasWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  canvasWin.loadURL('data:text/html,<canvas id=c></canvas>');

  let n = 0, busy = false;
  const dbg = m => fs.appendFileSync(path.join(dir, 'recorder.log'), new Date().toISOString() + ' ' + m + '\n');
  dbg('start');
  const timer = setInterval(async () => {
    if (busy || win.isDestroyed() || win.isMinimized()) return;
    busy = true;
    try {
      const base = await win.webContents.capturePage();
      const { width } = base.getSize();
      if (!width) return; // the window has not painted yet
      const scale = width / win.getContentBounds().width;
      const parts = [];
      for (const v of Object.values(views)) {
        if (!v.getVisible()) continue;
        const b = v.getBounds();
        const img = await v.webContents.capturePage();
        parts.push({ x: b.x * scale, y: b.y * scale, w: b.width * scale, h: b.height * scale, src: img.toDataURL() });
      }
      const jpeg = await canvasWin.webContents.executeJavaScript(`(async () => {
        const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = s; });
        const base = await load(${JSON.stringify(base.toDataURL())});
        const c = document.getElementById('c'); c.width = base.width; c.height = base.height;
        const g = c.getContext('2d'); g.drawImage(base, 0, 0);
        for (const p of ${JSON.stringify(parts)}) { const i = await load(p.src); if (i) g.drawImage(i, p.x, p.y, p.w, p.h); }
        return c.toDataURL('image/jpeg', 0.9);
      })()`);
      fs.writeFileSync(path.join(dir, `frame_${String(++n).padStart(5, '0')}.jpg`), Buffer.from(jpeg.split(',')[1], 'base64'));
    } catch (e) {
      dbg('error ' + e.message);
    } finally {
      busy = false;
    }
  }, 1000 / fps);

  setTimeout(() => { clearInterval(timer); console.log(`[recorder] ${n} frames in ${dir}`); }, seconds * 1000);
}
