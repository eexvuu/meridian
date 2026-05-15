/**
 * Paper trading simulator for DRY_RUN mode.
 *
 * Provides:
 *  - Pool snapshot fetcher (cached) from Meteora datapi
 *  - PnL simulation for single-side SOL bid_ask positions
 *  - Lifecycle helpers compatible with tools/dlmm.js shapes
 *
 * Activated when process.env.DRY_RUN === "true". Otherwise these helpers
 * are inert and should not be invoked.
 *
 * Storage:
 *  - paper-state.json   (via state.js, DRY_RUN-aware)
 *  - paper-lessons.json (via lessons.js, DRY_RUN-aware)
 *
 * Accuracy model:
 *  - Single-side SOL bid_ask: range = [active_bin - bins_below, active_bin].
 *    As price drops through bins, SOL is progressively converted to token.
 *  - Fees: linear accrual using pool's current fee_active_tvl_ratio × time-in-range,
 *    scaled by our_share of active_tvl. Coarse but defensible.
 *  - IL: triangular approximation. Assumes uniform conversion across the range.
 */

import { log } from "./logger.js";

const METEORA_POOL_URL = (addr) => `https://dlmm.datapi.meteora.ag/pools/${addr}`;
const POOL_CACHE_TTL_MS = 20_000;
const _poolCache = new Map();

export function isDryRun() {
  return process.env.DRY_RUN === "true";
}

async function fetchPoolDetail(pool_address) {
  const cached = _poolCache.get(pool_address);
  if (cached && Date.now() - cached.ts < POOL_CACHE_TTL_MS) return cached.data;
  const res = await fetch(METEORA_POOL_URL(pool_address));
  if (!res.ok) throw new Error(`Meteora pool detail ${res.status}`);
  const data = await res.json();
  _poolCache.set(pool_address, { data, ts: Date.now() });
  return data;
}

