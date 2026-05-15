/**
 * Demo showcase: deploy + reasoning, back-to-back.
 * Run: node test/demo-showcase.js
 *
 * Scenario 1: Reasoning — ask the agent to compare top 2 pools head-to-head.
 * Scenario 2: Deploy   — ask the agent to deploy 0.3 SOL into the best pool.
 *
 * Both run in DRY_RUN mode (no on-chain TXs).
 */

import "dotenv/config";
import { agentLoop } from "../agent.js";

function divider(title) {
  console.log("\n" + "═".repeat(70));
  console.log("  " + title);
  console.log("═".repeat(70));
}

async function main() {
  // ─── Scenario 1: Reasoning showcase ─────────────────────────────
  divider("SCENARIO 1 · Reasoning showcase");
  console.log("Goal: Compare the top 2 pool candidates, explain which is safer.\n");

  const reasoning = await agentLoop(
    "Run get_top_candidates with limit=3. Then for the #1 and #2 candidates, " +
    "fetch get_token_holders and get_token_narrative for each. " +
    "Compare them side-by-side: which one would you LP into and why? " +
    "Address: bundler %, holder concentration, narrative quality, and any red flags.",
    8,
    [],
    "GENERAL"
  );

  console.log("\n─── Agent reasoning ──");
  console.log(reasoning.content);

  // ─── Scenario 2: Deploy showcase ─────────────────────────────────
  divider("SCENARIO 2 · Deploy showcase (DRY RUN)");
  console.log("Goal: Deploy 0.3 SOL into the best pool — should call deploy_position.\n");

  const deploy = await agentLoop(
    "Run get_top_candidates with limit=3. Pick the best one. " +
    "Then call get_active_bin for that pool, then call deploy_position with " +
    "amount_sol=0.3, bins_below=50, strategy='bid_ask'. " +
    "Report exactly what would be deployed (bin range, shape, etc).",
    8,
    [],
    "SCREENER"
  );

  console.log("\n─── Agent deploy result ──");
  console.log(deploy.content);

  divider("DEMO COMPLETE");
}

main().catch((e) => {
  console.error("\nDemo failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
