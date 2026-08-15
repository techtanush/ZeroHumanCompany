import type { ZodTypeAny } from 'zod';
import { calculate } from './calc.js';
import { toolDefs, toolNames, type ToolName } from './definitions.js';
export { toolNames, type ToolName };
import { runRealTool } from './drivers/real/index.js';
import { stableHash } from './mock.js';

export type GateType =
  | 'money_out'
  | 'public_content'
  | 'outbound_to_real_person'
  | 'account_creation'
  | 'pivot_approval'
  | 'deploy'
  | 'refund'
  | 'new_department'
  | 'niche_selection'
  | 'voice_clone_consent';

export interface ToolCtx {
  venture_id: string;
  department_id: string;
  agent_id: string;
  work_order_id?: string;
  /** Absolute folder the founder granted the agency; workspace.* tools are confined to it. */
  workspace_root?: string;
  budget: { record(cost_usd: number, unit: string, resource: string): void };
  requestGate?(req: GateRequest): Promise<boolean>;
}

export interface GateRequest {
  gate: GateType;
  tool_name: string;
  venture_id: string;
  department_id: string;
  agent_id: string;
  work_order_id?: string;
  args: unknown;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: ZodTypeAny;
  sideEffecting: boolean;
  gate?: GateType;
  run(args: unknown, ctx: ToolCtx): Promise<unknown>;
}

export interface ToolCallEvent {
  type: 'agent.tool_used';
  tool_name: string;
  venture_id: string;
  department_id: string;
  agent_id: string;
  work_order_id?: string;
  cost_usd: number;
  unit: string;
  resource: string;
  driver: 'mock' | 'real';
}

export class GateRequiredError extends Error {
  constructor(public readonly gate: GateType, public readonly tool_name: string) {
    super(`Gate required for ${tool_name}: ${gate}`);
    this.name = 'GateRequiredError';
  }
}

type Driver = 'mock' | 'real';
type DegradedEvent = { type: 'degraded'; tool_name: string; reason: string };

export class ToolPlane {
  constructor(
    private readonly opts: {
      driver: Driver;
      fixturesDir?: string;
      onCall?: (ev: ToolCallEvent | DegradedEvent) => void;
    },
  ) {}

  build(names: string[], ctx: ToolCtx): Tool[] {
    return names.map((name) => this.buildOne(name, ctx));
  }

  private buildOne(name: string, buildCtx: ToolCtx): Tool {
    const def = toolDefs[name as ToolName];
    if (!def) throw new Error(`Unknown tool: ${name}`);

    return {
      name: def.name,
      description: def.description,
      input_schema: def.input_schema,
      sideEffecting: def.sideEffecting,
      gate: def.gate,
      run: async (raw: unknown, runCtx: ToolCtx = buildCtx) => {
        const args = def.input_schema.parse(raw);
        await this.ensureGate(def.name, def.gate, def.sideEffecting, args, runCtx);
        this.recordUsage(def, runCtx);

        // workspace.* is the founder's own disk: same code path in mock and real.
        if (def.name.startsWith('workspace.')) return def.mock(args, runCtx);

        if (this.opts.driver === 'real') {
          return runRealTool(
            def.name,
            args,
            (reason) => this.opts.onCall?.({ type: 'degraded', tool_name: def.name, reason }),
            () => def.mock(args, runCtx),
          );
        }

        return def.mock(args, runCtx);
      },
    };
  }

  private async ensureGate(name: string, gate: GateType | undefined, sideEffecting: boolean, args: unknown, ctx: ToolCtx): Promise<void> {
    if (!sideEffecting || !gate) return;

    const approved = await ctx.requestGate?.({
      gate,
      tool_name: name,
      venture_id: ctx.venture_id,
      department_id: ctx.department_id,
      agent_id: ctx.agent_id,
      work_order_id: ctx.work_order_id,
      args,
    });

    if (!approved) throw new GateRequiredError(gate, name);
  }

  private recordUsage(def: { name: string; cost_usd: number; unit: string; resource: string }, ctx: ToolCtx): void {
    ctx.budget.record(def.cost_usd, def.unit, def.resource);
    this.opts.onCall?.({
      type: 'agent.tool_used',
      tool_name: def.name,
      venture_id: ctx.venture_id,
      department_id: ctx.department_id,
      agent_id: ctx.agent_id,
      work_order_id: ctx.work_order_id,
      cost_usd: def.cost_usd,
      unit: def.unit,
      resource: def.resource,
      driver: this.opts.driver,
    });
  }
}

export const __test = { calculate, stableHash };
