import fs from 'node:fs';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TOKEN = 'erp_pat_live_REDACTED';
const BASE = 'https://api.erpai.studio';
const TABLE_IDS = JSON.parse(fs.readFileSync('/Users/shas232/Desktop/Projects/Telco billing system/.table-ids.json', 'utf8'));
const R = JSON.parse(fs.readFileSync('/Users/shas232/Desktop/Projects/Telco billing system/.e2e-modules-result.json', 'utf8'));

async function api(m, u, b) {
  const o = { method: m, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } };
  if (b) o.body = JSON.stringify(b);
  const r = await fetch(BASE + u, o);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _error: true, _status: r.status, _body: t.slice(0, 200) }; }
}

const get = async (tableName, id) => {
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tableName]}/record/${id}`);
  if (Array.isArray(r)) return r[0] || {};
  return r || {};
};
const schema = (tableName) => api('GET', `/v1/app-builder/table/${TABLE_IDS[tableName]}`);

function resolveSelect(schemaObj, colId, cellVal) {
  if (cellVal == null) return null;
  const col = (schemaObj.columnsMetaData || []).find(c => c.id === colId || c._id === colId);
  if (!col) return cellVal;
  const opts = col.options || col.selectOptions || [];
  // cellVal could be like "[3]", or array, or already name
  const parseIds = v => {
    if (typeof v === 'string') {
      const m = v.match(/\[(\d+)\]/g);
      if (m) return m.map(x => x.replace(/[\[\]]/g, ''));
      return [v];
    }
    if (Array.isArray(v)) return v.map(x => String(x));
    return [String(v)];
  };
  const ids = parseIds(cellVal);
  const names = ids.map(id => {
    const o = opts.find(o => String(o.id) === String(id) || String(o._id) === String(id));
    return o ? o.name : id;
  });
  return names.length === 1 ? names[0] : names;
}

function cell(rec, colId) {
  if (!rec || !rec.cells) return undefined;
  return rec.cells[colId];
}

// ref cells typically arrays of ids
function refIds(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(x => typeof x === 'object' ? (x._id || x.id) : x);
  if (typeof v === 'object') return [v._id || v.id];
  return [v];
}

function toNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  if (Array.isArray(v) && v.length === 1) return toNum(v[0]);
  return NaN;
}

function toBool(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false' || v == null) return false;
  return Boolean(v);
}

const results = [];
function check(section, num, label, pass, detail) {
  results.push({ section, num, label, pass, detail });
}

async function main() {
  // Fetch all needed schemas in parallel
  const [
    sRoam, sPartner, sZone, sDev, sTAC, sEIR, sIMEI, sMNP, sNCE, sSub, sCust
  ] = await Promise.all([
    schema('Roaming Sessions'), schema('Roaming Partners'), schema('Roaming Zones'),
    schema('Devices'), schema('Device TAC Database'), schema('Equipment Identity Register'),
    schema('IMEI Change Events'), schema('MNP Requests'), schema('Number Change Events'),
    schema('Subscriptions'), schema('Customers')
  ]);

  // Print MNP and IMEI Change Events schema columns to identify needed column IDs
  const printCols = (name, s) => {
    const cols = (s.columnsMetaData || []).map(c => ({ id: c.id || c._id, name: c.name, type: c.type }));
    console.log(`\n=== ${name} columns ===`);
    for (const c of cols) console.log(`  ${c.id}  ${c.name}  (${c.type})`);
  };
  printCols('MNP Requests', sMNP);
  printCols('IMEI Change Events', sIMEI);
  printCols('Subscriptions', sSub);
  printCols('Customers', sCust);

  // Fetch all main records
  const [cust, sub, dev, fraudDev, roam, eir, mnp, partner, zone, tac] = await Promise.all([
    get('Customers', R.created.customerId),
    get('Subscriptions', R.created.subId),
    get('Devices', R.created.deviceId),
    get('Devices', R.created.fraudDeviceId),
    get('Roaming Sessions', R.created.roamSessionId),
    get('Equipment Identity Register', R.created.eirId),
    get('MNP Requests', R.created.mnpId),
    get('Roaming Partners', R.refs.singtelId),
    get('Roaming Zones', R.refs.aseanId),
    get('Device TAC Database', R.refs.iphoneTACId)
  ]);

  // dump record structures for debug
  fs.writeFileSync('/tmp/dump.json', JSON.stringify({
    cust: cust.cells, sub: sub.cells, dev: dev.cells, fraudDev: fraudDev.cells, roam: roam.cells,
    eir: eir.cells, mnp: mnp.cells, partner: partner.cells, zone: zone.cells, tac: tac.cells
  }, null, 2));

  // ====== A. RECORD EXISTENCE ======
  // 1. Customer Name starts with "Rohan Gupta"
  const custNameCol = (sCust.columnsMetaData || []).find(c => (c.name||'').toLowerCase() === 'name');
  const custName = custNameCol ? cell(cust, custNameCol.id || custNameCol._id) : null;
  const custNameStr = Array.isArray(custName) ? custName.join(' ') : String(custName || '');
  check('A', 1, 'Customer Name starts with "Rohan Gupta"', custNameStr.startsWith('Rohan Gupta'), `got: ${custNameStr}`);

  // 2. Subscription MSISDN
  const subMsisdnCol = (sSub.columnsMetaData || []).find(c => (c.name||'').toUpperCase() === 'MSISDN');
  const subMsisdn = subMsisdnCol ? cell(sub, subMsisdnCol.id || subMsisdnCol._id) : null;
  check('A', 2, 'Subscription MSISDN = 919988776655', String(subMsisdn) === '919988776655', `got: ${subMsisdn}`);

  // 3. Device IMEI
  const devImei = cell(dev, 'Zxqf');
  check('A', 3, 'Device IMEI matches createdImei', String(devImei) === String(R.createdImei), `got: ${devImei}, expected: ${R.createdImei}`);

  // 4. Device Make/Model/5G
  const devMake = cell(dev, '8A2D');
  const devModel = cell(dev, 'OWkc');
  const dev5G = cell(dev, 'hRMb');
  check('A', 4, 'Device Make=Apple, Model=iPhone 15 Pro, 5G=true',
    String(devMake) === 'Apple' && String(devModel) === 'iPhone 15 Pro' && toBool(dev5G) === true,
    `make=${devMake}, model=${devModel}, 5G=${dev5G}`);

  // 5. Roaming Country
  const country = cell(roam, 'VvVl');
  check('A', 5, 'Roaming Session Country = Singapore', String(country) === 'Singapore', `got: ${country}`);

  // 6-8. usage
  const dataUsage = toNum(cell(roam, 'jDAO'));
  const voiceUsage = toNum(cell(roam, 'Fdq3'));
  const totalCharged = toNum(cell(roam, 'Nws5'));
  check('A', 6, 'Data Usage = 1850', dataUsage === 1850, `got: ${dataUsage}`);
  check('A', 7, 'Voice Usage = 95', voiceUsage === 95, `got: ${voiceUsage}`);
  check('A', 8, 'Total Charged = 780', totalCharged === 780, `got: ${totalCharged}`);

  // 9. Partner Name (denormalized text)
  const partnerNameDen = cell(roam, 'GMjB');
  check('A', 9, 'Partner Name denorm = Singtel', String(partnerNameDen) === 'Singtel', `got: ${partnerNameDen}`);

  // 10. Zone Name denorm
  const zoneNameDen = cell(roam, 'tAIa');
  check('A', 10, 'Zone Name denorm = Southeast Asia', String(zoneNameDen) === 'Southeast Asia', `got: ${zoneNameDen}`);

  // 11. Status select = Active
  let statusVal = cell(roam, 'T1dQ');
  const statusName = resolveSelect(sRoam, 'T1dQ', statusVal);
  check('A', 11, 'Roaming Status = Active', String(statusName) === 'Active', `got: ${statusName} (raw=${JSON.stringify(statusVal)})`);

  // 12. EIR List Type = Graylist
  const listTypeVal = cell(eir, 'N3P3');
  const listTypeName = resolveSelect(sEIR, 'N3P3', listTypeVal);
  check('A', 12, 'EIR List Type = Graylist', String(listTypeName) === 'Graylist', `got: ${listTypeName} (raw=${JSON.stringify(listTypeVal)})`);

  // 13. EIR Reason = Fraud
  const reasonVal = cell(eir, 'YBdS');
  const reasonName = resolveSelect(sEIR, 'YBdS', reasonVal);
  check('A', 13, 'EIR Reason = Fraud', String(reasonName) === 'Fraud', `got: ${reasonName} (raw=${JSON.stringify(reasonVal)})`);

  // 14-16: MNP — find Type/Status/Recipient columns dynamically
  const mnpTypeCol = (sMNP.columnsMetaData || []).find(c => (c.name||'').toLowerCase() === 'type' || (c.name||'').toLowerCase() === 'request type' || (c.name||'').toLowerCase() === 'mnp type');
  const mnpStatusCol = (sMNP.columnsMetaData || []).find(c => (c.name||'').toLowerCase() === 'status');
  const mnpRecipCol = (sMNP.columnsMetaData || []).find(c => /recipient/i.test(c.name||''));
  const mnpTypeRaw = mnpTypeCol ? cell(mnp, mnpTypeCol.id || mnpTypeCol._id) : null;
  const mnpStatusRaw = mnpStatusCol ? cell(mnp, mnpStatusCol.id || mnpStatusCol._id) : null;
  const mnpRecipRaw = mnpRecipCol ? cell(mnp, mnpRecipCol.id || mnpRecipCol._id) : null;
  const mnpType = mnpTypeCol ? resolveSelect(sMNP, mnpTypeCol.id || mnpTypeCol._id, mnpTypeRaw) : null;
  const mnpStatus = mnpStatusCol ? resolveSelect(sMNP, mnpStatusCol.id || mnpStatusCol._id, mnpStatusRaw) : null;
  const mnpRecip = mnpRecipCol ? resolveSelect(sMNP, mnpRecipCol.id || mnpRecipCol._id, mnpRecipRaw) : null;
  check('A', 14, 'MNP Type = Port Out', String(mnpType) === 'Port Out', `col=${mnpTypeCol?.name} got: ${mnpType} (raw=${JSON.stringify(mnpTypeRaw)})`);
  check('A', 15, 'MNP Status = Donor Approved', String(mnpStatus) === 'Donor Approved', `col=${mnpStatusCol?.name} got: ${mnpStatus} (raw=${JSON.stringify(mnpStatusRaw)})`);
  check('A', 16, 'MNP Recipient = Airtel', String(mnpRecip) === 'Airtel', `col=${mnpRecipCol?.name} got: ${mnpRecip} (raw=${JSON.stringify(mnpRecipRaw)})`);

  // ====== B. REF INTEGRITY ======
  const roamSubRefs = refIds(cell(roam, 'tR4u'));
  const roamPartRefs = refIds(cell(roam, 'dhDj'));
  const roamZoneRefs = refIds(cell(roam, 'rfdK'));
  check('B', 17, 'Roaming Session refs (sub, partner, zone)',
    roamSubRefs.includes(R.created.subId) && roamPartRefs.includes(R.refs.singtelId) && roamZoneRefs.includes(R.refs.aseanId),
    `sub=${JSON.stringify(roamSubRefs)}, partner=${JSON.stringify(roamPartRefs)}, zone=${JSON.stringify(roamZoneRefs)}`);

  const devOwnerRefs = refIds(cell(dev, 'gMLL'));
  const devSubRefs = refIds(cell(dev, 'cO1V'));
  const devTacRefs = refIds(cell(dev, 'O0yP'));
  check('B', 18, 'Device refs (customer, sub, TAC)',
    devOwnerRefs.includes(R.created.customerId) && devSubRefs.includes(R.created.subId) && devTacRefs.includes(R.refs.iphoneTACId),
    `owner=${JSON.stringify(devOwnerRefs)}, sub=${JSON.stringify(devSubRefs)}, tac=${JSON.stringify(devTacRefs)}`);

  const eirDevRefs = refIds(cell(eir, 'eOhv'));
  check('B', 19, 'EIR points to fraud device',
    eirDevRefs.includes(R.created.fraudDeviceId), `got: ${JSON.stringify(eirDevRefs)}`);

  // MNP sub + customer refs — find by name
  const mnpSubCol = (sMNP.columnsMetaData || []).find(c => /subscription/i.test(c.name||'') && /ref|reference/i.test(c.type||''));
  const mnpCustCol = (sMNP.columnsMetaData || []).find(c => /customer/i.test(c.name||'') && /ref|reference/i.test(c.type||''));
  // fallback: any ref column containing those words
  const mnpSubColAny = mnpSubCol || (sMNP.columnsMetaData || []).find(c => /subscription/i.test(c.name||''));
  const mnpCustColAny = mnpCustCol || (sMNP.columnsMetaData || []).find(c => /customer/i.test(c.name||''));
  const mnpSubRefs = mnpSubColAny ? refIds(cell(mnp, mnpSubColAny.id || mnpSubColAny._id)) : [];
  const mnpCustRefs = mnpCustColAny ? refIds(cell(mnp, mnpCustColAny.id || mnpCustColAny._id)) : [];
  check('B', 20, 'MNP refs (sub, customer)',
    mnpSubRefs.includes(R.created.subId) && mnpCustRefs.includes(R.created.customerId),
    `sub=${JSON.stringify(mnpSubRefs)} (col=${mnpSubColAny?.name}), cust=${JSON.stringify(mnpCustRefs)} (col=${mnpCustColAny?.name})`);

  // ====== C. FORMULA LOOKUPS ======
  // 21. Roaming Session MSISDN formula
  const roamMsisdn = cell(roam, 'TX62');
  const roamMsisdnStr = Array.isArray(roamMsisdn) ? String(roamMsisdn[0]) : String(roamMsisdn);
  check('C', 21, 'Roaming Session MSISDN formula = 919988776655', roamMsisdnStr === '919988776655', `got: ${roamMsisdnStr}`);

  // 22. IMEI Change Events — find our event via sub's related records
  const iceSubCol = (sIMEI.columnsMetaData || []).find(c => /subscription/i.test(c.name||''));
  const iceMsisdnCol = (sIMEI.columnsMetaData || []).find(c => /msisdn/i.test(c.name||''));
  // list all IMEI Change Events
  const allIce = await api('GET', `/v1/app-builder/table/${TABLE_IDS['IMEI Change Events']}/record`);
  const iceList = Array.isArray(allIce) ? allIce : [];
  let ourIce = null;
  for (const rec of iceList) {
    const subR = iceSubCol ? refIds(rec.cells?.[iceSubCol.id || iceSubCol._id]) : [];
    if (subR.includes(R.created.subId)) { ourIce = rec; break; }
  }
  const iceMsisdnVal = ourIce && iceMsisdnCol ? ourIce.cells?.[iceMsisdnCol.id || iceMsisdnCol._id] : null;
  const iceMsisdnStr = Array.isArray(iceMsisdnVal) ? String(iceMsisdnVal[0]) : String(iceMsisdnVal);
  check('C', 22, 'IMEI Change Event MSISDN formula = 919988776655',
    iceMsisdnStr === '919988776655',
    `found event: ${!!ourIce}, msisdn col=${iceMsisdnCol?.name}, got: ${iceMsisdnStr}`);

  // ====== D. ROLLUPS ======
  // 23-24. Roaming Partners
  const partnerSessionCount = toNum(cell(partner, 'yxg5'));
  const partnerRevenue = toNum(cell(partner, 'r6ou'));
  check('D', 23, 'Partner Session Count >= 1', partnerSessionCount >= 1, `got: ${partnerSessionCount}`);
  check('D', 24, 'Partner Total Roaming Revenue >= 780', partnerRevenue >= 780, `got: ${partnerRevenue}`);

  // 25-26. Roaming Zones
  const zoneSessionCount = toNum(cell(zone, 'fHd6'));
  const zoneRevenue = toNum(cell(zone, 'n8Cl'));
  check('D', 25, 'Zone Session Count >= 1', zoneSessionCount >= 1, `got: ${zoneSessionCount}`);
  check('D', 26, 'Zone Total Revenue >= 780', zoneRevenue >= 780, `got: ${zoneRevenue}`);

  // 27. TAC Active Devices
  const tacActive = toNum(cell(tac, 'Lk4S'));
  check('D', 27, 'TAC Active Devices >= 1', tacActive >= 1, `got: ${tacActive}`);

  // 28. Fraud Device EIR Entries = 1
  const fraudEir = toNum(cell(fraudDev, 'e3Sq'));
  check('D', 28, 'Fraud Device EIR Entries = 1', fraudEir === 1, `got: ${fraudEir}`);

  // 29-32. Subscription rollups — need to find column IDs
  const findSubCol = (re) => (sSub.columnsMetaData || []).find(c => re.test(c.name||''));
  const subRoamSessCol = findSubCol(/roaming session count/i);
  const subLifetimeCol = findSubCol(/lifetime roaming/i);
  const subImeiCntCol = findSubCol(/imei change count/i);
  const subMnpCntCol = findSubCol(/mnp request count/i);
  const subRoamSess = subRoamSessCol ? toNum(cell(sub, subRoamSessCol.id || subRoamSessCol._id)) : null;
  const subLifetime = subLifetimeCol ? toNum(cell(sub, subLifetimeCol.id || subLifetimeCol._id)) : null;
  const subImeiCnt = subImeiCntCol ? toNum(cell(sub, subImeiCntCol.id || subImeiCntCol._id)) : null;
  const subMnpCnt = subMnpCntCol ? toNum(cell(sub, subMnpCntCol.id || subMnpCntCol._id)) : null;
  check('D', 29, 'Sub.Roaming Session Count = 1', subRoamSess === 1, `col=${subRoamSessCol?.name} got: ${subRoamSess}`);
  check('D', 30, 'Sub.Lifetime Roaming Charges = 780', subLifetime === 780, `col=${subLifetimeCol?.name} got: ${subLifetime}`);
  check('D', 31, 'Sub.IMEI Change Count = 1', subImeiCnt === 1, `col=${subImeiCntCol?.name} got: ${subImeiCnt}`);
  check('D', 32, 'Sub.MNP Request Count = 1', subMnpCnt === 1, `col=${subMnpCntCol?.name} got: ${subMnpCnt}`);

  // 33-35. Customer rollups
  const findCustCol = (re) => (sCust.columnsMetaData || []).find(c => re.test(c.name||''));
  const custDevCol = findCustCol(/^device count$/i);
  const custMnpCol = findCustCol(/^mnp request count$/i);
  const custSubCol = findCustCol(/^subscription count$/i);
  const custDev = custDevCol ? toNum(cell(cust, custDevCol.id || custDevCol._id)) : null;
  const custMnp = custMnpCol ? toNum(cell(cust, custMnpCol.id || custMnpCol._id)) : null;
  const custSubN = custSubCol ? toNum(cell(cust, custSubCol.id || custSubCol._id)) : null;
  check('D', 33, 'Customer.Device Count = 1', custDev === 1, `col=${custDevCol?.name} got: ${custDev}`);
  check('D', 34, 'Customer.MNP Request Count = 1', custMnp === 1, `col=${custMnpCol?.name} got: ${custMnp}`);
  check('D', 35, 'Customer.Subscription Count = 1', custSubN === 1, `col=${custSubCol?.name} got: ${custSubN}`);

  // ====== E. CROSS-MODULE ======
  const subCurDevCol = findSubCol(/current device/i);
  const subCurZoneCol = findSubCol(/current roaming zone/i);
  const subCurDev = subCurDevCol ? refIds(cell(sub, subCurDevCol.id || subCurDevCol._id)) : [];
  const subCurZone = subCurZoneCol ? refIds(cell(sub, subCurZoneCol.id || subCurZoneCol._id)) : [];
  check('E', 36, 'Sub.Current Device matches deviceId',
    subCurDev.includes(R.created.deviceId), `col=${subCurDevCol?.name} got: ${JSON.stringify(subCurDev)}`);
  check('E', 37, 'Sub.Current Roaming Zone = aseanId',
    subCurZone.includes(R.refs.aseanId), `col=${subCurZoneCol?.name} got: ${JSON.stringify(subCurZone)}`);

  // Retry logic for any rollup at zero (one-shot 15s wait + single refetch)
  const failingRollups = results.filter(r => r.section === 'D' && !r.pass && /= 0|got: 0\b|got: null/.test(r.detail));
  if (failingRollups.length > 0) {
    console.log(`\nWaiting 15s to retry ${failingRollups.length} rollup(s)...`);
    await new Promise(r => setTimeout(r, 15000));
    // refetch subscription, customer, partner, zone, tac, fraudDev
    const [sub2, cust2, part2, zone2, tac2, fraud2] = await Promise.all([
      get('Subscriptions', R.created.subId),
      get('Customers', R.created.customerId),
      get('Roaming Partners', R.refs.singtelId),
      get('Roaming Zones', R.refs.aseanId),
      get('Device TAC Database', R.refs.iphoneTACId),
      get('Devices', R.created.fraudDeviceId)
    ]);
    const recheck = (num, val, pass, detail) => {
      const r = results.find(x => x.num === num);
      if (r) { r.pass = pass; r.detail = detail + ' (after 15s retry)'; }
    };
    // re-evaluate each failing rollup
    for (const fr of failingRollups) {
      if (fr.num === 23) { const v = toNum(cell(part2, 'yxg5')); recheck(23, v, v >= 1, `got: ${v}`); }
      if (fr.num === 24) { const v = toNum(cell(part2, 'r6ou')); recheck(24, v, v >= 780, `got: ${v}`); }
      if (fr.num === 25) { const v = toNum(cell(zone2, 'fHd6')); recheck(25, v, v >= 1, `got: ${v}`); }
      if (fr.num === 26) { const v = toNum(cell(zone2, 'n8Cl')); recheck(26, v, v >= 780, `got: ${v}`); }
      if (fr.num === 27) { const v = toNum(cell(tac2, 'Lk4S')); recheck(27, v, v >= 1, `got: ${v}`); }
      if (fr.num === 28) { const v = toNum(cell(fraud2, 'e3Sq')); recheck(28, v, v === 1, `got: ${v}`); }
      if (fr.num === 29) { const v = subRoamSessCol ? toNum(cell(sub2, subRoamSessCol.id || subRoamSessCol._id)) : null; recheck(29, v, v === 1, `got: ${v}`); }
      if (fr.num === 30) { const v = subLifetimeCol ? toNum(cell(sub2, subLifetimeCol.id || subLifetimeCol._id)) : null; recheck(30, v, v === 780, `got: ${v}`); }
      if (fr.num === 31) { const v = subImeiCntCol ? toNum(cell(sub2, subImeiCntCol.id || subImeiCntCol._id)) : null; recheck(31, v, v === 1, `got: ${v}`); }
      if (fr.num === 32) { const v = subMnpCntCol ? toNum(cell(sub2, subMnpCntCol.id || subMnpCntCol._id)) : null; recheck(32, v, v === 1, `got: ${v}`); }
      if (fr.num === 33) { const v = custDevCol ? toNum(cell(cust2, custDevCol.id || custDevCol._id)) : null; recheck(33, v, v === 1, `got: ${v}`); }
      if (fr.num === 34) { const v = custMnpCol ? toNum(cell(cust2, custMnpCol.id || custMnpCol._id)) : null; recheck(34, v, v === 1, `got: ${v}`); }
      if (fr.num === 35) { const v = custSubCol ? toNum(cell(cust2, custSubCol.id || custSubCol._id)) : null; recheck(35, v, v === 1, `got: ${v}`); }
    }
  }

  // Output
  const by = {};
  for (const r of results) { (by[r.section] ||= []).push(r); }
  const labels = { A: 'A. RECORD EXISTENCE', B: 'B. REF INTEGRITY', C: 'C. FORMULA LOOKUPS', D: 'D. ROLLUPS', E: 'E. CROSS-MODULE' };
  let out = '';
  for (const s of ['A','B','C','D','E']) {
    out += `\n## ${labels[s]}\n`;
    for (const r of by[s] || []) {
      out += `${r.pass ? 'PASS' : 'FAIL'} ${r.num}. ${r.label}${r.pass ? '' : ' -- ' + r.detail}\n`;
    }
  }
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  out += `\n## SUMMARY\n${passed} passed / ${total} total\n`;
  const fails = results.filter(r => !r.pass);
  if (fails.length) { out += 'Failures:\n'; for (const f of fails) out += `  - #${f.num} ${f.label}: ${f.detail}\n`; }
  console.log(out);
}

main().catch(e => { console.error(e); process.exit(1); });
