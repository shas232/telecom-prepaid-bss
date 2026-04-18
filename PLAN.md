---
title: Prepaid Telecom Billing System
description: Prepaid BSS for a telco — customers, subscriptions, catalog, wallet/recharge, real-time charging via Diameter, balance enforcement, self-care, and retail distribution
audience: both
category: domain
app: telecom (afe8c4540708da6ca9e6fe79)
related:
  - research/diameter-protocol.md
---

# Prepaid Telecom Billing System

## Purpose

This domain covers a prepaid telecom Business Support System (BSS) — the business and data layer sitting behind a mobile operator's network. It models the **prepaid** side of the Tecnotree BSS reference architecture: customers, SIMs, product catalog, tariff plans, wallets, recharge/top-up channels, and real-time charging driven by Diameter credit-control messages (Gy for data, Ro for voice/SMS).

The core promise of prepaid is **pay-before-use with real-time enforcement**. Subscribers load money into a wallet via recharge or voucher, buy a tariff plan (which credits allowances into a bucket per rating group — 10GB data, 300 min voice, 100 SMS), and consume services. Every chargeable event (data session, call, SMS) arrives as a Diameter `CCR` message, which this system rates, debits from the appropriate balance, and responds to with a `CCA` carrying granted quota or a final-unit indication when the balance is exhausted.

Scope is **prepaid only**. Postpaid invoicing, dunning, AR, and credit scoring are out. The billing "money flow" is replaced by wallet + recharge + voucher. Plan validity (time expiry) and allowance depletion (unit expiry) are the two end-of-life triggers that replace monthly billing cycles.

## Architecture Context

Mapped from the Tecnotree BSS module diagram:

```
┌──────────────────────── Channels ─────────────────────────┐
│  CRM  │ Self-care │ Chat │ Marketplace │ IVR │ POS │ USSD │
└───────────────────────────┬───────────────────────────────┘
                            │
┌─────────────────── Digital Accelerator ───────────────────┐
│  API Mgmt  │  Workflows  │  Orchestration  │  Rules        │
└───────────────────────────┬───────────────────────────────┘
                            │
┌──────────── Digital Online Charging System (DOCS) ────────┐
│                                                            │
│  Rating:  Tariff │ Taxation │ Decision │ Bonus │ Promos    │
│  CHF:     Session & Event charging                         │
│  ABMF:    Hierarchy │ Wallet │ Lifecycle │ Transfer │     │
│           Recharge │ Subscription │ Redirect               │
│  Supp:    MVPN │ F&F │ CUG │ Community                     │
│  UDR:     CDRs │ Offline Processing                        │
│                                                            │
└───────────────────────────┬───────────────────────────────┘
                            │
┌────── Catalog ──────┐  ┌────── Order ──────┐  ┌── Partner ──┐
│ Offerings │ Bundles │  │ Capture │ Status  │  │ Distributors│
│ Services  │ Rsrcs   │  │ Decompose │ Bulk  │  │ Commissions │
└─────────────────────┘  └───────────────────┘  └─────────────┘
                            │
┌────────────── Signaling Gateway (reference) ───────────────┐
│  CAMEL │ MAP │ DIAMETER │ INAP │ SIP │ 5G PCF/CHF/SMF/NRF  │
└────────────────────────────────────────────────────────────┘
```

The system treats signaling (Diameter, CAMEL, etc.) as **simulated inputs** — CCR messages arrive as JSON events rather than over the actual wire protocol.

## Key Entities

### Customer

- **Description**: The legal entity (individual or organization) who owns the subscription(s). Primary relationship anchor.
- **Key Fields**: `customer_id` (auto `CUST-000001`), `name`, `email`, `phone`, `address`, `customer_type` (individual, corporate, family), `segment` (prepaid_consumer, prepaid_business, student, senior), `status` (active, suspended, churned), `language`, `kyc_status` (unverified, in_progress, verified, rejected), `onboarded_date`, `churn_date`, `lifetime_value`
- **Relationships**: 1:N Subscriptions, 1:N Wallets, 1:1 Account Hierarchy parent, 1:N Customer Interactions, 1:N Cases.
- **Design Notes**: Segment drives eligibility for promotions and specific tariff plans. KYC status gates activation in regulated markets.

### Customer Identification

- **Description**: KYC documents. A single customer may have multiple (passport + national ID).
- **Key Fields**: `id_type` (passport, national_id, driver_license, voter_id, aadhaar), `id_number`, `issuing_authority`, `issue_date`, `expiry_date`, `verified`, `verification_date`, `scan_url`
- **Relationships**: N:1 Customer.

### Customer Lifecycle Event

