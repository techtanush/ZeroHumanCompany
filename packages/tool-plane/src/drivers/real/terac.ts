import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'TERAC_API_KEY', base_url: 'https://api.terac.ai', path: '/v1/requisitions', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('terac', spec, args); }
