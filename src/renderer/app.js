const $ = (s, el = document) => el.querySelector(s);
const panesEl = $('#panes');
const els = {};
const labels = {};
const colors = {};

// The current run: one record per agent, each with a list of turns (first question + follow-ups).
// The compare board, the status bar and the saved history are all drawn from this.
let run = null;          // { id, task, started, agents: { id: { turns: [...] } } }
let viewing = null;      // a run loaded from history, shown read-only on the board
const runs = {};         // id -> live record for the current turn (status, timing, tools, visited, answer)

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

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

const selected = () => [...document.querySelectorAll('#who input:checked')].map(i => i.value);
const runId = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const secs = r => ((r.end || Date.now()) - r.start) / 1000;
const working = () => Object.values(runs).some(r => r.status === 'working');

/* ---------- running tasks ---------- */

function startTurn(ids, text, followUp) {
  const previous = {};
  if (!followUp || !run) {
    run = { id: runId(), task: text, started: Date.now(), agents: {} };
    for (const k of Object.keys(runs)) delete runs[k];
  }
  for (const id of ids) {
    const prior = run.agents[id]?.turns || [];
    if (followUp && prior.length) {
      const last = prior[prior.length - 1];
      previous[id] = `Q: ${last.q}\nA: ${last.answer}`;
    }
    runs[id] = { status: 'working', start: Date.now(), end: 0, tools: 0, visited: [], answer: '', q: text };
    run.agents[id] = run.agents[id] || { turns: [] };
    run.agents[id].turns.push(runs[id]);
    if (!followUp) $('.log', els[id]).textContent = '';
    line(id, `${followUp ? 'follow-up' : 'task'}: ${text}\n\n`, 'sys');
  }
  viewing = null;
  updateCompareButton();
  renderStatus();
  window.wb.run(ids, text, followUp, previous);
}

function runTask() {
  const text = $('#task').value.trim();
  const ids = selected();
  if (!text || !ids.length) return;
  const followUp = $('#followUp').checked && run && ids.every(id => run.agents[id]);
  startTurn(ids, text, followUp);
  $('#task').value = '';
  $('#task').placeholder = 'Follow-up question, or a new task';
}

function persist() {
  if (!run) return;
  window.wb.saveRun(run);
}

/* ---------- browser profiles ---------- */

const NEW_PROFILE = '__new';

function renderLogins(id, hosts) {
  const n = $('.logins', els[id]);
  n.textContent = hosts.length ? `cookies: ${hosts.join(', ')}` : 'no cookies';
  n.title = hosts.length ? 'Sites that set a session cookie in this pane, usually after a login. Clear wipes them.' : 'No site has set a session cookie in this pane yet.';
  n.classList.toggle('on', hosts.length > 0);
}

function renderProfiles(state) {
  for (const id of Object.keys(els)) {
    const sel = $('.profile', els[id]);
    sel.textContent = '';
    for (const p of state.profiles) { const o = el('option', null, p.label); o.value = p.id; sel.appendChild(o); }
    const add = el('option', null, 'New profile…'); add.value = NEW_PROFILE; sel.appendChild(add);
    sel.value = state.assigned[id] || 'clean';
    renderLogins(id, state.logins[id] || []);
  }
}

function askProfileName(id, sel) {
  // Inline name box in place of the select; Enter creates the profile and moves this pane onto it.
  const input = el('input', 'newprof');
  input.placeholder = 'Profile name, e.g. Work logins';
  sel.replaceWith(input);
  input.focus();
  const restore = async () => { const st = await window.wb.profiles(); input.replaceWith(sel); renderProfiles(st); };
  input.onkeydown = async e => {
    if (e.key === 'Escape') return restore();
    if (e.key !== 'Enter' || e.isComposing) return;
    const label = input.value.trim();
    if (!label) return restore();
    const r = await window.wb.addProfile(label);
    const st = await window.wb.setProfile(id, r.id);
    input.replaceWith(sel);
    renderProfiles(st);
  };
  input.onblur = () => { if (document.body.contains(input)) restore(); };
}

