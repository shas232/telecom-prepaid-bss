// Re-populate Subscription.Current Plan from the active SPA. The earlier
// population may have been wiped during column-rebuild operations.

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

async function fetchAll(t) {
  const all = []; let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[t]}/paged-record?pageNo=${page}&pageSize=200`, {});
    const batch = r?.data || []; all.push(...batch);
    if (batch.length < 200) break;
    page++; await sleep(500);
  }
  return all;
}

async function main() {
  const subs = await fetchAll('Subscriptions');
  const spas = await fetchAll('Subscription Plan Assignments');
  const tariffs = await fetchAll('Tariff Plans');

  // Get column IDs
  const subMeta = await api('GET', `/v1/app-builder/table/${TABLE_IDS['Subscriptions']}`);
  const spaMeta = await api('GET', `/v1/app-builder/table/${TABLE_IDS['Subscription Plan Assignments']}`);
  const tariffMeta = await api('GET', `/v1/app-builder/table/${TABLE_IDS['Tariff Plans']}`);
  const subCols = subMeta.columnsMetaData.reduce((m,c)=>(m[c.name]=c.id,m), {});
  const spaCols = spaMeta.columnsMetaData.reduce((m,c)=>(m[c.name]=c.id,m), {});
  const tariffCols = tariffMeta.columnsMetaData.reduce((m,c)=>(m[c.name]=c.id,m), {});

  console.log(`Subscriptions has Current Plan col: ${subCols['Current Plan']}`);

  // Group SPAs by sub: only ACTIVE (no Effective To, status Active), pick highest priority (= base, priority 10)
  const subToBase = new Map();
  for (const a of spas) {
    const sid = a.cells[spaCols['Subscription']]?.[0];
    if (!sid) continue;
    if (a.cells[spaCols['Effective To']]) continue; // ended
    const tariffId = a.cells[spaCols['Tariff Plan']]?.[0];
    if (!tariffId) continue;
    const tariff = tariffs.find(t => t._id === tariffId);
    const priority = Number(tariff?.cells[tariffCols['Priority On Charge']]) || 10;
    // Keep the BASE plan (highest priority number, since boosters have lower priority)
    const existing = subToBase.get(sid);
    if (!existing || priority > existing.priority) {
      subToBase.set(sid, { tariffId, priority });
    }
  }

  let updated = 0;
  for (const s of subs) {
    const base = subToBase.get(s._id);
    if (!base) continue;
    const r = await api('PUT', `/v1/app-builder/table/${TABLE_IDS['Subscriptions']}/record/${s._id}`,
      { cells: { [subCols['Current Plan']]: [base.tariffId] } });
    if (r.success) updated++;
    await sleep(900);
  }
  console.log(`✓ Set Current Plan on ${updated} subscriptions`);
}

main().catch(e => { console.error(e); process.exit(1); });
