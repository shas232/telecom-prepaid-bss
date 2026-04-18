# Prepaid Telecom Billing System — App Plan

**App:** `telecom` · **Platform:** ERPAI · **Scope:** Prepaid BSS (Business Support System)
**Status:** 46 tables built · ~350 columns · 63 references wired · data seeded · core flow pending rollup/workflow conversion

---

## 1. What This App Does

A prepaid mobile operator's **business + data layer** — everything behind the network that decides "can this subscriber use this service, and what does it cost?"

**Core promise:** Pay-before-use with real-time enforcement.

1. Customer loads money → **Wallet**
2. Customer buys a **Tariff Plan** → gets **Balances** (data MB, voice min, SMS count)
3. Every call/data session/SMS arrives as a **Diameter CCR event** → lands in **Usage Transactions** → decrements **Balances** in real time
4. When a bucket hits zero → service blocked (FUI=Terminate) or charged from wallet
5. Retail **Distribution Partners** sell recharges + vouchers → earn commission

**Out of scope:** Postpaid invoicing, dunning, credit scoring, physical Diameter stack (CCRs simulated as JSON events).

---

## 2. Architecture at a Glance

```
┌───────────────── Channels ─────────────────┐
│  App · USSD · IVR · Retail POS · Web · SMS │
└─────────────────────┬──────────────────────┘
                      │
┌─────────────────── CRM / Self-Care ─────────────────┐
│   Customer · Subscription · Wallet · Cases · Orders │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────── Catalog & Rating ─────────────┐
│ Tariff Plans · Allowances · Rate Cards · Tax │
└─────────────────────┬────────────────────────┘
                      │
┌──────────── Online Charging (DOCS) ──────────┐
│   Balances · Charging Sessions · Usage Txns  │
│        ↑ fed by Diameter CCR events          │
└─────────────────────┬────────────────────────┘
                      │
┌──────────────── Retail Partner ──────────────┐
│  Partners · Recharges · Vouchers · Commission│
└──────────────────────────────────────────────┘
```

---

## 3. Schema — Tables by Category

### 3.1 Customers & Identity

| Table | Purpose | Key Fields |
|---|---|---|
| **Customers** | Legal entity owning subscriptions | `customer_id`, `name`, `email`, `phone`, `customer_type`, `segment`, `status`, `kyc_status`, `lifetime_value` |
| **Customer Identifications** | KYC documents (Aadhaar, passport, etc.) | `id_type`, `id_number`, `issuing_authority`, `expiry_date`, `verified`, `scan_url` |
| **Customer Lifecycle Events** | Immutable audit of state transitions | `event_type`, `event_date`, `reason`, `triggered_by`, `previous_status`, `new_status` |
| **Account Hierarchy** | Parent-child (family head / corp master) | `parent_customer`, `child_customer`, `relationship_type`, `billing_responsibility` |

### 3.2 Subscriptions & Network Resources

| Table | Purpose | Key Fields |
|---|---|---|
| **Subscriptions** | SIM/MSISDN owned by a customer | `msisdn`, `imsi`, `iccid`, `customer`, `status`, `activation_date`, `roaming_enabled` |
| **Subscription Status History** | Audit of subscription state changes | `subscription`, `from_status`, `to_status`, `changed_at`, `reason` |
| **MSISDN Pool** | Inventory of phone numbers | `msisdn`, `status` (available/reserved/assigned/quarantined), `tier` (standard/gold/vanity) |
| **SIM Inventory** | Physical SIM cards | `iccid`, `imsi`, `ki_encrypted`, `batch_id`, `vendor`, `status`, `allocated_to_partner` |

### 3.3 Product Catalog

| Table | Purpose | Key Fields |
|---|---|---|
| **Services** | Billable primitives (data, voice on/off-net, SMS) | `service_code`, `service_family`, `default_rating_group`, `unit_type` |
| **Product Offerings** | Marketing-facing plan names | `offering_code`, `offering_name`, `offering_type`, `base_price`, `validity_days`, `renewal_type` |
| **Bundles** | Named combinations of offerings | `bundle_code`, `bundle_price`, `discount_vs_components` |
| **Bundle Components** | Line items of a bundle | `bundle`, `offering`, `quantity`, `sequence` |
| **Tariff Plans** | Instantiated, buyable plan | `plan_code`, `price`, `plan_type`, `validity_days`, `auto_renew_default`, `priority_on_charge` |
| **Plan Allowances** | What a plan gives, per rating group | `tariff_plan`, `rating_group`, `unit_type`, `initial_amount`, `overage_action`, `overage_rate` |
| **Rate Cards** | PAYG pricing when no allowance applies | `rating_group`, `unit_type`, `price_per_unit`, `peak_off_peak`, `effective_from` |
| **Tax Rates** | VAT/GST per region | `tax_code`, `rate_percent`, `applies_to`, `region` |

