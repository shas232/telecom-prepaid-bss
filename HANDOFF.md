---
title: Telecom Prepaid Billing System — Agent Handoff
app_name: telecom
app_id: afe8c4540708da6ca9e6fe79
base_url: https://api.erpai.studio
last_working_token: erp_pat_live_REDACTED (REVOKED — need new one)
status: partial build — schema done, data seeded, core flow NOT executable end-to-end
---

# Telecom Prepaid Billing System — Handoff

## 1. The Goal

Build a **prepaid telecom Business Support System (BSS)** in ERPAI. The system models the business/data layer of a mobile operator:

- **Customers** buy **Tariff Plans** that give them **Balances** (data/voice/SMS).
- **Diameter CCR messages** arrive (simulated as JSON events) → land in **Usage Transactions** → decrement **Balances**.
- When a balance hits zero, service is blocked (FUI=Terminate). When under 20%, customer is alerted.
- **Wallet** holds prepaid cash. **Recharges** top it up. **Distribution Partners** earn 3% commission per recharge.

The user wants it built using **ERPAI-native primitives** — rollups for aggregation, formulas for derivation, lookups for pulling values, and workflows ONLY for cross-table record creation (plan purchase, recharge, new activation).

**Everything else — balance math, running totals, customer aggregates — should be automatic via rollup/formula/lookup columns, NOT workflow code.**

---

## 2. Current State — What's Actually Built

### 2.1 Schema (✅ done)

- **46 tables** across 11 categories in the `telecom` app
- **~350 basic columns** with proper types
- **63 reference columns** with `refTable.colId` set (ref cells display human-readable names, not UUIDs)
- **11 parent tables embed children as line items** (Orders → Order Items, Subscriptions → Balances/SPAs/Sessions, etc.)

### 2.2 Data Seeded (✅ done but HARDCODED — see §3)

Counts as of last check:
- 20 Customers + 20 KYC docs + 20 Lifecycle Events + 3 Family Hierarchies
- 27 Subscriptions + 27 Status History rows
- 47 MSISDN Pool entries (27 assigned + 20 available)
- 37 SIM Inventory (27 activated + 10 in stock)
- 5 Services, 3 base Tariff Plans + 2 booster Tariff Plans (+5GB Data, +200 min Voice), 11 Plan Allowances, 5 Rate Cards, 2 Tax Rates
- 27 base SPAs + 6 stacked booster SPAs = 33 Subscription Plan Assignments
- **87 Balances** (3 per sub for base + 6 for boosters)
- 20 Wallets, 12 Recharges, 32 Wallet Transactions, 30 Vouchers, 3 Balance Transfers
- **18 Charging Sessions + 237 Usage Transactions + 18 CDRs**
- 3 Promotions, 6 Redemptions, 5 Bonus Grants
- 3 Distribution Partners, 12 Commissions, 3 Contracts
- 5 Channels, 15 Customer Interactions, 8 Orders + 8 Order Items, 8 Cases
- 5 Notification Templates, 49 Notifications Sent
- 6 Business Rules, 2 F&F Groups + 6 Members, 1 CUG + 5 Members, 6 Network Elements

### 2.3 Dashboard (✅ done)

`custom-pages/balance-dashboard.html` is saved to ERPAI as **"Prepaid Customer Balances"** in the Overview sidebar. Shows 5 KPI cards, a usage chart, customer table with progress bars, and drill-down into Sessions + CCR events.

### 2.4 Simulator + Workflow Runner (⚠️ works but reads/writes plain number columns — see §3)

- `scripts/diameter-simulator.mjs` — generates realistic CCR-I/U/T sequences, currently writes `Used Amount` and `Remaining Amount` directly (because rollup is broken)
- `scripts/workflows.mjs` — 9 Node-based workflows (auto-builder API rejects PATs, so they run as Node scripts)

---

## 3. What's FAKE / Hardcoded / Not Working

**Be honest about this** — the previous agent (me) seeded the database to LOOK correct but the data flow is not actually live.

