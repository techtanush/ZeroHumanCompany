import type { AgentSpec, DepartmentManifest } from '@zeroth/contracts';
import { renderPrompt } from '@zeroth/prompts';
import type { Tool, ToolCtx } from '@zeroth/tool-plane';
import { createHash } from 'node:crypto';
import {
  extractJson,
  resolveModel,
  tierOf,
  type LlmClient,
  type LlmRequest,
} from './llm.js';

export interface RunContext {
  venture_id: string;
  department_id: string;
  work_order_id?: string;
  trace_id: string;
  llm: LlmClient;
  /** Tools already filtered to this agent's allowlist. */
  tools: Tool[];
  toolCtx: ToolCtx;
  /** Values substituted into the prompt template. */
  vars: Record<string, unknown>;
  /** Called with token usage after every model call, for the Budget Meter. */
  onUsage?: (u: {
    agent_id: string; tier: string; model: string;
    tokens_in: number; tokens_out: number; tokens_cached_read: number;
  }) => Promise<void> | void;
  onEvent?: (type: string, payload: Record<string, unknown>) => Promise<void> | void;
  /** Model tier override from the Budget Meter (degradation). */
  resolveTier?: (requested: string) => Promise<string> | string;
  signal?: AbortSignal;
  /** Max tool-use round trips before we stop the agent. */
  maxSteps?: number;
}

export interface AgentResult {
  agent_id: string;
  text: string;
  json: unknown | null;
  tokens_in: number;
  tokens_out: number;
  prompt_hash: string;
  model: string;
  tool_calls: Array<{ name: string; ok: boolean; error?: string }>;
}

/**
 * Run one agent to completion: render its prompt, let it call only the tools its
 * manifest allows, meter every token, and return parsed JSON when it produced any.
 */
export async function runAgent(spec: AgentSpec, ctx: RunContext): Promise<AgentResult> {
  const requestedTier = spec.model;
  const tier = ctx.resolveTier ? await ctx.resolveTier(requestedTier) : requestedTier;
  const model = resolveModel(tier);

  const system = renderPrompt(spec.system_prompt_ref, {
    agent_id: spec.agent_id,
    department_id: ctx.department_id,
    venture_id: ctx.venture_id,
    ...ctx.vars,
  });
  const prompt_hash = createHash('sha256').update(`${system}::${model}`).digest('hex').slice(0, 16);

  const toolByName = new Map(ctx.tools.map((t) => [t.name, t]));
  const messages: LlmRequest['messages'] = [
    { role: 'user', content: String(ctx.vars.task ?? 'Perform your role and return the required JSON.') },
  ];

  let tokens_in = 0;
  let tokens_out = 0;
  const tool_calls: AgentResult['tool_calls'] = [];
  let text = '';

  await ctx.onEvent?.('agent.started', { agent_id: spec.agent_id, model, tier });

  const maxSteps = ctx.maxSteps ?? 6;
  for (let step = 0; step < maxSteps; step++) {
    if (ctx.signal?.aborted) throw new Error(`agent ${spec.agent_id} aborted`);

    const res = await ctx.llm.complete({
      model,
      system,
      messages,
      max_tokens: Math.min(spec.max_tokens_per_run, 8192),
      tools: ctx.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: { type: 'object' },
      })),
    });

    tokens_in += res.usage.input_tokens;
    tokens_out += res.usage.output_tokens;
    await ctx.onUsage?.({
      agent_id: spec.agent_id,
      tier: tierOf(model),
      model,
      tokens_in: res.usage.input_tokens,
      tokens_out: res.usage.output_tokens,
      tokens_cached_read: res.usage.cache_read_tokens,
    });

    text = res.text || text;

    if (res.stop_reason !== 'tool_use' || res.tool_uses.length === 0) break;

    // Execute the requested tools. An agent physically cannot call a tool that
    // is not in ctx.tools — the manifest allowlist is enforced by construction.
    const results: string[] = [];
    for (const use of res.tool_uses) {
      const tool = toolByName.get(use.name);
      if (!tool) {
        tool_calls.push({ name: use.name, ok: false, error: 'tool not allowed' });
        results.push(`${use.name}: ERROR tool not allowed for this agent`);
        await ctx.onEvent?.('agent.tool_failed', { agent_id: spec.agent_id, tool: use.name, error: 'not_allowed' });
        continue;
      }
      try {
        const out = await tool.run(use.input, { ...ctx.toolCtx, agent_id: spec.agent_id });
        tool_calls.push({ name: use.name, ok: true });
        results.push(`${use.name}: ${JSON.stringify(out).slice(0, 4000)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        tool_calls.push({ name: use.name, ok: false, error: msg });
        results.push(`${use.name}: ERROR ${msg}`);
        await ctx.onEvent?.('agent.tool_failed', { agent_id: spec.agent_id, tool: use.name, error: msg });
      }
    }
    messages.push({ role: 'assistant', content: res.text || '(tool use)' });
    messages.push({ role: 'user', content: `Tool results:\n${results.join('\n')}` });
  }

  let json: unknown | null = null;
  try {
    json = extractJson(text);
  } catch {
    json = null;
  }

  await ctx.onEvent?.('agent.finished', {
    agent_id: spec.agent_id, tokens_in, tokens_out, produced_json: json !== null,
  });

  return { agent_id: spec.agent_id, text, json, tokens_in, tokens_out, prompt_hash, model, tool_calls };
}

export function headSpec(manifest: DepartmentManifest): AgentSpec {
  return manifest.head;
}
