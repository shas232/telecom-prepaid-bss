#!/usr/bin/env node
// plan-expiry.mjs - Plan expiry sweep, auto-renewal, and 3-day warnings.
//
// Usage:
//   node scripts/plan-expiry.mjs                 # full run
//   node scripts/plan-expiry.mjs --dry-run       # no writes
//   node scripts/plan-expiry.mjs --no-expiry     # skip phase 1
//   node scripts/plan-expiry.mjs --no-renew      # skip phase 2
//
// Reads Balances, flips expired -> Expired (status=3), attempts auto-renewal
// when the tariff plan has auto_renew_default=true, and sends 3-day warning
// notifications. Idempotent.

import { api, APP_ID, sleep } from './lib-common.mjs';

// ---- Args / flags
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const NO_EXPIRY = args.has('--no-expiry');
const NO_RENEW = args.has('--no-renew');

// ---- Table IDs (from /tmp/table-ids.json)
const TID = {
  Balances:        '9daeb0991b806538ceab887f',
  TariffPlans:     'f2e797515f347f862e71a641',
  Wallets:         '1ec21f333aa5965f9d9be874',
  WalletTx:        'd9a7f5779835c59a75d837c3',
  Subscriptions:   '495e7f2e36663583722c8ec8',
  Customers:       'aed243e6c13b8f5194724d76',
  LifecycleEvents: '739318075af795fcbfe7dd11',
  NotifSent:       '1119d4dad001272c2d342f2e',
  NotifTemplates:  '7f559e405ea6595e0c06fe24',
};

// ---- Column IDs (verified against GET /v1/app-builder/table/<tid>)
const BAL = {
  Status: 'VrcT',         // select: 1=Active,2=Depleted,3=Expired,4=Suspended
  CycleStart: 'o4qw',
  CycleEnd: 'DXPX',
  EffectiveFrom: 'zlob',
  EffectiveTo: 'GVKg',
  Subscription: 'yw1p',
  TariffPlan: '1hH7',
  UnitType: 'yutm',       // 1=MB,2=Minutes,3=Count
  InitialAmount: 'aGu1',
  PricePaid: '42E9',
  ActivationSource: 'uhlG', // 3=Auto Renew
  AllowanceLabel: 'g3QJ',
  BalanceCode: 'ucLa',
  ReservedAmount: 'khzL',
  RatingGroup: 'dOSd',
  ServiceContext: 'Esuj',
};
const TP = {
  Price: 'WZ99',
  ValidityDays: 'vqEa',
  AutoRenewDefault: 'YAhL',
  Data: '43Sg',
  Voice: 'CAnm',
  SMS: 'ALxp',
  PlanName: 'kSbg',
};
const WAL = {
  CurrentBalance: 'PEUU',
  LifetimeSpend: 'QGjX',
  Customer: 'DoVS',
  LastUsage: 'GkdW',
};
const WTX = {
  Amount: '8n2I',
  Timestamp: 'ajVy',
  TxType: 'FT69',          // 2=Plan Purchase (no 'Plan Renewal' option; closest)
  RefType: 'YBNC',         // no 'Plan' option; 2=Order (closest)
  RefID: 'mqMb',
  Wallet: '2yFo',
  Notes: 'uw5l',
  BalanceBefore: 'jNFT',
  BalanceAfter: '1Hc4',
  InitiatedBy: 'NyKH',
  TransactionCode: '93aU', // required=true — Bug-2 fix (P5): missing caused 400 on insert
};
const SUB = { Customer: 'c6QN', MSISDN: 'sDya' };
const LCE = {
  EventType: 'Vcqj',        // Enum lacks 'Plan Expired/Renewed'; stored in Notes
  TriggeredBy: 'mEDC',      // 1=System
  EventDate: '5RoL',
  Reason: '5XfQ',
  Notes: 'jXwi',
  Customer: 'sRHx',
  PreviousStatus: 'lKIh',
  NewStatus: '9mt9',
};
const NOT = {
  Template: 'hywV',
  Customer: '5Zt0',
  Subscription: 'qCsv',
  Status: 'JaBx',           // 1=Queued
  SentAt: 'JVsa',
  Content: 'OItS',
};

