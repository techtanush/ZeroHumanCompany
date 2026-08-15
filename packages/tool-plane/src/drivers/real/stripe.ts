import { bearer, hasEnv, postJson } from './common.js';
const spec = { env: 'STRIPE_SECRET_KEY', base_url: 'https://api.stripe.com', path: '/v1/payment_links', auth: (key: string) => ({ authorization: `Bearer ${key}` }) };
export function hasKey(): boolean { return hasEnv(spec.env); }
export async function run(args: unknown): Promise<unknown> { return postJson('stripe', spec, args); }
