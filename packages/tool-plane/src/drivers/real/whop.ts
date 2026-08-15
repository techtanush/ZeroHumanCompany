import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'WHOP_API_KEY', base_url: 'https://api.whop.com', path: '/api/v5/checkouts', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('whop', spec, args); }
