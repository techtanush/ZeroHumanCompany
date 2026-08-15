import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'PIONEER_API_KEY', base_url: 'https://api.pioneer.ai', path: '/v1/classify', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('pioneer', spec, args); }
