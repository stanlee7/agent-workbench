// A hand-off belongs to one pane; only the workbench renderer can answer it.
export function createSignIns({ ipcMain, send, isRenderer, isClean, keep, timeout = 10 * 60 * 1000 }) {
  const pending = new Map();
  let seq = 0;

  function finish(id, result) {
    const request = pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(id);
    send('pane:signin-end', { id, requestId: request.requestId, result });
    request.resolve(result);
  }

  ipcMain.handle('signin:answer', async (event, { id, requestId, result }) => {
    const request = pending.get(id);
    if (!isRenderer(event) || !request || request.requestId !== requestId || !['signed in', 'skipped'].includes(result)) return false;
    try { if (request.switching) await request.switching; } catch { return false; }
    if (pending.get(id) !== request) return false;
    finish(id, result);
    return true;
  });

  ipcMain.handle('signin:keep', async (event, { id, requestId }) => {
    const request = pending.get(id);
    if (!isRenderer(event) || !request || request.requestId !== requestId) return false;
    if (!request.switching) request.switching = Promise.resolve().then(() => keep(id));
    try { await request.switching; return true; }
    catch { request.switching = null; return false; }
  });

  return {
    waiting: id => pending.has(id),
    ask(id, reason) {
      if (pending.has(id)) return pending.get(id).promise;
      const requestId = ++seq;
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const timer = setTimeout(() => finish(id, 'timed out'), timeout);
      pending.set(id, { requestId, promise, resolve, timer });
      send('pane:signin', { id, requestId, reason, clean: isClean(id) });
      return promise;
    },
    cancel: id => finish(id, 'skipped'),
    close: () => { for (const id of pending.keys()) finish(id, 'skipped'); }
  };
}
