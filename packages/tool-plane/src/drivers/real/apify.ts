import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'APIFY_TOKEN', base_url: 'https://api.apify.com', path: '/v2/acts/run-sync-get-dataset-items', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('apify', spec, args); }
