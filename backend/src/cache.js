const TTL_MS = 30_000; // 30 seconds
const store  = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) { store.delete(key); return null; }
  return entry.value;
}

function set(key, value) {
  store.set(key, { value, ts: Date.now() });
}

function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

function size() { return store.size; }

module.exports = { get, set, invalidate, size };