// ---- Rate-limit helper for writes
const WRITE_DELAY_MS = 130;
async function rateLimitedWrite(fn) {
  const out = await fn();
  await sleep(WRITE_DELAY_MS);
  return out;
}

// ---- SQL helper
async function sql(sqlQuery) {
  const r = await api('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery, limit: 10000 });
  if (!r.data?.success) throw new Error('SQL failed: ' + (r.data?.message || JSON.stringify(r.data)).slice(0, 300));
  // Response envelope: { status, success, data: { rows, fields, rowCount } }
  return r.data?.data?.rows || r.data?.rows || [];
}

// ---- Helpers to parse selects that come back as "[3]"
function parseSelect(v) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v[0] ?? null;
  if (typeof v === 'number') return v;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a[0] : a; } catch { return null; }
}

// ---- Bulk insert helper (app-builder endpoint, batches of 20)
async function bulkInsert(tableId, cellsArray) {
  if (!cellsArray.length) return [];
  const ids = [];
  for (let i = 0; i < cellsArray.length; i += 20) {
    const batch = cellsArray.slice(i, i + 20).map(cells => ({ cells }));
    const r = await api('POST', `/v1/app-builder/table/${tableId}/record-bulk?appId=${APP_ID}`, { arr: batch });
    if (!r.ok) throw new Error('bulkInsert failed: ' + JSON.stringify(r.data).slice(0, 400));
    const newIds = r.data?.data?.map(x => x._id) || r.data?.ids || [];
    ids.push(...newIds);
    await sleep(WRITE_DELAY_MS);
  }
  return ids;
}

// ---- PUT record update
async function putRecord(tableId, id, cells) {
  const r = await api('PUT', `/v1/app-builder/table/${tableId}/record/${id}`, { cells });
  if (!r.ok) throw new Error(`PUT ${tableId}/${id} failed: ` + JSON.stringify(r.data).slice(0, 300));
  return r.data;
}

// ---- Date helpers
const todayISO = () => new Date().toISOString();
function addDaysISO(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + (days || 0));
  return d.toISOString();
}

