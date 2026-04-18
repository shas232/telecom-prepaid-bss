# Telecom Prepaid BSS — Node Workflow Runner

Three workflow scripts run as Node scripts (auto-builder API rejects PATs).

## Scripts

| Script | Purpose | Cadence |
|---|---|---|
| `loyalty-accrual.mjs` | Earn loyalty points per Recharge/Order, tier customers | Daily |
| `commission-settlement.mjs` | Flip Pending Settlement → Settled, group by partner | Weekly (Monday) |
| `fraud-scan.mjs` | Run 4 fraud rules, write Fraud Alerts | Every 15 min |
| `seed-fraud-demo.mjs` | One-off: seed fraud-triggering demo data | Manual |

All are idempotent — safe to re-run.

## Running manually

```bash
cd "/Users/shas232/Desktop/Projects/Telco billing system"
node scripts/loyalty-accrual.mjs
node scripts/commission-settlement.mjs          # production run
node scripts/commission-settlement.mjs --dry-run   # preview
node scripts/fraud-scan.mjs
```

## Scheduling via launchd (macOS)

On macOS use `launchd` (user LaunchAgents) — `crontab` is deprecated for user jobs.

Plist files live at `~/Library/LaunchAgents/com.telecom.<name>.plist` for all 6
workflows: `fraud-scan`, `compute-counters`, `loyalty-accrual`, `plan-expiry`,
`period-rollover`, `commission-settlement`.

```bash
# Install / (re)load all 6:
ls ~/Library/LaunchAgents/com.telecom.*.plist  # verify 6 files
for n in fraud-scan compute-counters loyalty-accrual plan-expiry period-rollover commission-settlement; do
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
| `loyalty-accrual` | daily 02:00 |
| `plan-expiry` | daily 03:00 |
| `period-rollover` | daily 04:00 |
| `commission-settlement` | weekly Monday 05:00 |

### Legacy: cron (not recommended on macOS)

```cron
*/15 * * * * cd "/Users/shas232/Desktop/Projects/Telco billing system" && /usr/bin/env node scripts/fraud-scan.mjs >> /tmp/telco-fraud-scan.log 2>&1
0 2 * * *    cd "/Users/shas232/Desktop/Projects/Telco billing system" && /usr/bin/env node scripts/loyalty-accrual.mjs >> /tmp/telco-loyalty.log 2>&1
0 5 * * 1    cd "/Users/shas232/Desktop/Projects/Telco billing system" && /usr/bin/env node scripts/commission-settlement.mjs >> /tmp/telco-commission.log 2>&1
```

## Scheduling via ERPAI auto-builder (when PAT scope is fixed)

Per `HANDOFF.md` §4.3, `/v1/auto-builder/workflows` currently rejects PATs with 403.
When backend adds that scope, these Node scripts can be replaced with native ERPAI
workflows by porting the logic via the `build-workflow` skill.

## Credentials

Token + base URL are hard-coded at the top of each script. Rotate via:
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
