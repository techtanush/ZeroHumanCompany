import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'REPLAY_API_KEY', base_url: 'https://api.replay.io', path: '/v1/test-runs', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('replay', spec, args); }
