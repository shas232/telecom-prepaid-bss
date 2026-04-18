#!/usr/bin/env node
/**
 * Weekly Commission Settlement Workflow
 *
 * Settles Partner Commissions that are Pending ([1]) with accrued_date > 7 days ago.
 * Groups by Partner, computes totals, generates SETT-YYYYMMDD-<partnerCode> reference,
 * and updates each Partner Commission row: Status -> Settled ([3]), Settled Date -> today,
 * Settlement Reference -> ref.
 *
 * Usage:
 *   node scripts/commission-settlement.mjs             # live run
 *   node scripts/commission-settlement.mjs --dry-run   # preview, no writes
 *   node scripts/commission-settlement.mjs --no-date-filter  # ignore 7-day filter
 */

const BASE_URL = "https://api.erpai.studio";
const TOKEN = "erp_pat_live_REDACTED";
const APP_ID = "afe8c4540708da6ca9e6fe79";

const PARTNER_COMMISSIONS_TID = "8418a5b8a4ded0fb3851b72c";
const PARTNERS_TID = "516584eb1195eaacb54404d9";

// Column IDs on Partner Commissions (resolved via GET table metadata)
const COL = {
  STATUS: "90q1",
  COMMISSION_AMOUNT: "gPHc",
  ACCRUED_DATE: "Bi8g",
  SETTLED_DATE: "mLHa",
  SETTLEMENT_REF: "lM9r",
  PARTNER: "QhC0",
  RECHARGE: "Lv3B",
};

const STATUS_PENDING = 1;
const STATUS_SETTLED = 3;

const DRY_RUN = process.argv.includes("--dry-run");
const NO_DATE_FILTER = process.argv.includes("--no-date-filter");
const RATE_LIMIT_MS = 100;

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayISODate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function compactDate() {
  return todayISODate().replaceAll("-", "");
}

async function sqlQuery(sql) {
  const res = await fetch(`${BASE_URL}/v1/agent/app/sql/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({ appId: APP_ID, sqlQuery: sql, limit: 10000 }),
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`SQL error: ${json.message || JSON.stringify(json)}`);
  }
  return json.data.rows;
}

async function updateCommissionRecord(recordId, cells) {
  const url = `${BASE_URL}/v1/app-builder/table/${PARTNER_COMMISSIONS_TID}/record/${recordId}?appId=${APP_ID}`;
  let attempt = 0;
  while (attempt < 5) {
    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ cells }),
    });
    if (res.status === 429) {
      await sleep(3000);
      attempt++;
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`PUT ${recordId} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  throw new Error(`PUT ${recordId} failed after 5 retries (rate limited)`);
}

async function main() {
  console.log(`=== Commission Settlement Workflow ===`);
  console.log(`Date:        ${todayISODate()}`);
  console.log(`Mode:        ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Date filter: ${NO_DATE_FILTER ? "DISABLED" : "accrued_date < now() - 7 days"}`);
  console.log("");

  // 1. Fetch pending commissions (status stored as "[1]" string in ClickHouse)
  const dateClause = NO_DATE_FILTER ? "" : "AND accrued_date < now() - INTERVAL 7 DAY";
  const sql = `
    SELECT _id, partner, commission_amount, accrued_date, status
    FROM a1776271424351_partner_commissions
    WHERE _deleted = 0
      AND status = '[${STATUS_PENDING}]'
      ${dateClause}
    ORDER BY partner, accrued_date
  `.trim();

  const rows = await sqlQuery(sql);
  console.log(`Fetched ${rows.length} pending commission row(s).`);

  if (rows.length === 0) {
    console.log("Nothing to settle. Exiting.");
    return;
  }

  // 2. Group by partner uuid
  const byPartner = new Map();
  for (const r of rows) {
    if (!r.partner) continue;
    if (!byPartner.has(r.partner)) byPartner.set(r.partner, []);
    byPartner.get(r.partner).push(r);
  }
  console.log(`Grouped into ${byPartner.size} partner(s).`);

  // 3. Resolve partner codes (for settlement references)
  const partnerIds = [...byPartner.keys()];
  const partnerList = partnerIds.map((id) => `'${id}'`).join(",");
  const partnerRows = await sqlQuery(
    `SELECT _id, partner_code, partner_name FROM a1776271424351_distribution_partners WHERE _deleted = 0 AND _id IN (${partnerList})`
  );
  const partnerInfo = new Map();
  for (const p of partnerRows) {
    partnerInfo.set(p._id, { code: p.partner_code || p._id.slice(0, 8), name: p.partner_name || "(unknown)" });
  }

  const today = todayISODate();
  const datePart = compactDate();

  const summaries = [];
  const failures = [];
  let totalSettled = 0;

  // 4. Settle per partner
  for (const [partnerUuid, commissions] of byPartner) {
    const info = partnerInfo.get(partnerUuid) || { code: partnerUuid.slice(0, 8), name: "(unknown)" };
    const total = commissions.reduce((s, c) => s + Number(c.commission_amount || 0), 0);
    const ref = `SETT-${datePart}-${info.code}`;

    console.log("");
    console.log(`Partner ${info.code} (${info.name}) [${partnerUuid}]`);
    console.log(`  rows: ${commissions.length}  total: ${total.toFixed(2)}  ref: ${ref}`);

    let settledForPartner = 0;
    for (const c of commissions) {
      const cells = {
        [COL.STATUS]: [STATUS_SETTLED],
        [COL.SETTLED_DATE]: today,
        [COL.SETTLEMENT_REF]: ref,
      };
      if (DRY_RUN) {
        console.log(`  [dry-run] would PUT ${c._id} amount=${c.commission_amount}`);
        settledForPartner++;
        continue;
      }
      try {
        await updateCommissionRecord(c._id, cells);
        settledForPartner++;
        totalSettled++;
        await sleep(RATE_LIMIT_MS);
      } catch (err) {
        const msg = err.message || String(err);
        console.log(`  FAILED ${c._id}: ${msg.slice(0, 200)}`);
        failures.push({ id: c._id, partner: info.code, error: msg });
      }
    }

    summaries.push({
      partnerUuid,
      code: info.code,
      name: info.name,
      count: settledForPartner,
      total,
      ref,
    });

    console.log(`  settled: ${settledForPartner}/${commissions.length}`);
  }

  // 5. Summary
  console.log("");
  console.log("=== Summary ===");
  console.log(`Partners touched: ${summaries.length}`);
  console.log(`Commissions ${DRY_RUN ? "would-settle" : "settled"}: ${DRY_RUN ? rows.length : totalSettled}`);
  console.log(`Failures: ${failures.length}`);
  console.log("");

  summaries.sort((a, b) => b.total - a.total);
  console.log("Per-partner settled amounts (sorted desc):");
  for (const s of summaries) {
    console.log(
      `  ${s.code.padEnd(12)} ${s.name.padEnd(30)} count=${String(s.count).padStart(3)}  total=${s.total.toFixed(2).padStart(10)}  ref=${s.ref}`
    );
  }

  if (failures.length) {
    console.log("");
    console.log("Failures (first 10):");
    for (const f of failures.slice(0, 10)) {
      console.log(`  ${f.id} [${f.partner}] -> ${f.error.slice(0, 200)}`);
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
