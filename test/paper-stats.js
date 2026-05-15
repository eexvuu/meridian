// Paper trading stats viewer.
// Usage: node test/paper-stats.js
//
// Reads paper-state.json + paper-lessons.json and prints:
//   - Open paper positions with real-time simulated PnL
//   - Closed positions stats (win rate, avg PnL, distribution)
//   - Top winners/losers
//   - Per-pool summary

import "../envcrypt.js";
import "../config.js";
import fs from "fs";
import { computePaperPnl } from "../paper-trading.js";

const STATE = "./paper-state.json";
const LESSONS = "./paper-lessons.json";

if (process.env.DRY_RUN !== "true") {
  console.log("⚠️  DRY_RUN is not 'true' — set DRY_RUN=true in env to read paper files.");
  console.log("    (Or copy paper-state.json → state.json if you want to inspect a backup.)");
  process.exit(1);
}

function readJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  try { return JSON.parse(fs.readFileSync(path, "utf8")); } catch { return fallback; }
}

function fmtUsd(value) {
  if (value == null || !Number.isFinite(value)) return "$?";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function fmtPct(value) {
  if (value == null || !Number.isFinite(value)) return "?";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function fmtAge(minutes) {
  if (minutes == null) return "?";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d${Math.floor((minutes % 1440) / 60)}h`;
}

const state = readJson(STATE, { positions: {} });
const lessons = readJson(LESSONS, { performance: [], lessons: [] });

const positions = Object.values(state.positions || {});
const open = positions.filter((p) => !p.closed);
const closed = positions.filter((p) => p.closed);
const performance = lessons.performance || [];

console.log("═══════════════════════════════════════════════════════════════");
console.log("  PAPER TRADING STATS");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`Wallet:     ${state.lastUpdated ? `last updated ${state.lastUpdated}` : "(no data)"}`);
console.log(`Open:       ${open.length}`);
console.log(`Closed:     ${closed.length}`);
console.log(`Perf rec:   ${performance.length}`);
console.log("");

// ─── Open positions (live PnL) ──────────────────────────────────────
if (open.length === 0) {
  console.log("📭 No open paper positions.");
} else {
  console.log(`📊 OPEN PAPER POSITIONS (${open.length})`);
  console.log("───────────────────────────────────────────────────────────────");
  for (const pos of open) {
    const snap = pos.signal_snapshot || {};
    try {
      const pnl = await computePaperPnl({
        pool: pos.pool,
        amount_sol: pos.amount_sol,
        initial_value_usd: pos.initial_value_usd,
        deployed_at: pos.deployed_at,
        bin_range: pos.bin_range,
        bin_step: pos.bin_step,
        active_bin_at_deploy: pos.active_bin_at_deploy,
        out_of_range_since: pos.out_of_range_since,
        entry_price: snap.entry_price,
        lower_price: snap.lower_price,
        sol_usd_price: snap.sol_usd_price,
      });
      const status = pnl.in_range ? "✅ in-range" : pnl._price_region === "above" ? "⬆️  OOR up" : "⬇️  OOR down";
      console.log(`  ${pos.pool_name}  [${pos.position.slice(0, 14)}…]`);
      console.log(`    value=${fmtUsd(pnl.current_value_usd)}  pnl=${fmtUsd(pnl.pnl_usd)} (${fmtPct(pnl.pnl_pct)})  fees=${fmtUsd(pnl.unclaimed_fee_usd)}`);
      console.log(`    strategy=${pos.strategy}  bin_step=${pos.bin_step}  range=[${pnl.lower_bin}, ${pnl.upper_bin}]  active=${pnl.active_bin}`);
      console.log(`    age=${fmtAge(pnl.age_minutes)}  in-range time=${fmtAge(pnl.minutes_in_range)}  ${status}`);
      console.log(`    peak pnl=${fmtPct(pos.peak_pnl_pct)}  trailing_active=${pos.trailing_active}`);
      console.log("");
    } catch (err) {
      console.log(`  ${pos.pool_name}: ⚠️  PnL fetch failed — ${err.message}`);
    }
  }
}

// ─── Closed positions stats ──────────────────────────────────────────
if (performance.length > 0) {
  console.log("");
  console.log(`📈 CLOSED POSITIONS PERFORMANCE (${performance.length} records)`);
  console.log("───────────────────────────────────────────────────────────────");

  const winners = performance.filter((p) => (p.pnl_pct ?? 0) > 0);
  const losers = performance.filter((p) => (p.pnl_pct ?? 0) < 0);
  const breakeven = performance.length - winners.length - losers.length;
  const winRate = (winners.length / performance.length) * 100;

  const sumPnlUsd = performance.reduce((s, p) => s + (p.pnl_usd ?? 0), 0);
  const sumFeesUsd = performance.reduce((s, p) => s + (p.fees_earned_usd ?? 0), 0);
  const avgPnlPct = performance.reduce((s, p) => s + (p.pnl_pct ?? 0), 0) / performance.length;
  const avgHoldMin = performance.reduce((s, p) => s + (p.minutes_held ?? 0), 0) / performance.length;
  const avgRangeEff = performance.reduce((s, p) => s + (p.range_efficiency ?? 0), 0) / performance.length;

  console.log(`  Win rate:        ${winRate.toFixed(1)}% (${winners.length}W / ${losers.length}L / ${breakeven}BE)`);
  console.log(`  Total PnL:       ${fmtUsd(sumPnlUsd)}`);
  console.log(`  Total fees:      ${fmtUsd(sumFeesUsd)}`);
  console.log(`  Avg PnL:         ${fmtPct(avgPnlPct)}`);
  console.log(`  Avg hold:        ${fmtAge(Math.round(avgHoldMin))}`);
  console.log(`  Avg range eff:   ${avgRangeEff.toFixed(1)}%`);

  // Distribution by close_reason
  console.log("");
  console.log("  Close reasons:");
  const reasonGroup = {};
  for (const p of performance) {
    const reason = (p.close_reason || "unknown").toLowerCase();
    reasonGroup[reason] = (reasonGroup[reason] || 0) + 1;
  }
  for (const [reason, count] of Object.entries(reasonGroup).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / performance.length) * 100).toFixed(0);
    console.log(`    ${reason.padEnd(40)} ${String(count).padStart(3)}  (${pct}%)`);
  }

  // Top 5 winners and losers
  console.log("");
  console.log("  🏆 Top winners:");
  for (const p of [...performance].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0)).slice(0, 5)) {
    console.log(`    ${p.pool_name?.padEnd(20)} ${fmtPct(p.pnl_pct).padStart(8)}  ${fmtUsd(p.pnl_usd).padStart(10)}  ${fmtAge(p.minutes_held)}  ${p.close_reason}`);
  }
  console.log("");
  console.log("  💀 Worst losers:");
  for (const p of [...performance].sort((a, b) => (a.pnl_pct ?? 0) - (b.pnl_pct ?? 0)).slice(0, 5)) {
    console.log(`    ${p.pool_name?.padEnd(20)} ${fmtPct(p.pnl_pct).padStart(8)}  ${fmtUsd(p.pnl_usd).padStart(10)}  ${fmtAge(p.minutes_held)}  ${p.close_reason}`);
  }

  // Per-strategy
  console.log("");
  console.log("  By strategy:");
  const stratGroup = {};
  for (const p of performance) {
    const k = p.strategy || "unknown";
    if (!stratGroup[k]) stratGroup[k] = { count: 0, wins: 0, pnl_total: 0 };
    stratGroup[k].count++;
    if ((p.pnl_pct ?? 0) > 0) stratGroup[k].wins++;
    stratGroup[k].pnl_total += p.pnl_usd ?? 0;
  }
  for (const [strat, s] of Object.entries(stratGroup)) {
    const wr = ((s.wins / s.count) * 100).toFixed(0);
    console.log(`    ${strat.padEnd(10)} ${s.count} trades, ${wr}% WR, total ${fmtUsd(s.pnl_total)}`);
  }
}

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