### 3.4 Subscription Plans & Bonuses

| Table | Purpose | Key Fields |
|---|---|---|
| **Subscription Plan Assignments** | Link between subscription and active plans | `subscription`, `tariff_plan`, `effective_from`, `effective_to`, `renewal_count`, `status` |
| **Bonus Grants** | Ad-hoc free allowance (loyalty, compensation) | `subscription`, `rating_group`, `amount`, `granted_reason`, `expiry_date`, `consumed_amount` |

### 3.5 Wallet & Recharge

| Table | Purpose | Key Fields |
|---|---|---|
| **Wallets** | Monetary balance per customer | `customer`, `currency`, `current_balance`, `lifetime_recharge`, `lifetime_spend`, `status` |
| **Wallet Transactions** | Double-entry log of money movements | `wallet`, `transaction_type`, `amount`, `balance_before`, `balance_after`, `reference_id`, `timestamp` |
| **Recharges** | Top-up event | `wallet`, `amount`, `channel`, `distribution_partner`, `voucher_serial`, `status`, `tax_amount` |
| **Recharge Vouchers** | Pre-printed voucher inventory | `voucher_serial`, `pin_encrypted`, `denomination`, `status`, `allocated_to_partner`, `redeemed_date` |
| **Balance Transfers** | P2P gifting between subscriptions | `from_subscription`, `to_subscription`, `transfer_type`, `amount`, `fee`, `status` |

### 3.6 Real-Time Charging (DOCS Core)

| Table | Purpose | Key Fields |
|---|---|---|
| **Charging Sessions** | One row per Diameter Session-Id | `session_id`, `subscription`, `service_context_id`, `started_at`, `ended_at`, `termination_cause`, `total_used_amount` |
| **Usage Transactions** | One row per CCR message (source of truth) | `charging_session`, `message_type` (CCR-I/U/T/E), `request_number`, `rating_group`, `used_amount`, `granted_amount`, `result_code`, `raw_event` |
| **Balances** | Live remaining allowance per (sub × RG × plan) | `subscription`, `subscription_plan_assignment`, `rating_group`, `initial_amount`, `used_amount`, `remaining_amount`, `cycle_end`, `status` |
| **CDRs (Call Detail Records)** | Flattened post-session record | `charging_session`, `subscription`, `duration_seconds`, `total_octets`, `total_charged_from_allowance`, `total_charged_from_wallet` |

### 3.7 Promotions & Community

| Table | Purpose | Key Fields |
|---|---|---|
| **Promotions** | Campaigns (double data, BOGO, referral) | `promotion_code`, `type`, `eligibility_rules`, `start_date`, `end_date`, `total_budget` |
| **Promotion Redemptions** | Who redeemed what | `promotion`, `customer`, `subscription`, `value_granted`, `reference_transaction` |
| **F&F Groups / Members** | Friends & Family calling circles | `group_code`, `subscription` (owner), `special_rate_card`, `member_msisdn` |
| **CUG / CUG Members** | Closed User Groups (corporate, MVPN) | `cug_code`, `owner_customer`, `internal_rate_card`, `subscription`, `role` |

### 3.8 Retail Distribution

| Table | Purpose | Key Fields |
|---|---|---|
| **Distribution Partners** | Retail shops, dealers, app agents | `partner_code`, `partner_type`, `tier`, `commission_scheme`, `wallet_balance` (partner float) |
| **Partner Commissions** | Accrual ledger per recharge | `partner`, `recharge`, `commission_type`, `commission_amount`, `accrued_date`, `settlement_reference`, `status` |
| **Partner Contracts** | Legal agreements, SLAs | `partner`, `contract_number`, `effective_from`, `commission_structure`, `sla_targets` |

### 3.9 Interaction & Orders

