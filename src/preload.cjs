const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wb', {
  config: () => ipcRenderer.invoke('config'),
  layout: rects => ipcRenderer.send('layout', rects),
  run: (ids, task) => ipcRenderer.send('task:run', { ids, task }),
  stop: id => ipcRenderer.send('task:stop', { id }),
  showPanes: visible => ipcRenderer.send('panes:visible', visible),
  agents: () => ipcRenderer.invoke('agents:get'),
  saveAgents: list => ipcRenderer.send('agents:save', list),
  openAgentsFile: () => ipcRenderer.send('agents:open'),
  go: (id, url) => ipcRenderer.send('pane:go', { id, url }),
  answer: (approvalId, ok) => ipcRenderer.send('approval:answer', { approvalId, ok }),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, payload) => fn(payload))
});
