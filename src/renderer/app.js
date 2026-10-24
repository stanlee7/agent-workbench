const $ = (s, el = document) => el.querySelector(s);
const panesEl = $('#panes');
const els = {};

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
  const task = $('#task').value.trim();
  const ids = selected();
  if (!task || !ids.length) return;
  for (const id of ids) {
    $('.log', els[id]).textContent = '';
    line(id, `▶ ${task}\n\n`, 'sys');
  }
  window.wb.run(ids, task);
}

async function init() {
  const cfg = await window.wb.config();
  const tpl = $('#paneTpl');
  for (const p of cfg.panes) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.style.setProperty('--c', `var(--${p.id})`);
    $('.name', node).textContent = p.label;
    $('.stop', node).onclick = () => window.wb.stop(p.id);
    $('.addr', node).onsubmit = e => { e.preventDefault(); window.wb.go(p.id, $('.url', node).value.trim()); };
    panesEl.appendChild(node);
    els[p.id] = node;

    const who = document.createElement('label');
    who.innerHTML = `<input type="checkbox" value="${p.id}" checked> ${p.label}`;
    $('#who').appendChild(who);
  }

  window.wb.on('pane:url', ({ id, url }) => { $('.url', els[id]).value = url; });
  window.wb.on('pane:status', ({ id, status, code }) => {
    setStatus(id, status, status === 'error' ? `exited (${code})` : status);
    line(id, `\n— ${status === 'done' ? 'finished' : 'stopped'} —\n`, 'sys');
  });
  window.wb.on('pane:out', ({ id, text }) => line(id, text));
  window.wb.on('pane:tool', ({ id, name, args }) => {
    const a = Object.keys(args || {}).length ? ' ' + JSON.stringify(args) : '';
    line(id, `🔧 ${name}${a}\n`, 'tool');
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
      line(id, `${ok ? '✅ allowed' : '⛔ blocked'}: ${question}\n`, 'sys');
      requestAnimationFrame(sendLayout);
    };
    $('.yes', card).onclick = () => answer(true);
    $('.no', card).onclick = () => answer(false);
    $('.approvals', els[id]).appendChild(card);
    requestAnimationFrame(sendLayout);
  });

  $('#runAll').onclick = runTask;
  $('#task').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); runTask(); }
  });
  new ResizeObserver(sendLayout).observe(panesEl);
  window.addEventListener('resize', sendLayout);
  sendLayout();
}

init();