- **Description**: Immutable audit log of customer state transitions.
- **Key Fields**: `event_type` (activated, suspended, reactivated, churned, reinstated, merged), `event_date`, `reason`, `triggered_by` (system, csr, customer, fraud_rule), `previous_status`, `new_status`, `notes`
- **Relationships**: N:1 Customer.

### Account Hierarchy

- **Description**: Parent-child relationships between customers (family plans, corporate master accounts).
- **Key Fields**: `parent_customer`, `child_customer`, `relationship_type` (family_head, family_member, corp_master, corp_employee), `billing_responsibility` (parent_pays, child_pays, split), `effective_from`, `effective_to`
- **Relationships**: Self-referencing on Customer.

### Subscription

- **Description**: A SIM/MSISDN owned by a customer. One customer can own many.
- **Key Fields**: `msisdn` (e.g. `919812345678`), `imsi`, `iccid`, `customer`, `apn`, `subscription_type` (prepaid_voice, prepaid_data, prepaid_hybrid), `status` (active, suspended, terminated, port_out), `activation_date`, `termination_date`, `last_usage_date`, `home_network`, `roaming_enabled`
- **Relationships**: N:1 Customer, 1:N Subscription Plan Assignments, 1:N Balances, 1:N Charging Sessions, 1:N Usage Transactions.
- **Design Notes**: MSISDN is the primary key telecom network side; IMSI is unique per SIM; ICCID is the physical card serial. Indexed on all three for lookup.

### Subscription Status History

- **Description**: Audit of subscription state changes.
- **Key Fields**: `subscription`, `from_status`, `to_status`, `changed_at`, `reason`, `changed_by`

### MSISDN Pool

- **Description**: Inventory of phone numbers. Numbers flow pool → reserved → assigned → (churned) → pool.
- **Key Fields**: `msisdn`, `status` (available, reserved, assigned, quarantined, blocked), `tier` (standard, gold, platinum, vanity), `reservation_expiry`, `assigned_to_subscription`, `last_assigned_date`

### SIM Inventory

- **Description**: Physical SIM cards before assignment. Sourced in batches from vendors.
- **Key Fields**: `iccid`, `imsi`, `ki_encrypted`, `batch_id`, `vendor`, `status` (in_stock, allocated, activated, returned, damaged), `warehouse_location`, `allocated_to_partner`

### Service

- **Description**: Technical services the network offers. These are the billable primitives.
- **Key Fields**: `service_code` (DATA_GPRS, VOICE_ONNET, VOICE_OFFNET, VOICE_INTL, SMS_DOM, SMS_INTL, VIDEO_CALL), `service_name`, `service_family` (data, voice, messaging, content), `default_rating_group`, `default_service_context_id` (`32251@3gpp.org` for data, etc.), `unit_type` (MB, minutes, count)

### Product Offering

- **Description**: Customer-facing plan (what the marketing team names it). "Ultimate 10GB", "Daily Combo", "Unlimited Weekend".
- **Key Fields**: `offering_code`, `offering_name`, `description`, `offering_type` (plan, booster, top_up_bonus), `base_price`, `validity_days`, `grace_period_days`, `status` (draft, active, retired), `renewal_type` (one_time, auto_renew, on_demand), `segment_eligibility`, `launch_date`, `retire_date`

### Bundle

- **Description**: A named combination of offerings (e.g., "New User Welcome Pack" = plan + booster).
- **Key Fields**: `bundle_code`, `bundle_name`, `bundle_price`, `discount_vs_components`, `validity_days`, `status`

### Bundle Component

- **Key Fields**: `bundle`, `offering`, `quantity`, `sequence` — ordered components within a bundle.

### Tariff Plan

- **Description**: The instantiated, buyable plan with a price and allowance set. A Product Offering may have multiple Tariff Plans (different regions/segments).
- **Key Fields**: `plan_code`, `plan_name`, `product_offering`, `price`, `currency`, `plan_type` (recurring_pack, one_time_pack, daily, weekly, monthly, annual, payg), `validity_days`, `auto_renew_default`, `priority_on_charge` (order of depletion across stacked plans), `region`, `status`

### Plan Allowance

- **Description**: What the plan gives, per rating group. A plan has one or more of these.
- **Key Fields**: `tariff_plan`, `rating_group` (integer: 10, 100, 101, 200, 201), `service_context_id`, `allowance_label` ("General Internet 10GB"), `unit_type` (MB, minutes, count), `initial_amount`, `overage_action` (block, charge_from_wallet, continue_free), `overage_rate`, `priority`

### Rate Card

- **Description**: Pay-as-you-go pricing when no allowance applies (or overage continues from wallet).
- **Key Fields**: `rate_card_code`, `rating_group`, `service_context_id`, `unit_type`, `price_per_unit`, `peak_off_peak` (all, peak, off_peak), `peak_start_hour`, `peak_end_hour`, `effective_from`, `effective_to`

