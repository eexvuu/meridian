/**
 * LLM API key rotation pool.
 *
 * Reads multiple API keys from env (LLM_API_KEYS, comma-separated) or single key
 * (LLM_API_KEY / OPENROUTER_API_KEY). Returns clients round-robin. On rate limit
 * (429), the current key is parked in a cooldown bucket and the next key is used.
 *
 * Public API:
 *   getClient()              — returns a client entry to use for the next call
 *   markRateLimited(entry)   — call when a 429 is observed for that entry
 *   getKeyCount()            — total keys configured
 *   getCooldownStatus()      — debug: which keys are currently cooled
 */

import OpenAI from "openai";
import { log } from "./logger.js";

const DEFAULT_COOLDOWN_MS = 60_000; // 1 minute — covers per-minute Gemini RPM
const TIMEOUT_MS = 5 * 60 * 1000;

function parseKeys() {
  const multi = process.env.LLM_API_KEYS;
  if (multi) {
    return multi.split(",").map((k) => k.trim()).filter(Boolean);
  }
  const single = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
  return single ? [single] : [];
}

function maskKey(key) {
  if (!key) return "??";
  if (key.length <= 8) return "***";
  return `***${key.slice(-4)}`;
}

const baseURL = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
const keys = parseKeys();

const pool = keys.map((key, id) => ({
  id,
  mask: maskKey(key),
  client: new OpenAI({ apiKey: key, baseURL, timeout: TIMEOUT_MS }),
  cooledUntil: 0,
}));

let nextIndex = 0;

if (pool.length === 0) {
  log("llm_keys", "No API keys configured — agent will fail on first LLM call");
} else {
  log("llm_keys", `Loaded ${pool.length} key${pool.length > 1 ? "s" : ""}: ${pool.map((p) => p.mask).join(", ")}`);
}

export function getClient() {
  if (pool.length === 0) {
    throw new Error("No LLM API keys configured. Set LLM_API_KEYS or llmApiKey/llmApiKeys in user-config.json.");
  }

  const now = Date.now();
  for (let i = 0; i < pool.length; i++) {
    const idx = (nextIndex + i) % pool.length;
    if (pool[idx].cooledUntil <= now) {
      nextIndex = (idx + 1) % pool.length;
      return pool[idx];
    }
  }

  // All keys cooled down — pick the one whose cooldown ends soonest
  const earliest = pool.reduce((a, b) => (a.cooledUntil < b.cooledUntil ? a : b));
  const waitMs = Math.max(0, earliest.cooledUntil - now);
  log("llm_keys", `All ${pool.length} keys rate-limited; using ${earliest.mask} (waits ${Math.ceil(waitMs / 1000)}s)`);
  return earliest;
}

export function markRateLimited(entry, durationMs = DEFAULT_COOLDOWN_MS) {
  if (!entry) return;
  entry.cooledUntil = Date.now() + durationMs;
  const cooled = pool.filter((p) => p.cooledUntil > Date.now()).length;
  log("llm_keys", `Key ${entry.mask} rate-limited (${cooled}/${pool.length} cooled, ${Math.round(durationMs / 1000)}s)`);
}

export function getKeyCount() {
  return pool.length;
}

export function getCooldownStatus() {
  const now = Date.now();
  return pool.map((p) => ({
    id: p.id,
    mask: p.mask,
    cooled: p.cooledUntil > now,
    waitSeconds: Math.max(0, Math.round((p.cooledUntil - now) / 1000)),
  }));
}
