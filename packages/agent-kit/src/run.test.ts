import { describe, expect, it } from 'vitest';
import type { AgentSpec } from '@zeroth/contracts';
import { z } from 'zod';
import { runAgent, type RunContext } from './run.js';
import type { LlmClient } from './llm.js';
import type { Tool } from '@zeroth/tool-plane';

describe('runAgent', () => {
  it('attributes tool execution to the actual agent spec', async () => {
    const seenAgentIds: string[] = [];
    const tool: Tool = {
      name: 'calc',
      description: 'test tool',
      input_schema: z.object({ expression: z.string() }),
      sideEffecting: false,
      run: async (_args, ctx) => {
        seenAgentIds.push(ctx.agent_id);
        return { result: 3 };
      },
    };
    let calls = 0;
    const llm: LlmClient = {
      kind: 'mock',
      complete: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            text: '',
            stop_reason: 'tool_use',
            tool_uses: [{ id: 'toolu_1', name: 'calc', input: { expression: '1+2' } }],
            usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0 },
          };
        }
        return {
          text: '{"ok":true}',
          stop_reason: 'end_turn',
          tool_uses: [],
          usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0 },
        };
      },
    };
    const spec: AgentSpec = {
      agent_id: 'leads.enricher',
      model: 'sonnet',
      replicas: 1,
      system_prompt_ref: 'prompts/D09/enricher.md',
      tools: ['calc'],
      max_tokens_per_run: 1000,
    };
    const ctx: RunContext = {
      venture_id: 'v1',
      department_id: 'D09',
      work_order_id: 'wo1',
      trace_id: 't1',
      llm,
      tools: [tool],
      toolCtx: {
        venture_id: 'v1',
        department_id: 'D09',
        work_order_id: 'wo1',
        agent_id: 'D09.head',
        budget: { record: () => undefined },
      },
      vars: { task: 'test' },
    };

    await runAgent(spec, ctx);
    expect(seenAgentIds).toEqual(['leads.enricher']);
  });
});
