// Convert Balance.Used Amount to a real ROLLUP and Remaining Amount to a real
// FORMULA, then trigger eval across all existing balances so they backfill.

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

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

async function main() {
  const TID_BAL = TABLE_IDS['Balances'];
  const TID_UTX = TABLE_IDS['Usage Transactions'];

  // --- Step 1: Find current Used/Remaining cols on Balances + the Balance ref on UT
  const balMeta = await api('GET', `/v1/app-builder/table/${TID_BAL}`);
  const utxMeta = await api('GET', `/v1/app-builder/table/${TID_UTX}`);
  const usedCol = balMeta.columnsMetaData.find(c => c.name === 'Used Amount');
  const remCol  = balMeta.columnsMetaData.find(c => c.name === 'Remaining Amount');
  const initCol = balMeta.columnsMetaData.find(c => c.name === 'Initial Amount');
  const utBalanceRefCol = utxMeta.columnsMetaData.find(c => c.name === 'Balance' && c.type === 'ref');
  const utUsedCol = utxMeta.columnsMetaData.find(c => c.name === 'Used Amount');

  log(`Balance.Used: ${usedCol?.id} (${usedCol?.type})`);
  log(`Balance.Remaining: ${remCol?.id} (${remCol?.type})`);
  log(`Balance.Initial: ${initCol?.id}`);
  log(`UT.Balance ref: ${utBalanceRefCol?.id}`);
  log(`UT.Used Amount: ${utUsedCol?.id}`);

  // --- Step 2: Delete current Used + Remaining
  if (remCol && remCol.type !== 'formula') {
    log(`Deleting plain Remaining (${remCol.id})...`);
    const r = await api('DELETE', `/v1/app-builder/table/${TID_BAL}/column/${remCol.id}`);
    log(`  → ${r.success ? '✓' : '✗ ' + JSON.stringify(r).slice(0,100)}`);
    await sleep(1100);
  }
  if (usedCol && usedCol.type !== 'rollup') {
    log(`Deleting plain Used (${usedCol.id})...`);
    const r = await api('DELETE', `/v1/app-builder/table/${TID_BAL}/column/${usedCol.id}`);
    log(`  → ${r.success ? '✓' : '✗ ' + JSON.stringify(r).slice(0,100)}`);
    await sleep(1100);
  }

  // --- Step 3: Create Used Amount as rollup
  log('Creating Used Amount as ROLLUP (SUM of Usage Transactions.Used Amount via Balance ref)...');
  const rollupResp = await api('POST', `/v1/app-builder/table/${TID_BAL}/column/bulk`, {
    columns: [{
      name: 'Used Amount',
      type: 'rollup',
      refTable: { _id: TID_UTX },
      formula: {
        expression: 'SUM({Used})',
        variablePath: { Used: [utBalanceRefCol.id, utUsedCol.id] },
      },
    }],
  });
  const newUsedId = rollupResp?.columns?.[0]?.id;
  log(`  → ${rollupResp.success ? '✓ rollup id=' + newUsedId : '✗ ' + JSON.stringify(rollupResp).slice(0,200)}`);
  await sleep(1500);

  // --- Step 4: Create Remaining Amount as formula
  log('Creating Remaining Amount as FORMULA (Initial − Used)...');
  const formulaResp = await api('POST', `/v1/app-builder/table/${TID_BAL}/column/bulk`, {
    columns: [{
      name: 'Remaining Amount',
      type: 'formula',
      formula: {
        expression: 'SUBTRACT({Initial}, {Used})',
        variablePath: {
          Initial: [initCol.id],
          Used:    [newUsedId],
        },
        outputType: 'number',
      },
    }],
  });
  const newRemId = formulaResp?.columns?.[0]?.id;
  log(`  → ${formulaResp.success ? '✓ formula id=' + newRemId : '✗ ' + JSON.stringify(formulaResp).slice(0,200)}`);
  await sleep(1500);

  // --- Step 5: Trigger evaluation across ALL balances
  log('Fetching all Balance IDs...');
  let allIds = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TID_BAL}/paged-record?pageNo=${page}&pageSize=200`, {});
    const batch = r?.data || [];
    allIds.push(...batch.map(b => b._id));
    if (batch.length < 200) break;
    page++;
    await sleep(500);
  }
  log(`  → ${allIds.length} balances`);

  log('Triggering eval on Used Amount...');
  const evalUsed = await api('POST', `/v1/app-builder/table/${TID_BAL}/evaluate/${newUsedId}?appId=${APP_ID}`, {
    sessionId: `eval-used-${Date.now()}`,
    filter: { ids: allIds },
  });
  log(`  → ${evalUsed.success ? '✓ eval started' : '✗ ' + JSON.stringify(evalUsed).slice(0,150)}`);
  await sleep(15000); // Give async compute time

  log('Triggering eval on Remaining Amount...');
  const evalRem = await api('POST', `/v1/app-builder/table/${TID_BAL}/evaluate/${newRemId}?appId=${APP_ID}`, {
    sessionId: `eval-rem-${Date.now()}`,
    filter: { ids: allIds },
  });
  log(`  → ${evalRem.success ? '✓ eval started' : '✗ ' + JSON.stringify(evalRem).slice(0,150)}`);
  await sleep(15000);

  // --- Step 6: Verify
  log('Verifying values populated (sample)...');
  const verify = await api('POST', `/v1/app-builder/table/${TID_BAL}/paged-record?pageNo=1&pageSize=200`, {});
  const samples = (verify?.data || []).slice(0, 5);
  for (const s of samples) {
    const code = s.cells.ucLa;
    const init = s.cells[initCol.id];
    const used = s.cells[newUsedId];
    const rem = s.cells[newRemId];
    log(`  ${code}: init=${init}, used=${used}, remaining=${rem}`);
  }
  // Count populated
  const populated = (verify?.data || []).filter(b => b.cells[newUsedId] != null).length;
  log(`  → ${populated}/${verify.data?.length || 0} balances have Used Amount populated`);
}

main().catch(e => { console.error(e); process.exit(1); });