| What appears to work | What's actually happening |
|---|---|
| Balance.Used Amount = 898 MB | Simulator code hardcodes this value during CCR processing. Not a rollup. |
| Balance.Remaining Amount = 1150 MB | Simulator does `initial - used` in code and writes result. Not a formula. |
| Subscription.Current Plan = "Starter 2GB Pack" | One-time seed script ran and copied the value. Not a live ref. |
| Subscription.Data/Voice/SMS Remaining | Seeded with aggregated numbers. Not a rollup. No update when Balances change (except via manual workflow re-run). |
| Balance.Initial Amount = 2048 MB | Seed script read the Plan Allowance table and typed the number in. Not a lookup. If you change the Plan Allowance, existing Balances don't update. |
| Wallet got debited when plan was "purchased" | No — seed script manually inserted a negative Wallet Transaction. No real link between a plan purchase and the wallet debit. |
| Recharge → wallet credit + partner commission | The workflow runner (Node code) does this when invoked. Not an ERPAI workflow/rollup. |

**Current state: the database is a static snapshot, not a live data-flow system.** All the aggregation and derivation that SHOULD happen via rollup/formula/lookup is being done by seed scripts and simulator code.

---

## 4. Critical Blockers

### 4.1 PAT Token Revoked
- Last working token: `erp_pat_live_90ff5b...`
- Currently revoked. User tried issuing 3 new tokens today — all returned `"Invalid or revoked API key"` immediately on creation
- **Without a working token, no tables, columns, records, or workflows can be modified via API**
- Server itself is fine — other endpoints return proper 401 (not 500/timeout)
- Backend team needs to investigate PAT generation

### 4.2 Rollup Engine Flaky
- Tried converting `Balance.Used Amount` from a plain number column to a real rollup: `SUM(Usage Transactions.Used Amount)` via Balance ref
- Rollup **computed correctly ONCE** when a Usage Transaction was touched (updated to 2869 for BAL-1-DAT, matching real total)
- But on ANY subsequent update to the Balance (even empty `{cells:{}}`), the rollup value was **wiped back to null**
- Reverted to plain number columns as an interim workaround
- User committed to fixing the rollup engine — once stable, rollups and formulas should be used everywhere

### 4.3 Auto-Builder Workflow API Rejects PATs
- `/v1/app-builder/*` — PAT works ✅
- `/v1/agent/app/*` — PAT works ✅
- `/v1/auto-builder/nodes` — PAT works ✅
- `/v1/auto-builder/workflows` — PAT returns 403 ❌ (even with valid token)
- Session cookies work, PATs do not
- Workaround: workflows run as Node scripts (`scripts/workflows.mjs`)
- Backend needs to extend PAT scope to include `/v1/auto-builder/workflows`

---

## 5. The Target Architecture (what to build)

The user wants to **simplify the schema** and use **ERPAI-native primitives** for all data flow. Only use workflows for multi-table orchestration.

### 5.1 Simplifications requested

**Delete these tables (flatten into parent tables):**
- ❌ `Plan Allowances` — put `data_mb`, `voice_min`, `sms_count`, overage rates/actions as columns directly on `Tariff Plans`
- ❌ `Subscription Plan Assignments` — put `effective_from`, `effective_to`, `price_paid`, `activation_source` directly on `Balances`
- ❌ `Rate Cards` — put overage rates on `Tariff Plans`, add `payg_rate` on `Services`
- ❌ `Tax Rates` — hardcode one tax rate in Business Rules or app config (single-country MVP)
- ❓ `Product Offerings` — can merge into `Tariff Plans` (add `Description`, `Offering Type`, `Segment Eligibility` columns)

**Keep these tables:**
- ✅ `Tariff Plans` (expanded)
- ✅ `Balances` (expanded)
- ✅ `Services` (with PAYG rate)

**Optional further simplification** (user is weighing this):
- If plan-only model (no PAYG, no wallet overage): kill `Wallets`, `Wallet Transactions`, `Recharges`, `Recharge Vouchers` and have customers pay directly for plans
- If keeping wallet: merge `Recharges` INTO `Wallet Transactions` (as type=Recharge rows with extra columns)
- Keep `Wallets` separate for multi-currency/status tracking

### 5.2 Use rollup / formula / lookup for ALL of this (NO workflows)

#### On **Balances**
| Column | Type | Source | Notes |
|---|---|---|---|
| Used Amount | ROLLUP | SUM(Usage Transactions.Used Amount) via Balance ref | Replaces plain number col |
| Remaining Amount | FORMULA | `Initial Amount - Used Amount` | Replaces plain number col |
| Plan Name | LOOKUP | Tariff Plan ref → Plan Name | Show plan on balance row |
| Plan Price | LOOKUP | Tariff Plan ref → Price | Show what customer paid |

