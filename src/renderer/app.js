import { t, setLanguage, translate, language } from './i18n.js';

import { $, el } from './dom.js';
import { createSetupUI } from './setup.js';
import { createSignInUI } from './signIn.js';

let setupUI;
const panesEl = $('#panes');
const els = {};
const labels = {};
const colors = {};

// The current run: one record per agent, each with a list of turns (first question + follow-ups).
// The compare board, the status bar and the saved history are all drawn from this.
let run = null;          // { id, task, started, agents: { id: { turns: [...] } } }
let viewing = null;      // a run loaded from history, shown read-only on the board
const runs = {};         // id -> live record for the current turn (status, timing, tools, visited, answer)


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
  $('.state', els[id]).textContent = label || t(status);
}

// The browsers are native views drawn over the window; tell main where each slot is.
function sendLayout() {
  const rects = {};
  for (const [id, el] of Object.entries(els)) {
    const r = $('.slot', el).getBoundingClientRect();
    const pane = el.getBoundingClientRect();
    rects[id] = { x: r.left, y: r.top, width: r.width, height: Math.max(0, Math.min(r.bottom, pane.bottom) - r.top) };
  }
  window.wb.layout(rects);
}

const selected = () => [...document.querySelectorAll('#who input:checked')].map(i => i.value);
const runId = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const secs = r => ((r.end || Date.now()) - r.start) / 1000;
const working = () => Object.values(runs).some(r => r.status === 'working');

/* ---------- running tasks ---------- */

async function startTurn(ids, text, followUp) {
  if (working() || setupUI.busy) return false;
  const setup = await setupUI.refresh();
  ids = ids.filter(id => setup.some(a => a.id === id && a.ready));
  if (!ids.length) { openOverlay('#setupView'); return false; }
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
    line(id, `${t(followUp ? 'follow-up' : 'task')}: ${text}\n\n`, 'sys');
  }
  viewing = null;
  updateCompareButton();
  renderStatus();
  window.wb.run(ids, text, followUp, previous);
  return true;
}

async function runTask() {
  const text = $('#task').value.trim();
  const ids = selected();
  if (!text || !ids.length) return;
  const followUp = $('#followUp').checked && run && ids.every(id => run.agents[id]);
  if (!await startTurn(ids, text, followUp)) return;
  $('#task').value = '';
  $('#task').placeholder = t('Follow-up question, or a new task');
}

function persist() {
  if (!run) return;
  window.wb.saveRun(run);
}

/* ---------- browser profiles ---------- */

const NEW_PROFILE = '__new';

function renderLogins(id, hosts) {
  const n = $('.logins', els[id]);
  n.textContent = hosts.length ? t('cookies: {hosts}', { hosts: hosts.join(', ') }) : t('no cookies');
  n.title = hosts.length ? t('Sites that set a session cookie in this pane, usually after a login. Clear wipes them.') : t('No site has set a session cookie in this pane yet.');
  n.classList.toggle('on', hosts.length > 0);
}

function renderProfiles(state) {
  for (const id of Object.keys(els)) {
    const sel = $('.profile', els[id]);
    if (!sel) continue;
    sel.disabled = els[id].dataset.status === 'signin';
    sel.textContent = '';
    for (const p of state.profiles) { const o = el('option', null, p.id === 'clean' || (p.id === 'me' && p.label === 'My logins') ? t(p.label) : p.label); o.value = p.id; sel.appendChild(o); }
    const add = el('option', null, t('New profile…')); add.value = NEW_PROFILE; sel.appendChild(add);
    sel.value = state.assigned[id] || 'clean';
    renderLogins(id, state.logins[id] || []);
  }
}

