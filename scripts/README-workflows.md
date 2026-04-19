# Telecom Prepaid BSS — Node Workflow Runner

Workflows run as Node scripts (auto-builder API rejects PATs).

## Scripts

| Script | Purpose | Cadence |
|---|---|---|
| `loyalty-accrual.mjs` | Earn loyalty points per Recharge/Order, tier customers | Daily 02:00 |
| `commission-settlement.mjs` | Flip Pending Settlement → Settled, group by partner | Weekly Mon 05:00 |
| `fraud-scan.mjs` | Run 4 fraud rules, write Fraud Alerts | Every 15 min |
| `compute-counters.mjs` | Daily counter/stat rebuild | Daily 01:00 |
| `plan-expiry.mjs` | Expire plans, auto-renew, 3-day warnings | Daily 03:00 |
| `period-rollover.mjs` | Monthly cycle rollover | Daily 04:00 |
| `low-stock-alert.mjs` | Warehouse/batch SIM stock below reorder threshold → Notifications Sent | Daily 01:30 |
| `cdr-reconcile.mjs` | Compare Usage Transactions sum vs CDRs sum per sub per day; flag deltas > 5% | Daily 02:30 |
| `unbilled-cdr-report.mjs` | Find CDRs with units but no billed charges → JSON artifact + Cases | Daily 06:00 |
| `bulk-recharge.mjs` | Import recharges from CSV (`msisdn,amount,channel,reference_id`) | On-demand |
| `scheduled-reports.mjs` | Execute subscribed report SQL, write CSV/JSON under /tmp, roll next_run_at | Daily 06:30 |
| `shrinkage-recon.mjs` | Weekly SIM allocation variance per partner → Cases | Weekly Mon 07:00 |
| `seed-fraud-demo.mjs` | One-off: seed fraud-triggering demo data | Manual |

All are idempotent — safe to re-run.

## Running manually

```bash
cd "/Users/shas232/Desktop/Projects/Telco billing system"
node scripts/loyalty-accrual.mjs
node scripts/commission-settlement.mjs --dry-run
node scripts/fraud-scan.mjs
node scripts/low-stock-alert.mjs --dry-run
node scripts/cdr-reconcile.mjs --dry-run --date 2026-04-18
node scripts/unbilled-cdr-report.mjs --dry-run --days 7
node scripts/bulk-recharge.mjs --csv scripts/bulk-recharge-sample.csv --dry-run
node scripts/scheduled-reports.mjs --dry-run
node scripts/shrinkage-recon.mjs --dry-run
```

### bulk-recharge — on demand only (no schedule)

```bash
node scripts/bulk-recharge.mjs --csv /path/to/file.csv [--dry-run] [--batch-size 20] [--continue-on-error]
```

CSV header required: `msisdn,amount,channel,reference_id`.
`channel` may be a name (`Voucher|USSD|App|Retail POS|IVR|Online|Bank Transfer`) or its numeric id (1-7).
Ships with `scripts/bulk-recharge-sample.csv` (3 rows) as a starter.

## Scheduling via launchd (macOS)

On macOS use `launchd` (user LaunchAgents) — `crontab` is deprecated for user jobs.

Plist files live at `~/Library/LaunchAgents/com.telecom.<name>.plist`.
Loaded names: `fraud-scan`, `compute-counters`, `loyalty-accrual`, `plan-expiry`,
`period-rollover`, `commission-settlement`, `low-stock-alert`, `cdr-reconcile`,
`unbilled-cdr-report`, `scheduled-reports`, `shrinkage-recon` (11 total).
`bulk-recharge` has **no plist** — run on demand with a CSV.

```bash
# Install / (re)load all 11:
for n in fraud-scan compute-counters loyalty-accrual plan-expiry period-rollover \
         commission-settlement low-stock-alert cdr-reconcile unbilled-cdr-report \
         scheduled-reports shrinkage-recon; do
  launchctl load ~/Library/LaunchAgents/com.telecom.$n.plist
done

# List loaded:
launchctl list | grep telecom

# Check logs (stdout -> .log, stderr -> .err, both under /tmp):
tail -f /tmp/telecom-*.log

# Trigger one manually (ignores schedule, runs immediately):
launchctl start com.telecom.fraud-scan

# Uninstall all:
bash scripts/uninstall-schedulers.sh
```

### Cadence

| Workflow | Schedule |
|---|---|
| `fraud-scan` | every 15 min (`:00, :15, :30, :45`) |
| `compute-counters` | daily 01:00 |
| `low-stock-alert` | daily 01:30 |
| `loyalty-accrual` | daily 02:00 |
| `cdr-reconcile` | daily 02:30 |
| `plan-expiry` | daily 03:00 |
| `period-rollover` | daily 04:00 |
| `commission-settlement` | weekly Monday 05:00 |
| `unbilled-cdr-report` | daily 06:00 |
| `scheduled-reports` | daily 06:30 |
| `shrinkage-recon` | weekly Monday 07:00 |
| `bulk-recharge` | on-demand (no plist) |

## Scheduling via ERPAI auto-builder (when PAT scope is fixed)

Per `HANDOFF.md` §4.3, `/v1/auto-builder/workflows` currently rejects PATs with 403.
When backend adds that scope, these Node scripts can be replaced with native ERPAI
workflows by porting the logic via the `build-workflow` skill.

## Credentials

Token + base URL are hard-coded at the top of each script (or loaded from
`process.env.TOKEN` via `scripts/lib-common.mjs`). Rotate via:
```bash
BASE_URL=https://api.erpai.studio
TOKEN=<new_pat>
APP_ID=afe8c4540708da6ca9e6fe79
```

## Operational notes

- **Rate limit**: 60 req/min. Scripts sleep 100-200ms between writes + batch bulk up to 20.
- **Rollup evaluation**: formulas/rollups on Balances auto-compute; don't write to `used_amount` / `remaining_amount` directly. Write Usage Transactions and let rollups compute.
- **Ref format**: all `ref` column values must be `[uuid]` arrays, not bare strings.
- **Status values**: option-id arrays like `[1]`, not names. From ClickHouse they return as string `"[1]"` — compare accordingly.
