// Browser profiles for the panes. A profile is a cookie jar (an Electron session partition).
//   clean   a fresh jar every time the pane is created: nothing carried over, the default
//   named   a persistent jar such as "My logins", shared by every pane that picks it
// The settings file keeps the list of named profiles and which pane uses which.

export const CLEAN = 'clean';

export function profileList(settings) {
  if (!Array.isArray(settings.profiles) || !settings.profiles.length) settings.profiles = [{ id: 'me', label: 'My logins' }];
  return settings.profiles;
}

export const profileOf = (settings, paneId) => (settings.paneProfiles || {})[paneId] || CLEAN;

export function setProfile(settings, paneId, profileId) {
  settings.paneProfiles = settings.paneProfiles || {};
  if (profileId === CLEAN) delete settings.paneProfiles[paneId]; else settings.paneProfiles[paneId] = profileId;
}

export function addProfile(settings, label) {
  const list = profileList(settings);
  let id = String(label).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'profile';
  while (list.some(p => p.id === id) || id === CLEAN) id += '-2';
  list.push({ id, label: String(label).trim() });
  return id;
}

// A clean partition has no "persist:" prefix, so it lives only in memory; a new name per creation
// means switching back to clean in the same run also starts empty.
let cleanSeq = 0;
export const partitionFor = (paneId, profileId) =>
  profileId === CLEAN ? `clean-${paneId}-${++cleanSeq}` : `persist:profile-${profileId}`;

// Hosts this jar carries state for: an httpOnly cookie named like a session or auth token.
// Sites set some of these before any login (GitHub has _gh_sess for visitors), so the list means
// "this site will remember the pane", not strictly "signed in"; the agent is told the same.
const SESSION_NAME = /sess|sid|auth|token|login|logged|remember|jwt|account|_id$|^id$|uid|user/i;

export async function signedInHosts(session) {
  let cookies = [];
  try { cookies = await session.cookies.get({}); } catch { return []; }
  const hosts = new Set();
  for (const c of cookies) {
    if (!c.httpOnly || !SESSION_NAME.test(c.name) || /^(no|false|0)?$/i.test(c.value)) continue;
    const h = (c.domain || '').replace(/^\./, '').replace(/^www\./, '');
    if (h && !/^(google\.com|doubleclick\.net|youtube\.com)$/.test(h)) hosts.add(h);
  }
  // google.com sets httpOnly cookies even when signed out, so it only counts with its sign-in cookie.
  if (cookies.some(c => /google\.com$/.test(c.domain || '') && /^(SID|SSID|HSID)$/.test(c.name))) hosts.add('google.com');
  return [...hosts].sort();
}
