// Shared helper for module-build scripts.
// Usage: import * as lib from './lib-common.mjs';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const BASE_URL = 'https://api.erpai.studio';
export const TOKEN = process.env.TOKEN || 'erp_pat_live_REDACTED';
export const APP_ID = 'afe8c4540708da6ca9e6fe79';
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function loadTableIds() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));
}
export function saveTableIds(obj) {
  fs.writeFileSync(path.join(ROOT, '.table-ids.json'), JSON.stringify(obj, null, 2));
}

export async function api(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i = 0; i < 5; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt, status: res.status }; }
    if (res.status === 429) { await sleep(2000); continue; }
    return { ok: res.ok, status: res.status, data };
  }
}

export async function createTable(name, description = '', icon = 'Database', category = 'Telecom', idColName = 'ID', idColCode = 'ID') {
  // Check if table already exists under this name
  const list = await api('GET', `/v1/app-builder/table?appId=${APP_ID}&pageSize=200`);
  const existing = (list.data?.data || []).find(t => t.name === name);
  if (existing) return existing._id;
  const r = await api('POST', `/v1/app-builder/table`, {
    name, appId: APP_ID, description, icon, category,
    idColumn: { name: idColName, columnCode: idColCode },
  });
  const id = r.data?.data?._id || r.data?._id || r.data?.id;
  if (!id) throw new Error(`createTable(${name}) failed: ${JSON.stringify(r.data).slice(0, 400)}`);
  return id;
}

export async function getTableSchema(tableId) {
  const r = await api('GET', `/v1/app-builder/table/${tableId}`);
  return r.data?.columnsMetaData || [];
}

// Create columns using the bulk endpoint. `specs` is an array of column specs.
// Returns { name → id } map.
export async function createColumns(tableId, specs) {
  const r = await api('POST', `/v1/app-builder/table/${tableId}/column/bulk`, { columns: specs });
  if (!r.data?.success) {
    console.error('createColumns failed:', JSON.stringify(r.data).slice(0, 500));
    throw new Error('createColumns failed');
  }
  const out = {};
  for (const c of r.data.columns || []) out[c.name] = c.id;
  return out;
}

export async function createRecord(tableId, cells) {
  const r = await api('POST', `/v1/app-builder/table/${tableId}/record`, { cells });
  const id = r.data?.id || r.data?.data?.[0]?._id;
  if (!r.data?.success || !id) {
    throw new Error(`createRecord failed: ${JSON.stringify(r.data).slice(0, 400)}`);
  }
  return id;
}

export async function updateRecord(tableId, id, cells) {
  return api('PUT', `/v1/app-builder/table/${tableId}/record/${id}`, { cells });
}

export async function fetchAll(tableId) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${tableId}/paged-record?pageNo=${page}&pageSize=300`, {});
    const b = r.data?.data || [];
    all.push(...b);
    if (b.length < 300) break;
    page++;
  }
  return all;
}

export async function evalColumn(tableId, colId, recordIds) {
  return api('POST', `/v1/app-builder/table/${tableId}/evaluate/${colId}?appId=${APP_ID}`, {
    sessionId: `eval-${colId}-${Date.now()}`,
    filter: { ids: recordIds },
  });
}

export async function evalAllComputed(tableId, recordIds) {
  const cols = (await getTableSchema(tableId)).filter(c => c.type === 'formula' || c.type === 'rollup');
  for (const c of cols) {
    await evalColumn(tableId, c.id, recordIds);
    await sleep(300);
  }
}

// Lookup formula spec helper
export function lookupSpec(name, refColName, refColId, targetColName, targetColId, outputType = 'text') {
  const varName = `${refColName}->${targetColName}`;
  return {
    name, type: 'formula',
    formula: {
      expression: `\${${varName}}`,
      variablePath: { [varName]: [refColId, targetColId] },
      outputType,
    },
  };
}

// Rollup spec helper (matches observed working schema)
export function rollupSpec(name, childTableName, childTableId, childRefColId, targetColName, targetColId, aggregation = 'SUM', outputType = 'number') {
  const AGG = aggregation.toUpperCase();
  const varName = `${childTableName}->${targetColName}`;
  return {
    name, type: 'rollup',
    refTable: { _id: childTableId, colId: childRefColId },
    formula: {
      expression: `${AGG}(\${${varName}})`,
      variablePath: { [varName]: [childRefColId, targetColId] },
      outputType,
    },
    typeOptions: { aggregation: AGG },
  };
}

// Math formula spec helper (in-table columns)
export function formulaSpec(name, expression, variablePath, outputType = 'number') {
  return { name, type: 'formula', formula: { expression, variablePath, outputType } };
}

// Ref column spec (display = parent name column)
export function refSpec(name, targetTableId, displayColId, required = false) {
  return {
    name, type: 'ref',
    refTable: { _id: targetTableId, colId: displayColId },
    required,
  };
}

// Select column spec
export function selectSpec(name, options, required = false) {
  return {
    name, type: 'select', required,
    options: options.map((o, i) => ({ id: i + 1, name: o })),
  };
}
