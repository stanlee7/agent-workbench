import { $, el } from './dom.js';
import { t } from './i18n.js';

export function createSetupUI({ selected, openOverlay, port }) {
  let checkingSetup = false, pending;
  function refreshSetup() {
    if (!pending) pending = check().finally(() => { pending = null; });
    return pending;
  }
  async function check() {
    checkingSetup = true;
    $('#runAll').disabled = $('#checkSetup').disabled = true;
    $('#setupProgress').textContent = t('Checking PATH and CLI versions…');
    try {
      const rows = await window.wb.checkSetup();
      const body = $('#setupRows'); body.replaceChildren();
      for (const row of rows) {
        const box = [...document.querySelectorAll('#who input')].find(b => b.value === row.id);
        if (box) {
          const wasDisabled = box.disabled;
          box.disabled = !row.ready;
          if (!row.ready) box.checked = false;
          else if (wasDisabled) box.checked = true;
        }
        const tr = el('tr');
        tr.append(el('td', null, row.label), el('td', null, row.found ? t('Found') : t('Missing')));
        tr.append(el('td', null, row.version || (row.issue === 'timeout' ? t('Timed out (5 s)') : row.issue ? t('Version check failed') : '—')));
        const help = el('td');
        if (!row.found && row.install) help.appendChild(el('code', null, row.install));
        if (!row.found && row.docs) {
          help.append(t('install command unverified '));
          const docs = el('button', null, t('Official docs')); docs.onclick = () => window.wb.setupDocs(); help.appendChild(docs);
        }
        if (!row.found && !row.install && !row.docs) help.append(t('Install this CLI and add it to PATH.'));
        if (row.mcp) help.append(row.mcp === 'registered' ? t('wb MCP registered') : row.mcp === 'unchecked' ? t('MCP check skipped (mcp list unavailable)') : t('wb MCP is not registered. '));
        if (row.mcp === 'missing') {
          help.appendChild(el('code', null, `agy mcp add wb http://127.0.0.1:${port}/mcp/agy`));
          const add = el('button', null, t('Register wb'));
          add.onclick = async () => {
            add.disabled = true;
            try {
              const ok = await window.wb.registerAgy(row.id);
              await refreshSetup();
              if (!ok) $('#setupProgress').textContent = t('Registration failed. Run the displayed command in a terminal.');
            } finally { add.disabled = false; }
          };
          help.append(' ', add);
        }
        tr.appendChild(help); body.appendChild(tr);
      }
      $('#setupProgress').textContent = rows.some(a => a.ready) ? t('Ready. Choose an agent and a task.') : t('No agents are ready. Install a CLI, then check again.');
      return rows;
    } catch {
      $('#setupProgress').textContent = t('Setup check failed. Please try again.');
      return [];
    } finally {
      checkingSetup = false;
      $('#runAll').disabled = !selected().length;
      $('#checkSetup').disabled = false;
    }
  }

  async function openSetup() { openOverlay('#setupView'); await refreshSetup(); }

  return { refresh: refreshSetup, open: openSetup, get busy() { return checkingSetup; } };
}
