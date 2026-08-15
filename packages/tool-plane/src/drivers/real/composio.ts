import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'COMPOSIO_API_KEY', base_url: 'https://backend.composio.dev', path: '/api/v1/actions/GMAIL_SEND_EMAIL/execute', auth: bearer };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('composio', spec, args); }