/* ---------- status bar ---------- */

let port = 0;
function renderStatus() {
  const bar = $('#status');
  bar.textContent = '';
  for (const id of Object.keys(els)) {
    const r = runs[id];
    const item = el('span', 'item');
    const sw = el('span', 'sw'); sw.style.setProperty('--c', colors[id]);
    item.appendChild(sw);
    item.append(labels[id]);
    const status = els[id].dataset.status || 'idle';
    if (r) item.appendChild(el('span', status, `${status === 'working' ? '✻ ' : status === 'done' ? '✓ ' : ''}${status} ${secs(r).toFixed(0)}s`));
    else item.appendChild(el('span', null, 'idle'));
    bar.appendChild(item);
  }
  bar.appendChild(el('span', 'spacer'));
  if (run) bar.appendChild(el('span', 'item', `run ${run.id}`));
  bar.appendChild(el('span', 'item', `MCP 127.0.0.1:${port}`));
}

/* ---------- full-window views (board, history, agents) ---------- */

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

/* ---------- answers: sources, plain text, consensus ---------- */

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const URL_RE = /https?:\/\/[^\s<>()\[\]"'`]+/g;
const cleanUrl = u => u.replace(/[.,;:!?*]+$/, '');
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Agents answer in Markdown; the table shows it as plain text without the markers.
const plain = s => (s || '').trim()
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)');

function sources(r) {
  const cited = [...new Set((r.answer.match(URL_RE) || []).map(cleanUrl))];
  const visited = (r.visited || []).filter(u => !cited.includes(u) && !/^about:|google\.com\/?$/.test(u));
  return { cited, visited };
}

// Facts worth comparing across answers: numbers with their unit, dates, and cited hosts.
// Rule based on purpose: no model call, so the agreement line is instant and free.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function facts(answer) {
  const t = plain(answer).replace(URL_RE, ' ');
  const out = new Map(); // key -> display
  const add = (key, display) => { if (!out.has(key)) out.set(key, display); };
  // dates: 2026-10-21, 2026.10.21, 2026년 10월 21일, October 21, 2026, 21 Oct 2026
  for (const m of t.matchAll(/(\d{4})[-./년]\s?(\d{1,2})[-./월]\s?(\d{1,2})일?/g)) add(`d:${m[1]}-${+m[2]}-${+m[3]}`, `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`);
  for (const m of t.matchAll(/\b([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) add(`d:${m[3]}-${mo}-${+m[2]}`, `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`); }
  for (const m of t.matchAll(/\b(\d{1,2})\s+([A-Z][a-z]{2})[a-z]*\.?\s+(\d{4})\b/g)) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) add(`d:${m[3]}-${mo}-${+m[1]}`, `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`); }
  // versions like v24.22.1 / 24.22.1
  for (const m of t.matchAll(/\bv?(\d+\.\d+(?:\.\d+)+)\b/g)) add(`v:${m[1]}`, `v${m[1]}`);
  // numbers with a unit or a following noun: 94 points, 1,402원, $12.5, 35%
  for (const m of t.matchAll(/(?:[$€£₩]\s?)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(%|원|만원|억|points?|pts|명|건|개|회|달러|USD|KRW|km|kg|GB|MB|시간|분)?/g)) {
    const raw = m[0].trim();
    const n = m[1].replace(/,/g, '');
    if (!m[2] && !/[$€£₩]/.test(raw)) continue;           // bare numbers are too noisy
    if (/^\d{4}$/.test(n) && !m[2]) continue;               // years are handled as dates
    add(`n:${n}${(m[2] || '').toLowerCase()}`, raw);
  }
  return out;
}

