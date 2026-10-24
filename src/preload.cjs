const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wb', {
  config: () => ipcRenderer.invoke('config'),
  layout: rects => ipcRenderer.send('layout', rects),
  run: (ids, task, followUp, previous) => ipcRenderer.send('task:run', { ids, task, followUp, previous }),
  saveRun: run => ipcRenderer.send('run:save', run),
  listRuns: () => ipcRenderer.invoke('runs:list'),
  loadRun: id => ipcRenderer.invoke('runs:load', id),
  openRunsFolder: () => ipcRenderer.send('runs:open'),
  exportRun: (name, markdown) => ipcRenderer.invoke('run:export', { name, markdown }),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  stop: id => ipcRenderer.send('task:stop', { id }),
  showPanes: visible => ipcRenderer.send('panes:visible', visible),
  agents: () => ipcRenderer.invoke('agents:get'),
  saveAgents: list => ipcRenderer.send('agents:save', list),
  openAgentsFile: () => ipcRenderer.send('agents:open'),
  profiles: () => ipcRenderer.invoke('profiles:get'),
  setProfile: (id, profileId) => ipcRenderer.invoke('profile:set', { id, profileId }),
  addProfile: label => ipcRenderer.invoke('profile:add', label),
  clearProfile: id => ipcRenderer.invoke('profile:clear', id),
  go: (id, url) => ipcRenderer.send('pane:go', { id, url }),
  answer: (approvalId, ok) => ipcRenderer.send('approval:answer', { approvalId, ok }),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, payload) => fn(payload))
});