function num(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function binPriceRatio(bin_step, bin_delta) {
  return Math.pow(1 + bin_step / 10000, bin_delta);
}

/**
 * Compute current state for a paper position.
 *
 * @param {object} pos - paper position record (from state.js paper-state.json)
 * @returns {Promise<object>} Shape compatible with getPositionPnl + supplemental fields
 */
export async function computePaperPnl(pos) {
  const pool = await fetchPoolDetail(pos.pool);

  const currentPrice = num(pool.current_price)
    || num(pool.price)
    || num(pool.token_x?.price)
    || num(pool.token_x?.usd_price) / Math.max(num(pool.token_y?.usd_price), 1e-12);

  const entryPrice = num(pos.entry_price);
  const lowerPrice = num(pos.lower_price);
  const solUsd     = num(pool.token_y?.usd_price) || num(pos.sol_usd_price) || 0;
  // Datapi /pools/<addr> nests fee_tvl_ratio by timeframe; "24h" is percent/day.
  const feeRatio   = num(pool.fee_tvl_ratio?.["24h"]); // percent per 24h (e.g. 6.31 = 6.31%/day)

  const ageMs = Date.now() - new Date(pos.deployed_at).getTime();
  const minutesHeld = Math.max(0, Math.floor(ageMs / 60000));

  // ── In-range check via bin delta (more accurate than raw price ratio) ──
  // bin_delta > 0 = price moved up past upper bin (OOR above)
  // bin_delta in [-bins_below, 0] = in_range
  // bin_delta < -bins_below = OOR below
  const binStep = pos.bin_step ?? num(pool.bin_step, 100);
  const binsBelow = pos.bin_range?.bins_below ?? num(pool.bins_below, 35);
  const r = entryPrice > 0 ? currentPrice / entryPrice : 1;
  const lowerR = entryPrice > 0 ? lowerPrice / entryPrice : 0.7;
  const binRatio = 1 + binStep / 10000;
  const binDelta = r > 0 ? Math.log(r) / Math.log(binRatio) : -Infinity;

  let positionValueSol;
  let inRange;
  let priceRegion;

  // Allow half-bin tolerance on upper edge: active_bin width itself is treated as in-range
  // so micro price ticks above entry don't flap OOR (Meteora current_price updates per trade).
  if (binDelta > 0.5) {
    // OOR above — price moved past active bin. Position still all SOL.
    positionValueSol = pos.amount_sol;
    inRange = false;
    priceRegion = "above";
  } else if (binDelta >= -binsBelow) {
    // In range — linear conversion approximation.
    const fractionConverted = (1 - r) / Math.max(1 - lowerR, 1e-9);
    const remainingSol = pos.amount_sol * (1 - fractionConverted);
    // Average buy price ratio (midpoint between entry and current).
    const avgBuyR = (1 + r) / 2;
    const tokenValueSol = (pos.amount_sol * fractionConverted / avgBuyR) * r;
    positionValueSol = remainingSol + tokenValueSol;
    inRange = true;
    priceRegion = "in";
  } else {
    // OOR below — fully converted; frozen as token.
    const avgBuyR = (1 + lowerR) / 2;
    positionValueSol = (pos.amount_sol / avgBuyR) * r;
    inRange = false;
    priceRegion = "below";
  }

  // ── Fees accrual (linear estimate) ──
  // feeRatio is fee_tvl_ratio["24h"] in PERCENT per day (e.g. 6.31 = 6.31%/day on TVL).
  // Convert to fraction-per-minute: (percent / 100) / 1440.
  // Approximation: fee_sol_per_minute ≈ feesPerMinFraction × amount_sol  (small-share assumption).
  // minutes_in_range: minutes_held minus current contiguous OOR duration (state.js OOR clock).
  const feesPerMinFraction = (feeRatio / 100) / 1440;
  const currentOorMinutes = pos.out_of_range_since
    ? Math.max(0, Math.floor((Date.now() - new Date(pos.out_of_range_since).getTime()) / 60000))
    : 0;
  const minutesInRange = Math.max(0, minutesHeld - currentOorMinutes);
  const feesSolAccrued = feesPerMinFraction * pos.amount_sol * minutesInRange;
  const feesUsdAccrued = feesSolAccrued * solUsd;

  // ── Aggregate ──
  const initialValueUsd = num(pos.initial_value_usd) || pos.amount_sol * solUsd;
  const currentValueUsd = positionValueSol * solUsd;
  const totalUsd = currentValueUsd + feesUsdAccrued;
  const pnlUsd = totalUsd - initialValueUsd;
  const pnlPct = initialValueUsd > 0 ? (pnlUsd / initialValueUsd) * 100 : 0;

  // Active bin id from pool
  const activeBinId = num(pool.active_bin_id, pos.active_bin_at_deploy ?? null);

  return {
    // getPositionPnl shape
    pnl_usd: round2(pnlUsd),
    pnl_pct: round2(pnlPct),
    current_value_usd: round2(currentValueUsd),
    unclaimed_fee_usd: round2(feesUsdAccrued),
    all_time_fees_usd: round2(feesUsdAccrued),
    fee_per_tvl_24h: round2(feeRatio), // already percent per 24h (matches live mode scale)
    in_range: inRange,
    lower_bin: pos.bin_range?.min ?? null,
    upper_bin: pos.bin_range?.max ?? null,
    active_bin: activeBinId,
    age_minutes: minutesHeld,
    // Supplemental
    minutes_in_range: minutesInRange,
    _price_region: priceRegion,
    _current_price: currentPrice,
    _sol_usd_price: solUsd,
    _fees_earned_sol: feesSolAccrued,
    _position_value_sol: positionValueSol,
  };
}

/**
 * Build the deploy-time snapshot for a new paper position.
 * Caller (deploy_position in tools/dlmm.js) provides the raw deploy parameters.
 * Returns the trackPosition() argument object enriched with paper-specific fields.
 *
 * @param {object} args
 * @param {string} args.pool_address
 * @param {string} args.pool_name
 * @param {string} args.base_mint
 * @param {number} args.amount_sol
 * @param {string} args.strategy
 * @param {number} args.bin_step
 * @param {number} args.bins_below
 * @param {number} args.bins_above
 * @param {number} args.active_bin_id
 * @param {number} args.entry_price
 * @param {number} args.sol_usd_price
 * @param {number} args.volatility
 * @param {number} args.fee_tvl_ratio
 * @param {number} args.organic_score
 */
export function buildPaperTrackArgs(args) {
  const positionId = `paper_${randomId(16)}`;
  const lowerBin = args.active_bin_id - (args.bins_below ?? 0);
  const upperBin = args.active_bin_id + (args.bins_above ?? 0);
  const lowerPrice = args.entry_price * binPriceRatio(args.bin_step, lowerBin - args.active_bin_id);
  const upperPrice = args.entry_price * binPriceRatio(args.bin_step, upperBin - args.active_bin_id);
  const initialValueUsd = args.amount_sol * (args.sol_usd_price || 0);

  return {
    position: positionId,
    pool: args.pool_address,
    pool_name: args.pool_name,
    strategy: args.strategy,
    bin_range: { min: lowerBin, max: upperBin, bins_below: args.bins_below, bins_above: args.bins_above },
    amount_sol: args.amount_sol,
    amount_x: 0,
    active_bin: args.active_bin_id,
    bin_step: args.bin_step,
    volatility: args.volatility,
    fee_tvl_ratio: args.fee_tvl_ratio,
    organic_score: args.organic_score,
    initial_value_usd: initialValueUsd,
    signal_snapshot: {
      paper_trading: true,
      base_mint: args.base_mint,
      entry_price: args.entry_price,
      lower_price: lowerPrice,
      upper_price: upperPrice,
      sol_usd_price: args.sol_usd_price,
      _minutes_in_range_cum: 0,
      _last_tick_at: new Date().toISOString(),
    },
  };
}

/**
 * Compute final perf record for a closing paper position.
 * Called by closePosition() in DRY_RUN mode before recordPerformance.
 *
 * @param {object} trackedPos - The state.js position record (after trackPosition).
 * @param {string} closeReason
 */
export async function computePaperCloseResult(trackedPos, closeReason) {
  const snap = trackedPos.signal_snapshot || {};
  const paperPos = {
    pool: trackedPos.pool,
    amount_sol: trackedPos.amount_sol,
    initial_value_usd: trackedPos.initial_value_usd,
    deployed_at: trackedPos.deployed_at,
    bin_range: trackedPos.bin_range,
    bin_step: trackedPos.bin_step,
    active_bin_at_deploy: trackedPos.active_bin_at_deploy,
    out_of_range_since: trackedPos.out_of_range_since,
    entry_price: snap.entry_price,
    lower_price: snap.lower_price,
    sol_usd_price: snap.sol_usd_price,
  };

  const pnl = await computePaperPnl(paperPos);
  const minutesHeld = pnl.age_minutes;
  const minutesInRange = pnl.minutes_in_range;
  const feesUsd = pnl.unclaimed_fee_usd;
  const feesSol = pnl._fees_earned_sol;
  const finalValueUsd = pnl.current_value_usd;

  return {
    // recordPerformance shape
    perf: {
      position: trackedPos.position,
      pool: trackedPos.pool,
      pool_name: trackedPos.pool_name,
      strategy: trackedPos.strategy,
      bin_range: trackedPos.bin_range,
      bin_step: trackedPos.bin_step,
      volatility: trackedPos.volatility,
      fee_tvl_ratio: trackedPos.fee_tvl_ratio,
      organic_score: trackedPos.organic_score,
      amount_sol: trackedPos.amount_sol,
      fees_earned_usd: round2(feesUsd),
      fees_earned_sol: round6(feesSol),
      final_value_usd: round2(finalValueUsd),
      initial_value_usd: round2(trackedPos.initial_value_usd),
      minutes_in_range: minutesInRange,
      minutes_held: minutesHeld,
      close_reason: closeReason,
      base_mint: snap.base_mint || null,
      deployed_at: trackedPos.deployed_at,
      closed_at: new Date().toISOString(),
    },
    // Return-payload shape (close_position result)
    payload: {
      success: true,
      dry_run: true,
      paper_trading: true,
      position: trackedPos.position,
      pool: trackedPos.pool,
      pool_name: trackedPos.pool_name,
      pnl_usd: pnl.pnl_usd,
      pnl_pct: pnl.pnl_pct,
      base_mint: snap.base_mint || null,
      message: `PAPER CLOSE — ${closeReason}`,
    },
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
function randomId(bytes = 16) {
  const chars = "abcdef0123456789";
  let out = "";
  for (let i = 0; i < bytes; i++) out += chars[Math.floor(Math.random() * 16)];
  return out;
}