function consensus(ids) {
  const per = ids.map(id => ({ id, f: facts(latest(id)?.answer || '') }));
  const all = new Map();
  for (const { id, f } of per) for (const [k, d] of f) { const e = all.get(k) || { display: d, ids: [] }; e.ids.push(id); all.set(k, e); }
  const n = ids.length;
  const agreed = [], partial = [], lone = [];
  for (const [k, e] of all) {
    const item = { key: k, display: e.display, ids: e.ids };
    if (e.ids.length === n) agreed.push(item); else if (e.ids.length > 1) partial.push(item); else lone.push(item);
  }
  // A disagreement is the same kind of fact (a date, a version, points, 원 …) with different values
  // from different agents, and no value of that kind that everyone shares. Extra dates one agent
  // adds beside an agreed date are just extra detail.
  const kind = k => k.split(':')[0] + ':' + (k.startsWith('n:') ? k.replace(/^n:[\d.]+/, '') : '');
  const settled = new Set(agreed.map(it => kind(it.key)));
  const byKind = {};
  for (const it of [...partial, ...lone]) if (!settled.has(kind(it.key))) (byKind[kind(it.key)] = byKind[kind(it.key)] || []).push(it);
  const conflicts = Object.values(byKind).filter(list => list.length > 1 && new Set(list.flatMap(i => i.ids)).size > 1);
  return { agreed, partial, lone, conflicts };
}

const latest = id => { const t = (viewing || run)?.agents[id]?.turns; return t ? t[t.length - 1] : null; };
const boardIds = () => Object.keys((viewing || run)?.agents || {});

/* ---------- compare board ---------- */

function updateCompareButton() {
  const ids = Object.keys(runs);
  const done = ids.filter(id => runs[id].status !== 'working').length;
  const btn = $('#compare'), badge = $('.badge', btn);
  btn.disabled = !ids.length;
  badge.hidden = !ids.length;
  badge.textContent = `${done}/${ids.length}`;
  btn.classList.toggle('ready', ids.length > 0 && done === ids.length);
  $('#modeWrap').hidden = !run;
}

function renderConsensus(ids) {
  const box = $('#consensus');
  box.textContent = '';
  if (ids.length < 2) return;
  const c = consensus(ids);
  const n = ids.length;
  const row = (cls, title, items, fmt) => {
    if (!items.length) return;
    const r = el('div', `crow ${cls}`);
    r.appendChild(el('b', null, title));
    items.slice(0, 12).forEach((it, i) => { if (i) r.append(', '); r.appendChild(fmt(it)); });
    if (items.length > 12) r.append(` and ${items.length - 12} more`);
    box.appendChild(r);
  };
  row('ok', `Agreed by all ${n}:`, c.agreed, it => el('span', 'fact', it.display));
  row('warn', 'Differs:', c.conflicts, list => {
    const s = el('span', 'fact');
    list.forEach((it, i) => { if (i) s.append(' vs '); s.append(`${it.display} (${it.ids.map(id => labels[id] || id).join(', ')})`); });
    return s;
  });
  row('dim', 'Only one agent says:', c.lone.filter(it => !c.conflicts.flat().includes(it)), it => el('span', 'fact', `${it.display} (${labels[it.ids[0]] || it.ids[0]})`));
  if (!c.agreed.length && !c.conflicts.length) box.appendChild(el('div', 'crow dim', 'No comparable numbers or dates found in the answers.'));

  if (c.conflicts.length && !viewing) {
    const judge = el('div', 'crow judge');
    judge.append('Let one agent check the disagreement: ');
    const sel = el('select');
    for (const id of ids) { const o = el('option', null, labels[id]); o.value = id; sel.appendChild(o); }
    const btn = el('button', null, 'Ask to verify');
    btn.onclick = () => {
      const lines = c.conflicts.map(list => list.map(it => `${it.display} according to ${it.ids.map(id => labels[id]).join(', ')}`).join(' vs '));
      const cites = ids.map(id => `${labels[id]}: ${sources(latest(id)).cited.join(', ') || '(no URL)'}`).join('\n');
      const q = `The agents disagree on: ${lines.join('; ')}. Open the sources below in your browser pane, check which value is right as of now, and answer with the verified value and the URL that shows it.\n${cites}`;
      closeOverlay();
      startTurn([sel.value], q, true);
    };
    judge.append(sel, ' ', btn);
    box.appendChild(judge);
  }
}

