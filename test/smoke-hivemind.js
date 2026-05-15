// Smoke test: verify HiveMind endpoint reachable & credential accepted.
import "../envcrypt.js";
import "../config.js";
import {
  isHiveMindEnabled,
  registerHiveMindAgent,
  pullHiveMindLessons,
  pullHiveMindPresets,
} from "../hivemind.js";
import { config } from "../config.js";

console.log("\n=== HiveMind Smoke Test ===");
console.log("URL:        ", config.hiveMind.url);
console.log("API key:    ", (config.hiveMind.apiKey || "").slice(0, 8) + "..." + (config.hiveMind.apiKey || "").slice(-4));
console.log("agentId:    ", config.hiveMind.agentId);
console.log("pullMode:   ", config.hiveMind.pullMode);
console.log("shareData:  ", config.hiveMind.shareData, "(false = receive only)");
console.log("enabled?    ", isHiveMindEnabled());

if (!isHiveMindEnabled()) {
  console.error("\nHiveMind disabled (URL or API key missing)");
  process.exit(1);
}

console.log("\n--- Calling /api/hivemind/agents/register ---");
const reg = await registerHiveMindAgent({ reason: "smoke-test" });
console.log("response:", reg ? JSON.stringify(reg).slice(0, 200) : "(null/failed)");

console.log("\n--- Calling /api/hivemind/lessons/pull ---");
const lessons = await pullHiveMindLessons(5);
console.log("lessons received:", Array.isArray(lessons) ? lessons.length : "(failed)");
if (Array.isArray(lessons) && lessons.length > 0) {
  console.log("sample:", JSON.stringify(lessons[0]).slice(0, 200));
}

console.log("\n--- Calling /api/hivemind/presets/pull ---");
const presets = await pullHiveMindPresets();
console.log("presets received:", Array.isArray(presets) ? presets.length : "(failed)");

console.log("\nDONE.");
process.exit(0);
