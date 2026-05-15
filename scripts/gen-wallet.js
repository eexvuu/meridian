/**
 * Generates a fresh Solana keypair for demo / DRY_RUN use.
 * Run: node scripts/gen-wallet.js
 *
 * Prints public address + base58 private key. Copy the private key
 * into your .env as WALLET_PRIVATE_KEY (or paste it into the setup wizard).
 *
 * NEVER share the private key. NEVER fund a wallet you generated this way
 * unless you have backed up the private key somewhere safe.
 */

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const kp = Keypair.generate();
const privateKeyBase58 = bs58.encode(kp.secretKey);

console.log("\n╔═══════════════════════════════════════════════════════════╗");
console.log("║       Fresh Solana Wallet Generated (Demo / DRY_RUN)      ║");
console.log("╚═══════════════════════════════════════════════════════════╝\n");
console.log("Public address (safe to share):");
console.log(`  ${kp.publicKey.toBase58()}\n`);
console.log("Private key — base58 (KEEP SECRET, paste into wizard):");
console.log(`  ${privateKeyBase58}\n`);
console.log("⚠ Save the private key in a password manager BEFORE closing this terminal.");
console.log("⚠ For DRY_RUN you do NOT need to fund this wallet.\n");
