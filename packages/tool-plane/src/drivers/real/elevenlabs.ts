import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'ELEVENLABS_API_KEY', base_url: 'https://api.elevenlabs.io', path: '/v1/text-to-speech', auth: (key: string) => ({ 'xi-api-key': key }) };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('elevenlabs', spec, args); }
