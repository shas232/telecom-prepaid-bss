#!/usr/bin/env node
// bulk-recharge.mjs — EVD-008
// Reads a CSV of recharges and inserts Recharges + Wallet Transactions, one per row.
//
// CSV columns (header required): msisdn,amount,channel,reference_id
//   channel: Voucher|USSD|App|Retail POS|IVR|Online|Bank Transfer  (name or id 1-7)
//
// Usage:
//   node scripts/bulk-recharge.mjs --csv scripts/bulk-recharge-sample.csv
//   node scripts/bulk-recharge.mjs --csv /path/file.csv --dry-run
//   node scripts/bulk-recharge.mjs --csv /path/file.csv --batch-size 20 --continue-on-error

import fs from 'node:fs';
import { api, APP_ID, sleep } from './lib-common.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONTINUE = args.includes('--continue-on-error');
function argVal(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const CSV = argVal('--csv');
const BATCH = Number(argVal('--batch-size')) || 20;

if (args.includes('--help') || args.includes('-h') || !CSV) {
  console.log(`bulk-recharge.mjs — import recharges from a CSV

  Usage:
    node scripts/bulk-recharge.mjs --csv <path> [--dry-run] [--batch-size N] [--continue-on-error]

  CSV columns (with header): msisdn,amount,channel,reference_id
    channel: Voucher|USSD|App|Retail POS|IVR|Online|Bank Transfer  (or 1-7)

  A sample CSV ships at scripts/bulk-recharge-sample.csv.`);
  if (!CSV) process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  if (args.includes('--help') || args.includes('-h')) process.exit(0);
}

const TID = {
  Recharges:        '4f5d0c07bc1db0dcef8e2c02',
  WalletTx:         'd9a7f5779835c59a75d837c3',
  Subscriptions:    '495e7f2e36663583722c8ec8',
  Wallets:          '1ec21f333aa5965f9d9be874',
};

const R = {
  Amount:       'Y39a',
  NetAmount:    'Qxij',
  Status:       'MMab',  // 2=Successful
  Timestamp:    'UG1r',
  RechargeCode: 'UhkZ',
  Currency:     'WzsW',
  Channel:      'cqLl',
  Wallet:       'fa5r',
  GatewayRef:   'tKyH',
};

const WT = {
  Amount:          '8n2I',
  Timestamp:       'ajVy',
  ReferenceType:   'YBNC',  // 1=Recharge
  TransactionType: 'FT69',  // 1=Recharge
  BalanceBefore:   'jNFT',
  BalanceAfter:    '1Hc4',
  ReferenceId:     'mqMb',
  TransactionCode: '93aU',
  Wallet:          '2yFo',
};

const CHANNEL_IDS = { 'Voucher':1, 'USSD':2, 'App':3, 'Retail POS':4, 'IVR':5, 'Online':6, 'Bank Transfer':7 };

function parseCsv(path) {
  const raw = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim());
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = cols[i];
    return obj;
  });
}

async function sql(q) {
  const r = await api('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery: q, limit: 100000 });
  if (!r.ok) throw new Error('SQL: ' + JSON.stringify(r.data).slice(0, 400));
  return r.data?.data?.rows || [];
}

async function bulkInsert(tableId, rows) {
  if (!rows.length) return { inserted: 0, ids: [], errors: [] };
  let inserted = 0; const ids = []; const errors = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const r = await api('POST', `/v1/app-builder/table/${tableId}/record-bulk?appId=${APP_ID}`,
      { arr: batch.map(cells => ({ cells })) });
    if (!r.ok) {
      errors.push({ start: i, status: r.status, body: JSON.stringify(r.data).slice(0, 400) });
      if (!CONTINUE) throw new Error(`insert failed at batch ${i}: ${r.status}`);
    } else {
      inserted += batch.length;
      const got = (r.data?.data || r.data?.arr || []).map(x => x?._id || x?.id).filter(Boolean);
      ids.push(...got);
    }
    await sleep(150);
  }
  return { inserted, ids, errors };
}

