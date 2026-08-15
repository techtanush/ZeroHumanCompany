import { bearer, hasEnv, postJson } from './common.js';

const env = 'LINQ_API_KEY';
const defaultBaseUrl = 'https://api.linqapp.com/api/partner/v3';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  return runTool('linq.send_card', args);
}

export async function runTool(toolName: string, args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const baseUrl = process.env.LINQ_BASE_URL ?? defaultBaseUrl;
  if (toolName === 'linq.await_reply') {
    return postJson({ vendor: 'linq', url: `${baseUrl}/webhooks/replies/query`, apiKey: key, headers: bearer(key), body: args });
  }

  const input = args as { to?: string; message: unknown; gate_id?: string; thread_ref?: string };
  const body = {
    from: process.env.LINQ_FROM_NUMBER || undefined,
    to: [input.to ?? process.env.FOUNDER_PHONE].filter(Boolean),
    message: input.message,
    gate_id: input.gate_id,
    thread_ref: input.thread_ref,
  };
  return postJson({ vendor: 'linq', url: `${baseUrl}/messages`, apiKey: key, headers: bearer(key), body });
}