function renderBoard() {
  const src = viewing || run;
  if (!src) return;
  const ids = boardIds();
  // The headline is the latest question; the first task stays in the kicker once there are follow-ups.
  const turnCount = Math.max(...ids.map(id => src.agents[id].turns.length));
  const lastQ = ids.map(id => latest(id)).sort((a, b) => b.start - a.start)[0]?.q || src.task;
  $('#boardKicker').textContent = `${viewing ? `History · ${viewing.id}` : 'Compare'}${turnCount > 1 ? ` · turn ${turnCount} · first task: ${src.task}` : ''}`;
  $('#boardTask').textContent = lastQ;
  $('#exportMd').disabled = false;
  renderConsensus(ids);

  // Sites that more than one agent cited are the quickest signal of agreement.
  const byHost = {};
  for (const id of ids) for (const u of sources(latest(id)).cited) {
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
      sharedEl.append(el('b', null, h), ` (${[...s].map(id => labels[id] || id).join(', ')})`);
    });
  }

  const table = $('#cols');
  table.textContent = '';
  const head = el('tr');
  head.appendChild(el('th'));
  for (const id of ids) {
    const th = el('th');
    const name = el('span', 'col-name', labels[id] || id);
    name.style.setProperty('--c', colors[id] || '#888');
    th.appendChild(name);
    head.appendChild(th);
  }
  table.appendChild(el('thead')).appendChild(head);
  const body = table.appendChild(el('tbody'));

  const row = (label, cell) => {
    const tr = el('tr');
    tr.appendChild(el('th', null, label));
    for (const id of ids) { const td = el('td'); cell(td, latest(id), id); tr.appendChild(td); }
    body.appendChild(tr);
  };
  const linkList = (td, urls, cls, id) => {
    if (!urls.length) { td.appendChild(el('span', 'none', '-')); return; }
    for (const u of urls) {
      const a = el('a', `src ${cls}`, u);
      a.href = '#';
      a.title = `Open in ${labels[id] || id}'s pane`;
      a.onclick = e => { e.preventDefault(); if (els[id]) { closeOverlay(); window.wb.go(id, u); } };
      td.appendChild(a);
    }
  };

  row('Status', (td, r) => { td.textContent = r.status; td.className = `st-${r.status}`; });
  row('Time', (td, r) => { td.textContent = `${secs(r).toFixed(0)} s`; td.className = 'num'; });
  row('Tool calls', (td, r) => { td.textContent = r.tools; td.className = 'num'; });
  row('Pages opened', (td, r) => { td.textContent = (r.visited || []).length; td.className = 'num'; });
  row('Answer', (td, r) => td.appendChild(el('div', 'answer', plain(r.answer) || (r.status === 'working' ? 'Still working.' : 'Nothing on stdout.'))));
  row('Cited', (td, r, id) => linkList(td, sources(r).cited, 'cited', id));
  row('Opened, not cited', (td, r, id) => linkList(td, sources(r).visited, 'visited', id));
  if (!viewing) {
    row('Ask this agent', (td, r, id) => {
      const form = el('form', 'ask');
      const input = el('input'); input.placeholder = `Follow-up for ${labels[id]} only`;
      const btn = el('button', null, 'Send');
      form.append(input, btn);
      form.onsubmit = e => { e.preventDefault(); const q = input.value.trim(); if (!q || runs[id]?.status === 'working') return; closeOverlay(); startTurn([id], q, true); };
      td.appendChild(form);
    });
  }

  // Earlier turns of this run, oldest first, so the follow-up chain reads top to bottom.
  const turnsEl = $('#turns');
  turnsEl.textContent = '';
  const maxTurns = Math.max(...ids.map(id => src.agents[id].turns.length));
  if (maxTurns > 1) {
    turnsEl.appendChild(el('div', 'kicker', 'Earlier turns'));
    for (let i = 0; i < maxTurns - 1; i++) {
      for (const id of ids) {
        const t = src.agents[id].turns[i];
        if (!t) continue;
        const d = el('details', 'turn');
        const sm = el('summary');
        sm.append(el('b', null, labels[id] || id), ` · turn ${i + 1} · `, el('span', 'q', t.q));
        d.append(sm, el('div', 'answer', plain(t.answer)));
        turnsEl.appendChild(d);
      }
    }
  }
}

