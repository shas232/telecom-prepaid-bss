import { api, APP_ID } from './lib-common.mjs';
const TID={Balances:'9daeb0991b806538ceab887f'};
const BAL={Status:'VrcT'};
const r = await api('PUT', `/v1/app-builder/table/${TID.Balances}/record/90c3a3c71d62002633f6e82b`, {
  cells: { [BAL.Status]:[1] }
});
console.log(r.status);
