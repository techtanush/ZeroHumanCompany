import { z, type ZodTypeAny } from 'zod';
import { runRealTool } from './drivers/real/index.js';

export type GateType = 'outbound_to_real_person' | 'money_out' | 'deploy';
export interface ToolCtx { venture_id: string; department_id: string; agent_id: string; work_order_id?: string; budget: { record(cost_usd: number, unit: string, resource: string): void }; requestGate?(req: GateRequest): Promise<boolean> }
export interface GateRequest { gate: GateType; tool_name: string; venture_id: string; department_id: string; agent_id: string; work_order_id?: string; args: unknown }
export interface Tool { name: string; description: string; input_schema: ZodTypeAny; sideEffecting: boolean; gate?: GateType; run(args: unknown, ctx: ToolCtx): Promise<unknown> }
export interface ToolCallEvent { type: 'agent.tool_used'; tool_name: string; venture_id: string; department_id: string; agent_id: string; work_order_id?: string; cost_usd: number; unit: string; resource: string; driver: 'mock' | 'real' }
export class GateRequiredError extends Error { constructor(public readonly gate: GateType, public readonly tool_name: string) { super(`Gate required for ${tool_name}: ${gate}`); this.name = 'GateRequiredError'; } }

type Driver = 'mock' | 'real';
type ToolDef = Omit<Tool, 'run'> & { cost_usd: number; unit: string; resource: string; mock(args: unknown, ctx: ToolCtx): Promise<unknown> };

const objectSchema = z.record(z.unknown()).default({});
const textSchema = z.object({ text: z.string() });
const urlSchema = z.object({ url: z.string().url() });
const querySchema = z.object({ query: z.string() });
const namedSchemas: Record<string, ZodTypeAny> = {
  web_search: querySchema, web_fetch: urlSchema, calc: z.object({ expression: z.string() }), memory_read: querySchema,
  memory_write: z.object({ key: z.string(), value: z.unknown() }), 'apify.run_actor': z.object({ actor_id: z.string(), input: z.unknown().optional() }),
  'solari.browse': z.object({ task: z.string(), url: z.string().url().optional() }), 'composio.gmail_send': z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  'stripe.create_payment_link': z.object({ name: z.string(), amount_cents: z.number().int().positive(), currency: z.string().default('usd') }),
  'whop.create_checkout': objectSchema, 'dodo.create_checkout': objectSchema, 'terac.post_requisition': objectSchema,
  'elevenlabs.tts': textSchema, 'render.deploy': objectSchema, 'replay.run_suite': objectSchema, 'linq.send_card': objectSchema,
  'band.publish': objectSchema, 'pioneer.classify': objectSchema, 'github.push': objectSchema,
};

const tools = ['web_search','web_fetch','calc','memory_read','memory_write','apify.run_actor','solari.browse','composio.gmail_send','stripe.create_payment_link','whop.create_checkout','dodo.create_checkout','terac.post_requisition','elevenlabs.tts','render.deploy','replay.run_suite','linq.send_card','band.publish','pioneer.classify','github.push'] as const;
type ToolName = typeof tools[number];

function stableHash(value: unknown): number { const s = JSON.stringify(value, Object.keys(value as object).sort()); let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mockPayload(name: string, args: unknown): unknown { const seed = stableHash({ name, args }); return { provider: 'mock', tool_name: name, seed, id: `${name.replace(/[^a-z0-9]+/g, '_')}_${seed.toString(16)}`, ok: true, data: args }; }

function calculate(expression: string): number {
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/^]/g) ?? [];
  if (tokens.join('').replace(/\s/g,'') !== expression.replace(/\s/g,'')) throw new Error('Invalid token');
  const out: string[] = [], ops: string[] = []; const prec: Record<string, number> = { '+':1, '-':1, '*':2, '/':2, '^':3 };
  for (const t of tokens) { if (/^\d/.test(t)) out.push(t); else if (t === '(') ops.push(t); else if (t === ')') { while (ops.length && ops.at(-1) !== '(') out.push(ops.pop()!); if (ops.pop() !== '(') throw new Error('Mismatched parentheses'); } else { while (ops.length && ops.at(-1)! !== '(' && (prec[ops.at(-1)!] > prec[t] || (prec[ops.at(-1)!] === prec[t] && t !== '^'))) out.push(ops.pop()!); ops.push(t); } }
  while (ops.length) { const op = ops.pop()!; if (op === '(') throw new Error('Mismatched parentheses'); out.push(op); }
  const stack: number[] = []; for (const t of out) { if (/^\d/.test(t)) stack.push(Number(t)); else { const b = stack.pop(), a = stack.pop(); if (a === undefined || b === undefined) throw new Error('Invalid expression'); const v = t==='+'?a+b:t==='-'?a-b:t==='*'?a*b:t==='/'?a/b:Math.pow(a,b); if (!Number.isFinite(v)) throw new Error('Non-finite result'); stack.push(v); } }
  if (stack.length !== 1) throw new Error('Invalid expression'); return stack[0]!;
}

const defs = Object.fromEntries(tools.map((name) => [name, { name, description: `Run ${name}`, input_schema: namedSchemas[name], sideEffecting: !['web_search','web_fetch','calc','memory_read','pioneer.classify'].includes(name), gate: ({'composio.gmail_send':'outbound_to_real_person','stripe.create_payment_link':'money_out','terac.post_requisition':'money_out','render.deploy':'deploy'} as Partial<Record<ToolName, GateType>>)[name], cost_usd: name==='calc'?0.00001:0.001, unit:'call', resource:name, mock: async (args: unknown) => name==='calc' ? { result: calculate(z.object({ expression: z.string() }).parse(args).expression) } : mockPayload(name,args) } satisfies ToolDef])) as unknown as Record<ToolName, ToolDef>;

export class ToolPlane {
  constructor(private readonly opts: { driver: Driver; fixturesDir?: string; onCall?: (ev: ToolCallEvent | { type:'degraded'; tool_name: string; reason: string }) => void }) {}
  build(names: string[], ctx: ToolCtx): Tool[] { return names.map((name) => { const def = defs[name as ToolName]; if (!def) throw new Error(`Unknown tool: ${name}`); return { name: def.name, description: def.description, input_schema: def.input_schema, sideEffecting: def.sideEffecting, gate: def.gate, run: async (raw: unknown, runCtx: ToolCtx = ctx) => { const args = def.input_schema.parse(raw); if (def.sideEffecting && def.gate) { const approved = await runCtx.requestGate?.({ gate: def.gate, tool_name: def.name, venture_id: runCtx.venture_id, department_id: runCtx.department_id, agent_id: runCtx.agent_id, work_order_id: runCtx.work_order_id, args }); if (!approved) throw new GateRequiredError(def.gate, def.name); } runCtx.budget.record(def.cost_usd, def.unit, def.resource); this.opts.onCall?.({ type:'agent.tool_used', tool_name:def.name, venture_id:runCtx.venture_id, department_id:runCtx.department_id, agent_id:runCtx.agent_id, work_order_id:runCtx.work_order_id, cost_usd:def.cost_usd, unit:def.unit, resource:def.resource, driver:this.opts.driver }); if (this.opts.driver === 'real') return runRealTool(def.name, args, (reason) => this.opts.onCall?.({ type:'degraded', tool_name:def.name, reason }), () => def.mock(args, runCtx)); return def.mock(args, runCtx); } }; }); }
}
export const __test = { calculate, stableHash };