### Tax Rate

- **Key Fields**: `tax_code` (VAT_IN, GST_IN_SGST, GST_IN_CGST, etc.), `tax_name`, `rate_percent`, `applies_to` (recharge, plan_purchase, payg, all), `region`, `effective_from`, `effective_to`

### Subscription Plan Assignment

- **Description**: The link between a subscription and the tariff plans it holds. One subscription can stack multiple active plans (e.g., base + booster). History lives here too.
- **Key Fields**: `assignment_code`, `subscription`, `tariff_plan`, `effective_from`, `effective_to` (null = currently active), `activation_source` (customer_self_care, csr, auto_renew, promotion, welcome_pack), `renewal_count`, `status` (active, expired, cancelled, suspended), `cancelled_reason`
- **Relationships**: N:1 Subscription, N:1 Tariff Plan, 1:N Balances.
- **Design Notes**: `effective_to IS NULL` = current assignment. Stacking order from `tariff_plan.priority_on_charge`.

### Bonus Grant

- **Description**: Ad-hoc free allowance (loyalty reward, service compensation, promotional credit).
- **Key Fields**: `bonus_code`, `subscription`, `rating_group`, `unit_type`, `amount`, `validity_days`, `granted_reason` (loyalty, compensation, promo, referral, win_back), `granted_by`, `granted_date`, `expiry_date`, `consumed_amount`

### Wallet

- **Description**: Monetary balance per customer (prepaid cash account).
- **Key Fields**: `wallet_code`, `customer`, `currency`, `current_balance`, `lifetime_recharge`, `lifetime_spend`, `last_recharge_date`, `last_usage_date`, `status` (active, frozen, closed)
- **Design Notes**: Balance is the source of truth maintained by Wallet Transactions postings.

### Wallet Transaction

- **Description**: Double-entry style audit log of every money movement touching a wallet.
- **Key Fields**: `transaction_code`, `wallet`, `transaction_type` (recharge, plan_purchase, payg_debit, refund, bonus, adjustment, transfer_in, transfer_out, reversal), `amount`, `balance_before`, `balance_after`, `reference_id`, `reference_type` (recharge, order, usage_transaction, balance_transfer), `timestamp`, `initiated_by`

### Recharge

- **Description**: A top-up event that adds money to the wallet.
- **Key Fields**: `recharge_code`, `wallet`, `amount`, `currency`, `channel` (voucher, ussd, app, retail_pos, ivr, online, bank_transfer), `distribution_partner`, `voucher_serial`, `gateway_reference`, `status` (initiated, successful, failed, reversed), `timestamp`, `tax_amount`, `net_amount`

### Recharge Voucher

- **Description**: Pre-printed voucher inventory (scratch cards / digital PINs).
- **Key Fields**: `voucher_serial`, `pin_encrypted`, `denomination`, `currency`, `batch_id`, `status` (generated, distributed, sold, redeemed, expired, cancelled), `allocated_to_partner`, `sold_date`, `redeemed_date`, `redeemed_by_wallet`, `expiry_date`

### Balance Transfer

- **Description**: P2P money or allowance gifting from one subscription to another.
- **Key Fields**: `transfer_code`, `from_subscription`, `to_subscription`, `transfer_type` (money, data_mb, voice_min), `amount`, `fee`, `status`, `timestamp`, `reason`

### Charging Session

- **Description**: One row per Diameter Session-Id. Groups the CCR lifecycle (I → U* → T) or a single CCR-E.
- **Key Fields**: `session_id` (from Diameter Session-Id AVP), `subscription`, `service_context_id`, `service_type` (data, voice_onnet, voice_offnet, sms_dom, sms_intl), `started_at`, `ended_at`, `status` (active, terminated, abandoned), `termination_cause` (LOGOUT, SESSION_TIMEOUT, USER_MOVED, LINK_BROKEN, AUTH_EXPIRED, ADMIN_TERMINATED), `calling_party`, `called_party`, `apn`, `location_info`, `rat_type` (EUTRAN, UTRAN, GERAN, WLAN, NR), `request_count`, `total_used_amount`, `total_charged`
- **Relationships**: N:1 Subscription, 1:N Usage Transactions, 1:1 CDR (on terminate).

### Usage Transaction