function boardMarkdown() {
  const src = viewing || run;
  const ids = boardIds();
  const c = consensus(ids);
  const rows = [
    `# ${src.task}`, '',
    `- Run: ${src.id} · ${new Date(src.started).toLocaleString()}`,
    `- Agents: ${ids.map(id => labels[id] || id).join(', ')}`, ''
  ];
  if (ids.length > 1) {
    rows.push('## Agreement', '');
    if (c.agreed.length) rows.push(`- Agreed by all ${ids.length}: ${c.agreed.map(i => i.display).join(', ')}`);
    for (const list of c.conflicts) rows.push(`- Differs: ${list.map(it => `${it.display} (${it.ids.map(id => labels[id] || id).join(', ')})`).join(' vs ')}`);
    if (!c.agreed.length && !c.conflicts.length) rows.push('- No comparable numbers or dates found.');
    rows.push('');
  }
  rows.push(
    `| | ${ids.map(id => labels[id] || id).join(' | ')} |`,
    `|---|${ids.map(() => '---').join('|')}|`,
    `| Status | ${ids.map(id => latest(id).status).join(' | ')} |`,
    `| Time | ${ids.map(id => `${secs(latest(id)).toFixed(0)}s`).join(' | ')} |`,
    `| Tool calls | ${ids.map(id => latest(id).tools).join(' | ')} |`,
    `| Sources | ${ids.map(id => sources(latest(id)).cited.join('<br>') || '-').join(' | ')} |`
  );
  for (const id of ids) {
    rows.push('', `## ${labels[id] || id}`);
    src.agents[id].turns.forEach((t, i) => {
      if (src.agents[id].turns.length > 1) rows.push('', `### Turn ${i + 1}: ${t.q}`);
      rows.push('', (t.answer || '').trim() || '_no answer_');
    });
  }
  return rows.join('\n') + '\n';
}

