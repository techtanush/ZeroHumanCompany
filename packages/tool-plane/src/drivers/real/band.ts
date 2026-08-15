import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'BAND_API_KEY', base_url: 'https://api.band.us', path: '/v2.1/band/post/create', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('band', spec, args); }