- **Description**: One row per CCR message received. The source of truth for billable events.
- **Key Fields**: `transaction_id` (auto `TXN-000001`), `charging_session`, `subscription`, `message_type` (CCR-I, CCR-U, CCR-T, CCR-E), `request_number`, `timestamp`, `rating_group`, `service_identifier`, `used_amount`, `unit_type`, `input_octets`, `output_octets` (data only), `cc_time_seconds` (voice only), `requested_amount`, `granted_amount` (CCA side), `result_code` (2001, 4010, 4011, 4012, 5030, 5031), `validity_time`, `fui_action` (none, terminate, redirect, restrict), `fui_redirect_url`, `calling_party`, `called_party`, `apn`, `raw_event` (full JSON)
- **Relationships**: N:1 Charging Session, N:1 Subscription, N:1 Balance (decremented).
- **Design Notes**: Dedup key is `(session_id, request_number)`. Ordering matters for out-of-order message handling.

### Call Detail Record (CDR)

- **Description**: Post-session flattened record — derived once a session closes with CCR-T. One row per finished session. The record the "offline CDR processor" would produce.
- **Key Fields**: `cdr_code`, `charging_session`, `subscription`, `customer`, `service_type`, `started_at`, `ended_at`, `duration_seconds`, `total_octets`, `total_minutes`, `total_units`, `rating_group`, `tariff_plan`, `total_charged_from_allowance`, `total_charged_from_wallet`, `final_termination_cause`, `rec_sequence_number`, `partner_involvement`

### Balance

- **Description**: Live remaining allowance per (subscription, rating group, plan assignment). THIS is the "current balance" table — what enforcement reads on every Diameter request.
- **Key Fields**: `balance_code`, `subscription`, `subscription_plan_assignment`, `rating_group`, `service_context_id`, `allowance_label`, `unit_type`, `initial_amount`, `used_amount`, `remaining_amount` (formula: initial − used), `reserved_amount`, `cycle_start`, `cycle_end`, `status` (active, depleted, expired, suspended)
- **Design Notes**: `used_amount` is a rollup from Usage Transactions filtered by rating_group + effective window. `remaining_amount` is a formula column. Cycle end = plan assignment `effective_to` or `effective_from + validity_days`.

### Promotion

- **Description**: Campaign offers (double data weekend, buy 1 get 1, referral bonus).
- **Key Fields**: `promotion_code`, `promotion_name`, `type` (percent_discount, fixed_discount, bonus_allowance, free_service, cashback), `eligibility_rules`, `start_date`, `end_date`, `max_redemptions_per_customer`, `total_budget`, `budget_consumed`, `status`
- **Relationships**: 1:N Promotion Redemptions.

### Promotion Redemption

- **Key Fields**: `promotion`, `customer`, `subscription`, `redeemed_at`, `value_granted`, `reference_transaction`, `expiry_date`

### Friends & Family Group / Member

- **F&F Group Fields**: `group_code`, `subscription` (owner), `group_name`, `max_members`, `special_rate_card`, `status`
- **F&F Member Fields**: `group`, `member_msisdn`, `added_date`, `on_net`, `status`

### Closed User Group (CUG) / CUG Member

- **CUG Fields**: `cug_code`, `cug_name`, `owner_customer` (corporate master), `cug_type` (corporate, community, mvpn), `internal_rate_card`, `status`
- **CUG Member Fields**: `cug`, `subscription`, `role` (admin, member), `added_date`

### Distribution Partner

- **Description**: Retail shops, super-dealers, app-based agents that sell recharges/SIMs.
- **Key Fields**: `partner_code`, `partner_name`, `partner_type` (retail_shop, super_dealer, app_agent, bank_channel, online_portal), `tier` (gold, silver, bronze), `region`, `contact_person`, `contact_phone`, `contact_email`, `commission_scheme`, `status` (prospect, onboarding, active, suspended, terminated), `onboarded_date`, `wallet_balance` (partner float)
- **Relationships**: 1:N Recharges, 1:N Partner Commissions, 1:N Partner Contracts.

### Partner Commission

- **Key Fields**: `partner`, `recharge`, `commission_type` (percent, fixed, tiered), `base_amount`, `commission_amount`, `accrued_date`, `settled_date`, `settlement_reference`, `status` (accrued, pending_settlement, settled)

### Partner Contract

- **Key Fields**: `partner`, `contract_number`, `effective_from`, `effective_to`, `commission_structure`, `sla_targets`, `termination_clauses`, `signed_document_url`, `status`

### Channel

- **Description**: Registry of customer interaction channels.
- **Key Fields**: `channel_code`, `channel_name`, `channel_type` (ussd, sms, ivr, mobile_app, web_self_care, retail, chat, social, whatsapp), `enabled`, `operating_hours`, `config_json`

### Customer Interaction