function askProfileName(id, sel) {
  // Inline name box in place of the select; Enter creates the profile and moves this pane onto it.
  const input = el('input', 'newprof');
  input.placeholder = t('Profile name, e.g. Work logins');
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
    if (r) item.appendChild(el('span', status, `${status === 'working' ? '✻ ' : status === 'done' ? '✓ ' : ''}${t(status)} ${secs(r).toFixed(0)}s`));
    else item.appendChild(el('span', status, t(status)));
    bar.appendChild(item);
  }
  bar.appendChild(el('span', 'spacer'));
  if (run) bar.appendChild(el('span', 'item', t('run {id}', { id: run.id })));
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
  if (overlay === '#setupView') window.wb.setupSeen();
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
    if (items.length > 12) r.append(t(' and {n} more', { n: items.length - 12 }));
    box.appendChild(r);
  };
  row('ok', t('Agreed by all {n}:', { n }), c.agreed, it => el('span', 'fact', it.display));
  row('warn', t('Differs:'), c.conflicts, list => {
    const s = el('span', 'fact');
    list.forEach((it, i) => { if (i) s.append(t(' vs ')); s.append(`${it.display} (${it.ids.map(id => labels[id] || id).join(', ')})`); });
    return s;
  });
  row('dim', t('Only one agent says:'), c.lone.filter(it => !c.conflicts.flat().includes(it)), it => el('span', 'fact', `${it.display} (${labels[it.ids[0]] || it.ids[0]})`));
  if (!c.agreed.length && !c.conflicts.length) box.appendChild(el('div', 'crow dim', t('No comparable numbers or dates found in the answers.')));

  if (c.conflicts.length && !viewing) {
    const judge = el('div', 'crow judge');
    judge.append(t('Let one agent check the disagreement: '));
    const sel = el('select');
    for (const id of ids) { const o = el('option', null, labels[id]); o.value = id; sel.appendChild(o); }
    const btn = el('button', null, t('Ask to verify'));
    btn.onclick = () => {
      const lines = c.conflicts.map(list => list.map(it => t('{value} according to {agents}', { value: it.display, agents: it.ids.map(id => labels[id]).join(', ') })).join(t(' vs ')));
      const cites = ids.map(id => `${labels[id]}: ${sources(latest(id)).cited.join(', ') || t('(no URL)')}`).join('\n');
      const q = t('The agents disagree on: {facts}. Open the sources below in your browser pane, check which value is right as of now, and answer with the verified value and the URL that shows it.\n{sources}', { facts: lines.join('; '), sources: cites });
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
  $('#boardKicker').textContent = `${viewing ? t('History · {id}', { id: viewing.id }) : t('Compare')}${turnCount > 1 ? t(' · turn {n} · first task: {task}', { n: turnCount, task: src.task }) : ''}`;
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
    sharedEl.append(t('Cited by more than one agent: '));
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
      a.title = t("Open in {agent}'s pane", { agent: labels[id] || id });
      a.onclick = e => { e.preventDefault(); if (els[id]) { closeOverlay(); window.wb.go(id, u); } };
      td.appendChild(a);
    }
  };

  row(t('Status'), (td, r) => { td.textContent = t(r.status); td.className = `st-${r.status}`; });
  row(t('Time'), (td, r) => { td.textContent = `${secs(r).toFixed(0)} s`; td.className = 'num'; });
  row(t('Tool calls'), (td, r) => { td.textContent = r.tools; td.className = 'num'; });
  row(t('Pages opened'), (td, r) => { td.textContent = (r.visited || []).length; td.className = 'num'; });
  row(t('Answer'), (td, r) => td.appendChild(el('div', 'answer', plain(r.answer) || (r.status === 'working' ? t('Still working.') : t('Nothing on stdout.')))));
  row(t('Cited'), (td, r, id) => linkList(td, sources(r).cited, 'cited', id));
  row(t('Opened, not cited'), (td, r, id) => linkList(td, sources(r).visited, 'visited', id));
  if (!viewing) {
    row(t('Ask this agent'), (td, r, id) => {
      const form = el('form', 'ask');
      const input = el('input'); input.placeholder = t('Follow-up for {agent} only', { agent: labels[id] });
      const btn = el('button', null, t('Send'));
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
    turnsEl.appendChild(el('div', 'kicker', t('Earlier turns')));
    for (let i = 0; i < maxTurns - 1; i++) {
      for (const id of ids) {
        const turn = src.agents[id].turns[i];
        if (!turn) continue;
        const d = el('details', 'turn');
        const sm = el('summary');
        sm.append(el('b', null, labels[id] || id), t(' · turn {n} · ', { n: i + 1 }), el('span', 'q', turn.q));
        d.append(sm, el('div', 'answer', plain(turn.answer)));
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
    `- ${t('Run:')} ${src.id} · ${new Date(src.started).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US')}`,
    `- ${t('Agents:')} ${ids.map(id => labels[id] || id).join(', ')}`, ''
  ];
  if (ids.length > 1) {
    rows.push(`## ${t('Agreement')}`, '');
    if (c.agreed.length) rows.push(`- ${t('Agreed by all {n}:', { n: ids.length })} ${c.agreed.map(i => i.display).join(', ')}`);
    for (const list of c.conflicts) rows.push(`- ${t('Differs:')} ${list.map(it => `${it.display} (${it.ids.map(id => labels[id] || id).join(', ')})`).join(t(' vs '))}`);
    if (!c.agreed.length && !c.conflicts.length) rows.push(`- ${t('No comparable numbers or dates found.')}`);
    rows.push('');
  }
  rows.push(
    `| | ${ids.map(id => labels[id] || id).join(' | ')} |`,
    `|---|${ids.map(() => '---').join('|')}|`,
    `| ${t('Status')} | ${ids.map(id => t(latest(id).status)).join(' | ')} |`,
    `| ${t('Time')} | ${ids.map(id => `${secs(latest(id)).toFixed(0)}s`).join(' | ')} |`,
    `| ${t('Tool calls')} | ${ids.map(id => latest(id).tools).join(' | ')} |`,
    `| ${t('Sources')} | ${ids.map(id => sources(latest(id)).cited.join('<br>') || '-').join(' | ')} |`
  );
  for (const id of ids) {
    rows.push('', `## ${labels[id] || id}`);
    src.agents[id].turns.forEach((turn, i) => {
      if (src.agents[id].turns.length > 1) rows.push('', `### ${t('Turn {n}: {q}', { n: i + 1, q: turn.q })}`);
      rows.push('', (turn.answer || '').trim() || `_${t('no answer')}_`);
    });
  }
  return rows.join('\n') + '\n';
}

function exportName() {
  const src = viewing || run;
  const date = new Date(src.started);
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const topic = src.task.replace(/https?:\/\/\S+/g, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().split(/\s+/).slice(0, 5).join(' ').slice(0, 40) || t('task');
  return t('{date}_research_{topic}_review.md', { date: ymd, topic });
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
    tr.appendChild(el('td', 'c-when', new Date(r.started).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US')));
    tr.appendChild(el('td', null, r.task));
    tr.appendChild(el('td', 'c-agents', r.agents.map(id => labels[id] || id).join(', ')));
    tr.appendChild(el('td', 'c-turns num', String(r.turns)));
    const act = el('td', 'c-act');
    const open = el('button', null, t('Open'));
    open.onclick = async () => { viewing = await window.wb.loadRun(r.id); if (viewing) { renderBoard(); openOverlay('#board'); } };
    const again = el('button', null, t('Run again'));
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
  const fu = el('input', 'txt mono dim'); fu.value = a.followUp || ''; fu.placeholder = t('follow-up command (optional), e.g. mycli --continue -p {prompt}'); fu.spellcheck = false;
  fu.oninput = () => { draft[i].followUp = fu.value; };
  cmds.append(cmd, fu);
  const del = el('button', null, t('Remove'));
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
  $('#agentsPath').textContent = t('Saved in {path}', { path });
  renderAgents();
  openOverlay('#agentsView');
}

/* ---------- setup ---------- */

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
  $('.fold', els[id]).textContent = t(fold);
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
  $('#dock').textContent = where === 'bottom' ? t('Bar at top') : t('Bar at bottom');
  try { localStorage.setItem(DOCK_KEY, where); } catch {}
  requestAnimationFrame(sendLayout);
}

/* ---------- start ---------- */

async function init() {
  const cfg = await window.wb.config();
  port = cfg.port;
  setupUI = createSetupUI({ selected, openOverlay, port });
  setLanguage(cfg.locale);
  document.documentElement.lang = language;
  translate();
  translate($('#paneTpl').content);
  $('#language').value = language;
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
      if (run) window.wb.notify('Agent Workbench', t('All agents finished: {task}', { task: run.task.slice(0, 80) }));
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
    setStatus(id, status, status === 'error' ? t('exited ({code})', { code }) : t(status));
    if (status === 'working') return renderStatus();
    const r = runs[id];
    if (r) { r.status = status; r.end = Date.now(); }
    line(id, `\n[${t(status === 'done' ? 'finished' : 'stopped')}${r ? t(' after {seconds}s', { seconds: secs(r).toFixed(0) }) : ''}]\n`, 'sys');
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
  const signInUI = createSignInUI({ els, labels, setStatus, renderProfiles, renderStatus, sendLayout, closeOverlay, setFold, setLayout, panesEl, line });
  window.wb.on('pane:approval', ({ id, approvalId, question }) => {
    const prev = els[id].dataset.status;
    setStatus(id, 'waiting', t('needs your approval'));
    window.wb.notify(t('{agent} needs approval', { agent: labels[id] }), question);
    const card = document.createElement('div');
    card.className = 'approval';
    card.innerHTML = `<div class="q"></div><div class="btns"><button class="yes">${t('Allow')}</button><button class="no">${t('Block')}</button></div>`;
    $('.q', card).textContent = question;
    const answer = ok => {
      window.wb.answer(approvalId, ok);
      card.remove();
      setStatus(id, prev || 'working');
      line(id, `${ok ? t('allowed') : t('blocked')}: ${question}\n`, 'sys');
      requestAnimationFrame(sendLayout);
    };
    $('.yes', card).onclick = () => answer(true);
    $('.no', card).onclick = () => answer(false);
    $('.approvals', els[id]).appendChild(card);
    // An approval needs the pane in view.
    closeOverlay();
    requestAnimationFrame(sendLayout);
  });

  for (const chip of document.querySelectorAll('#starters button')) chip.onclick = () => {
    closeOverlay();
    $('#task').value = t(chip.dataset.i18n);
    $('#followUp').checked = false;
    $('#task').focus();
  };
  $('#runAll').onclick = runTask;
  $('#compare').onclick = () => { viewing = null; openBoard(); };
  $('#closeBoard').onclick = closeOverlay;
  $('#copyMd').onclick = async () => {
    await navigator.clipboard.writeText(boardMarkdown());
    $('#copyMd').textContent = t('Copied');
    setTimeout(() => { $('#copyMd').textContent = t('Copy as Markdown'); }, 1500);
  };
  $('#exportMd').onclick = async () => {
    const file = await window.wb.exportRun(exportName(), boardMarkdown());
    if (file) { $('#exportMd').textContent = t('Saved'); setTimeout(() => { $('#exportMd').textContent = t('Export .md'); }, 2000); }
  };
  $('#openHistory').onclick = openHistory;
  $('#closeHistory').onclick = closeOverlay;
  $('#openRunsFolder').onclick = () => window.wb.openRunsFolder();
  $('#openAgents').onclick = openAgents;
  $('#openSetup').onclick = setupUI.open;
  $('#language').onchange = async event => {
    setLanguage(event.target.value);
    await window.wb.setLanguage(language);
    document.documentElement.lang = language;
    translate(); translate($('#paneTpl').content);
    $('#copyMd').textContent = t('Copy as Markdown');
    $('#exportMd').textContent = t('Export .md');
    $('#saveAgents').textContent = t('Save and restart');
    $('#task').placeholder = t(run ? 'Follow-up question, or a new task' : 'One task for every checked agent. Enter to run, Shift+Enter for a new line');
    for (const id of Object.keys(els)) {
      setStatus(id, els[id].dataset.status || 'idle');
      setFold(id, els[id].dataset.fold || 'both');
    }
    signInUI.translate();
    for (const card of document.querySelectorAll('.approval')) {
      $('.yes', card).textContent = t('Allow'); $('.no', card).textContent = t('Block');
    }
    setDock(document.body.classList.contains('dock-bottom') ? 'bottom' : 'top');
    renderProfiles(await window.wb.profiles());
    renderStatus();
    if (overlay === '#board') renderBoard();
    if (overlay === '#historyView') await openHistory();
    if (overlay === '#agentsView') renderAgents();
    if (overlay === '#setupView') await setupUI.refresh();
  };
  $('#checkSetup').onclick = setupUI.refresh;
  $('#closeSetup').onclick = closeOverlay;
  $('#who').onchange = () => { $('#runAll').disabled = setupUI.busy || !selected().length; };
  $('#cancelAgents').onclick = closeOverlay;
  $('#openFile').onclick = () => window.wb.openAgentsFile();
  $('#addAgent').onclick = () => { draft.push({ label: '', color: '#666666', enabled: true, command: '', followUp: '' }); renderAgents(); };
  $('#saveAgents').onclick = () => {
    const list = draft.filter(a => a.label.trim() && a.command.trim());
    if (!list.some(a => a.enabled !== false)) { $('#saveAgents').textContent = t('Turn on at least one'); return; }
    $('#saveAgents').textContent = t('Restarting');
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

  if (cfg.firstRun) openOverlay('#setupView');
  await setupUI.refresh();

  if (cfg.startTask) {
    $('#task').value = cfg.startTask;
    // Give the panes a moment to load their start page before the agents arrive.
    if (!cfg.firstRun) setTimeout(runTask, 2500);
  }
}

init();