#### On **Subscriptions**
| Column | Type | Source | Notes |
|---|---|---|---|
| Plan Price | LOOKUP | Current Plan ref → Price | |
| Plan Validity | LOOKUP | Current Plan ref → Validity Days | |
| Total Charging Sessions | ROLLUP | COUNT(Charging Sessions) | |
| *Data/Voice/SMS Remaining* | rollup with filter (not supported yet) — keep as denorm plain number for now | | |

#### On **Charging Sessions**
| Column | Type | Source |
|---|---|---|
| Total Used Amount | ROLLUP | SUM(Usage Transactions.Used Amount) |
| Event Count | ROLLUP | COUNT(Usage Transactions) |
| Last Event Timestamp | ROLLUP | MAX(Usage Transactions.Timestamp) |

#### On **Customers**
| Column | Type | Source |
|---|---|---|
| Subscription Count | ROLLUP | COUNT(Subscriptions) |
| Wallet Balance | LOOKUP | Wallets ref → Current Balance |
| Total Cases | ROLLUP | COUNT(Cases) |
| Total Interactions | ROLLUP | COUNT(Customer Interactions) |

#### On **Tariff Plans**
| Column | Type | Source |
|---|---|---|
| Total Subscribers | ROLLUP | COUNT(Balances with this Tariff Plan ref) |

#### On **Distribution Partners**
| Column | Type | Source |
|---|---|---|
| Total Commission | ROLLUP | SUM(Partner Commissions.Commission Amount) |
| Total Recharges | ROLLUP | COUNT(Recharges) |
| Recharge Volume | ROLLUP | SUM(Recharges.Amount) |

#### On **Wallets**
| Column | Type | Source |
|---|---|---|
| Recharge Count | ROLLUP | COUNT(Recharges) |
| Total Recharged | ROLLUP | SUM(Recharges.Amount) |

#### On **Promotions**
| Column | Type | Source |
|---|---|---|
| Redemption Count | ROLLUP | COUNT(Promotion Redemptions) |
| Value Given | ROLLUP | SUM(Promotion Redemptions.Value Granted) |

### 5.3 Only 3 workflows needed

These require cross-table record creation / updates — can't be done by rollup/formula.

#### Workflow 1: Plan Purchase
**Trigger:** Order created with Order Type = Plan Purchase

**Actions:**
1. Check `Wallet.Current Balance ≥ Tariff Plan.Price` → block if insufficient
2. Update `Wallet.Current Balance -= price`
3. Insert `Wallet Transactions` row (type=Plan Purchase, amount=-price)
4. Read `Tariff Plan.data_mb / voice_min / sms_count` (after flattening)
5. Insert 3 `Balance` rows (Initial Amount from Tariff Plan, Used/Remaining auto-compute via rollup+formula)
6. Update `Subscription.Current Plan` = this Tariff Plan ref
7. Send PLAN_ACTIVATED notification

#### Workflow 2: Recharge Processing
**Trigger:** Recharge created with Status = Successful

**Actions:**
1. Update `Wallet.Current Balance += amount`
2. Insert `Wallet Transactions` row (type=Recharge, amount=+amount)
3. Insert `Partner Commissions` row (3% of amount)
4. If voucher-based → mark `Recharge Voucher.Status = Redeemed`
5. Send RECHARGE_OK notification

#### Workflow 3: New Subscription Activation
**Trigger:** Order created with Order Type = New Activation

**Actions:**
1. Check `Customer.KYC Status = Verified` → block if not
2. Pick Available MSISDN from Pool → flip to Assigned + link to new Subscription
3. Pick In-Stock SIM from Inventory → flip to Activated + link to new Subscription
4. Insert `Subscriptions` row
5. Insert `Wallets` row if customer has no wallet
6. Insert `Customer Lifecycle Events` + `Subscription Status History` rows
7. Send WELCOME_SMS
8. If Order has a Tariff Plan → trigger Workflow 1

### 5.4 Optional scheduled workflows (nice-to-have)