- **Description**: Unified touch log across all channels.
- **Key Fields**: `interaction_code`, `customer`, `subscription`, `channel`, `interaction_type` (balance_check, recharge, plan_purchase, complaint, query, status_update, self_care_action), `timestamp`, `duration_seconds`, `outcome`, `agent_id`, `transcript`, `csat_score`

### Order / Order Item / Order Status History

- **Order Fields**: `order_code`, `customer`, `subscription`, `order_type` (new_activation, plan_purchase, sim_replacement, port_in, port_out, barring, reactivation), `channel`, `total_amount`, `status` (draft, submitted, in_progress, fulfilled, cancelled, failed), `submitted_at`, `fulfilled_at`
- **Order Item Fields**: `order`, `product_offering`, `tariff_plan`, `quantity`, `unit_price`, `total`
- **Order Status History**: `order`, `from_status`, `to_status`, `changed_at`, `reason`

### Case

- **Description**: Support ticket.
- **Key Fields**: `case_code`, `customer`, `subscription`, `channel`, `category` (billing, technical, service_request, complaint, fraud), `priority`, `status` (open, in_progress, resolved, closed, reopened), `subject`, `description`, `assigned_to`, `opened_at`, `resolved_at`, `resolution_notes`, `csat`

### Notification Template / Notifications Sent

- **Template Fields**: `template_code`, `template_name`, `trigger_event` (low_balance, plan_expiring, recharge_success, plan_activated, promotion_eligible, plan_depleted, kyc_pending), `channel_type`, `subject`, `body`, `variables`, `language`, `enabled`
- **Notifications Sent Fields**: `template`, `customer`, `subscription`, `channel`, `sent_at`, `delivered_at`, `read_at`, `status` (queued, sent, delivered, failed, bounced), `content_snapshot`

### Business Rule

- **Description**: Configurable policies for the rule engine (used for rating decisions, notifications, promotions, and workflow triggers).
- **Key Fields**: `rule_code`, `rule_name`, `rule_type` (rating, notification, promotion, fraud, workflow), `trigger_condition_json`, `action_json`, `priority`, `enabled`

### Workflow / Workflow Instance

- **Workflow Fields**: `workflow_code`, `workflow_name`, `trigger_event`, `steps_json`, `enabled`, `owner`
- **Instance Fields**: `workflow`, `started_at`, `completed_at`, `status` (running, completed, failed, cancelled), `context_json`, `triggered_by`

### Network Element

- **Description**: Reference registry of network functions we receive signaling from or interact with.
- **Key Fields**: `element_code`, `element_type` (PGW, SGW, SMSC, MSC, MME, HSS, PCRF, PCF, SMF, UPF, AMF, NRF, AUSF), `fqdn`, `ip_address`, `diameter_realm`, `region`, `status`, `last_heartbeat`

## Core Business Processes

### 1. Customer Acquisition

1. **Lead / Walk-in** via retail partner, app, or online portal.
2. **KYC capture** — identification document(s) uploaded to Customer Identifications.
3. **MSISDN selection** from MSISDN Pool (reserve → assign).
4. **SIM allocation** from SIM Inventory (allocated → activated).
5. **Customer + Subscription created**, lifecycle event logged, welcome SMS dispatched via Notification.
6. Welcome pack promotion applied (Bonus Grant) if eligible.

### 2. Recharge / Top-up

1. Customer initiates via voucher scratch (`*123*PIN#`), USSD, app, retail POS, IVR, or online.
2. Order created for audit; Recharge row inserted.
3. Voucher PIN validated against Recharge Voucher pool OR gateway payment authorized.
4. Wallet Transaction posted (credit), Wallet balance updated.
5. Partner Commission accrued for the originating Distribution Partner.
6. Notification ("Recharge successful, balance = X") dispatched.
7. Audit Log entry written.

### 3. Plan Purchase

1. Customer selects Product Offering via self-care channel.
2. Order → Order Item(s) → validates against Wallet balance.
3. Wallet debited (Wallet Transaction), Subscription Plan Assignment created with `effective_from = now`.
4. For each Plan Allowance of the chosen Tariff Plan, a Balance row is created (initial = plan allowance, used = 0, cycle_end = now + validity_days).
5. Previous Subscription Plan Assignment of the same tier gets `effective_to = now` if replacement mode.
6. Notification sent; promotional boosters evaluated and granted as Bonus Grants.

### 4. Real-time Charging (the Diameter flow)

The core enforcement loop. Each incoming CCR message:

**a. CCR-I (session start)**
1. Parse message → identify subscription by MSISDN/IMSI.
2. Create Charging Session (session_id, started_at, status=active).
3. Identify rating group & unit type from Service-Context-Id + Rating-Group.
4. Find active Balance row for (subscription, rating_group); check `remaining_amount`.
5. If balance sufficient: reserve chunk (e.g., 5 MB or 60 seconds) → insert Usage Transaction (msg_type=CCR-I, granted_amount=chunk, result_code=2001).
6. If balance zero & wallet sufficient: reserve against wallet at Rate Card rate (overage mode).
7. If both empty: Usage Transaction with result_code=4012, fui_action=terminate/redirect.
8. CCA response assembled and returned.

