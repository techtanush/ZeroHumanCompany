import type { ModelTier } from '@zeroth/contracts';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  max_tokens: number;
  tools?: Array<{ name: string; description: string; input_schema: unknown }>;
  temperature?: number;
}

export interface LlmToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
  tool_uses: LlmToolUse[];
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number };
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
}

export interface LlmClient {
  readonly kind: 'anthropic' | 'mock';
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Model ids per tier. Overridable by env so a model rename is a config change. */
export function resolveModel(tier: string): string {
  if (tier.startsWith('pioneer:')) return tier;
  const env: Record<string, string | undefined> = {
    opus: process.env.ANTHROPIC_MODEL_OPUS,
    sonnet: process.env.ANTHROPIC_MODEL_SONNET,
    haiku: process.env.ANTHROPIC_MODEL_HAIKU,
  };
  const fallback: Record<string, string> = {
    opus: 'claude-opus-4-20250514',
    sonnet: 'claude-sonnet-4-20250514',
    haiku: 'claude-3-5-haiku-20241022',
  };
  return env[tier] ?? fallback[tier] ?? fallback.sonnet;
}

export function tierOf(model: string): ModelTier {
  if (model.startsWith('pioneer:')) return 'pioneer';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return 'sonnet';
}

/**
 * Anthropic client over plain fetch: no SDK dependency, so the only thing
 * standing between this and live models is ANTHROPIC_API_KEY.
 */
export class AnthropicClient implements LlmClient {
  readonly kind = 'anthropic' as const;

  constructor(
    private apiKey: string,
    private baseUrl = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    private timeoutMs = 120_000,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.max_tokens,
          temperature: req.temperature ?? 0,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          ...(req.tools?.length ? { tools: req.tools } : {}),
        }),
        signal: ac.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        // Never echo the request body back: it can contain credentials.
        throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
      }
      const body = JSON.parse(text);
      const parts: any[] = body.content ?? [];
      return {
        text: parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n'),
        tool_uses: parts
          .filter((p) => p.type === 'tool_use')
          .map((p) => ({ id: p.id, name: p.name, input: p.input ?? {} })),
        usage: {
          input_tokens: body.usage?.input_tokens ?? 0,
          output_tokens: body.usage?.output_tokens ?? 0,
          cache_read_tokens: body.usage?.cache_read_input_tokens ?? 0,
        },
        stop_reason: body.stop_reason === 'tool_use' ? 'tool_use' : body.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export type MockHandler = (req: LlmRequest) => string | Promise<string>;

/**
 * Deterministic stand-in for a model. The whole company runs on this until the
 * API key lands, which is what lets every department be tested end to end.
 */
export class MockLlmClient implements LlmClient {
  readonly kind = 'mock' as const;
  private handlers: Array<{ match: RegExp; handler: MockHandler }> = [];

  /** Register a canned response for prompts matching a pattern. */
  on(match: RegExp, handler: MockHandler): this {
    this.handlers.push({ match, handler });
    return this;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const haystack = `${req.system}\n${req.messages.map((m) => m.content).join('\n')}`;
    const hit = this.handlers.find((h) => h.match.test(haystack));
    const text = hit ? await hit.handler(req) : JSON.stringify({ mock: true, note: 'no handler matched' });
    return {
      text,
      tool_uses: [],
      usage: {
        input_tokens: Math.ceil(haystack.length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cache_read_tokens: 0,
      },
      stop_reason: 'end_turn',
    };
  }
}

/** Real client when the key exists, deterministic mock when it does not. */
export function createLlmClient(): LlmClient {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && process.env.ZEROTH_LLM !== 'mock') return new AnthropicClient(key);
  return new MockLlmClient();
}

/** Pull the first JSON object/array out of a model response. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error('no JSON found in model output');
  const opener = candidate[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === opener) depth++;
    else if (c === closer) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error('unterminated JSON in model output');
}
