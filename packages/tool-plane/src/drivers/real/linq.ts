import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'LINQ_API_KEY', base_url: 'https://api.linqapp.com', path: '/v1/cards', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('linq', spec, args); }