**b. CCR-U (session update, most frequent)**
1. Increment request_number tracking.
2. Record `used_service_unit` → Usage Transaction (used_amount = delta).
3. Decrement Balance.remaining_amount (via rollup recompute).
4. If used > 80% of last grant → grant next chunk; else continue.
5. Trigger Low-Balance Notification if crossing thresholds (20%, 10%, 0%).

**c. CCR-T (session termination)**
1. Finalize used amount; Usage Transaction (msg_type=CCR-T).
2. Refund any unused reserved quota back to Balance.
3. Close Charging Session (ended_at, termination_cause, total_used_amount).
4. Generate CDR row from the closed session.

**d. CCR-E (event — SMS, one-shot purchase)**
1. Single-shot: validate balance, debit in one step, insert one Usage Transaction, close session immediately.

**Dedup:** `(session_id, request_number)` is the idempotency key.
**Ordering:** handle out-of-order arrival (CCR-U after CCR-T) by ignoring or applying based on timestamp.

### 5. Balance Enforcement & FUI

When a Balance hits zero during CCR-U:
1. Determine policy: `overage_action` on Plan Allowance.
   - `block`: return CCA with `result_code=4012`, `fui_action=TERMINATE`.
   - `charge_from_wallet`: rate subsequent units from Wallet at Rate Card; returns `2001` as long as wallet has funds.
   - `continue_free`: zero-rated bucket (e.g., operator portal).
2. Notification sent to customer.
3. Self-care redirect URL issued in `fui_redirect_url` (top-up portal).

### 6. Plan Expiry

Plans expire on whichever comes first:
- **Allowance depletion**: every Balance row for the plan is depleted.
- **Validity expiry**: `effective_from + validity_days` reached.

On expiry:
1. Subscription Plan Assignment gets `effective_to = now`, `status = expired`.
2. Balances marked `expired`.
3. Auto-renewal attempted if `renewal_type=auto_renew` and wallet ≥ price.
4. If auto-renew fails or off: subscription falls back to PAYG (wallet-direct rating) or to base plan if stacked.
5. Notification sent.

### 7. Balance Transfer (P2P Gifting)

1. Originating subscription requests via USSD/app.
2. Validate limits (max daily, max per recipient, KYC of both).
3. Wallet debited on source, transfer fee charged, destination wallet credited.
4. Balance Transfer row logged.

### 8. Churn / Port-Out / Suspension

- **Inactivity suspension**: no usage / no recharge for N days → status=suspended.
- **Grace period expiry**: N more days with no recharge → status=terminated; MSISDN quarantined (90 days) then returned to pool.
- **Port-out**: subscription status → port_out; final CDR settlement with the new operator.

### 9. Self-Care Interactions

Any balance check, plan change, support call, complaint → Customer Interaction row, optionally Case row for multi-step issues.

### 10. Partner Settlement

1. At period end (daily/weekly/monthly), all Partner Commissions with status=accrued are aggregated per partner.
2. Settlement payment made; Partner Commission rows updated to status=settled with settlement_reference.

## Diameter Integration Reference

Implementation detail: we simulate Diameter CCRs as JSON events rather than running a Diameter stack. Minimum viable event shape:

```json
{
  "event_id": "uuid",
  "timestamp": "ISO-8601",
  "session_id": "pgw01.op.com;1697472000;42;ABC",
  "message_type": "CCR-I | CCR-U | CCR-T | CCR-E",
  "request_number": 0,
  "subscriber": {"imsi": "404680123456789", "msisdn": "919812345678"},
  "service_context": "32251@3gpp.org",
  "charging_buckets": [{
    "rating_group": 10,
    "service_id": 1001,
    "requested": {"total_octets": 52428800, "time": null, "units": null},
    "used":      {"input_octets": 123, "output_octets": 456, "total_octets": 579, "time": null, "units": null}
  }],
  "network_info": {"apn": "internet", "rat_type": "EUTRAN", "location": "cell-id"},
  "termination_cause": null
}
```

**Service-Context-Id mapping:**

| Context ID | Meaning | Unit |
|---|---|---|
| `32251@3gpp.org` | PS data (GPRS/LTE) | octets → MB |
| `32260@3gpp.org` | IMS voice | CC-Time seconds → minutes |
| `32274@3gpp.org` | SMS | count |
| `32270@3gpp.org` | MMS | count |

