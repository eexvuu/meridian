# Paper Trading Mode

Paper trading mode = mode simulasi yang aktif saat `DRY_RUN=true`. Bot menjalankan **flow lengkap** (screening, deploy, manage, close) tapi tidak menyentuh wallet. Semua "posisi" disimpan di file terpisah dan PnL-nya dihitung dari harga pool real-time.

---

## 1. Cara Mengaktifkan

Paper trading aktif **otomatis** saat `DRY_RUN=true`. Cek dua tempat:

**`.env`:**
```env
DRY_RUN=true
```

**`user-config.json`:**
```json
{
  "dryRun": true
}
```

Restart bot setelah ubah. Saat startup, akan muncul log seperti:
```
[STATE] Tracked new position: paper_xxxx in pool ...
[PAPER_DEPLOY] Tracked paper position paper_xxxx... in MONET-SOL ...
```

Notifikasi Telegram juga diprefix `[PAPER]` agar mudah dibedakan dari live.

---

## 2. Cara Menjalankan untuk Test Mingguan

### Lokal (untuk dev singkat)
```bash
npm run dev
```
Hanya jalan selama terminal terbuka.

### VPS dengan PM2 (persistent, untuk seminggu penuh)
```bash
# pastikan dryRun=true di config + .env, lalu:
pm2 start npm --name "meridian-paper" -- start
pm2 logs meridian-paper        # lihat aktivitas
pm2 stop meridian-paper        # hentikan
pm2 restart meridian-paper     # restart
```

Recommended timing untuk test seminggu:
- `managementIntervalMin: 5` (default) — cek posisi tiap 5 menit
- `screeningIntervalMin: 10` — screening baru tiap 10 menit
- `maxPositions: 3` — paralel max 3 posisi

---

## 3. File yang Dibuat (Paper-Specific)

Semua file paper trading **tidak akan menyentuh** state asli kamu (state.json, lessons.json, pool-memory.json), jadi aman switch ke live nanti.

| File | Isi | Sama seperti (di live) |
|------|-----|------------------------|
| `paper-state.json` | Posisi paper (open + closed), bin range, OOR clock, peak PnL | `state.json` |
| `paper-lessons.json` | History performance + lesson auto-derived | `lessons.json` |
| `paper-pool-memory.json` | Per-pool deploy history (PnL, efficiency) | `pool-memory.json` |
| `decision-log.json` | Keputusan deploy/close dengan alasan (shared dgn live) | `decision-log.json` |
| `logs/` | Daily log files (shared) | `logs/` |

Semua paper-* di-gitignore.

---

## 4. Cara Baca Hasil Setelah Seminggu

### A. Quick stats via REPL/CLI

Dengan bot jalan, kirim ke Telegram atau pakai REPL:
```
/positions             # posisi paper terbuka sekarang
performance summary    # ringkasan win/loss
```

### Paling cepat — script `test/paper-stats.js`

Kapanpun (gak ganggu bot yang lagi jalan), pakai:
```powershell
cross-env DRY_RUN=true node test/paper-stats.js
```
atau di bash:
```bash
DRY_RUN=true node test/paper-stats.js
```

Output mencakup:
- Open paper positions dengan real-time simulated PnL, status in-range/OOR, age, peak PnL
- Closed positions stats: win rate, total PnL, total fees, avg hold time, avg range efficiency
- Distribution close_reason (TP, SL, OOR, low yield, dll)
- Top 5 winners + worst 5 losers
- Breakdown per strategy (spot vs bid_ask)

### B. Manual dari file

**Performance ringkas:**
```bash
# Total posisi closed
jq '.performance | length' paper-lessons.json

# Win rate
jq '.performance | (map(select(.pnl_pct > 0)) | length) / length * 100' paper-lessons.json

# Avg PnL
jq '.performance | map(.pnl_pct) | add / length' paper-lessons.json

# Distribusi close_reason
jq '.performance | group_by(.close_reason) | map({reason: .[0].close_reason, count: length})' paper-lessons.json
```

**Decision log review:**
```bash
# 10 keputusan terakhir
jq '.decisions[0:10]' decision-log.json
```

**Per-pool stats:**
```bash
jq '. | to_entries | map({pool: .key, deploys: .value.deploys | length, avg_pnl: (.value.deploys | map(.pnl_pct) | add / length)})' paper-pool-memory.json
```

### C. Log scan

```bash
# Semua paper deploys minggu ini
grep PAPER_DEPLOY logs/*.log

# Semua paper closes + alasan
grep PAPER_CLOSE logs/*.log

# Safety blocks (model error / arg salah)
grep SAFETY_BLOCK logs/*.log
```

---

## 5. Apa yang Disimulasi

### Yang Akurat
- ✅ **Screening logic** — semua filter (TVL, fee/TVL, organic, holders, dll) jalan sesuai live
- ✅ **Bin range calculation** — sesuai volatility, sama dengan live formula
- ✅ **Safety checks** — duplicate pool, blacklist, cooldown, max positions
- ✅ **Decision logic** — STOP_LOSS, TRAILING_TP, OOR detection, LOW_YIELD
- ✅ **Lessons & evolution** — bot tetap belajar dari paper performance (di paper-lessons.json saja)
- ✅ **Telegram notif** — tetap masuk dengan prefix `[PAPER]`

### Yang Estimasi/Approximation
- ⚠️ **Fee accrual** — linear: `fee_active_tvl_ratio / 1440 × amount_sol × minutes_in_range`.
  Tidak hitung volume tick-by-tick. Cenderung sedikit overestimate kalau pool aktivitas turun.
- ⚠️ **Impermanent loss** — triangular approximation untuk single-side SOL bid_ask:
  - Price ≥ entry bin: position tetap 100% SOL
  - Price drop in-range: linear conversion SOL → token
  - Price < lower_bin: 100% token, IL = `current/avg_buy - 1`
