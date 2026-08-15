import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'DODO_API_KEY', base_url: 'https://api.dodopayments.com', path: '/v1/checkouts', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('dodo', spec, args); }