| Table | Purpose | Key Fields |
|---|---|---|
| **Channels** | Registry of touchpoints | `channel_code`, `channel_type` (ussd/sms/ivr/app/web/retail), `operating_hours` |
| **Customer Interactions** | Unified touch log | `customer`, `channel`, `interaction_type`, `timestamp`, `outcome`, `csat_score` |
| **Orders** | Activations, plan purchases, ports, barring | `customer`, `order_type`, `channel`, `total_amount`, `status`, `submitted_at`, `fulfilled_at` |
| **Order Items** | Line items on an order | `order`, `product_offering`, `tariff_plan`, `quantity`, `unit_price` |
| **Order Status History** | Audit of order state | `order`, `from_status`, `to_status`, `changed_at`, `reason` |
| **Cases** | Support tickets | `customer`, `category`, `priority`, `status`, `subject`, `assigned_to`, `resolution_notes` |

### 3.10 Notifications & Rules

| Table | Purpose | Key Fields |
|---|---|---|
| **Notification Templates** | Reusable message templates | `template_code`, `trigger_event`, `channel_type`, `subject`, `body`, `variables`, `language` |
| **Notifications Sent** | Delivery log | `template`, `customer`, `sent_at`, `delivered_at`, `status`, `content_snapshot` |
| **Business Rules** | Rule-engine config (rating, fraud, promo) | `rule_type`, `trigger_condition_json`, `action_json`, `priority`, `enabled` |
| **Workflows / Workflow Instances** | Orchestration config + runs | `workflow_code`, `trigger_event`, `steps_json`, `started_at`, `status`, `context_json` |

### 3.11 Reference

| Table | Purpose | Key Fields |
|---|---|---|
| **Network Elements** | Registry of PGW / SMSC / HSS / PCRF / SMF etc. | `element_type`, `fqdn`, `diameter_realm`, `region`, `last_heartbeat` |

---

## 4. Data Flow — The Core Loop

### 4.1 End-to-end flow of a single data session

```
┌──────────┐      ┌─────────────┐      ┌──────────────┐      ┌─────────┐
│ Network  │──CCR→│   Usage     │─SUM→│  Balance     │─SEL→│ Decision│
│ (PGW/SMF)│      │ Transactions│      │ Remaining    │      │ Grant/  │
└──────────┘      └─────────────┘      └──────────────┘      │ Deny    │
                                                              └─────────┘
                                                                   │
                                       ┌───────────────────────────┘
                                       ▼
                                  ┌─────────┐     ┌──────────────┐
                                  │Wallet   │─DR→│ Wallet       │
                                  │ debit on │     │ Transactions │
                                  │ overage  │     └──────────────┘
                                  └─────────┘
```

### 4.2 Diameter CCR → CCA loop (the enforcement heart)

| Phase | What happens | Tables touched |
|---|---|---|
| **CCR-I** (start) | Parse MSISDN → lookup Subscription → check Balance for rating group → reserve chunk (e.g. 5 MB or 60s) → grant via CCA | Subscription read, Balance read+reserve, Usage Transaction insert, Charging Session insert |
| **CCR-U** (update, most frequent) | Record `used_service_unit` → decrement Balance → grant next chunk if >80% consumed → trigger Low-Balance notification at 80%/95% | Usage Transaction insert, Balance update |
| **CCR-T** (terminate) | Finalize used amount → refund unused reserved quota → close session → generate CDR | Usage Transaction insert, Charging Session update, CDR insert |
| **CCR-E** (event: SMS, one-shot) | Single step: validate + debit + record, session closes immediately | Usage Transaction insert, Balance update |

**Idempotency key:** `(session_id, request_number)`
**Response codes:** `2001` success · `4010` blocked · `4012` credit limit reached · `5030` unknown user

### 4.3 Plan Purchase flow

```
Customer → Order (plan_purchase)
    ↓
Check Wallet.current_balance ≥ Tariff Plan.price
    ↓
Wallet Transaction (debit)  →  Wallet.current_balance updates
    ↓
Subscription Plan Assignment created (effective_from = now)
    ↓
For each Plan Allowance → Balance row created
    ↓
Notification: PLAN_ACTIVATED
```

### 4.4 Recharge flow

```
Customer → Recharge (voucher / USSD / app / retail POS)
    ↓
Validate voucher PIN OR gateway auth
    ↓
Wallet Transaction (credit)  →  Wallet.current_balance updates
    ↓
Partner Commission accrued (3% of amount)
    ↓
Voucher.status → Redeemed (if voucher-based)
    ↓
Notification: RECHARGE_OK
```

---

## 5. Rating Group Convention

