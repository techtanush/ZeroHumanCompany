/**
 * Minimal OpenAI client used for venture-level reasoning that sits above any
 * single department: understanding the product right after onboarding,
 * deciding which departments matter most for it, giving Market Research a
 * head start, and turning a newly-connected tool (LinkedIn, Gmail, …) into a
 * concrete usage strategy for the department that owns it. Anthropic still
 * runs every department agent — this is a second, narrower brain for
 * cross-cutting judgment calls, not a replacement.
 */

function hasKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Three-provider fallback chain so one vendor outage never stalls a
 * department: OpenAI first, then Anthropic, then Groq. Every call returns
 * plain text; JSON callers parse it themselves so a fallback provider's
 * slightly different formatting can't hard-fail the chain.
 */
async function chatTextChain(system: string, user: string): Promise<string | null> {
  // Same mock-mode convention as the agent runtime (packages/agent-kit/src/llm.ts)
  // and the /v1/integrations driver flag: ZEROTH_LLM=mock means no live vendor
  // calls, full stop — tests and offline demos depend on this being absolute.
  if (process.env.ZEROTH_LLM === 'mock') return null;
  const attempts: Array<() => Promise<string | null>> = [
    async () => {
      if (!process.env.OPENAI_API_KEY) return null;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          temperature: 0.4,
        }),
      });
      if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as any;
      return j.choices?.[0]?.message?.content ?? null;
    },
    async () => {
      if (!process.env.ANTHROPIC_API_KEY) return null;
      const res = await fetch(`${process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL_HAIKU ?? 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: `${system}\nRespond with ONLY the JSON object, no prose.`,
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as any;
      return j.content?.find((p: any) => p.type === 'text')?.text ?? null;
    },
    async () => {
      if (!process.env.GROQ_API_KEY) return null;
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: `${system}\nRespond with ONLY the JSON object, no prose.` }, { role: 'user', content: user }],
          temperature: 0.4,
        }),
      });
      if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as any;
      return j.choices?.[0]?.message?.content ?? null;
    },
  ];
  for (const attempt of attempts) {
    try {
      const text = await attempt();
      if (text) return text;
    } catch (e) {
      console.error('[llm-chain] provider failed, trying next', e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function chatJson<T>(system: string, user: string, fallback: T): Promise<T> {
  const text = await chatTextChain(system, user);
  if (!text) return fallback;
  const parsed = extractJsonObject(text);
  return parsed ? { ...fallback, ...parsed } : fallback;
}

/** Free-text variant of the fallback chain — used for grounded agent status replies. */
export async function chatText(system: string, user: string, fallback: string): Promise<string> {
  const text = await chatTextChain(`${system}\nRespond ONLY with JSON: {"reply": "your answer as one short paragraph"}.`, user);
  if (!text) return fallback;
  const parsed = extractJsonObject(text);
  const reply = typeof parsed?.reply === 'string' ? parsed.reply : null;
  return reply?.trim() || fallback;
}

export interface VentureBrief {
  summary: string;
  recommended_departments: string[];
  market_research_notes: string;
}

const ALL_DEPTS = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12', 'D13'];

/** Right after onboarding: read the idea and decide what matters, in the founder's own words. */
export async function briefVenture(idea: { raw_statement?: string; normalized?: Record<string, unknown> }): Promise<VentureBrief> {
  const fallback: VentureBrief = {
    summary: idea.raw_statement ?? '',
    recommended_departments: ALL_DEPTS,
    market_research_notes: '',
  };
  if (!idea.raw_statement) return fallback;
  return chatJson<VentureBrief>(
    'You are the chief of staff of an AI-run company. Given a founder\'s product idea, respond ONLY with JSON: ' +
      '{"summary": "2 sentences on what this product actually is and who it is for", ' +
      '"recommended_departments": ["D01".."D13", pick the ones essential to run first, D02 and D03 are almost always essential], ' +
      '"market_research_notes": "3-4 sentences: what Market Research (D03) should specifically go dig up for this idea - real niches, comparable pricing, and where the buyers actually are"}',
    `Idea: ${idea.raw_statement}\nDetails: ${JSON.stringify(idea.normalized ?? {})}`,
    fallback,
  );
}

/** Once a toolkit (LinkedIn, Gmail, GitHub, …) connects, tell the owning department how to actually use it. */
export async function integrationStrategy(toolkit: string, department: string, ideaSummary: string): Promise<string> {
  if (!hasKey()) return '';
  const r = await chatJson<{ plan: string }>(
    'You are a growth operator. Respond ONLY with JSON {"plan": "..."}. In 2-3 concrete sentences, say exactly how this ' +
      'department should use this newly-connected tool for this product - name specific tactics (e.g. cold outreach ' +
      'sequencing, warm-connection leverage, content cadence), not generic advice.',
    `Tool: ${toolkit}\nDepartment: ${department}\nProduct: ${ideaSummary}`,
    { plan: '' },
  );
  return r.plan;
}
