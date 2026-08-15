import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'RENDER_API_KEY', base_url: 'https://api.render.com', path: '/v1/services', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('render', spec, args); }