function today() {
  const d = new Date(); const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function main() {
  console.log(`== bulk-recharge == csv=${CSV} ${DRY ? '[DRY RUN]' : ''}`);

  const rows = parseCsv(CSV);
  console.log(`CSV rows: ${rows.length}`);
  if (!rows.length) return;

  // Resolve MSISDNs → subscription → customer → wallet
  const msisdns = rows.map(r => r.msisdn).filter(Boolean).map(m => `'${m.replace(/'/g, "''")}'`);
  if (!msisdns.length) { console.log('no msisdns found in CSV'); return; }
  const subs = await sql(
    `SELECT _id, msisdn, customer FROM a1776271424351_subscriptions
     WHERE _deleted=0 AND msisdn IN (${msisdns.join(',')})`
  );
  const subByMsisdn = new Map(subs.map(s => [s.msisdn, s]));
  const custIds = [...new Set(subs.map(s => s.customer).filter(Boolean))];
  const wallets = custIds.length ? await sql(
    `SELECT _id, customer, current_balance FROM a1776271424351_wallets
     WHERE _deleted=0 AND customer IN (${custIds.map(c => `'${c}'`).join(',')})`
  ) : [];
  const walletByCust = new Map(wallets.map(w => [w.customer, w]));

  const rechargeCells = [];
  const wtCells = [];
  const skips = [];
  let seq = 0;
  const ymd = today();

  for (const row of rows) {
    const sub = subByMsisdn.get(row.msisdn);
    if (!sub) { skips.push({ msisdn: row.msisdn, reason: 'no subscription' }); continue; }
    const wallet = walletByCust.get(sub.customer);
    if (!wallet) { skips.push({ msisdn: row.msisdn, reason: 'no wallet' }); continue; }
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) { skips.push({ msisdn: row.msisdn, reason: 'invalid amount' }); continue; }
    const chanId = /^\d+$/.test(row.channel) ? Number(row.channel) : (CHANNEL_IDS[row.channel] || 3);
    const balBefore = Number(wallet.current_balance) || 0;
    const balAfter = balBefore + amount;
    const ts = new Date().toISOString();
    seq++;
    const code = `RCH-${ymd}-${String(seq).padStart(5, '0')}`;
    const txCode = `WTX-${ymd}-${String(seq).padStart(5, '0')}`;
    rechargeCells.push({
      [R.RechargeCode]: code,
      [R.Amount]: amount,
      [R.NetAmount]: amount,
      [R.Status]: [2],
      [R.Timestamp]: ts,
      [R.Currency]: [1],
      [R.Channel]: [chanId],
      [R.Wallet]: [wallet._id],
      [R.GatewayRef]: row.reference_id || code,
    });
    wtCells.push({
      [WT.Amount]: amount,
      [WT.Timestamp]: ts,
      [WT.ReferenceType]: [1],
      [WT.TransactionType]: [1],
      [WT.BalanceBefore]: balBefore,
      [WT.BalanceAfter]: balAfter,
      [WT.ReferenceId]: row.reference_id || code,
      [WT.TransactionCode]: txCode,
      [WT.Wallet]: [wallet._id],
    });
    wallet.current_balance = balAfter; // in-memory running for successive rows on same wallet
  }

  console.log(`prepared: ${rechargeCells.length} recharges, ${wtCells.length} wallet tx, skipped ${skips.length}`);
  for (const s of skips.slice(0, 10)) console.log(`  skip ${s.msisdn}: ${s.reason}`);

  if (DRY) { console.log('DRY: no inserts performed'); return; }
  if (!rechargeCells.length) return;

  const r1 = await bulkInsert(TID.Recharges, rechargeCells);
  console.log(`recharges inserted: ${r1.inserted}/${rechargeCells.length} errors=${r1.errors.length}`);
  if (r1.errors.length) for (const e of r1.errors.slice(0, 3)) console.log('  ', JSON.stringify(e).slice(0, 300));

  const r2 = await bulkInsert(TID.WalletTx, wtCells);
  console.log(`wallet tx inserted: ${r2.inserted}/${wtCells.length} errors=${r2.errors.length}`);
  if (r2.errors.length) for (const e of r2.errors.slice(0, 3)) console.log('  ', JSON.stringify(e).slice(0, 300));

  console.log('\n== DONE ==');
  console.log(`recharges=${r1.inserted} walletTx=${r2.inserted} skipped=${skips.length}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
