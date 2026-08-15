import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'GITHUB_TOKEN', base_url: 'https://api.github.com', path: '/user/repos', auth: (key: string) => ({ authorization: `Bearer ${key}`, 'user-agent': 'zeroth-tool-plane', accept: 'application/vnd.github+json' }) };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('github', spec, args); }
