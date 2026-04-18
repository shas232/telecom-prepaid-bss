# Prepaid BSS — Feature Coverage & Build Plan

**Source:** `BSS_Exhaustive_Feature_List_v2.xlsx` (244 features, 29 modules)
**Scope filter:** prepaid-only, single-tenant, business-data layer (ERPAI app)
**Out-of-scope modules** (not prepaid or not ERPAI-addressable): MVNO & Wholesale, PoS, Lead & Prospect, Infra/K8s, Observability, DR, Security/SOC2, AI Platform, Digital Wallet (merchant), Digital Services Marketplace.
**Out-of-scope within Billing:** BIL-001..004, 009..015, 018..020, 022 (postpaid invoice/dunning/interconnect).

**Prepaid-relevant: 172 of 244 features.**

Legend: ✅ already modelled · 🟡 column present but workflow/UI missing · ❌ not modelled · ⛔ runtime-only (can't build in ERPAI data layer — flag conceptually)

---

## Online Charging & Rating (20)

| ID | Feature | Status | Notes |
|---|---|---|---|
| OCR-001 | 4G Gy Diameter | ⛔ | Network protocol — simulator only |
| OCR-002 | IMS/VoLTE Ro | ⛔ | Same |
| OCR-003 | 5G CHF N40 | ⛔ | Same |
| OCR-004 | Spending Limit Sy/Nchf | ⛔ | PCRF integration |
| OCR-005 | Dual-stack balance | ✅ | `balances` unit-type agnostic |
| OCR-006 | Quota reservation | ⛔ | Redis runtime |
| OCR-007 | Bundle deduction priority | 🟡 | `balances.plan_priority` exists; needs rollup+formula |
| OCR-008 | PAYG rating | 🟡 | `services.payg_rate` exists; needs workflow when balance=0 |
| OCR-009 | Tiered pricing | ❌ | Add `tariff_plans.tier_structure_json` |
| OCR-010 | Roaming charging | ✅ | `roaming_rate_cards` + sessions |
| OCR-011 | Balance alerts | 🟡 | `is_low_balance` flag; needs scheduled workflow |
| OCR-012 | Session affinity | ⛔ | Runtime |
| OCR-013 | OCS autoscaling | ⛔ | Platform |
| OCR-014 | Prefix tariff routing | ❌ | Add `special_prefixes` table or column |
| OCR-015 | Accumulation counters | ❌ | Add `usage_counters` table (daily/monthly per sub) |
| OCR-016 | Free unit management | 🟡 | `bonus_grants` table exists |
| OCR-017 | Policy cycle config | 🟡 | `balances.cycle_start/end` exists |
| OCR-018 | Content charging flag | ❌ | Add `services.content_based` column |
| OCR-019 | FUI actions | ✅ | `usage_transactions.fui_action` + `fui_redirect_url` |
| OCR-020 | RAR initiation | ⛔ | Runtime |

## Billing & Invoicing (7 prepaid-relevant of 22)

| ID | Feature | Status | Notes |
|---|---|---|---|
| BIL-005 | VAT/GST tax engine | 🟡 | `recharges.tax_rate_%`/`tax_amount` on recharges; need Tax Rates table for plan-price tax |
| BIL-006 | Reverse charge B2B | ❌ | Column on customer `reverse_charge` |
| BIL-007 | USO levy | ❌ | Column on recharges / tariff_plans |
| BIL-008 | Manual balance adjustment | ❌ | New `balance_adjustments` table OR reuse `wallet_transactions` with type=Adjustment + approval_by |
| BIL-016 | Bill shock / spend cap | 🟡 | `roaming_sessions.bill_shock_level/daily_cap` exists for roaming; add `subscriptions.spend_cap` overall |
| BIL-017 | Family shared pool | 🟡 | F&F tables exist; need shared-balance concept |
| BIL-021 | TAP3 roaming settlement | ✅ | `tap_records` table |

## CRM & Customer Management (15)

| ID | Feature | Status | Notes |
|---|---|---|---|
| CRM-001 | Registration | ✅ | customers+subscriptions |
| CRM-002 | Unified search | 🟡 | data there; needs page |
| CRM-003 | 360 view | ✅ | `customer-360.html` |
| CRM-004 | SIM swap | 🟡 | `imei_change_events` covers device; need SIM swap workflow |
| CRM-005 | Suspend/reactivate | 🟡 | `subscription_status_history` + customer_lifecycle_events |
| CRM-006 | Plan upgrade/downgrade | 🟡 | via orders.order_type; workflow needed |
| CRM-007 | Add-on purchase | 🟡 | booster plans seeded; workflow needed |
| CRM-008 | RBAC | ❌ | New `roles`, `permissions`, `role_assignments` tables |
| CRM-009 | Agent audit trail | ❌ | New `agent_actions` (audit log) table |
| CRM-010 | Case mgmt | ✅ | `cases` |
| CRM-011 | Corporate hierarchy | ✅ | `account_hierarchy` |
| CRM-012 | Number portability | ✅ | `mnp_requests` |
| CRM-013 | Lifecycle events | ✅ | `customer_lifecycle_events` |
| CRM-014 | Multi-language | ✅ | `customers.language` |
| CRM-015 | Comms preferences | ❌ | Add `sms_opt_in`, `email_opt_in`, `push_opt_in`, `dnd` on customers |

## Product & Catalog (14)

| ID | Feature | Status | Notes |
|---|---|---|---|
| CAT-001 | Offer definition | ✅ | `tariff_plans` (offerings folded in) |
| CAT-002 | Bundle composition | ✅ | `bundles` + `bundle_components` |
| CAT-003 | Immutable versioning | ❌ | Add `version`, `is_current`, `parent_plan_id` on tariff_plans |
| CAT-004 | MVNO override | ⛔ | Out of scope |
| CAT-005 | Promo rate override | 🟡 | `promotions` table has value_given |
| CAT-006 | Brand config per MVNO | ⛔ | Out of scope |
| CAT-007 | Catalog Redis cache | ⛔ | Runtime |
| CAT-008 | Plan policy priority | ✅ | `tariff_plans.priority_on_charge` |
| CAT-009 | Plan-to-offering relation | ✅ | Merged |
| CAT-010 | IoT/M2M plans | 🟡 | plan_type option exists; add IoT options |
| CAT-011 | Roaming tariff/zone | ✅ | `roaming_zones`, `roaming_rate_cards` |
| CAT-012 | Wholesale rate plan | ⛔ | MVNO |
| CAT-013 | Sync status tracking | ❌ | Add `sync_status` column on tariff_plans |
| CAT-014 | Private/restricted offerings | ❌ | Add `is_restricted`, `eligible_segments` |

## Provisioning & Network (12)

| ID | Feature | Status | Notes |
|---|---|---|---|
| PRV-001..006 | HLR/HSS/UDM/PCRF/PCF provisioning, state machine | ⛔ | Network integration, out of ERPAI scope |
| PRV-007 | Number pool | ✅ | `msisdn_pool` |
| PRV-008 | IMSI pool | 🟡 | inside `sim_inventory.imsi`; could add `imsi_pool` table |
| PRV-009 | APN/DNN config | 🟡 | `subscriptions.apn` exists |
| PRV-010 | VoLTE service activation | ⛔ | Network |
| PRV-011 | IoT SIM lifecycle | 🟡 | `sim_inventory.status` covers basic lifecycle |
| PRV-012 | eSIM profile (SM-DP+) | ❌ | Add `sim_type` (physical/esim), `activation_code` on sim_inventory |

## EVD & Voucher (10)

| ID | Feature | Status | Notes |
|---|---|---|---|
| EVD-001 | EVD multi-level hierarchy | ❌ | Add `parent_partner` ref on distribution_partners |
| EVD-002 | USSD retailer top-up | ⛔ | Runtime channel |
| EVD-003 | EVD agent mobile app | ⛔ | Client app |
| EVD-004 | EVD REST API | ⛔ | API |
| EVD-005 | Float account | 🟡 | `distribution_partners.wallet_balance` exists |
| EVD-006 | Commission calc & settlement | ✅ | `partner_commissions` |
| EVD-007 | Physical voucher redemption | ❌ | Re-add `recharge_vouchers` table |
| EVD-008 | Bulk CSV upload | ⛔ | Process |
| EVD-009 | EVD fraud detection | ❌ | Fraud Rules (shared with RAF-004) |
| EVD-010 | Bank channel integration | 🟡 | `recharges.channel`/`gateway_reference` present |

## Dealer Management (10)

| ID | Feature | Status | Notes |
|---|---|---|---|
| DMS-001 | Dealer onboarding KYC | 🟡 | partner_contracts has signed doc; need dealer-KYC columns |
| DMS-002 | Hierarchy + territory | ❌ | `parent_partner`, `territory` on distribution_partners |
| DMS-003 | 8 commission types | 🟡 | `commission_scheme` col exists; need `commission_rules` table for configurability |
| DMS-004 | Performance tiers | 🟡 | `tier` col on distribution_partners |
| DMS-005 | Dealer portal | ⛔ | UI |
| DMS-006 | Dealer SIM activation + KYC | 🟡 | `sim_inventory.allocated_to_partner` + customer KYC |
| DMS-007 | Attribution tracing | ✅ | via `partner_contracts` + orders |
| DMS-008 | AML monitoring | ❌ | New `aml_alerts` table |
| DMS-009 | Underperformance | ⛔ | Reporting |
| DMS-010 | Commission disputes | ❌ | Reuse `cases` with category=Commission or new table |

## Inventory Management (11)

| ID | Feature | Status | Notes |
|---|---|---|---|
| INV-001 | SIM procurement & batch | ✅ | `sim_inventory.batch_id`/`vendor`/`received_date` |
| INV-002 | SIM lifecycle state machine | ✅ | `sim_inventory.status` |
| INV-003 | ICCID/IMSI pool | ✅ | sim_inventory |
| INV-004 | Modem/CPE inventory | ❌ | New `cpe_inventory` table (optional) |
| INV-005 | TR-069 management | ⛔ | Runtime |
| INV-006 | IMEI blacklist | ✅ | `equipment_identity_register` |
| INV-007 | Multi-location stock | ❌ | Add `sim_inventory.warehouse_location` exists ✅ |
| INV-008 | Low stock alert & reorder | ❌ | Rollup + scheduled workflow |
| INV-009 | Shrinkage / reconciliation | ❌ | Report / scheduled workflow |
| INV-010 | eSIM profile pool | ❌ | Columns on sim_inventory |
| INV-011 | IoT asset tracking | 🟡 | devices table covers handsets |

## Self-Care & Digital Channels (11)

All runtime UI (web, mobile, USSD, IVR, eSIM QR). ⛔ mostly. Can build:
| ID | Feature | Status | Notes |
|---|---|---|---|
| SCA-003 | Real-time balance display | ✅ | Dashboards |
| SCA-010 | Family plan management | 🟡 | F&F tables; need UI |

## KYC & Identity (8)

| ID | Feature | Status | Notes |
|---|---|---|---|
| KYC-001 | Doc submission & OCR | 🟡 | `customer_identifications` table; add OCR fields |
| KYC-002 | Liveness / face match | ❌ | `liveness_score` column |
| KYC-003 | Watchlist screening | ❌ | `watchlist_hits` column + `watchlist_screenings` table |
| KYC-004 | Manual review queue | ❌ | Add `review_status`, `reviewer`, `reviewed_at` on customer_identifications |
| KYC-005 | Document WORM storage | ⛔ | Infra |
| KYC-006 | Dealer KYC | 🟡 | partner_contracts |
| KYC-007 | Status tracking/triggers | ✅ | `customers.kyc_status` |
| KYC-008 | GDPR right to erasure | ❌ | `erasure_requests` table + soft-delete workflow |

## Mediation & Interconnect (6)

| ID | Feature | Status | Notes |
|---|---|---|---|
| MED-001 | Multi-source CDR | ✅ | `call_detail_records` |
| MED-002 | Normalisation | 🟡 | CDRs uniform already |
| MED-003 | Enrichment | ✅ | CDR fields include plan_name, tariff_plan |
| MED-004 | Dedup | ❌ | Add `duplicate_flag` column |
| MED-005 | TAP3 roaming | ✅ | `tap_records` |
| MED-006 | Mediation SLA | ❌ | Add `processing_lag_seconds` column |

## Revenue Assurance & Fraud (8)

| ID | Feature | Status | Notes |
|---|---|---|---|
| RAF-001 | CDR reconciliation | ❌ | Scheduled workflow + recon report table |
| RAF-002 | Unbilled CDR report | ❌ | Report view |
| RAF-003 | Balance reconciliation | ❌ | Once rollups live, compare denorm vs rollup |
| RAF-004 | Real-time fraud (CEP) | ❌ | `fraud_rules` + `fraud_alerts` tables (simplified) |
| RAF-005 | Auto fraud response | 🟡 | Workflow to suspend subs on alert |
| RAF-006 | Roaming NRTRDE | 🟡 | roaming_sessions has indicators |
| RAF-007 | Fraud case mgmt | 🟡 | Via `cases` |
| RAF-008 | RA dashboard | ❌ | New page |

## Analytics & BI (7)

Dashboards built for overview/balance/CDR/MNP/roaming/device/usage-heatmap/customer-360. Missing:
| ID | Feature | Status |
|---|---|---|
| ABI-001/003 | Revenue / Dealer dashboards | ✅ |
| ABI-002 | Network usage analytics | 🟡 (heatmap page) |
| ABI-004 | Cohort/churn | ❌ — new page |
| ABI-005 | Scheduled reports | ❌ — workflow |
| ABI-006 | Ad-hoc query | ⛔ — use /ask skill |
| ABI-007 | Real-time materialised views | ⛔ — ClickHouse |

## VAS (7)

Mostly runtime. Capture pref flags only:
| ID | Feature | Status |
|---|---|---|
| VAS-001 SMPP / VAS-002 MMSC / VAS-003 IVR / VAS-004 Voicemail / VAS-005 Conf / VAS-006 MCA / VAS-007 OBD | ⛔ | Runtime systems |

## Integration & APIs (6)

| ID | Feature | Status | Notes |
|---|---|---|---|
| INT-001..004 | Southbound/NB APIs/gRPC/Kafka | ⛔ | Platform |
| INT-005 | Payment gateway | 🟡 | recharges has gateway_reference |
| INT-006 | Webhook subscriptions | ❌ | New `webhook_subscriptions` table |

## Campaign Management (6)

| ID | Feature | Status | Notes |
|---|---|---|---|
| CMP-001 | Segmentation | ❌ | `campaign_segments` table |
| CMP-002 | Multi-channel dispatch | 🟡 | Reuse `notifications_sent` |
| CMP-003 | Scheduling / throttling | ❌ | `campaigns` table |
| CMP-004 | A/B testing | ❌ | `campaign_variants` |
| CMP-005 | DND / opt-out | 🟡 | Needs customer opt-in cols (CRM-015) |
| CMP-006 | Analytics & attribution | ❌ | Rollups on campaigns |

## Loyalty & Retention (4)

| ID | Feature | Status | Notes |
|---|---|---|---|
| LOY-001 | Points accrual | ❌ | `loyalty_points_txns` |
| LOY-002 | Tier system | ❌ | `loyalty_tiers` + `customers.tier` |
| LOY-003 | Rewards catalogue | ❌ | `rewards` |
| LOY-004 | Points expiry | ❌ | Column on loyalty txn |

## Order Management & CPQ (5)

| ID | Feature | Status | Notes |
|---|---|---|---|
| ORD-001 | Order capture multi-channel | ✅ | `orders.channel` |
| ORD-002 | CPQ | ❌ | `quotes` table or add to orders |
| ORD-003 | Decomposition to tasks | ❌ | `order_tasks` child table |
| ORD-004 | Jeopardy mgmt | ❌ | SLA columns on orders |
| ORD-005 | Fallout mgmt | ❌ | Fallout reason column |

## Trouble Ticketing (5)

| ID | Feature | Status | Notes |
|---|---|---|---|
| TKT-001 | Ticket creation | ✅ | `cases` |
| TKT-002 | Lifecycle (7 states) | 🟡 | status values in cases |
| TKT-003 | SLA mgmt | 🟡 | `cases.priority`/`days_open`; add due_date, sla_breached |
| TKT-004 | ITSM integration | ⛔ | External |
| TKT-005 | Customer ticket portal | ⛔ | UI |

---

## Summary counts (prepaid-only)

| Bucket | Count |
|---|---:|
| ✅ Already modelled | ~45 |
| 🟡 Partial (schema there, needs workflow/page) | ~40 |
| ❌ Not modelled — addressable in ERPAI | ~45 |
| ⛔ Runtime / platform — not addressable here | ~42 |
| **Total prepaid-relevant** | **172** |

---

## Proposed build phases (ERPAI-addressable gaps only)

### Phase 1 — Column additions to existing tables (safe, no new tables)
- `customers`: `sms_opt_in`, `email_opt_in`, `push_opt_in`, `dnd_enabled`, `loyalty_tier`, `loyalty_points`, `reverse_charge`
- `customer_identifications`: `liveness_score`, `watchlist_hits`, `review_status`, `reviewer`, `reviewed_at`, `ocr_extracted_json`
- `tariff_plans`: `version`, `is_current`, `parent_plan_id`, `sync_status`, `is_restricted`, `eligible_segments`, `tier_structure_json`, `uso_levy_%`
- `subscriptions`: `spend_cap_monthly`, `spend_cap_daily`, `apn_override`
- `sim_inventory`: `sim_type` (physical/esim), `activation_code`, `esim_qr_url`
- `distribution_partners`: `parent_partner`, `territory`, `dealer_kyc_status`, `aml_risk_score`
- `call_detail_records`: `duplicate_flag`, `cdr_format`, `processing_lag_seconds`
- `services`: `content_based`, `rating_mode`
- `cases`: `due_date`, `sla_breached`
- `orders`: `sla_target_hours`, `jeopardy_flag`, `fallout_reason`
- `recharges`: `uso_levy_amount`

### Phase 2 — New tables (high-value prepaid domain)
1. **Fraud Rules** (rule_type, thresholds, action, enabled)
2. **Fraud Alerts** (rule, subscription, severity, status, triggered_at, resolution)
3. **Recharge Vouchers** (serial, pin, denomination, status, batch, expiry)
4. **Loyalty Tiers** (name, min_points, benefits)
5. **Loyalty Points Transactions** (customer, type earn/redeem/expire, points, reason, reference)
6. **Rewards Catalog** (reward_code, name, points_cost, reward_type, stock)
7. **Campaigns** (name, segment, channel, schedule, status, dispatched_count, response_count)
8. **Campaign Segments** (code, definition_json, member_count)
9. **Commission Rules** (rule_code, event_type, partner_tier, amount_or_pct, conditions)
10. **Agent Actions / Audit Log** (actor, action, target_table, target_id, before, after, timestamp)
11. **Balance Adjustments** (subscription/balance, amount, reason, approved_by, approved_at)
12. **Tax Rates** (region, rate_type, rate_pct, effective_from/to)
13. **Webhook Subscriptions** (url, events, secret, status)

### Phase 3 — Workflows (need auto-builder fix or Node runner)
- PAYG charge when balance=0 → debit wallet
- Low-balance alert scheduled every 15 min
- Plan expiry daily sweep
- Commission settlement weekly
- CDR reconciliation nightly
- Fraud velocity scan every 15 min
- Campaign dispatch runner

### Phase 4 — New dashboards (prepaid operator operational views)
- Fraud ops dashboard (RAF-008)
- Loyalty overview
- Campaign attribution
- Churn cohort (ABI-004)
- Commission settlement ledger

### Phase 5 — Rollup/formula/lookup conversion (once engine stable per HANDOFF §4.2)
- balances.used_amount → rollup
- balances.remaining_amount → formula
- Subscription aggregates
- Customer rollups (subscription_count, total_cases, total_interactions already columns — confirm they're rollups)

---

## What to NOT build (explicit)

- All Diameter / 5G SBI / PCRF / HSS / HLR / UDM provisioning (⛔ runtime)
- Redis/Kafka/Flink/CEP integrations (⛔ platform)
- Self-care web/mobile/USSD/IVR client apps (⛔ out of ERPAI layer)
- SOC2 / ISO27001 / PCI-DSS controls (⛔ platform/people process)
- K8s / multi-region / DR plumbing (⛔ platform)
- AI/ML model training & serving (⛔ infra)
- MVNO multi-tenancy (excluded by single-tenant scope decision)
- Postpaid invoicing, dunning, tax engine, B2B corporate PO, EDI, device finance, interconnect settlement (out — prepaid-only)
- Digital wallet P2P / merchant QR / cash-out (not telco wallet; out)
