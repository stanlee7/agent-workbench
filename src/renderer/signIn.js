import { $, el } from './dom.js';
import { t } from './i18n.js';

export function createSignInUI({ els, labels, setStatus, renderProfiles, renderStatus, sendLayout, closeOverlay, setFold, setLayout, panesEl, line }) {
  const signInStates = new Map();
  window.wb.on('pane:signin', ({ id, requestId, reason, clean }) => {
    const box = $('.signin', els[id]);
    signInStates.set(id, { requestId, reason, previous: els[id].dataset.status || 'idle' });
    box.replaceChildren(el('strong', null, t('{agent} needs you to sign in here: {reason}', { agent: labels[id], reason })));
    box.hidden = false;
    setStatus(id, 'signin', t('waiting for sign-in'));
    const profile = $('.profile, .newprof', els[id]);
    if (profile) profile.disabled = true;
    $('.clear', els[id]).disabled = true;
    const buttons = el('div', 'btns');
    const done = el('button', 'primary', t('Done, continue'));
    const skip = el('button', null, t('Skip'));
    const answer = async result => {
      done.disabled = skip.disabled = true;
      try { await window.wb.signInAnswer(id, requestId, result); }
      catch { line(id, t('Could not send the sign-in response. Please try again.') + '\n', 'sys'); }
      finally { done.disabled = skip.disabled = false; }
    };
    done.onclick = () => answer('signed in');
    skip.onclick = () => answer('skipped');
    if (clean) {
      const label = el('label');
      const check = el('input'); check.type = 'checkbox';
      label.append(check, t(' Keep this sign-in (switch pane to My logins)'));
      check.onchange = async () => {
        if (!check.checked) return;
        check.disabled = done.disabled = skip.disabled = true;
        const ok = await window.wb.keepSignIn(id, requestId).catch(() => false);
        check.checked = ok; check.disabled = ok;
        if (!ok) box.appendChild(el('span', null, t('Could not switch profiles. Try again or continue without saving.')));
        done.disabled = skip.disabled = false;
        renderProfiles(await window.wb.profiles());
      };
      box.appendChild(label);
    }
    buttons.append(done, skip); box.appendChild(buttons);
    closeOverlay();
    setFold(id, 'both');
    if (panesEl.classList.contains('focus') || panesEl.classList.contains('grid')) setLayout('focus', id);
    renderStatus();
    window.wb.notify(t('{agent} needs sign-in', { agent: labels[id] }), reason);
    requestAnimationFrame(sendLayout);
  });
  window.wb.on('pane:signin-end', ({ id, requestId, result }) => {
    const state = signInStates.get(id);
    if (state?.requestId !== requestId) return;
    signInStates.delete(id);
    $('.signin', els[id]).hidden = true;
    $('.signin', els[id]).replaceChildren();
    const profile = $('.profile, .newprof', els[id]);
    if (profile) profile.disabled = false;
    $('.clear', els[id]).disabled = false;
    setStatus(id, state.previous);
    line(id, t('sign-in: {result}', { result: t(result) }) + '\n', 'sys');
    renderStatus();
    requestAnimationFrame(sendLayout);
  });
  return {
    translate() {
      for (const [id, state] of signInStates) {
        const box = $('.signin', els[id]);
        $('strong', box).textContent = t('{agent} needs you to sign in here: {reason}', { agent: labels[id], reason: state.reason });
        $('.primary', box).textContent = t('Done, continue');
        $('.btns button:last-child', box).textContent = t('Skip');
        const label = $('label', box);
        if (label) label.lastChild.textContent = t(' Keep this sign-in (switch pane to My logins)');
      }
    }
  };
}