- **Depletion / Low balance alerts** — every 15 min scan Balances where Remaining/Initial < 0.2
- **Plan expiry warning** — daily scan Balances where Effective To is within 3 days
- **Plan expiry enforcement** — daily flip Status=Expired on balances past Effective To, attempt auto-renewal
- **Partner commission settlement** — weekly aggregate + flip Status=Settled
- **Fraud velocity check** — every 15 min flag subs with >5 recharges/hour

---

## 6. What's Done vs. What's Left

### ✅ Done
1. PLAN.md written (470 lines, sales-crm.md style) — `/Users/shas232/Desktop/Projects/Telco billing system/PLAN.md`
2. 46 tables created via API with 11 categories
3. ~350 basic columns created with correct ERPAI types (boolean, email, phone, url, multi-select, currency:true, etc.)
4. 63 reference columns wired with `refTable.colId` set correctly (UI displays names)
5. Line items wired on 11 parent tables via entry-form `type: "table"` fields
6. Audit Log table deleted (user didn't want it)
7. 87 Balances seeded with Initial/Used/Remaining values (HARDCODED — needs to become rollup+formula)
8. 237 Usage Transactions seeded from simulator runs
9. MSISDN Pool + SIM Inventory backfilled so pool/inventory is the actual source
10. Current Plan ref column added + populated on all 27 Subscriptions
11. Data/Voice/SMS Remaining number columns added + populated on Subscriptions (denormalized)
12. Verification Method column added on Customer Identifications
13. Diameter simulator built — generates realistic CCR sequences, handles booster priority depletion
14. 2 Booster Tariff Plans added + stacked on 6 subscriptions
15. 9 Node-based workflows written (`scripts/workflows.mjs`) — Welcome, Recharge, Low Balance, Depleted, Plan Expiring, KYC Verify, Activate Subscription, Plan Purchase, Summary Refresh
16. Dashboard built + saved to ERPAI custom-pages (`custom-pages/balance-dashboard.html`)

### ❌ Left / Broken

**IMMEDIATE BLOCKERS (do these first):**
1. **Get a working PAT** — user needs to generate a PAT that actually works. Backend team needs to investigate why newly-issued PATs are rejected.
2. **Wait for rollup engine fix** — user committed to fixing it. Without stable rollups, the simplification can't happen.

**SCHEMA SIMPLIFICATION (once token works):**
3. Add flattened columns to `Tariff Plans`: `data_mb`, `voice_min`, `sms_count`, `data_overage_rate`, `voice_overage_rate`, `sms_overage_rate`, `data_overage_action`, `voice_overage_action`, `sms_overage_action`
4. Add flattened columns to `Balances`: `effective_from`, `effective_to`, `price_paid`, `activation_source`
5. Add `Tariff Plan` ref column to Balances (replaces SPA ref)
6. Add `payg_rate` column to `Services`
7. Migrate data from `Plan Allowances` → `Tariff Plans` columns
8. Migrate data from `Subscription Plan Assignments` → `Balances` columns
9. Migrate data from `Rate Cards` → `Tariff Plans` + `Services`
10. Delete: `Plan Allowances`, `Subscription Plan Assignments`, `Rate Cards`, `Tax Rates`, optionally `Product Offerings`

**ROLLUP / FORMULA / LOOKUP COLUMNS (once rollup engine works):**
11. Convert `Balance.Used Amount` → ROLLUP (SUM of Usage Transactions.Used Amount via Balance ref)
12. Convert `Balance.Remaining Amount` → FORMULA (`Initial Amount - Used Amount`)
13. Add lookups on Balances: Plan Name, Plan Price
14. Add lookups on Subscriptions: Plan Price, Plan Validity
15. Add rollups on Charging Sessions: Total Used Amount, Event Count, Last Event Timestamp
16. Add rollups on Customers: Subscription Count, Total Cases, Total Interactions
17. Add lookup on Customers: Wallet Balance (from Wallet ref)
18. Add rollups on Tariff Plans: Total Subscribers
19. Add rollups on Distribution Partners: Total Commission, Total Recharges, Recharge Volume
20. Add rollups on Wallets: Recharge Count, Total Recharged
21. Add rollups on Promotions: Redemption Count, Value Given

**WORKFLOWS (once auto-builder API accepts PATs OR using Node runner):**
22. Workflow 1: Plan Purchase (cross-table: Wallet debit + Balance creation + Subscription update + notification)
23. Workflow 2: Recharge Processing (cross-table: Wallet credit + Partner Commission + Voucher mark + notification)
24. Workflow 3: New Subscription Activation (cross-table: KYC check + MSISDN/SIM allocation + Subscription/Wallet/Lifecycle Event creation)
25. Optional: Depletion alert scheduled every 15 min
26. Optional: Plan expiry enforcement + auto-renewal daily
27. Optional: Partner commission settlement weekly

**SIMULATOR + DASHBOARD UPDATES (once simplification done):**
28. Update Diameter simulator — remove explicit writes to `Used Amount` and `Remaining Amount` (those become rollup/formula). Only insert Usage Transactions.
29. Update dashboard SQL — adapt to new schema (no SPAs, no Plan Allowances)
30. Delete obsolete seed scripts: `seed-supporting.mjs` (table-specific seeds that will no longer exist), rollup experiment scripts

---

## 7. Known ERPAI Gotchas (keep in mind)

| Area | Gotcha | Workaround |
|---|---|---|
| Ref column display | UI uses `refTable.colId`, NOT `refColumnId` (skill docs were wrong) | Set `refTable.colId` via PUT on each ref col |
| Rollup backlink | In `variablePath`, use the **forward ref column ID on the source table** (not the related_ref ID on parent) | E.g. for Balances rollup of Usage Transactions, use Usage Transactions.Balance column ID |
| Rollup filtering | No SUMIF — rollups can't filter by a condition | Use denormalized columns updated by workflows for per-bucket aggregates |
| Rollup evaluation trigger | Needs `{sessionId, filter:{ids:[...]}}` body — not just `{}` | Discovered via verbose curl |
| Column type changes | Can't change type after creation — must delete and recreate | Column ID changes, rollups that referenced the old column break |
| `boolean` column value | Use native `true`/`false`, NOT `"__YES__"`/`"__NO__"` | |
| `currency` option | Set `currency: true`, NOT `{code, symbol}` | |
| Select options | Must include `id` field (sequential integers) when creating in bulk | |
| Column delete | Use `DELETE /column/:colId` one-by-one. Bulk-delete body endpoint 404s | |
| Record ID extraction | After POST to `/record`, ID is at `.data[0]._id`, NOT `.data._id` | |
| Response shape of runSQL | Returns `{rows, fields, rowCount}` — access `.rows` | |
| PAT scope | Does NOT include `/v1/auto-builder/workflows` — returns 403 | Either fix PAT scope or use Node workflow runner |

---

## 8. File Manifest

```
/Users/shas232/Desktop/Projects/Telco billing system/
├── PLAN.md                              ← original 470-line spec (sales-crm.md style)
├── HANDOFF.md                           ← this file
├── .table-ids.json                      ← map of all 46 tables → their IDs (critical for scripts)
├── .seed-ids.json                       ← IDs of seeded records (services, partners, tariffs, etc.)
├── .schema-audit.json                   ← snapshot of column metadata per table
├── custom-pages/
│   ├── balance-dashboard.html           ← live dashboard page (saved to ERPAI custom-pages)
│   └── runtime/                         ← erpai-pages-runtime.js/css (from build-page skill)
└── scripts/
    ├── env.sh                           ← BASE_URL / TOKEN / APP_ID (TOKEN is revoked)
    ├── 01-create-tables.sh              ← creates 45 tables
    ├── 02-create-columns.sh             ← bulk-creates basic columns
    ├── 02b-cleanup-dupes.sh             ← removes duplicate columns from partial runs
    ├── 02c-aggressive-dedup.sh          ← more aggressive dedup
    ├── 03-set-primary-columns.sh        ← attempt at setting primary display col
    ├── 03b-fix-ref-display.sh           ← fixes refTable.colId on all 63 refs
    ├── 04-create-references.sh          ← wires all 63 ref columns
    ├── 00-wipe-seed-data.sh             ← wipes all records (keeps schema)
    ├── 05-seed-data.sh                  ← original shell seed (superseded by Node)
    ├── seed.mjs                         ← clean Node seed script (currently uses hardcoded token)
    ├── seed-supporting.mjs              ← seeds 27 supporting tables (KYC, recharges, cases, etc.)
    ├── seed-boosters.mjs                ← adds 2 booster plans + stacks on 6 subs
    ├── 06-wire-line-items.mjs           ← configures entry forms with embedded child tables
    ├── phase-2-schema-fixes.mjs         ← MSISDN/SIM backfill, Current Plan col, KYC method col
    ├── phase-2b-balance-summary.mjs     ← Data/Voice/SMS Remaining cols on Subscriptions
    ├── phase-2c-rollup-balance.mjs      ← attempted rollup conversion for Balances (reverted)
    ├── phase-2d-backfill-balances.mjs   ← backfilled Used/Remaining from Usage Transactions
    ├── phase-2e-repop-current-plan.mjs  ← re-populated Current Plan after column rebuild
    ├── balance-rollup.mjs               ← rollup conversion attempt (failed, reverted)
    ├── diameter-simulator.mjs           ← CCR event generator with priority-order depletion
    └── workflows.mjs                    ← 9 Node-based workflows (KYC/activate/purchase/welcome/recharge/lowbal/depleted/expiring/summary)
```

---

## 9. User's Mindset — Read This

The user is a domain expert (telecom billing) and is skeptical of over-engineering. They push back when:
- You build workflows for things that should be rollups/formulas
- You create tables for things that can be columns
- You claim something works when it's actually hardcoded
- You use technical jargon to obscure what's actually happening

**Be brutally honest.** If something is hardcoded/faked/not-yet-working, say so. If a table feels redundant, justify it or agree to cut it. If the user says "that seems over-engineered," they're usually right.

**Their priorities (in order):**
1. Data correctness — the database should be the source of truth, not seed scripts
2. Simplicity — fewer tables, fewer workflows, more rollups/formulas/lookups
3. End-to-end flow — plan purchase → balance creation → CCR → balance decrement — should all happen automatically
4. Everything visible in UI without drilling — they want key numbers as columns, not buried in line items

---

## 10. Recommended Next Steps (in order)

1. **Get a working PAT** from the user. Test it on `/v1/app-builder/app` first before doing anything else. If the new token is also rejected, stop and escalate to backend team.

2. **Confirm rollup engine is stable** — user said they're fixing it. Before doing the big simplification, test: add a test rollup column on Balances, insert a Usage Transaction, verify the rollup value persists after multiple updates. If it still clears on parent update, don't proceed with rollup conversion yet.

3. **Execute the simplification** (§5.1):
   - Add new columns to Tariff Plans, Balances, Services
   - Migrate data
   - Delete the 4-5 obsolete tables
   - Re-populate Current Plan on Subscriptions

4. **Add all rollup/formula/lookup columns** (§5.2). Test each one by inserting a new Usage Transaction or modifying a Tariff Plan and watching the downstream columns update.

5. **Build the 3 workflows** (§5.3). Use Node runner if auto-builder API still rejects PATs.

6. **Update simulator + dashboard** to use new schema. Remove explicit `Used Amount` writes — let rollups do it.

7. **Verify end-to-end flow**:
   - Create a new Order with Type=Plan Purchase → Workflow 1 fires → Wallet debited, Balances created
   - Simulator generates a CCR → Usage Transaction inserted → Balance.Used auto-increments via rollup → Balance.Remaining auto-decrements via formula
   - Run more CCRs until Remaining = 0 → Depletion workflow flips Status and sends SMS
   - Recharge the customer → Workflow 2 fires → Wallet credited, Partner Commission accrued

**Do NOT re-seed data from scratch.** The 20 customers, 27 subs, 237 CCR events etc. are fine. Just migrate the schema and the data flow.

---

## 11. One Last Honest Admission

The previous agent (me) built a system that **looks complete in the UI** because all 46 tables have data in them. But that data was typed in by scripts, not produced by the relationships the tables imply.

**The user is asking for the relationships to actually function.** That's what the rollup/formula/lookup simplification achieves. Once that's done, the system becomes real:
- You change a Tariff Plan's data allowance → all future Balances created from it get the new value (via workflow reading the column)
- A new Usage Transaction arrives → Balance.Used auto-updates → Remaining auto-updates → Subscription summary updates → dashboard reflects it
- Nothing has to be manually re-seeded or re-synced

That's the goal. That's what to build next.
