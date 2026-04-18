// Make Balance.Used Amount a true rollup of Usage Transactions.Used Amount
// (via the Balance ref column on Usage Transactions). Then make Balance.Remaining
// Amount a formula = Initial − Used.
//
// This means the simulator only needs to insert Usage Transactions; balances
// auto-compute. Same for any future workflow that records usage.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';

const TABLE_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(method, url, body) {
  const opts = { method, headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i=0; i<6; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) { await sleep(2500); continue; }
    return data;
  }
}

async function getCols(t) {
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[t]}`);
  return r.columnsMetaData || r.data?.columnsMetaData || [];
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

async function main() {
  log('Reading Balances + Usage Transactions schema...');
  const balCols = await getCols('Balances');
  const utxCols = await getCols('Usage Transactions');

  // Find related_ref on Balances → Usage Transactions
  // The related_ref column ID equals the target table ID
  const usageBacklink = balCols.find(c =>
    c.type === 'related_ref' && c.id === TABLE_IDS['Usage Transactions']
  );
  if (!usageBacklink) {
    console.error('  ✗ No related_ref from Balances → Usage Transactions found');
    process.exit(1);
  }
  log(`  Backlink col on Balances: id=${usageBacklink.id}, name="${usageBacklink.name}"`);

  // Find Used Amount on Usage Transactions
  const utxUsedCol = utxCols.find(c => c.name === 'Used Amount');
  if (!utxUsedCol) { console.error('  ✗ Usage Transactions.Used Amount not found'); process.exit(1); }
  log(`  UT.Used Amount col: id=${utxUsedCol.id}`);

  // Find existing Used Amount + Remaining Amount + Initial Amount on Balances
  const balUsed = balCols.find(c => c.name === 'Used Amount');
  const balRemaining = balCols.find(c => c.name === 'Remaining Amount');
  const balInitial = balCols.find(c => c.name === 'Initial Amount');
  log(`  Balance.Used: ${balUsed?.id} (type=${balUsed?.type})`);
  log(`  Balance.Remaining: ${balRemaining?.id} (type=${balRemaining?.type})`);
  log(`  Balance.Initial: ${balInitial?.id} (type=${balInitial?.type})`);

  // 1. Delete the dumb number columns (Used + Remaining) — must drop in dependency order: Remaining first (could reference Used in formula later)
  if (balRemaining && balRemaining.type === 'number') {
    log('Deleting dumb Remaining Amount column...');
    const r = await api('DELETE', `/v1/app-builder/table/${TABLE_IDS['Balances']}/column/${balRemaining.id}`);
    log(`  → ${r.success ? '✓ deleted' : '✗ ' + JSON.stringify(r).slice(0,200)}`);
    await sleep(1100);
  }
  if (balUsed && balUsed.type === 'number') {
    log('Deleting dumb Used Amount column...');
    const r = await api('DELETE', `/v1/app-builder/table/${TABLE_IDS['Balances']}/column/${balUsed.id}`);
    log(`  → ${r.success ? '✓ deleted' : '✗ ' + JSON.stringify(r).slice(0,200)}`);
    await sleep(1100);
  }

  // 2. Create Used Amount as rollup
  log('Creating Used Amount as rollup (SUM of Usage Transactions.Used Amount)...');
  const rollupBody = {
    columns: [{
      name: 'Used Amount',
      type: 'rollup',
      refTable: { _id: TABLE_IDS['Usage Transactions'] },
      formula: {
        expression: 'SUM(${Used})',
        variablePath: { Used: [usageBacklink.id, utxUsedCol.id] },
      },
    }],
  };
  const rollupResp = await api('POST', `/v1/app-builder/table/${TABLE_IDS['Balances']}/column/bulk`, rollupBody);
  const newUsed = rollupResp?.columns?.[0] || rollupResp?.data?.[0];
  log(`  → ${rollupResp.success ? '✓ created Used Amount as rollup, id=' + newUsed?.id : '✗ ' + JSON.stringify(rollupResp).slice(0,300)}`);
  await sleep(1500);

  // 3. Create Remaining Amount as formula
  log('Creating Remaining Amount as formula (Initial − Used)...');
  // Re-fetch column ids in case they changed
  const balColsFresh = await getCols('Balances');
  const initialId = balColsFresh.find(c => c.name === 'Initial Amount')?.id;
  const usedId = balColsFresh.find(c => c.name === 'Used Amount')?.id;
  if (!initialId || !usedId) {
    console.error('  ✗ Cannot find Initial/Used col ids after rollup creation');
    process.exit(1);
  }
  const formulaBody = {
    columns: [{
      name: 'Remaining Amount',
      type: 'formula',
      formula: {
        expression: 'SUBTRACT({Initial}, {Used})',
        variablePath: {
          Initial: [initialId],
          Used: [usedId],
        },
        outputType: 'number',
      },
    }],
  };
  const formulaResp = await api('POST', `/v1/app-builder/table/${TABLE_IDS['Balances']}/column/bulk`, formulaBody);
  log(`  → ${formulaResp.success ? '✓ created Remaining Amount as formula' : '✗ ' + JSON.stringify(formulaResp).slice(0,300)}`);
  await sleep(1500);

  // 4. Trigger evaluation for existing records
  const balColsFinal = await getCols('Balances');
  const newUsedId = balColsFinal.find(c => c.name === 'Used Amount')?.id;
  const newRemainingId = balColsFinal.find(c => c.name === 'Remaining Amount')?.id;
  log(`Triggering evaluation: Used Amount (${newUsedId}), Remaining Amount (${newRemainingId})...`);
  for (const id of [newUsedId, newRemainingId].filter(Boolean)) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS['Balances']}/evaluate/${id}?appId=${APP_ID}`, {});
    log(`  → ${id}: ${r.success ? '✓ evaluated' : '✗ ' + JSON.stringify(r).slice(0,200)}`);
    await sleep(1500);
  }

  log('=== PHASE 2C COMPLETE ===');
}

main().catch(e => { console.error(e); process.exit(1); });
