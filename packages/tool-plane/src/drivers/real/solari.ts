import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'SOLARI_API_KEY', base_url: 'https://api.solari.com', path: '/v1/browse', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('solari', spec, args); }