// ================================================================
// MAIN
// ================================================================
(async () => {
  const failures = [];
  const log = (...a) => console.log(...a);
  log(`\n=== Plan Expiry Workflow ${DRY ? '[DRY-RUN]' : ''} ${new Date().toISOString()} ===`);
  log(`Flags: no-expiry=${NO_EXPIRY} no-renew=${NO_RENEW}`);

  // ---------------------------------------------------------------
  // Pre-load: tariff plan map, template map
  // NOTE: ClickHouse views retain one row per _version. Always use
  // argMax(col, _version) + GROUP BY _id to read the latest value;
  // otherwise Map.set(_id, row) is last-write-wins-by-chance and
  // can return stale data (root cause of Wave-T5 TC-TIME-04).
  // ---------------------------------------------------------------
  log('\n[setup] Loading tariff plans + templates...');
  const tpRows = await sql(`
    SELECT argMax(price, _version) AS price,
           argMax(validity_days, _version) AS validity_days,
           argMax(auto_renew_default, _version) AS auto_renew_default,
           argMax("data_allowance_(mb)", _version) AS data_mb,
           argMax("voice_allowance_(min)", _version) AS voice_min,
           argMax(sms_allowance, _version) AS sms_allowance,
           argMax(plan_name, _version) AS plan_name,
           _id
    FROM a1776271424351_tariff_plans
    WHERE _deleted = 0
    GROUP BY _id
  `);
  const planById = new Map();
  for (const p of tpRows) {
    planById.set(p._id, {
      id: p._id,
      price: Number(p.price) || 0,
      validity: Number(p.validity_days) || 30,
      autoRenew: p.auto_renew_default == 1 || p.auto_renew_default === true || p.auto_renew_default === '1',
      data: Number(p.data_mb) || 0,
      voice: Number(p.voice_min) || 0,
      sms: Number(p.sms_allowance) || 0,
      name: p.plan_name || '',
    });
  }
  log(`  loaded ${planById.size} tariff plans (${[...planById.values()].filter(p => p.autoRenew).length} auto-renew)`);

  // Templates by trigger event id (see schema: 1=Low Balance,2=Plan Expiring,...)
  const tplRows = await sql(`
    SELECT argMax(template_code, _version) AS template_code,
           argMax(trigger_event, _version) AS trigger_event,
           _id
    FROM a1776271424351_notification_templates
    WHERE _deleted=0
    GROUP BY _id
  `);
  const tplByTrigger = {};
  for (const t of tplRows) {
    const tev = parseSelect(t.trigger_event);
    if (tev && !tplByTrigger[tev]) tplByTrigger[tev] = t._id;
  }
  const TPL_PLAN_EXPIRING = tplByTrigger[2] || null;
  log(`  TPL_PLAN_EXPIRING = ${TPL_PLAN_EXPIRING || '(none; warnings will be skipped)'}`);

  // ---------------------------------------------------------------
  // PHASE 1: Expiry sweep
  // ---------------------------------------------------------------
  let expiredCount = 0;
  const sampleExpired = [];
  const newlyExpiredBalances = []; // for phase 2

  if (!NO_EXPIRY) {
    log('\n[phase1] Expiry sweep...');
    // Fetch active balances whose effective_to (or cycle_end fallback) is in the past.
    // Aggregate with argMax to always use the latest version of each record.
    const rows = await sql(`
      SELECT argMax(effective_to, _version) AS effective_to,
             argMax(cycle_end, _version) AS cycle_end,
             argMax(subscription, _version) AS subscription,
             argMax(tariff_plan, _version) AS tariff_plan,
             argMax(status, _version) AS status,
             argMax(rating_group, _version) AS rating_group,
             _id
      FROM a1776271424351_balances
      WHERE _deleted = 0
      GROUP BY _id
      HAVING status = '[1]'
        AND (
          (effective_to < now() AND effective_to > toDateTime('1970-01-02'))
          OR (
            (effective_to IS NULL OR effective_to <= toDateTime('1970-01-02'))
            AND cycle_end < now()
          )
        )
    `);
    log(`  ${rows.length} balances are past-due`);

    // Group by subscription so we only fire one lifecycle event + one renewal per subscription
    const bySub = new Map();
    for (const r of rows) {
      const sub = r.subscription;
      if (!sub) continue;
      if (!bySub.has(sub)) bySub.set(sub, []);
      bySub.get(sub).push(r);
    }

    for (const [subId, bals] of bySub) {
      // Use first balance's tariff_plan as the plan (all 3 buckets in a pack share plan)
      const firstPlan = bals.find(b => b.tariff_plan)?.tariff_plan || null;

      // Flip each balance -> Expired
      for (const b of bals) {
        const effTo = b.effective_to || b.cycle_end || '(null)';
        // Prefer samples with a real past date (non-epoch) for clearer reporting
        const isRealDate = effTo && !String(effTo).startsWith('1970-01-01');
        if (isRealDate && sampleExpired.length < 2) sampleExpired.push({ id: b._id, effective_to: effTo });
        if (DRY) {
          log(`  [dry] would expire balance ${b._id} (effective_to=${effTo})`);
        } else {
          try {
            await rateLimitedWrite(() => putRecord(TID.Balances, b._id, { [BAL.Status]: [3] }));
          } catch (e) {
            failures.push(`expire balance ${b._id}: ${e.message}`);
            continue;
          }
        }
        expiredCount++;
      }

      newlyExpiredBalances.push({ subId, planId: firstPlan, bals });
    }

    // One lifecycle event per subscription (customer-level)
    // Need customer for each subscription — look them up.
    if (!DRY && bySub.size) {
      const subIds = [...bySub.keys()];
      const subRows = await sql(`
        SELECT argMax(customer, _version) AS customer, _id
        FROM a1776271424351_subscriptions
        WHERE _deleted=0 AND _id IN (${subIds.map(id => `'${id}'`).join(',')})
        GROUP BY _id
      `);
      const custBySub = new Map(subRows.map(s => [s._id, s.customer]));

      const lceCells = [];
      for (const [subId, bals] of bySub) {
        const cust = custBySub.get(subId);
        if (!cust) continue;
        lceCells.push({
          // Event Type enum lacks 'Plan Expired' — using Suspended (2) as closest
          // bucket; the real event name is logged in Notes for fidelity.
          [LCE.EventType]: [2],
          [LCE.TriggeredBy]: [1],
          [LCE.EventDate]: todayISO(),
          [LCE.Reason]: 'Validity period ended',
          [LCE.Notes]: `event_type=Plan Expired; subscription=${subId}; buckets=${bals.length}`,
          [LCE.Customer]: [cust], // ref cells must be an array of ids
          [LCE.PreviousStatus]: 'Active',
          [LCE.NewStatus]: 'Expired',
        });
      }
      try {
        const ids = await bulkInsert(TID.LifecycleEvents, lceCells);
        log(`  inserted ${ids.length} lifecycle events`);
      } catch (e) {
        failures.push(`lifecycle events insert: ${e.message}`);
      }
    }

    log(`  [phase1] expired ${expiredCount} balances across ${bySub.size} subscriptions`);
  } else {
    log('\n[phase1] SKIPPED (--no-expiry)');
  }

  // ---------------------------------------------------------------
  // PHASE 2: Auto-renewal
  // ---------------------------------------------------------------
  let renewAttempted = 0, renewOK = 0, renewInsufficient = 0, renewWouldHaveFired = 0;

  if (!NO_RENEW && newlyExpiredBalances.length) {
    log('\n[phase2] Auto-renewal...');

    // Build subscription->customer->wallet lookups (argMax to dodge stale versions)
    const subIds = newlyExpiredBalances.map(x => x.subId);
    const subRows = await sql(`
      SELECT argMax(customer, _version) AS customer,
             argMax(msisdn, _version) AS msisdn,
             _id
      FROM a1776271424351_subscriptions
      WHERE _deleted=0 AND _id IN (${subIds.map(id => `'${id}'`).join(',')})
      GROUP BY _id
    `);
    const subInfo = new Map(subRows.map(s => [s._id, { customer: s.customer, msisdn: s.msisdn }]));

    const custIds = [...new Set(subRows.map(s => s.customer).filter(Boolean))];
    const walletRows = custIds.length ? await sql(`
      SELECT argMax(current_balance, _version) AS current_balance,
             argMax(lifetime_spend, _version) AS lifetime_spend,
             argMax(customer, _version) AS customer,
             _id
      FROM a1776271424351_wallets
      WHERE _deleted=0
      GROUP BY _id
      HAVING customer IN (${custIds.map(id => `'${id}'`).join(',')})
    `) : [];
    const walletByCust = new Map(walletRows.map(w => [w.customer, w]));

    // Check idempotency: any fresh Balance with cycle_start=today already?
    // argMax pattern so we see the latest version of each balance.
    const today = new Date().toISOString().slice(0, 10);
    const freshRows = await sql(`
      SELECT argMax(subscription, _version) AS subscription,
             argMax(cycle_start, _version) AS cycle_start,
             _id
      FROM a1776271424351_balances
      WHERE _deleted=0
      GROUP BY _id
      HAVING toDate(cycle_start) = toDate(now())
        AND subscription IN (${subIds.map(id => `'${id}'`).join(',')})
    `);
    const alreadyRenewed = new Set(freshRows.map(r => r.subscription));

    for (const { subId, planId, bals } of newlyExpiredBalances) {
      if (!planId) continue;
      const plan = planById.get(planId);
      if (!plan) continue;
      if (alreadyRenewed.has(subId)) {
        log(`  [skip] subscription ${subId} already has a fresh balance for today`);
        continue;
      }
      if (!plan.autoRenew) {
        renewWouldHaveFired++;
        continue;
      }

      renewAttempted++;
      const sub = subInfo.get(subId);
      if (!sub) { failures.push(`renew ${subId}: no subscription info`); continue; }
      const wallet = walletByCust.get(sub.customer);
      if (!wallet) { failures.push(`renew ${subId}: no wallet for customer ${sub.customer}`); continue; }

      const walBal = Number(wallet.current_balance) || 0;
      const walSpend = Number(wallet.lifetime_spend) || 0;

      if (walBal < plan.price) {
        renewInsufficient++;
        // Try to insert a "Renewal Failed" notification if template exists — none does; skip gracefully.
        // Add a note to an expired balance about insufficient funds.
        const firstBal = bals[0];
        if (!DRY && firstBal) {
          try {
            await rateLimitedWrite(() => putRecord(TID.Balances, firstBal._id, {
              [BAL.BalanceCode]: 'AUTO-RENEW-INSUFFICIENT-FUNDS',
            }));
          } catch (e) { failures.push(`note insufficient ${firstBal._id}: ${e.message}`); }
        }
        log(`  [insufficient] sub ${subId}: wallet=${walBal} < price=${plan.price}`);
        continue;
      }

      if (DRY) {
        log(`  [dry] would renew sub ${subId} (plan ${plan.name}, price ${plan.price})`);
        renewOK++;
        continue;
      }

      // Determine rating group: prefer the existing expired balance's value,
      // fall back to 10 (no default on tariff_plan). Required on insert —
      // the API rejects fresh balances with 400 if omitted, but the wallet
      // debit would already be committed => customer loses money. See Bug 1.
      let ratingGroup = 10;
      for (const b of bals) {
        const rg = Number(b.rating_group);
        if (Number.isFinite(rg) && rg > 0) { ratingGroup = rg; break; }
      }

      // --- Transactional block: debit wallet + log tx + insert fresh balances.
      // If the balance insert fails we compensate by restoring the wallet and
      // deleting the wallet transaction we just wrote, so we never leave the
      // customer debited with nothing in return.
      let walletDebited = false;
      let walletTxIds = [];
      try {
        // 1) Debit wallet
        await rateLimitedWrite(() => putRecord(TID.Wallets, wallet._id, {
          [WAL.CurrentBalance]: walBal - plan.price,
          [WAL.LifetimeSpend]: walSpend + plan.price,
          [WAL.LastUsage]: todayISO(),
        }));
        walletDebited = true;

        // 2) Insert wallet transaction
        walletTxIds = await bulkInsert(TID.WalletTx, [{
          [WTX.Amount]: -plan.price,
          [WTX.Timestamp]: todayISO(),
          [WTX.TxType]: [2],       // Plan Purchase (no 'Plan Renewal' option)
          [WTX.RefType]: [2],      // Order (no 'Plan' option)
          [WTX.RefID]: plan.id,
          [WTX.Wallet]: [wallet._id],
          [WTX.Notes]: `Auto-renewal of plan ${plan.name}`,
          [WTX.BalanceBefore]: walBal,
          [WTX.BalanceAfter]: walBal - plan.price,
          [WTX.InitiatedBy]: 'System (Auto-Renew)',
          [WTX.TransactionCode]: `RENEW-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
        }]);

        // 3) Insert 3 fresh balances (Data=MB/1, Voice=Minutes/2, SMS=Count/3).
        //    RatingGroup MUST be present or the API returns 400.
        const eff = { from: todayISO(), to: addDaysISO(plan.validity) };
        const codeSuffix = `${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
        const commonCells = {
          [BAL.Status]: [1],                // Active
          [BAL.CycleStart]: eff.from,
          [BAL.CycleEnd]: eff.to,
          [BAL.EffectiveFrom]: eff.from,
          [BAL.EffectiveTo]: eff.to,
          [BAL.ActivationSource]: [3],      // Auto Renew
          [BAL.Subscription]: [subId],
          [BAL.TariffPlan]: [plan.id],
          [BAL.PricePaid]: plan.price,
          [BAL.RatingGroup]: ratingGroup,   // Bug-1 fix: mandatory on insert
        };
        const freshBals = [
          { ...commonCells, [BAL.UnitType]: [1], [BAL.InitialAmount]: plan.data,  [BAL.AllowanceLabel]: 'Data',  [BAL.ServiceContext]: [1], [BAL.BalanceCode]: `BAL-DATA-${codeSuffix}` },
          { ...commonCells, [BAL.UnitType]: [2], [BAL.InitialAmount]: plan.voice, [BAL.AllowanceLabel]: 'Voice', [BAL.ServiceContext]: [2], [BAL.BalanceCode]: `BAL-VOICE-${codeSuffix}` },
          { ...commonCells, [BAL.UnitType]: [3], [BAL.InitialAmount]: plan.sms,   [BAL.AllowanceLabel]: 'SMS',   [BAL.ServiceContext]: [3], [BAL.BalanceCode]: `BAL-SMS-${codeSuffix}` },
        ];
        await bulkInsert(TID.Balances, freshBals);
      } catch (e) {
        failures.push(`renew sub ${subId} (plan ${plan.id}): ${e.message}`);
        // Compensate: restore wallet + delete orphan wallet transaction(s).
        if (walletDebited) {
          try {
            await rateLimitedWrite(() => putRecord(TID.Wallets, wallet._id, {
              [WAL.CurrentBalance]: walBal,
              [WAL.LifetimeSpend]: walSpend,
              [WAL.LastUsage]: todayISO(),
            }));
            log(`  [compensate] restored wallet ${wallet._id} to ${walBal}`);
          } catch (ce) { failures.push(`COMPENSATION FAILED wallet ${wallet._id}: ${ce.message}`); }
        }
        for (const txId of walletTxIds) {
          try {
            const dr = await api('DELETE', `/v1/app-builder/table/${TID.WalletTx}/record/${txId}?appId=${APP_ID}`);
            if (!dr.ok) throw new Error('status ' + dr.status);
            log(`  [compensate] deleted wallet tx ${txId}`);
          } catch (ce) { failures.push(`COMPENSATION FAILED wallet-tx ${txId}: ${ce.message}`); }
        }
        continue;
      }

      // 4) Lifecycle event (Plan Renewed) — enum lacks it, store in Notes.
      try {
        await bulkInsert(TID.LifecycleEvents, [{
          // Event Type enum lacks 'Plan Renewed' — using Reactivated (3) as closest.
          [LCE.EventType]: [3],
          [LCE.TriggeredBy]: [1],
          [LCE.EventDate]: todayISO(),
          [LCE.Reason]: `Auto-renewal of plan ${plan.name} at ${plan.price}`,
          [LCE.Notes]: `event_type=Plan Renewed; subscription=${subId}; plan=${plan.id}`,
          [LCE.Customer]: [sub.customer],
          [LCE.PreviousStatus]: 'Expired',
          [LCE.NewStatus]: 'Active',
        }]);
      } catch (e) { failures.push(`lce renew: ${e.message}`); }

      renewOK++;
      log(`  [renewed] sub ${subId} plan=${plan.name} price=${plan.price}`);
    }

    log(`  [phase2] attempted=${renewAttempted} ok=${renewOK} insufficient=${renewInsufficient} would-have-fired(flag off)=${renewWouldHaveFired}`);
  } else {
    log('\n[phase2] SKIPPED');
  }

  // ---------------------------------------------------------------
  // PHASE 3: Expiry warnings (3-day lookahead)
  // ---------------------------------------------------------------
  let warningsCreated = 0;
  log('\n[phase3] Expiry warnings (3-day lookahead)...');

  const warnRows = await sql(`
    SELECT argMax(subscription, _version) AS subscription,
           argMax(tariff_plan, _version) AS tariff_plan,
           argMax(effective_to, _version) AS effective_to,
           argMax(status, _version) AS status,
           _id
    FROM a1776271424351_balances
    WHERE _deleted=0
    GROUP BY _id
    HAVING status = '[1]'
      AND effective_to >= now()
      AND effective_to <= now() + INTERVAL 3 DAY
  `);
  log(`  ${warnRows.length} balances expiring within 3 days`);

  if (warnRows.length && TPL_PLAN_EXPIRING) {
    const warnSubIds = [...new Set(warnRows.map(r => r.subscription).filter(Boolean))];
    // Idempotency: skip if a Plan Expiring notification was sent to this sub in the last 24h
    const recent = warnSubIds.length ? await sql(`
      SELECT argMax(subscription, _version) AS subscription,
             argMax(template, _version) AS template,
             argMax(sent_at, _version) AS sent_at,
             _id
      FROM a1776271424351_notifications_sent
      WHERE _deleted=0
      GROUP BY _id
      HAVING template = '${TPL_PLAN_EXPIRING}'
        AND sent_at >= now() - INTERVAL 1 DAY
        AND subscription IN (${warnSubIds.map(id => `'${id}'`).join(',')})
    `) : [];
    const recentSet = new Set(recent.map(r => r.subscription));

    const subInfoRows = warnSubIds.length ? await sql(`
      SELECT argMax(customer, _version) AS customer, _id
      FROM a1776271424351_subscriptions
      WHERE _deleted=0 AND _id IN (${warnSubIds.map(id => `'${id}'`).join(',')})
      GROUP BY _id
    `) : [];
    const custBySub = new Map(subInfoRows.map(s => [s._id, s.customer]));

    // Only 1 warning per subscription per run
    const firedSubs = new Set();
    const cells = [];
    for (const r of warnRows) {
      if (!r.subscription || firedSubs.has(r.subscription)) continue;
      if (recentSet.has(r.subscription)) continue;
      const cust = custBySub.get(r.subscription);
      if (!cust) continue;
      firedSubs.add(r.subscription);
      cells.push({
        [NOT.Template]: [TPL_PLAN_EXPIRING],
        [NOT.Customer]: [cust],
        [NOT.Subscription]: [r.subscription],
        [NOT.Status]: [1], // Queued
        [NOT.SentAt]: todayISO(),
        [NOT.Content]: `Plan expiring on ${r.effective_to}. Please recharge to avoid service disruption.`,
      });
    }

    if (cells.length) {
      if (DRY) {
        log(`  [dry] would create ${cells.length} notifications`);
      } else {
        try {
          const ids = await bulkInsert(TID.NotifSent, cells);
          warningsCreated = ids.length;
        } catch (e) { failures.push(`warning notifications insert: ${e.message}`); }
      }
    }
  } else if (!TPL_PLAN_EXPIRING) {
    log('  skipping warnings — no PLAN_EXPIRING template found');
  }

  log(`  [phase3] warnings created: ${warningsCreated}`);

  // ---------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------
  log('\n=== SUMMARY ===');
  log(`Expiry sweep:     flipped ${expiredCount} balances to Expired`);
  if (sampleExpired.length) log(`  samples: ${JSON.stringify(sampleExpired)}`);
  log(`Auto-renewal:     attempted=${renewAttempted} ok=${renewOK} insufficient=${renewInsufficient}`);
  log(`                  would-have-fired-if-flag-on=${renewWouldHaveFired}`);
  log(`Expiry warnings:  created=${warningsCreated}`);
  log(`Failures:         ${failures.length}`);
  if (failures.length) {
    log('First failures:');
    for (const f of failures.slice(0, 10)) log('  - ' + f);
  }
  log(DRY ? '[DRY-RUN complete — no writes performed]' : 'Done.');
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
