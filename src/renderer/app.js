const $ = (s, el = document) => el.querySelector(s);
const panesEl = $('#panes');
const els = {};
const labels = {};

// One record per agent for the current task; the compare board is drawn from these.
let task = '';
const runs = {};

function line(id, text, cls) {
  const log = $('.log', els[id]);
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  log.appendChild(span);
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function setStatus(id, status, label) {
  els[id].dataset.status = status;
  $('.state', els[id]).textContent = label || status;
}

// The browsers are native views drawn over the window; tell main where each slot is.
function sendLayout() {
  const rects = {};
  for (const [id, el] of Object.entries(els)) {
    const r = $('.slot', el).getBoundingClientRect();
    rects[id] = { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  window.wb.layout(rects);
}

function selected() {
  return [...document.querySelectorAll('#who input:checked')].map(i => i.value);
}

function runTask() {
  const text = $('#task').value.trim();
  const ids = selected();
  if (!text || !ids.length) return;
  task = text;
  for (const k of Object.keys(runs)) delete runs[k];
  for (const id of ids) {
    runs[id] = { status: 'working', start: Date.now(), end: 0, tools: 0, visited: [], answer: '' };
    $('.log', els[id]).textContent = '';
    line(id, `task: ${text}\n\n`, 'sys');
  }
  updateCompareButton();
  window.wb.run(ids, text);
}

/* ---------- full-window views (board, agents) ---------- */

// Only one of these is open at a time; while one is, the native browser views are hidden.
let overlay = null;

function openOverlay(id) {
  if (overlay) $(overlay).hidden = true;
  overlay = id;
  $(id).hidden = false;
  panesEl.hidden = true;
  window.wb.showPanes(false);
}

function closeOverlay() {
  if (!overlay) return;
  $(overlay).hidden = true;
  overlay = null;
  panesEl.hidden = false;
  window.wb.showPanes(true);
  requestAnimationFrame(sendLayout);
}

/* ---------- compare board ---------- */

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const URL_RE = /https?:\/\/[^\s<>()\[\]"'`]+/g;
const cleanUrl = u => u.replace(/[.,;:!?*]+$/, '');
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const secs = r => ((r.end || Date.now()) - r.start) / 1000;

// Agents answer in Markdown; the table shows it as plain text without the markers.
const plain = s => s.trim()
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)');

function sources(r) {
  const cited = [...new Set((r.answer.match(URL_RE) || []).map(cleanUrl))];
  const visited = r.visited.filter(u => !cited.includes(u) && !/^about:|google\.com\/?$/.test(u));
  return { cited, visited };
}

function updateCompareButton() {
  const ids = Object.keys(runs);
  const done = ids.filter(id => runs[id].status !== 'working').length;
  const btn = $('#compare'), badge = $('.badge', btn);
  btn.disabled = !ids.length;
  badge.hidden = !ids.length;
  badge.textContent = `${done}/${ids.length}`;
  btn.classList.toggle('ready', ids.length > 0 && done === ids.length);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderBoard() {
  $('#boardTask').textContent = task;
  const ids = Object.keys(runs);

  // Sites that more than one agent cited are the quickest signal of agreement.
  const byHost = {};
  for (const id of ids) for (const u of sources(runs[id]).cited) {
    const h = host(u); if (!h) continue;
    (byHost[h] = byHost[h] || new Set()).add(id);
  }
  const shared = Object.entries(byHost).filter(([, s]) => s.size > 1);
  const sharedEl = $('#shared');
  sharedEl.textContent = '';
  if (shared.length) {
    sharedEl.append('Cited by more than one agent: ');
    shared.forEach(([h, s], i) => {
      if (i) sharedEl.append(', ');
      sharedEl.append(el('b', null, h), ` (${[...s].map(id => labels[id]).join(', ')})`);
    });
  }

  const table = $('#cols');
  table.textContent = '';
  const head = el('tr');
  head.appendChild(el('th'));
  for (const id of ids) {
    const th = el('th');
    const name = el('span', 'col-name', labels[id]);
    name.style.setProperty('--c', els[id].style.getPropertyValue('--c'));
    th.appendChild(name);
    head.appendChild(th);
  }
  table.appendChild(el('thead')).appendChild(head);
  const body = table.appendChild(el('tbody'));

  const row = (label, cell) => {
    const tr = el('tr');
    tr.appendChild(el('th', null, label));
    for (const id of ids) { const td = el('td'); cell(td, runs[id], id); tr.appendChild(td); }
    body.appendChild(tr);
  };
  const linkList = (td, urls, cls, id) => {
    if (!urls.length) { td.appendChild(el('span', 'none', '-')); return; }
    for (const u of urls) {
      const a = el('a', `src ${cls}`, u);
      a.href = '#';
      a.title = `Open in ${labels[id]}'s pane`;
      a.onclick = e => { e.preventDefault(); closeOverlay(); window.wb.go(id, u); };
      td.appendChild(a);
    }
  };

  row('Status', (td, r) => { td.textContent = r.status; td.className = `st-${r.status}`; });
  row('Time', (td, r) => { td.textContent = `${secs(r).toFixed(0)} s`; td.className = 'num'; });
  row('Tool calls', (td, r) => { td.textContent = r.tools; td.className = 'num'; });
  row('Pages opened', (td, r) => { td.textContent = r.visited.length; td.className = 'num'; });
  row('Answer', (td, r) => td.appendChild(el('div', 'answer',
    plain(r.answer) || (r.status === 'working' ? 'Still working.' : 'Nothing on stdout.'))));
  row('Cited', (td, r, id) => linkList(td, sources(r).cited, 'cited', id));
  row('Opened, not cited', (td, r, id) => linkList(td, sources(r).visited, 'visited', id));
}

function boardMarkdown() {
  const ids = Object.keys(runs);
  const rows = [
    `**Task:** ${task}`, '',
    `| | ${ids.map(id => labels[id]).join(' | ')} |`,
    `|---|${ids.map(() => '---').join('|')}|`,
    `| Status | ${ids.map(id => runs[id].status).join(' | ')} |`,
    `| Time | ${ids.map(id => `${secs(runs[id]).toFixed(0)}s`).join(' | ')} |`,
    `| Tool calls | ${ids.map(id => runs[id].tools).join(' | ')} |`,
    `| Sources | ${ids.map(id => sources(runs[id]).cited.join('<br>') || '-').join(' | ')} |`
  ];
  for (const id of ids) rows.push('', `### ${labels[id]}`, '', runs[id].answer.trim() || '_no answer_');
  return rows.join('\n');
}

function openBoard() {
  if (!Object.keys(runs).length) return;
  renderBoard();
  openOverlay('#board');
}

/* ---------- agents editor ---------- */

let draft = [];

function agentRow(a, i) {
  const tr = el('tr');
  const on = el('input'); on.type = 'checkbox'; on.checked = a.enabled !== false;
  on.onchange = () => { draft[i].enabled = on.checked; };
  const color = el('input'); color.type = 'color'; color.value = a.color || '#666666';
  color.oninput = () => { draft[i].color = color.value; };
  const name = el('input', 'txt'); name.value = a.label || ''; name.placeholder = 'Gemini CLI';
  name.oninput = () => { draft[i].label = name.value; };
  const cmd = el('input', 'txt mono'); cmd.value = a.command || ''; cmd.placeholder = 'mycli -p {prompt}';
  cmd.spellcheck = false;
  cmd.oninput = () => { draft[i].command = cmd.value; };
  const del = el('button', null, 'Remove');
  del.onclick = () => { draft.splice(i, 1); renderAgents(); };
  for (const [node, cls] of [[on, 'c-on'], [color, 'c-color'], [name, 'c-name'], [cmd, ''], [del, 'c-del']]) {
    const td = el('td', cls); td.appendChild(node); tr.appendChild(td);
  }
  return tr;
}

function renderAgents() {
  const tbody = $('#agentRows');
  tbody.textContent = '';
  draft.forEach((a, i) => tbody.appendChild(agentRow(a, i)));
}

async function openAgents() {
  const { path, agents } = await window.wb.agents();
  draft = agents.map(a => ({ ...a }));
  $('#agentsPath').textContent = `Saved in ${path}`;
  renderAgents();
  openOverlay('#agentsView');
}

/* ---------- task bar position ---------- */

const DOCK_KEY = 'workbench.dock';
function setDock(where) {
  document.body.classList.toggle('dock-bottom', where === 'bottom');
  $('#dock').textContent = where === 'bottom' ? 'Bar at top' : 'Bar at bottom';
  try { localStorage.setItem(DOCK_KEY, where); } catch {}
  requestAnimationFrame(sendLayout);
}

/* ---------- start ---------- */

async function init() {
  const cfg = await window.wb.config();
  const tpl = $('#paneTpl');
  panesEl.style.gridTemplateColumns = `repeat(${cfg.panes.length}, minmax(0, 1fr))`;
  for (const p of cfg.panes) {
    labels[p.id] = p.label;
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.style.setProperty('--c', p.color || '#666666');
    $('.name', node).textContent = p.label;
    $('.stop', node).onclick = () => window.wb.stop(p.id);
    $('.addr', node).onsubmit = e => { e.preventDefault(); window.wb.go(p.id, $('.url', node).value.trim()); };
    panesEl.appendChild(node);
    els[p.id] = node;

    const who = document.createElement('label');
    const box = el('input'); box.type = 'checkbox'; box.value = p.id; box.checked = true;
    who.append(box, ` ${p.label}`);
    $('#who').appendChild(who);
  }

  const refresh = () => {
    updateCompareButton();
    if (overlay === '#board') renderBoard();
    else if (cfg.autoCompare && Object.values(runs).every(r => r.status !== 'working')) setTimeout(openBoard, 2000);
  };

  window.wb.on('pane:url', ({ id, url }) => {
    $('.url', els[id]).value = url;
    const r = runs[id];
    if (r && r.status === 'working' && url && !r.visited.includes(url)) r.visited.push(url);
  });
  window.wb.on('pane:status', ({ id, status, code }) => {
    setStatus(id, status, status === 'error' ? `exited (${code})` : status);
    if (status === 'working') return;
    const r = runs[id];
    if (r) { r.status = status; r.end = Date.now(); }
    line(id, `\n[${status === 'done' ? 'finished' : 'stopped'}${r ? ` after ${secs(r).toFixed(0)}s` : ''}]\n`, 'sys');
    refresh();
  });
  window.wb.on('pane:out', ({ id, text, stream }) => {
    line(id, text, stream === 'err' ? 'err' : '');
    if (runs[id] && stream === 'out') runs[id].answer += text.replace(ANSI, '');
  });
  window.wb.on('pane:tool', ({ id, name, args }) => {
    const a = Object.keys(args || {}).length ? ' ' + JSON.stringify(args) : '';
    line(id, `> ${name}${a}\n`, 'tool');
    if (runs[id]) runs[id].tools++;
  });
  window.wb.on('pane:approval', ({ id, approvalId, question }) => {
    const prev = els[id].dataset.status;
    setStatus(id, 'waiting', 'needs your approval');
    const card = document.createElement('div');
    card.className = 'approval';
    card.innerHTML = `<div class="q"></div><div class="btns"><button class="yes">Allow</button><button class="no">Block</button></div>`;
    $('.q', card).textContent = question;
    const answer = ok => {
      window.wb.answer(approvalId, ok);
      card.remove();
      setStatus(id, prev || 'working');
      line(id, `${ok ? 'allowed' : 'blocked'}: ${question}\n`, 'sys');
      requestAnimationFrame(sendLayout);
    };
    $('.yes', card).onclick = () => answer(true);
    $('.no', card).onclick = () => answer(false);
    $('.approvals', els[id]).appendChild(card);
    // An approval needs the pane in view.
    closeOverlay();
    requestAnimationFrame(sendLayout);
  });

  $('#runAll').onclick = runTask;
  $('#compare').onclick = openBoard;
  $('#closeBoard').onclick = closeOverlay;
  $('#copyMd').onclick = async () => {
    await navigator.clipboard.writeText(boardMarkdown());
    $('#copyMd').textContent = 'Copied';
    setTimeout(() => { $('#copyMd').textContent = 'Copy as Markdown'; }, 1500);
  };
  $('#openAgents').onclick = openAgents;
  $('#cancelAgents').onclick = closeOverlay;
  $('#openFile').onclick = () => window.wb.openAgentsFile();
  $('#addAgent').onclick = () => { draft.push({ label: '', color: '#666666', enabled: true, command: '' }); renderAgents(); };
  $('#saveAgents').onclick = () => {
    const list = draft.filter(a => a.label.trim() && a.command.trim());
    if (!list.some(a => a.enabled !== false)) { $('#saveAgents').textContent = 'Turn on at least one'; return; }
    $('#saveAgents').textContent = 'Restarting';
    window.wb.saveAgents(list);
  };
  $('#dock').onclick = () => setDock(document.body.classList.contains('dock-bottom') ? 'top' : 'bottom');
  let dock = 'top';
  try { dock = localStorage.getItem(DOCK_KEY) || 'top'; } catch {}
  setDock(dock);

  $('#task').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); runTask(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(); });
  setInterval(() => { if (overlay === '#board' && Object.values(runs).some(r => r.status === 'working')) renderBoard(); }, 1000);
  new ResizeObserver(sendLayout).observe(panesEl);
  window.addEventListener('resize', sendLayout);
  sendLayout();

  if (cfg.startTask) {
    $('#task').value = cfg.startTask;
    // Give the panes a moment to load their start page before the agents arrive.
    setTimeout(runTask, 2500);
  }
}

init();
