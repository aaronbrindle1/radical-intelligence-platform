import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '../api_cache.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS api_cache (
    key TEXT PRIMARY KEY,
    value TEXT,
    timestamp INTEGER
  )
`);

// Max age defaults to 24 hours
export function getCache(key, maxAgeSeconds = 86400) {
  try {
    const row = db.prepare('SELECT value, timestamp FROM api_cache WHERE key = ?').get(key);
    if (!row) return null;
    const now = Date.now();
    if (now - row.timestamp > maxAgeSeconds * 1000) return null; // expired
    return row.value;
  } catch (e) {
    console.error("Cache read error:", e);
    return null;
  }
}

export function setCache(key, value) {
  try {
    const now = Date.now();
    db.prepare('INSERT OR REPLACE INTO api_cache (key, value, timestamp) VALUES (?, ?, ?)').run(key, value, now);
  } catch (e) {
    console.error("Cache write error:", e);
  }
}

export function clearCache() {
  try {
    db.prepare('DELETE FROM api_cache').run();
  } catch (e) {
    console.error("Cache clear error:", e);
  }
}

// Delete all newsapi cache entries whose response body contains the given term
export function bustNewsCache(term) {
  try {
    const pattern = `%${term}%`;
    const result = db.prepare(
      "DELETE FROM api_cache WHERE value LIKE ? AND value LIKE '%totalResults%'"
    ).run(pattern);
    return result.changes;
  } catch (e) {
    console.error("Cache bust error:", e);
    return 0;
  }
}
