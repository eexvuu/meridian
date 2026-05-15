// Smoke test: verify config loads and MiniMax API responds.
import "../envcrypt.js";
import "../config.js";
import { getClient, getKeyCount } from "../llm-keys.js";

console.log("\n=== Smoke Test ===");
console.log("LLM_BASE_URL:", process.env.LLM_BASE_URL || "(unset)");
console.log("LLM_API_KEY masked:", (process.env.LLM_API_KEY || "").slice(0, 8) + "..." + (process.env.LLM_API_KEY || "").slice(-4));
console.log("LLM_MODEL:", process.env.LLM_MODEL || "(unset, will use config.llm.*Model)");
console.log("Key pool size:", getKeyCount());

const { config } = await import("../config.js");
console.log("managementModel:", config.llm.managementModel);
console.log("screeningModel: ", config.llm.screeningModel);
console.log("generalModel:   ", config.llm.generalModel);
console.log("DRY_RUN:", process.env.DRY_RUN);
console.log("lpAgentRelayEnabled:", config.api.lpAgentRelayEnabled);
console.log("LPAGENT_API_KEY set:", !!process.env.LPAGENT_API_KEY);

console.log("\n=== Pinging MiniMax ===");
const entry = getClient();
try {
  const t0 = Date.now();
  const resp = await entry.client.chat.completions.create({
    model: config.llm.generalModel,
    messages: [{ role: "user", content: "Say 'OK' and nothing else." }],
    max_tokens: 10,
    temperature: 0,
  });
  const ms = Date.now() - t0;
  const text = resp.choices?.[0]?.message?.content || "(empty)";
  console.log(`Response in ${ms}ms:`, text);
  console.log("\nSUCCESS — MiniMax is reachable.");
  process.exit(0);
} catch (err) {
  console.error("\nFAILED:", err.status, err.message);
  if (err.error) console.error("Body:", JSON.stringify(err.error).slice(0, 400));
  process.exit(1);
}
