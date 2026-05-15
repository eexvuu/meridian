// Smoke test: load config + env, verify critical fields resolve correctly
// after migration of secrets from user-config.json -> .env
import "../envcrypt.js";
import { config } from "../config.js";

const checks = [
  // [label, value, expected-truthy-or-not, hint]
  ["WALLET_PRIVATE_KEY",   process.env.WALLET_PRIVATE_KEY,   true, ".env"],
  ["RPC_URL",              process.env.RPC_URL,              true, ".env"],
  ["LLM_BASE_URL",         process.env.LLM_BASE_URL,         true, ".env"],
  ["LLM_API_KEY",          process.env.LLM_API_KEY,          true, ".env"],
  ["LLM_MODEL",            process.env.LLM_MODEL,            true, ".env"],
  ["TELEGRAM_BOT_TOKEN",   process.env.TELEGRAM_BOT_TOKEN,   true, ".env"],
  ["TELEGRAM_CHAT_ID",     process.env.TELEGRAM_CHAT_ID,     true, ".env"],
  ["TELEGRAM_TOPIC_ID",    process.env.TELEGRAM_TOPIC_ID,    true, ".env"],
  ["HIVEMIND_API_KEY",     process.env.HIVEMIND_API_KEY,     true, ".env"],
  ["MERIDIAN_AGENT_ID",    process.env.MERIDIAN_AGENT_ID,    true, ".env"],
  ["PUBLIC_API_KEY",       process.env.PUBLIC_API_KEY,       true, ".env"],
  ["DRY_RUN",              process.env.DRY_RUN,              true, ".env"],

  ["config.hiveMind.url",      config.hiveMind.url,      true, "default or env"],
  ["config.hiveMind.apiKey",   config.hiveMind.apiKey,   true, "from HIVEMIND_API_KEY"],
  ["config.hiveMind.agentId",  config.hiveMind.agentId,  true, "from MERIDIAN_AGENT_ID"],
  ["config.api.publicApiKey",  config.api.publicApiKey,  true, "from PUBLIC_API_KEY / default"],
  ["config.api.url",           config.api.url,           true, "default or env"],

  ["config.management.minFeePerTvl24h",       config.management.minFeePerTvl24h,       true, "finite number"],
  ["config.management.minAgeBeforeYieldCheck",config.management.minAgeBeforeYieldCheck,true, "finite number"],
  ["config.management.deployAmountSol",       config.management.deployAmountSol,       true, "finite number"],
  ["config.risk.maxPositions",                config.risk.maxPositions,                true, "finite number"],
  ["config.llm.managementModel",              config.llm.managementModel,              true, "string"],
];

let failed = 0;
for (const [label, value, expectTruthy, hint] of checks) {
  const ok = expectTruthy ? Boolean(value) : !value;
  const status = ok ? "OK  " : "FAIL";
  const display = value == null ? "<null/undefined>" :
                  String(value).length > 70 ? String(value).slice(0, 67) + "..." : String(value);
  if (!ok) failed++;
  console.log(`[${status}] ${label.padEnd(40)} = ${display.padEnd(72)} (${hint})`);
}

function assertFinite(label, actual) {
  const ok = Number.isFinite(Number(actual));
  console.log(`[${ok ? "OK  " : "FAIL"}] ${label.padEnd(40)} = ${actual} (finite)`);
  if (!ok) failed++;
}
function assertEq(label, actual, expected) {
  const ok = String(actual) === String(expected);
  console.log(`[${ok ? "OK  " : "FAIL"}] ${label.padEnd(40)} = ${actual} (expected ${expected})`);
  if (!ok) failed++;
}
assertFinite("management.minFeePerTvl24h",        config.management.minFeePerTvl24h);
assertFinite("management.minAgeBeforeYieldCheck", config.management.minAgeBeforeYieldCheck);
assertEq("hiveMind.agentId env wins",             config.hiveMind.agentId, process.env.MERIDIAN_AGENT_ID);

console.log("");
console.log(failed === 0 ? "✓ All checks passed — safe to run" : `✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
