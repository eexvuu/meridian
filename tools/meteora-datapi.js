import { log } from "../logger.js";

const USER_AGENT = "meridian-bot/1.0";
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_BACKOFF_MS = [500, 1000, 2000];

const _cache = new Map();
const _inflight = new Map();
let _stats = { hits: 0, misses: 0, retries: 0, errors: 0 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function backoffMs(attempt, retryAfterHeader) {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 5000);
  return DEFAULT_RETRY_BACKOFF_MS[attempt] ?? 2000;
}

/**
 * Fetch a Meteora datapi endpoint with in-memory TTL cache, retry on 429/5xx,
 * and inflight deduplication. Returns parsed JSON or throws after final retry.
 *
 * @param {string} url - full URL to fetch
 * @param {object} opts
 * @param {number} [opts.ttlMs=0] - cache TTL; 0 disables caching
 * @param {number} [opts.retries=3] - max retry attempts on 429/5xx
 * @param {boolean} [opts.noCache=false] - bypass cache read (still writes)
 * @returns {Promise<any>} parsed JSON
 */
export async function meteoraDatapiJson(url, { ttlMs = 0, retries = DEFAULT_RETRIES, noCache = false } = {}) {
  const useCache = ttlMs > 0;

  if (useCache && !noCache) {
    const cached = _cache.get(url);
    if (cached && Date.now() - cached.ts < ttlMs) {
      _stats.hits++;
      return cached.data;
    }
  }

  if (_inflight.has(url)) {
    return _inflight.get(url);
  }

  const promise = (async () => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        if (res.ok) {
          const data = await res.json();
          if (useCache) _cache.set(url, { data, ts: Date.now() });
          if (attempt === 0) _stats.misses++;
          return data;
        }

        const body = await res.text().catch(() => "");
        const err = new Error(`datapi ${res.status}: ${body.slice(0, 120)}`);
        err.status = res.status;
        err.retryAfter = res.headers.get("retry-after");
        lastError = err;

        if (!isRetryableStatus(res.status) || attempt === retries) throw err;
        const wait = backoffMs(attempt, err.retryAfter);
        _stats.retries++;
        log("datapi_retry", `${res.status} on ${shortUrl(url)} — retry ${attempt + 1}/${retries} in ${wait}ms`);
        await sleep(wait);
      } catch (err) {
        lastError = err;
        if (err.status != null && !isRetryableStatus(err.status)) throw err;
        if (attempt === retries) throw err;
        const wait = backoffMs(attempt, err.retryAfter);
        _stats.retries++;
        log("datapi_retry", `${err.message} on ${shortUrl(url)} — retry ${attempt + 1}/${retries} in ${wait}ms`);
        await sleep(wait);
      }
    }
    throw lastError;
  })();

  _inflight.set(url, promise);
  try {
    return await promise;
  } catch (err) {
    _stats.errors++;
    throw err;
  } finally {
    _inflight.delete(url);
  }
}

function shortUrl(url) {
  return url.replace("https://dlmm.datapi.meteora.ag", "");
}

export function getDatapiStats() {
  return { ..._stats, cacheSize: _cache.size, inflight: _inflight.size };
}

export function clearDatapiCache() {
  _cache.clear();
}

setInterval(() => {
  if (_cache.size === 0) return;
  const now = Date.now();
  const MAX_AGE = 10 * 60 * 1000;
  for (const [k, v] of _cache.entries()) {
    if (now - v.ts > MAX_AGE) _cache.delete(k);
  }
}, 5 * 60 * 1000).unref?.();
