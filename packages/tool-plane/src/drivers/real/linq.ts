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
  const message = normalizeMessage(input.message);
  const body = {
    from: process.env.LINQ_FROM_NUMBER || undefined,
    to: [input.to ?? process.env.FOUNDER_PHONE].filter(Boolean),
    message,
    gate_id: input.gate_id,
    thread_ref: input.thread_ref,
  };
  return postJson({ vendor: 'linq', url: `${baseUrl}/chats`, apiKey: key, headers: bearer(key), body });
}

function normalizeMessage(message: unknown): unknown {
  if (typeof message === 'string') return { parts: [{ type: 'text', value: message }] };
  if (message && typeof message === 'object' && Array.isArray((message as any).parts)) {
    return {
      ...(message as any),
      parts: (message as any).parts.map((part: any) => {
        if (typeof part === 'string') return { type: 'text', value: part };
        if (part && typeof part === 'object' && 'text' in part && !('value' in part)) return { ...part, type: part.type ?? 'text', value: part.text };
        return part;
      }),
    };
  }
  return message;
}
