import { api, APP_ID } from './lib-common.mjs';

const TID = {
  Balances:    '9daeb0991b806538ceab887f',
  TariffPlans: 'f2e797515f347f862e71a641',
  Wallets:     '1ec21f333aa5965f9d9be874',
};
const BAL = { Status:'VrcT', EffectiveTo:'GVKg', CycleEnd:'DXPX', TariffPlan:'1hH7' };
const TP  = { AutoRenewDefault:'YAhL' };
const WAL = { CurrentBalance:'PEUU', LifetimeSpend:'QGjX' };

const balId    = '90c3a3c71d62002633f6e82b';
const walId    = 'c776a133-035a-4c22-9f88-a10fded5b9c8';
const planId   = '2d23b75f-9e4e-4b22-9fe1-040d058685c1'; // Live Social Monthly (61)

// yesterday
const d = new Date(); d.setUTCDate(d.getUTCDate()-1);
const yesterdayISO = d.toISOString();

// 1) update balance: tariff_plan set, effective_to=yesterday, cycle_end=yesterday, status=Active
let r;
r = await api('PUT', `/v1/app-builder/table/${TID.Balances}/record/${balId}`, {
  cells: { [BAL.TariffPlan]:[planId], [BAL.EffectiveTo]: yesterdayISO, [BAL.CycleEnd]: yesterdayISO, [BAL.Status]:[1] }
});
console.log('balance update:', r.status);

// 2) wallet -> 1000, lifetime_spend stays same (356)
r = await api('PUT', `/v1/app-builder/table/${TID.Wallets}/record/${walId}`, {
  cells: { [WAL.CurrentBalance]: 1000 }
});
console.log('wallet update:', r.status);

// 3) flip plan auto_renew_default = true
r = await api('PUT', `/v1/app-builder/table/${TID.TariffPlans}/record/${planId}`, {
  cells: { [TP.AutoRenewDefault]: true }
});
console.log('plan update:', r.status);
