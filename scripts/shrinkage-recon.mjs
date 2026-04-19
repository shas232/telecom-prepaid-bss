#!/usr/bin/env node
// shrinkage-recon.mjs — INV-009
// Weekly: SIM Inventory groupBy allocated_to_partner → counts of In Stock vs Allocated vs Activated.
// Shrinkage = allocated_total - activated - in_stock > tolerance (5) → flag.
// One Case per flagged partner (category=Other, priority=Medium), idempotent per week.
//
// Usage:
//   node scripts/shrinkage-recon.mjs
//   node scripts/shrinkage-recon.mjs --dry-run
//   node scripts/shrinkage-recon.mjs --partner PTR-XYZ

import { api, APP_ID, sleep } from './lib-common.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
function argVal(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const PARTNER_CODE = argVal('--partner');

const TID = {
  Cases: 'abb4445bc9dfd2ccd9b8eb5a',
};

const C = {
  CaseCode:    '14zr',
  Subject:     'CamK',
  Description: 'LaSR',
  Category:    'lUL1',
  Priority:    'cZCE',
  Status:      'wc3U',
  OpenedAt:    's8D6',
};

const TOLERANCE = 5;

function parseSelectId(v) {
  if (v == null || v === '' || v === '[]') return null;
  try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) && a.length ? Number(a[0]) : null; }
  catch { return null; }
}

function isoWeekTag(d = new Date()) {
  // YYYYWNN using Thursday-based ISO week
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}W${String(week).padStart(2, '0')}`;
}

async function sql(q) {
  const r = await api('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery: q, limit: 100000 });
  if (!r.ok) throw new Error('SQL: ' + JSON.stringify(r.data).slice(0, 400));
  return r.data?.data?.rows || [];
}

async function bulkInsert(tableId, rows) {
  if (!rows.length) return { inserted: 0, errors: [] };
  let inserted = 0; const errors = [];
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const r = await api('POST', `/v1/app-builder/table/${tableId}/record-bulk?appId=${APP_ID}`,
      { arr: batch.map(cells => ({ cells })) });
    if (!r.ok) errors.push({ start: i, status: r.status, body: JSON.stringify(r.data).slice(0, 400) });
    else inserted += batch.length;
    await sleep(150);
  }
  return { inserted, errors };
}

async function main() {
  const week = isoWeekTag();
  const weekTag = `shrinkage-${week}`;
  console.log(`== shrinkage-recon == week=${week} ${DRY ? '[DRY RUN]' : ''} ${PARTNER_CODE ? `partner=${PARTNER_CODE}` : ''}`);

  // Partners (Distribution Partners table ref id used by SIM Inventory.allocated_to_partner)
  let partnerFilter = `_deleted=0`;
  if (PARTNER_CODE) partnerFilter += ` AND partner_code='${PARTNER_CODE}'`;
  const partners = await sql(
    `SELECT _id, partner_code, partner_name FROM a1776271424351_distribution_partners WHERE ${partnerFilter}`
  );
  console.log(`partners in scope: ${partners.length}`);
  const partnerById = new Map(partners.map(p => [p._id, p]));

  // SIM inventory rows (pull only those allocated to a partner)
  const sims = await sql(
    `SELECT _id, status, allocated_to_partner FROM a1776271424351_sim_inventory
     WHERE _deleted=0 AND allocated_to_partner IS NOT NULL`
  );
  console.log(`allocated SIM rows: ${sims.length}`);

  const stats = new Map();
  for (const s of sims) {
    if (!s.allocated_to_partner) continue;
    if (PARTNER_CODE && !partnerById.has(s.allocated_to_partner)) continue;
    if (!stats.has(s.allocated_to_partner)) stats.set(s.allocated_to_partner, { allocated: 0, inStock: 0, activated: 0 });
    const st = stats.get(s.allocated_to_partner);
    st.allocated++;
    const statusId = parseSelectId(s.status);
    if (statusId === 1) st.inStock++;
    else if (statusId === 3) st.activated++;
  }

  // Idempotency: existing cases this week
  const existingCases = await sql(
    `SELECT description FROM a1776271424351_cases WHERE _deleted=0 AND description LIKE '%${weekTag}%'`
  );
  const handled = new Set();
  for (const c of existingCases) {
    const m = /partner=([^\s\n]+)/.exec(c.description || '');
    if (m) handled.add(m[1]);
  }
  console.log(`already handled this week: ${handled.size}`);

  const flagged = [];
  for (const [pid, st] of stats) {
    const shrinkage = st.allocated - st.activated - st.inStock;
    if (shrinkage > TOLERANCE) {
      const p = partnerById.get(pid);
      if (!p) continue;
      if (handled.has(p.partner_code)) continue;
      flagged.push({ partner: p, stats: st, shrinkage });
    }
  }
  console.log(`flagged partners: ${flagged.length}`);

  if (!flagged.length) return;

  const nowIso = new Date().toISOString();
  const caseRows = flagged.map((f, i) => ({
    [C.CaseCode]:    `CASE-${week}-SHR-${String(i + 1).padStart(3, '0')}`,
    [C.Subject]:     `Shrinkage variance at ${f.partner.partner_name || f.partner.partner_code}`,
    [C.Description]: `Operations shrinkage reconciliation ${weekTag}\npartner=${f.partner.partner_code}\nPartner: ${f.partner.partner_name}\nAllocated: ${f.stats.allocated}\nIn Stock: ${f.stats.inStock}\nActivated: ${f.stats.activated}\nUnaccounted (shrinkage): ${f.shrinkage} (tolerance=${TOLERANCE})`,
    [C.Category]:    [6], // Other (closest to Operations)
    [C.Priority]:    [2], // Medium
    [C.Status]:      [1], // Open
    [C.OpenedAt]:    nowIso,
  }));

  if (DRY) {
    console.log(`DRY: would insert ${caseRows.length} cases`);
    for (const f of flagged.slice(0, 5)) console.log(`  ${f.partner.partner_code}: allocated=${f.stats.allocated} inStock=${f.stats.inStock} activated=${f.stats.activated} shrinkage=${f.shrinkage}`);
    return;
  }

  const { inserted, errors } = await bulkInsert(TID.Cases, caseRows);
  console.log(`cases inserted: ${inserted}/${caseRows.length}`);
  if (errors.length) { console.log('ERRORS:'); for (const e of errors.slice(0, 5)) console.log(JSON.stringify(e).slice(0, 400)); }

  console.log('\n== DONE ==');
  console.log(`flagged=${flagged.length} cases=${inserted}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