| RG | Bucket | Context ID | Unit |
|---|---|---|---|
| 10 | General internet | 32251@3gpp.org | MB |
| 20 | Zero-rated operator portal | 32251@3gpp.org | MB (not billed) |
| 30 | Social / streaming bundle | 32251@3gpp.org | MB |
| 100 | Voice on-net | 32260@3gpp.org | minutes |
| 101 | Voice off-net | 32260@3gpp.org | minutes |
| 102 | Voice international | 32260@3gpp.org | minutes |
| 200 | SMS domestic | 32274@3gpp.org | count |
| 201 | SMS international | 32274@3gpp.org | count |

---

## 6. Derived Columns — Rollup / Formula / Lookup Plan

**Principle:** Use ERPAI-native primitives for all aggregation. Workflows only for cross-table record creation.

### Balances
| Column | Type | Source |
|---|---|---|
| Used Amount | ROLLUP | `SUM(Usage Transactions.used_amount)` via Balance ref |
| Remaining Amount | FORMULA | `Initial Amount − Used Amount` |
| Plan Name | LOOKUP | Tariff Plan ref → Plan Name |
| Plan Price | LOOKUP | Tariff Plan ref → Price |

### Subscriptions
| Column | Type | Source |
|---|---|---|
| Plan Price | LOOKUP | Current Plan ref → Price |
| Plan Validity | LOOKUP | Current Plan ref → Validity Days |
| Total Sessions | ROLLUP | `COUNT(Charging Sessions)` |

### Charging Sessions
| Column | Type | Source |
|---|---|---|
| Total Used | ROLLUP | `SUM(Usage Transactions.used_amount)` |
| Event Count | ROLLUP | `COUNT(Usage Transactions)` |
| Last Event | ROLLUP | `MAX(Usage Transactions.timestamp)` |

### Customers
| Column | Type | Source |
|---|---|---|
| Subscription Count | ROLLUP | `COUNT(Subscriptions)` |
| Wallet Balance | LOOKUP | Wallet ref → Current Balance |
| Total Cases | ROLLUP | `COUNT(Cases)` |
| Total Interactions | ROLLUP | `COUNT(Customer Interactions)` |

### Tariff Plans
| Column | Type | Source |
|---|---|---|
| Total Subscribers | ROLLUP | `COUNT(Balances)` with this plan ref |

### Distribution Partners
| Column | Type | Source |
|---|---|---|
| Total Commission | ROLLUP | `SUM(Partner Commissions.commission_amount)` |
| Total Recharges | ROLLUP | `COUNT(Recharges)` |
| Recharge Volume | ROLLUP | `SUM(Recharges.amount)` |

### Wallets
| Column | Type | Source |
|---|---|---|
| Recharge Count | ROLLUP | `COUNT(Recharges)` |
| Total Recharged | ROLLUP | `SUM(Recharges.amount)` |

### Promotions
| Column | Type | Source |
|---|---|---|
| Redemption Count | ROLLUP | `COUNT(Promotion Redemptions)` |
| Value Given | ROLLUP | `SUM(Promotion Redemptions.value_granted)` |

---

## 7. Workflows (only 3 needed)

### Workflow 1 — Plan Purchase
**Trigger:** Order created, `order_type = plan_purchase`
**Steps:**
1. Check `Wallet.current_balance ≥ Tariff Plan.price` → block if insufficient
2. Debit wallet, insert Wallet Transaction (type=plan_purchase, amount=−price)
3. Create Balance rows (one per rating group in plan)
4. Update `Subscription.current_plan` ref
5. Send PLAN_ACTIVATED notification

### Workflow 2 — Recharge Processing
**Trigger:** Recharge created, `status = successful`
**Steps:**
1. Credit wallet, insert Wallet Transaction (type=recharge, amount=+amount)
2. Insert Partner Commission (3% of amount)
3. If voucher-based → mark voucher `status = redeemed`
4. Send RECHARGE_OK notification

### Workflow 3 — New Subscription Activation
**Trigger:** Order created, `order_type = new_activation`
**Steps:**
1. Check `Customer.kyc_status = verified` → block if not
2. Pick Available MSISDN → flip to Assigned → link to Subscription
3. Pick In-Stock SIM → flip to Activated → link to Subscription
4. Insert Subscription + (Wallet if customer has none)
5. Insert Lifecycle Event + Status History
6. Send WELCOME_SMS
7. If Order has a Tariff Plan → fire Workflow 1

### Optional scheduled jobs
- **Low balance alerts** — every 15 min, scan Balances where `remaining / initial < 0.2`
- **Plan expiry warning** — daily, scan Balances where `effective_to` within 3 days
- **Plan expiry enforcement** — daily, flip `status=expired`, attempt auto-renewal
- **Partner commission settlement** — weekly, aggregate + mark `status=settled`