- ⚠️ **minutes_in_range** — pakai `minutes_held - current_OOR_duration`. Period OOR historis yang sudah back-in-range tidak terhitung (bisa over-count time-in-range untuk posisi yang flap).
- ⚠️ **Active bin detection** — derive dari `current_price/entry_price` ratio, bukan dari SDK active bin saat ini (1 fetch per tick lebih murah)

### Yang TIDAK Disimulasi
- ❌ Gas fees / priority fees (live = ~0.0005 SOL per tx)
- ❌ Slippage saat entry/exit
- ❌ Pool TVL impact dari deploy kita (untuk pool kecil)
- ❌ Front-running / MEV
- ❌ Failed transactions / retry behavior

**Bottom line:** akurasi cukup untuk **ranking strategi & win-rate kasar**. Exact PnL number ±15-20%.

---

## 6. HiveMind Behavior di Paper Mode

- ✅ **Pull lessons** dari hive jalan normal (bot tetap belajar dari komunitas)
- ❌ **Push lessons** dari paper data **dimatikan otomatis** (gak polusi hive)
- ❌ **Push performance event** dimatikan otomatis
- ❌ **evolveThresholds** dimatikan — paper data tidak akan menulis ke `user-config.json`

Ini disengaja: paper data adalah simulasi, gak fair kalau ikut nge-tune live thresholds atau hive collective.

---

## 7. Cara Switch ke Live Setelah Test

Setelah seminggu, kalau hasil paper bagus:

1. **Backup paper data dulu** (kalau mau review nanti):
   ```bash
   mkdir -p paper-archive-$(date +%Y%m%d)
   cp paper-*.json paper-archive-*/
   ```

2. **Ubah config:**
   - `.env` → `DRY_RUN=false`
   - `user-config.json` → `"dryRun": false`

3. **Top-up wallet** — saat dry-run, wallet 0 SOL pun bot bisa "deploy". Saat live, kamu butuh:
   - Minimum: `minSolToOpen + gasReserve` = 0.35 + 0.2 = **0.55 SOL** (default config kamu)
   - Recommended: 2-3 SOL biar ada compounding room

4. **Restart bot.** Pastikan log menunjukkan `DRY_RUN: false` saat startup.

5. **Live mode aktif.** Posisi baru ditulis ke `state.json` (bukan paper-state.json), perf dicatat di `lessons.json`, dll. Paper files tetap ada sebagai arsip.

---

## 8. Troubleshooting

### "Saya gak lihat paper position muncul setelah deploy"
- Cek `DRY_RUN=true` di env: `node -e "require('dotenv').config(); console.log(process.env.DRY_RUN)"`
- Cek `paper-state.json` ada: `ls -la paper-state.json`
- Cek log: `grep paper_deploy logs/*.log`

### "PnL terlihat aneh / negatif besar di 0 menit"
- Biasa terjadi kalau `entry_price` di paper-state.json menggunakan unit yang salah. Hapus paper-state.json + restart, deploy ulang.
- Cek log paper_deploy untuk `entry=0.0000xxxx SOL` — kalau angkanya wajar untuk token tersebut (cek di Birdeye), simulasi benar.

### "Bot deploy terus tanpa close"
- Kemungkinan posisi paper jarang trigger TP/SL/OOR dalam waktu pendek. Sabar — di test seminggu biasanya 10-30 close events terjadi.
- Cek `paper-state.json` → `out_of_range_since` field di positions: kalau null padahal harga jauh dari range, simulasi bug.

### "Win rate 100% atau 0% — tidak realistis"
- Sample size terlalu kecil (< 10 closed positions). Tunggu lebih lama.
- Pool yang dipilih terlalu satu jenis (semua sukses) atau bot di blacklist semua (semua block).

---

## 9. Smoke Tests (untuk verify setup masih jalan)

```bash
# Cek MiniMax API + config loading
node test/smoke-minimax.js

# Cek HiveMind connectivity + agent registered
node test/smoke-hivemind.js

# Cek paper trading lifecycle (deploy → PnL → close)
DRY_RUN=true node test/smoke-paper-trading.js
```

Ketiganya harus exit dengan `SUCCESS — ...`. Kalau salah satu fail, cek log untuk error spesifik.

---

## 10. Catatan Implementasi

Untuk maintenance / debugging:

| Komponen | File | Fungsi kunci |
|----------|------|--------------|
| Module utama | `paper-trading.js` | `computePaperPnl`, `buildPaperTrackArgs`, `computePaperCloseResult` |
| State separation | `state.js:14` | `STATE_FILE` env-aware |
| Lesson separation | `lessons.js:18-19` | `LESSONS_FILE` + `IS_DRY_RUN` guards |
| Pool memory separation | `pool-memory.js:12` | `POOL_MEMORY_FILE` env-aware |
| Deploy hook | `tools/dlmm.js` `deployPosition` DRY_RUN branch | trackPosition + appendDecision |
| getMyPositions hook | `tools/dlmm.js` `getMyPositions` paper branch | iterate paper state + computePaperPnl |
| getPositionPnl hook | `tools/dlmm.js` `getPositionPnl` paper branch | single-position computePaperPnl |
| Close hook | `tools/dlmm.js` `closePosition` DRY_RUN branch | computePaperCloseResult + recordPerformance + recordClose |
| Telegram label | `tools/executor.js:597` | `paperPrefix` di notify |

Semua keputusan dijaga konsisten: paper mode tidak boleh menulis ke file live (state.json/lessons.json/pool-memory.json/user-config.json), tidak boleh push ke hive, tidak boleh trigger on-chain transaction.