function exportName() {
  const src = viewing || run;
  const date = new Date(src.started);
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const topic = src.task.replace(/https?:\/\/\S+/g, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().split(/\s+/).slice(0, 5).join(' ').slice(0, 40) || 'task';
  return `${ymd}_조사_${topic}_검토용.md`;
}

function openBoard() {
  if (!run && !viewing) return;
  renderBoard();
  openOverlay('#board');
}

/* ---------- history ---------- */

async function openHistory() {
  const list = await window.wb.listRuns();
  const tbody = $('#historyRows');
  tbody.textContent = '';
  $('#historyEmpty').hidden = list.length > 0;
  for (const r of list) {
    const tr = el('tr');
    tr.appendChild(el('td', 'c-when', new Date(r.started).toLocaleString()));
    tr.appendChild(el('td', null, r.task));
    tr.appendChild(el('td', 'c-agents', r.agents.map(id => labels[id] || id).join(', ')));
    tr.appendChild(el('td', 'c-turns num', String(r.turns)));
    const act = el('td', 'c-act');
    const open = el('button', null, 'Open');
    open.onclick = async () => { viewing = await window.wb.loadRun(r.id); if (viewing) { renderBoard(); openOverlay('#board'); } };
    const again = el('button', null, 'Run again');
    again.onclick = () => { closeOverlay(); $('#task').value = r.task; $('#followUp').checked = false; $('#task').focus(); };
    act.append(open, ' ', again);
    tr.appendChild(act);
    tbody.appendChild(tr);
  }
  openOverlay('#historyView');
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
  const cmds = el('div', 'cmds');
  const cmd = el('input', 'txt mono'); cmd.value = a.command || ''; cmd.placeholder = 'mycli -p {prompt}'; cmd.spellcheck = false;
  cmd.oninput = () => { draft[i].command = cmd.value; };
  const fu = el('input', 'txt mono dim'); fu.value = a.followUp || ''; fu.placeholder = 'follow-up command (optional), e.g. mycli --continue -p {prompt}'; fu.spellcheck = false;
  fu.oninput = () => { draft[i].followUp = fu.value; };
  cmds.append(cmd, fu);
  const del = el('button', null, 'Remove');
  del.onclick = () => { draft.splice(i, 1); renderAgents(); };
  for (const [node, cls] of [[on, 'c-on'], [color, 'c-color'], [name, 'c-name'], [cmds, ''], [del, 'c-del']]) {
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

/* ---------- layouts, fold, shortcuts ---------- */

const LAYOUT_KEY = 'workbench.layout';
let focusedPane = null;

function setLayout(mode, focusId) {
  const ids = Object.keys(els);
  if (mode === 'focus') focusedPane = focusId || focusedPane || ids[0];
  panesEl.classList.toggle('grid', mode === 'grid');
  panesEl.classList.toggle('focus', mode === 'focus');
  if (mode === 'grid') panesEl.style.gridTemplateColumns = `repeat(${Math.ceil(Math.sqrt(ids.length))}, minmax(0, 1fr))`;
  else if (mode === 'columns') panesEl.style.gridTemplateColumns = `repeat(${ids.length}, minmax(0, 1fr))`;
  for (const id of ids) {
    els[id].classList.toggle('focused', mode === 'focus' && id === focusedPane);
    els[id].style.setProperty('--rows', Math.max(1, ids.length - 1));
  }
  $('#layout').value = mode;
  try { localStorage.setItem(LAYOUT_KEY, mode); } catch {}
  requestAnimationFrame(sendLayout);
}

const FOLDS = ['both', 'browser', 'log'];
function setFold(id, fold) {
  els[id].classList.toggle('browser-only', fold === 'browser');
  els[id].classList.toggle('log-only', fold === 'log');
  $('.fold', els[id]).textContent = fold;
  els[id].dataset.fold = fold;
  requestAnimationFrame(sendLayout);
}

function shortcuts(e) {
  if (e.key === 'Escape') return closeOverlay();
  if (!(e.ctrlKey || e.metaKey)) return;
  const ids = Object.keys(els);
  if (e.key === 'Enter') { e.preventDefault(); runTask(); }
  else if (e.key === '0') { e.preventDefault(); closeOverlay(); setLayout('columns'); }
  else if (/^[1-9]$/.test(e.key) && ids[+e.key - 1]) { e.preventDefault(); closeOverlay(); setLayout('focus', ids[+e.key - 1]); }
  else if (e.key.toLowerCase() === 'k') { e.preventDefault(); closeOverlay(); $('#task').focus(); }
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
  port = cfg.port;
  const tpl = $('#paneTpl');
  // The layout mode sets the grid columns once the panes exist.
  for (const p of cfg.panes) {
    labels[p.id] = p.label;
    colors[p.id] = p.color || '#666666';
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.style.setProperty('--c', colors[p.id]);
    $('.name', node).textContent = p.label;
    $('.stop', node).onclick = () => window.wb.stop(p.id);
    $('.addr', node).onsubmit = e => { e.preventDefault(); window.wb.go(p.id, $('.url', node).value.trim()); };
    $('.profile', node).onchange = async e => {
      const sel = e.target;
      if (sel.value === NEW_PROFILE) return askProfileName(p.id, sel);
      renderProfiles(await window.wb.setProfile(p.id, sel.value));
    };
    $('.clear', node).onclick = async () => { renderProfiles(await window.wb.clearProfile(p.id)); };
    $('.fold', node).onclick = () => setFold(p.id, FOLDS[(FOLDS.indexOf(node.dataset.fold || 'both') + 1) % FOLDS.length]);
    // In focus layout, clicking a small pane's head brings it to the big slot.
    $('.head', node).onclick = e => { if (panesEl.classList.contains('focus') && !e.target.closest('button')) setLayout('focus', p.id); };
    panesEl.appendChild(node);
    els[p.id] = node;

    const who = document.createElement('label');
    const box = el('input'); box.type = 'checkbox'; box.value = p.id; box.checked = true;
    who.append(box, ` ${p.label}`);
    $('#who').appendChild(who);
  }

  const refresh = () => {
    updateCompareButton();
    renderStatus();
    if (overlay === '#board' && !viewing) renderBoard();
    if (!working()) {
      persist();
      if (run) window.wb.notify('Agent Workbench', `All agents finished: ${run.task.slice(0, 80)}`);
      if (cfg.autoCompare && overlay !== '#board') setTimeout(openBoard, 2000);
    }
  };

  renderProfiles(await window.wb.profiles());
  window.wb.on('pane:logins', ({ id, hosts }) => { if (els[id]) renderLogins(id, hosts); });
  window.wb.on('pane:url', ({ id, url }) => {
    $('.url', els[id]).value = url;
    const r = runs[id];
    if (r && r.status === 'working' && url && !r.visited.includes(url)) r.visited.push(url);
  });
  window.wb.on('pane:status', ({ id, status, code }) => {
    setStatus(id, status, status === 'error' ? `exited (${code})` : status);
    if (status === 'working') return renderStatus();
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
    line(id, `● ${name}${a}\n`, 'tool');
    if (runs[id]) runs[id].tools++;
  });
  window.wb.on('pane:approval', ({ id, approvalId, question }) => {
    const prev = els[id].dataset.status;
    setStatus(id, 'waiting', 'needs your approval');
    window.wb.notify(`${labels[id]} needs approval`, question);
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
  $('#compare').onclick = () => { viewing = null; openBoard(); };
  $('#closeBoard').onclick = closeOverlay;
  $('#copyMd').onclick = async () => {
    await navigator.clipboard.writeText(boardMarkdown());
    $('#copyMd').textContent = 'Copied';
    setTimeout(() => { $('#copyMd').textContent = 'Copy as Markdown'; }, 1500);
  };
  $('#exportMd').onclick = async () => {
    const file = await window.wb.exportRun(exportName(), boardMarkdown());
    if (file) { $('#exportMd').textContent = 'Saved'; setTimeout(() => { $('#exportMd').textContent = 'Export .md'; }, 2000); }
  };
  $('#openHistory').onclick = openHistory;
  $('#closeHistory').onclick = closeOverlay;
  $('#openRunsFolder').onclick = () => window.wb.openRunsFolder();
  $('#openAgents').onclick = openAgents;
  $('#cancelAgents').onclick = closeOverlay;
  $('#openFile').onclick = () => window.wb.openAgentsFile();
  $('#addAgent').onclick = () => { draft.push({ label: '', color: '#666666', enabled: true, command: '', followUp: '' }); renderAgents(); };
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
  document.addEventListener('keydown', shortcuts);
  $('#layout').onchange = e => setLayout(e.target.value);
  let layout = 'columns';
  try { layout = localStorage.getItem(LAYOUT_KEY) || 'columns'; } catch {}
  setLayout(layout);
  setInterval(() => {
    if (!working()) return;
    renderStatus();
    if (overlay === '#board' && !viewing) renderBoard();
  }, 1000);
  renderStatus();
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
