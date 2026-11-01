// Optional sync between devices through a private GitHub Gist.
// The token lives only in this browser (never in backups). With a passphrase the portfolio is
// encrypted (PBKDF2 → AES-GCM) before it leaves the browser, so GitHub only sees ciphertext.

const CFG_KEY = 'scrabfree_sync';
const FILE = 'portfolio.json';
const DESCRIPTION = 'scrabfree-portfolio-sync';
const API = 'https://api.github.com';

// ------------------------------------------------------------------ pure helpers (tested in Node)

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(state, passphrase) {
  if (!passphrase) return JSON.stringify({ v: 1, enc: 'none', state });
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(state)));
  return JSON.stringify({ v: 1, enc: 'aes-gcm', salt: b64(salt), iv: b64(iv), data: b64(data) });
}

export async function unseal(text, passphrase) {
  const p = JSON.parse(text);
  if (p.enc === 'none') return p.state;
  if (!passphrase) throw new Error('This sync file is encrypted — enter your passphrase.');
  try {
    const key = await deriveKey(passphrase, unb64(p.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, key, unb64(p.data));
    return JSON.parse(dec.decode(plain));
  } catch {
    throw new Error('Wrong passphrase (or the sync file is damaged).');
  }
}

/**
 * Merge two portfolio states. Transactions and portfolios are united by id, deletions recorded
 * in `deleted` (tombstones) win, and settings come from whichever side changed last.
 */
export function mergeStates(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const deleted = [...new Set([...(local.deleted || []), ...(remote.deleted || [])])].slice(-5000);
  const gone = new Set(deleted);
  const newer = (remote.updatedAt || '') > (local.updatedAt || '') ? remote : local;
  const older = newer === remote ? local : remote;
  const unite = (a = [], b = []) => {
    const m = new Map();
    for (const x of b) if (!gone.has(x.id)) m.set(x.id, x);
    for (const x of a) if (!gone.has(x.id)) m.set(x.id, x); // newer side wins on edits
    return [...m.values()];
  };
  return {
    ...older, ...newer,
    portfolios: unite(newer.portfolios, older.portfolios),
    transactions: unite(newer.transactions, older.transactions),
    settings: { ...older.settings, ...newer.settings },
    deleted,
    updatedAt: newer.updatedAt,
  };
}

// ------------------------------------------------------------------ config

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { return null; }
}
function setConfig(cfg) {
  try { if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); else localStorage.removeItem(CFG_KEY); } catch { /* ignore */ }
}

async function gh(path, token, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) throw new Error('GitHub rejected the token (expired or missing the "gist" scope).');
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

async function readGist(cfg) {
  const g = await gh(`/gists/${cfg.gistId}`, cfg.token);
  const f = g.files?.[FILE];
  if (!f) return null;
  const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  return unseal(text, cfg.passphrase);
}

async function writeGist(cfg, state) {
  await gh(`/gists/${cfg.gistId}`, cfg.token, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: await seal(state, cfg.passphrase) } } }) });
}

// ------------------------------------------------------------------ public API

/** Connect: find our gist among the user's gists, or create one. Returns the remote state (or null). */
export async function connect(token, passphrase, store) {
  const user = await gh('/user', token).catch(() => null);
  let gistId = null;
  for (let page = 1; page <= 5 && !gistId; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`, token);
    gistId = list.find((g) => g.description === DESCRIPTION && g.files?.[FILE])?.id || null;
    if (list.length < 100) break;
  }
  const cfg = { token, passphrase: passphrase || '', gistId, auto: true, login: user?.login || null, lastSync: null };
  if (!gistId) {
    const g = await gh('/gists', token, { method: 'POST', body: JSON.stringify({ description: DESCRIPTION, public: false, files: { [FILE]: { content: await seal(store.get(), cfg.passphrase) } } }) });
    cfg.gistId = g.id;
    cfg.lastSync = new Date().toISOString();
    setConfig(cfg);
    return { created: true };
  }
  setConfig(cfg);
  try { await syncNow(store); } catch (e) { setConfig(null); throw e; } // e.g. wrong passphrase: stay disconnected
  return { created: false };
}

export function disconnect() { setConfig(null); }

let busy = false;
/** Pull, merge, push. Safe to call often. */
export async function syncNow(store) {
  const cfg = getConfig();
  if (!cfg?.gistId || busy) return null;
  busy = true;
  try {
    const remote = await readGist(cfg);
    const local = store.get();
    const merged = mergeStates(local, remote);
    if (JSON.stringify(merged) !== JSON.stringify(local)) store.replace(merged, { fromSync: true });
    if (!remote || JSON.stringify(merged) !== JSON.stringify(remote)) await writeGist(cfg, merged);
    cfg.lastSync = new Date().toISOString();
    cfg.error = null;
    setConfig(cfg);
    return cfg;
  } catch (e) {
    cfg.error = e.message;
    setConfig(cfg);
    throw e;
  } finally {
    busy = false;
  }
}

let timer = null;
/** Auto-sync: pull on start, push a few seconds after each local change. */
export function startAutoSync(store, onStatus = () => {}) {
  const run = () => syncNow(store).then(() => onStatus(getConfig())).catch(() => onStatus(getConfig()));
  if (getConfig()?.auto) run();
  store.subscribe((_, meta) => {
    if (meta?.fromSync || !getConfig()?.auto) return;
    clearTimeout(timer);
    timer = setTimeout(run, 4000);
  });
}
