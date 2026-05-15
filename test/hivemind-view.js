// HiveMind cache viewer.
// Shows shared lessons + presets currently cached locally, sorted by score.
// Optionally pulls fresh data from hive first with --refresh.
//
// Usage:
//   node test/hivemind-view.js              # show local cache
//   node test/hivemind-view.js --refresh    # pull from hive, then show

import "../envcrypt.js";
import "../config.js";
import fs from "fs";
import { pullHiveMindLessons, pullHiveMindPresets, registerHiveMindAgent } from "../hivemind.js";

const CACHE_PATH = "./hivemind-cache.json";
const refresh = process.argv.includes("--refresh");

if (refresh) {
  console.log("🔄 Pulling fresh data from HiveMind...");
  await registerHiveMindAgent({ reason: "view" });
  await pullHiveMindLessons(20);
  await pullHiveMindPresets();
  console.log("✅ Refresh complete\n");
}

if (!fs.existsSync(CACHE_PATH)) {
  console.log("No hivemind-cache.json yet. Run with --refresh.");
  process.exit(1);
}

const cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
const lessons = cache.sharedLessons || [];
const presets = cache.presets || [];

console.log("═══════════════════════════════════════════════════════════════");
console.log("  HIVEMIND CACHE");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`Pulled at:   ${cache.pulledAt || "(unknown)"}`);
console.log(`Lessons:     ${lessons.length}`);
console.log(`Presets:     ${presets.length}`);

if (lessons.length > 0) {
  console.log("\n📚 SHARED LESSONS (sorted by score)");
  console.log("───────────────────────────────────────────────────────────────");
  const sorted = [...lessons].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const [i, lesson] of sorted.entries()) {
    const date = lesson.created_at ? new Date(lesson.created_at).toISOString().slice(0, 16).replace("T", " ") : "?";
    const outcome = lesson.outcome === "good" ? "✅" : lesson.outcome === "bad" ? "❌" : "•";
    const score = lesson.score != null ? `score=${lesson.score.toFixed(1)}` : "score=?";
    console.log(`\n  ${i + 1}. ${outcome} [${score}] ${lesson.sourceType || "?"} — ${date}`);
    console.log(`     ${lesson.rule}`);
    if (lesson.tags?.length) console.log(`     tags: ${lesson.tags.join(", ")}`);
    if (lesson.role) console.log(`     role: ${lesson.role}`);
  }
}

if (presets.length > 0) {
  console.log("\n\n⚙️  SHARED PRESETS");
  console.log("───────────────────────────────────────────────────────────────");
  for (const [i, preset] of presets.entries()) {
    console.log(`\n  ${i + 1}. ${preset.name || preset.id || "(unnamed)"}`);
    if (preset.description) console.log(`     ${preset.description}`);
    if (preset.config) console.log(`     config: ${JSON.stringify(preset.config).slice(0, 200)}`);
  }
} else {
  console.log("\n(No presets cached. They appear when the hive publishes them.)");
}

console.log("\n═══════════════════════════════════════════════════════════════");
