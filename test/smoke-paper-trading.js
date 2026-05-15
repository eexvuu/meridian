// Smoke test: paper trading lifecycle (deploy → PnL tick → close).
import "../envcrypt.js";
import "../config.js";
import { executeTool } from "../tools/executor.js";
import { getStateSummary, getTrackedPosition } from "../state.js";

console.log("=== PAPER TRADING SMOKE TEST ===");
console.log("DRY_RUN:", process.env.DRY_RUN);
if (process.env.DRY_RUN !== "true") {
  console.error("This test requires DRY_RUN=true");
  process.exit(1);
}

console.log("\n--- 1. Fetch top candidate ---");
const cand = await executeTool("get_top_candidates", { limit: 1 });
if (!cand?.candidates?.length) {
  console.error("No candidates:", JSON.stringify(cand).slice(0, 200));
  process.exit(1);
}
const top = cand.candidates[0];
console.log(`Candidate: ${top.name} @ ${top.pool.slice(0, 8)} (vol=${top.volatility}, bin_step=${top.bin_step})`);

console.log("\n--- 2. Paper deploy ---");
const minBin = 35;
const maxBin = 69;
const v = Math.max(0.01, Number(top.volatility) || 1);
const binsBelow = Math.max(minBin, Math.min(maxBin, Math.round(minBin + (v / 5) * (maxBin - minBin))));

const deployResult = await executeTool("deploy_position", {
  pool_address: top.pool,
  amount_y: 0.3,
  amount_x: 0,
  strategy: "bid_ask",
  bins_below: binsBelow,
  bins_above: 0,
  volatility: top.volatility,
  pool_name: top.name,
  bin_step: top.bin_step,
  fee_tvl_ratio: top.fee_active_tvl_ratio,
  organic_score: top.organic_score,
});

console.log("Deploy result:");
console.log(JSON.stringify(deployResult, null, 2));

if (!deployResult?.paper_trading || !deployResult.position) {
  console.error("\nFAIL: paper_trading flag not set or no position");
  process.exit(1);
}

const positionId = deployResult.position;

console.log("\n--- 3. Verify state.js tracked the position ---");
const summary = getStateSummary();
console.log("open_positions:", summary.open_positions);
const tracked = getTrackedPosition(positionId);
if (!tracked) {
  console.error("FAIL: trackPosition didn't persist");
  process.exit(1);
}
console.log("tracked.position:", tracked.position);
console.log("tracked.pool_name:", tracked.pool_name);
console.log("tracked.initial_value_usd:", tracked.initial_value_usd);
console.log("tracked.signal_snapshot.entry_price:", tracked.signal_snapshot?.entry_price);
console.log("tracked.signal_snapshot.lower_price:", tracked.signal_snapshot?.lower_price);
console.log("tracked.signal_snapshot.sol_usd_price:", tracked.signal_snapshot?.sol_usd_price);

console.log("\n--- 4. getMyPositions (simulated) ---");
const positions = await executeTool("get_my_positions", { force: true });
console.log("paper_trading flag:", positions.paper_trading);
console.log("total_positions:", positions.total_positions);
if (positions.positions?.[0]) {
  const p = positions.positions[0];
  console.log(`  ${p.pair} — value=$${p.total_value_usd}, fees=$${p.unclaimed_fees_usd}, pnl=${p.pnl_pct}%, in_range=${p.in_range}, age=${p.age_minutes}m`);
}

console.log("\n--- 5. getPositionPnl (simulated) ---");
const pnl = await executeTool("get_position_pnl", {
  pool_address: top.pool,
  position_address: positionId,
});
console.log(JSON.stringify(pnl, null, 2));

console.log("\n--- 6. Paper close (simulated) ---");
const closeResult = await executeTool("close_position", {
  position_address: positionId,
  reason: "smoke_test_manual_close",
});
console.log(JSON.stringify(closeResult, null, 2));

console.log("\n--- 7. Verify position marked closed + perf recorded ---");
const finalTracked = getTrackedPosition(positionId);
console.log("position closed flag:", finalTracked?.closed);
console.log("closed_at:", finalTracked?.closed_at);

import fs from "fs";
if (fs.existsSync("./paper-lessons.json")) {
  const lessons = JSON.parse(fs.readFileSync("./paper-lessons.json", "utf8"));
  const lastPerf = lessons.performance?.[lessons.performance.length - 1];
  console.log("Last perf record:", JSON.stringify(lastPerf, null, 2).slice(0, 400));
}

console.log("\nSUCCESS — paper trading lifecycle complete.");
process.exit(0);