**Rating Group convention (operator-defined; adopted for this build):**

| RG | Bucket | Context | Unit |
|---|---|---|---|
| 10 | General internet | 32251 | MB |
| 20 | Zero-rated operator portal | 32251 | MB (not billed) |
| 30 | Social / streaming bundle | 32251 | MB |
| 100 | Voice on-net | 32260 | minutes |
| 101 | Voice off-net | 32260 | minutes |
| 102 | Voice international | 32260 | minutes |
| 200 | SMS domestic | 32274 | count |
| 201 | SMS international | 32274 | count |

**CCA response codes to return:**

| Code | Meaning |
|---|---|
| `2001 DIAMETER_SUCCESS` | Granted |
| `4010 DIAMETER_END_USER_SERVICE_DENIED` | Subscriber blocked |
| `4011 DIAMETER_CREDIT_CONTROL_NOT_APPLICABLE` | Not chargeable here |
| `4012 DIAMETER_CREDIT_LIMIT_REACHED` | Balance zero |
| `5030 DIAMETER_USER_UNKNOWN` | MSISDN not found |
| `5031 DIAMETER_RATING_FAILED` | Rating logic error |

**Reference specs:** RFC 6733 (Diameter base), RFC 4006 (DCCA), 3GPP TS 32.299 (charging AVPs), 32.251 (PS charging), 32.260 (IMS charging), 32.274 (SMS charging).

## Regulatory & Compliance

| Requirement | Scope | What to Track |
|---|---|---|
| **KYC (Aadhaar / national ID)** | All new subscriptions | Valid ID, verified flag, re-verification schedule. Unverified SIMs barred within grace window. |
| **Lawful Intercept (LI)** | Communications data | CDR retention (typically 12–24 months), subscriber lookup API, LI request audit. |
| **Data Retention** | CDRs, Usage Transactions | Typically 12 months rolling in hot DB; archive beyond. |
| **Number Portability (MNP)** | MSISDN moves | Port-in / port-out events tracked with donor/recipient operator codes. |
| **Consumer Protection (TRAI/FCC/Ofcom)** | Billing transparency | Plan disclosures, pre-usage confirmation for paid content, do-not-disturb (DND) adherence. |
| **GDPR / CCPA** | Customer data | Consent for marketing, right-to-erasure (subject to LI retention overrides). |
| **Roaming Steering & Cap** | International usage | Roaming alert SMS on first roam, bill-shock cap (e.g., €50/month default). |
| **Anti-fraud** | Usage patterns | SIM-box detection, premium-rate fraud thresholds, velocity checks on recharges. |
| **Tax (GST/VAT)** | Recharges & plan purchases | Tax Rate application per region; tax invoice generation on request. |
| **PCI-DSS** | Online recharges | Card data never stored — gateway tokenization only. |

## Common Configuration Patterns

- **Rating Group Design**: Start with 8 groups (data general/zero/bundle, voice on/off/intl, SMS dom/intl). Keep integers stable forever — promotions target specific RGs.
- **Validity Strategy**: Fixed days from activation (`effective_from + validity_days`) is simpler than calendar boundary. Grace period gives 24–72h after expiry to recharge before service cuts.
- **Overage Policy**: Per Plan Allowance, default `block` for data bundles, `charge_from_wallet` for voice. Mismatched policies drive bill shock complaints.
- **Stacked Plans**: Active assignments ordered by `priority_on_charge`. Deplete in priority order (boosters before base). Balances query with ORDER BY priority.
- **Low-Balance Notifications**: Trigger at 80%, 95%, 100% consumed per RG. Throttle per customer/day to avoid spam.
- **Voucher Denominations**: Keep a small set (e.g., 10, 20, 50, 100, 200, 500). Track lifecycle strictly — lost vouchers = direct revenue leak.
- **MSISDN Tiers**: Vanity numbers priced higher. Quarantine churned numbers 90 days before re-assignment.
- **Partner Commission Schemes**: Simple percent (e.g., 3% on all recharges) is the norm; tiered by volume creates gaming. Settlement weekly or bi-weekly.

## Integration Points

