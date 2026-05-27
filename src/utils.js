// ─── Logger ────────────────────────────────────────────────────────────────
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export function log(level, ...args) {
  if (LEVELS[level] >= LEVELS[LOG_LEVEL]) {
    const time = new Date().toISOString().slice(11, 19);
    const prefix = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' }[level] || '';
    console.log(`[${time}] ${prefix}`, ...args);
  }
}

// ─── Safe fetch with timeout ───────────────────────────────────────────────
export async function safeFetch(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Calculate account age ─────────────────────────────────────────────────
export function accountAgeDays(createdTimestamp) {
  if (!createdTimestamp) return null;
  const created = typeof createdTimestamp === 'number'
    ? new Date(createdTimestamp * 1000)
    : new Date(createdTimestamp);
  return Math.floor((Date.now() - created.getTime()) / 86400000);
}
