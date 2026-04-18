import { api, APP_ID } from './lib-common.mjs';
const q = process.argv[2];
const r = await api('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery: q, limit: 500 });
console.log(JSON.stringify(r.data?.data?.rows || r.data, null, 2));