| System | Direction | Data | Pattern |
|---|---|---|---|
| **PGW / SGSN / SMF (Data)** | Inbound | Gy CCR messages | Diameter DCCA; simulated here as JSON events. |
| **IMS / S-CSCF (Voice)** | Inbound | Ro CCR messages | Diameter DCCA; simulated. |
| **SMSC** | Inbound | Ro CCR-E per SMS | Diameter; event-based. |
| **PCRF / PCF** | Bidirectional | Policy rules, quota status | Gx/N7 interface; out of scope in simulation. |
| **HSS / UDM** | Lookup | Subscriber identity, APN | S6a / Nudm; modelled as direct DB lookup. |
| **Payment Gateway** | Outbound | Authorize + capture on online recharge | REST + webhooks. |
| **Voucher Printing** | Outbound | Voucher batch generation | Batch file handoff. |
| **USSD Gateway** | Bidirectional | Menu interactions, self-care | REST; drives Customer Interaction inserts. |
| **SMS Gateway** | Outbound | Notifications | REST / SMPP; Notifications Sent. |
| **CRM / Case Mgmt** | Bidirectional | Customer 360, cases | Currently modelled inside the app; could externalize to Salesforce/ServiceNow. |
| **Fraud Engine** | Outbound stream | Real-time usage feed | Kafka; out of scope. |
| **Data Warehouse / Reporting** | Outbound | CDRs, Wallet Transactions | Nightly extract. |
| **Regulator / LI Portal** | Outbound | Intercept feeds, retention query | Regulator-specified APIs. |

## KPIs & Reporting

### Revenue & Usage
- **ARPU** (Average Revenue Per User) = sum(Wallet Transactions.debit) / active subscribers / month.
- **MOU** (Minutes of Use) = sum(voice Usage Transactions.used_amount in minutes) / active subscribers / month.
- **Data MB per sub** = sum(data Usage Transactions.used_amount) / active subscribers / month.
- **SMS per sub** = sum(SMS Usage Transactions) / active subscribers / month.
- **Yield per MB / per minute / per SMS** = revenue / unit consumed.

### Recharge & Wallet
- **Recharge frequency** = recharges / active subscriber / month.
- **Recharge value distribution** across denominations.
- **Idle wallet balance** — sum(Wallet.current_balance) of inactive subs (fraud signal + regulatory issue).
- **Voucher redemption rate** = sold / redeemed within N days.

### Plan Performance
- **Plan uptake** = active assignments per Tariff Plan.
- **Plan renewal rate** = auto-renew successful / due.
- **Plan ARPU contribution** = revenue attributable per Tariff Plan.
- **Allowance exhaustion distribution** — what % of plans fully consumed vs. expired unused.

### Customer Health
- **Active subscribers** (last 30d recharge OR last 30d usage).
- **Churn rate** (monthly): subscribers terminating / start-of-month active.
- **Port-out rate** (regulatory concern).
- **Net Adds** = Activations − (Churn + Port-out).
- **Inactive-to-churn rate**.

### Network & Operational
- **Charging success rate** = Usage Transactions with 2001 / total.
- **FUI trigger rate** = rate of 4012 responses (signals under-spending customers).
- **Notification delivery rate** per channel.
- **Partner recharge volume by partner & by region**.
- **Case backlog / resolution time per category**.

## Checklist

- [x] Research Diameter Gy/Ro CCR/CCA flow and critical AVPs
- [x] Confirm rating group convention
- [x] Confirm units (MB for data, minutes for voice, single currency)
- [ ] Create Customers, Customer Identifications, Lifecycle Events, Account Hierarchy
- [ ] Create Subscriptions, Status History, MSISDN Pool, SIM Inventory
- [ ] Create Services, Product Offerings, Bundles, Bundle Components
- [ ] Create Tariff Plans, Plan Allowances, Rate Cards, Tax Rates
- [ ] Create Subscription Plan Assignments, Bonus Grants
- [ ] Create Wallets, Wallet Transactions, Recharges, Recharge Vouchers, Balance Transfers
- [ ] Create Charging Sessions, Usage Transactions, CDRs, Balances
- [ ] Create Promotions, Promotion Redemptions, F&F groups, CUGs
- [ ] Create Distribution Partners, Partner Commissions, Partner Contracts
- [ ] Create Channels, Customer Interactions, Orders, Cases
- [ ] Create Notification Templates, Notifications Sent, Business Rules, Workflows, Network Elements
- [ ] Wire reference columns across all tables
- [ ] Seed test data: 3 tariff plans, 20 customers, 25 subscriptions, 50 vouchers, 5 partners
- [ ] Build Diameter simulator generating CCR sequences for data, voice, SMS
- [ ] Implement balance decrement + CCA response logic
- [ ] Build balance dashboard (customer → plan → allowances remaining → recent transactions)
- [ ] Build SQL-backed usage charts (by day / rating group / customer segment)
- [ ] Build self-care USSD/app flows (future phase)
- [ ] Build partner commission settlement report (future phase)

## Related

- `research/diameter-protocol.md` — full Diameter CCR/CCA reference (TODO: extract from research step)
- `simulator/diameter.ts` — CCR event generator (TODO)
- `dashboard/` — NextJS UI for customer balance / usage (TODO)