---

## 8. KPIs & Reporting

### Revenue & Usage
- **ARPU** = Σ Wallet Transactions debits ÷ active subscribers ÷ month
- **MOU** (Minutes of Use) = Σ voice Usage Transactions ÷ active subs ÷ month
- **Data MB per sub** = Σ data Usage Transactions ÷ active subs ÷ month
- **Yield per unit** = revenue ÷ MB / minute / SMS consumed

### Recharge & Wallet
- **Recharge frequency** per active subscriber / month
- **Recharge value distribution** across denominations
- **Idle wallet balance** — fraud + regulatory signal
- **Voucher redemption rate** = sold ÷ redeemed within N days

### Plan Performance
- **Plan uptake** = active assignments per Tariff Plan
- **Plan renewal rate** = auto-renew successes ÷ due
- **Allowance exhaustion** — % of plans fully consumed vs. expired unused

### Customer Health
- **Active subscribers** — any recharge OR usage in last 30d
- **Churn rate** = terminations ÷ start-of-month active
- **Net adds** = activations − (churn + port-out)

### Operational
- **Charging success rate** = CCRs with `2001` ÷ total
- **FUI trigger rate** = `4012` responses ÷ total
- **Notification delivery rate** per channel
- **Case backlog** & resolution time per category

---

## 9. Regulatory Touchpoints

| Requirement | Track |
|---|---|
| **KYC** (Aadhaar / national ID) | Valid ID, verified flag, re-verification schedule |
| **Lawful Intercept** | CDR retention 12–24 months, subscriber lookup API |
| **Data Retention** | 12 months hot, archive beyond |
| **Number Portability (MNP)** | Port-in / port-out with donor/recipient operator |
| **GST / VAT** | Tax Rate application per region |
| **Anti-fraud** | SIM-box, premium-rate, recharge velocity |
| **PCI-DSS** | Gateway tokenization only — no card data stored |

---

## 10. Integration Points

| System | Direction | Interface | Status |
|---|---|---|---|
| PGW / SMF (data) | Inbound | Diameter Gy | Simulated as JSON |
| IMS / S-CSCF (voice) | Inbound | Diameter Ro | Simulated as JSON |
| SMSC | Inbound | Diameter Ro (CCR-E) | Simulated as JSON |
| HSS / UDM | Lookup | S6a / Nudm | Modelled as DB lookup |
| Payment Gateway | Outbound | REST + webhooks | Stubbed |
| USSD Gateway | Bidirectional | REST | Drives Interactions |
| SMS Gateway | Outbound | REST / SMPP | Writes Notifications Sent |
| Data Warehouse | Outbound | Nightly extract | TBD |

---

## 11. Current Build State

| Area | Status |
|---|---|
| Schema (46 tables, 350 columns, 63 refs) | ✅ Done |
| Line-item embedding (11 parent tables) | ✅ Done |
| Seed data (20 customers, 27 subs, 237 CCR events) | ✅ Done, but hardcoded |
| Dashboard (`balance-dashboard.html`) | ✅ Live |
| Diameter simulator (CCR-I/U/T sequences) | ✅ Working, writes Used/Remaining directly |
| Rollup-based Balance.Used Amount | ❌ Blocked on rollup engine fix |
| Formula-based Balance.Remaining | ❌ Blocked on rollup engine fix |
| 3 core workflows (Purchase / Recharge / Activation) | ❌ Pending PAT + rollups |
| Schema simplification (flatten Plan Allowances, SPAs, Rate Cards) | ❌ Pending |

**Blockers:** PAT token issuance broken; rollup engine wipes values on parent update.

---

## 12. File Manifest

```
Telco billing system/
├── PLAN.md                     original 470-line spec
├── HANDOFF.md                  current state + gotchas for next agent
├── APP_PLAN.md                 this doc
├── .table-ids.json             map of 46 tables → IDs
├── .seed-ids.json              IDs of seeded records
├── .schema-audit.json          column metadata snapshot
├── custom-pages/
│   └── balance-dashboard.html  live dashboard in ERPAI sidebar
└── scripts/
    ├── 01-create-tables.sh       creates 45 tables
    ├── 02-create-columns.sh      bulk-creates columns
    ├── 04-create-references.sh   wires 63 ref columns
    ├── seed.mjs                  primary seed script
    ├── diameter-simulator.mjs    CCR event generator
    └── workflows.mjs             9 Node-based workflows
```
