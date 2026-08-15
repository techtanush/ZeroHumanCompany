import { bearer, hasEnv, postJson } from './common.js';

const env = 'WHOP_API_KEY';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const companyId = process.env.WHOP_COMPANY_ID;
  const body = companyId ? { company_id: companyId, ...((args as Record<string, unknown>) ?? {}) } : args;
  return postJson({ vendor: 'whop', url: 'https://api.whop.com/api/v5/checkouts', apiKey: key, headers: bearer(key), body });
}
