import { z, type ZodTypeAny } from 'zod';
import type { GateType, ToolCtx } from './index.js';
import { calculate } from './calc.js';
import { mockTool } from './mock.js';

export const toolNames = [
  'web_search',
  'web_fetch',
  'calc',
  'memory_read',
  'memory_write',
  'apify.run_actor',
  'solari.browse',
  'composio.gmail_send',
  'stripe.create_payment_link',
  'whop.create_checkout',
  'dodo.create_checkout',
  'terac.post_requisition',
  'elevenlabs.tts',
  'render.deploy',
  'replay.run_suite',
  'linq.send_card',
  'band.publish',
  'pioneer.classify',
  'simpop.build_panel',
  'simpop.poll',
  'github.push',
] as const;

export type ToolName = (typeof toolNames)[number];

export type ToolDef = {
  name: ToolName;
  description: string;
  input_schema: ZodTypeAny;
  sideEffecting: boolean;
  gate?: GateType;
  cost_usd: number;
  unit: string;
  resource: string;
  mock(args: unknown, ctx: ToolCtx): Promise<unknown>;
};

const looseObject = z.record(z.unknown()).default({});

const schemas: Record<ToolName, ZodTypeAny> = {
  web_search: z.object({ query: z.string().min(1) }),
  web_fetch: z.object({ url: z.string().url() }),
  calc: z.object({ expression: z.string().min(1) }),
  memory_read: z.object({ query: z.string().min(1) }),
  memory_write: z.object({ key: z.string().min(1), value: z.unknown() }),
  'apify.run_actor': z.object({ actor_id: z.string().min(1), input: z.unknown().optional() }),
  'solari.browse': z.object({ task: z.string().min(1), url: z.string().url().optional() }),
  'composio.gmail_send': z.object({ to: z.string().min(1), subject: z.string(), body: z.string() }),
  'stripe.create_payment_link': z.object({ name: z.string().min(1), amount_cents: z.number().int().positive(), currency: z.string().default('usd'), price: z.string().optional() }),
  'whop.create_checkout': looseObject,
  'dodo.create_checkout': looseObject,
  'terac.post_requisition': looseObject,
  'elevenlabs.tts': z.object({ text: z.string().min(1), voice_id: z.string().optional(), model_id: z.string().optional() }),
  'render.deploy': looseObject,
  'replay.run_suite': looseObject,
  'linq.send_card': looseObject,
  'band.publish': looseObject,
  'pioneer.classify': looseObject,
  'simpop.build_panel': z.object({ region: z.string().default('CA'), seed: z.number().int().optional(), archetypes: z.number().int().min(4).optional() }),
  'simpop.poll': z.object({ region: z.string().default('CA'), questions: z.array(z.string()).min(1), seed: z.number().int().optional(), archetypes: z.number().int().min(4).optional() }),
  'github.push': looseObject,
};

const gates: Partial<Record<ToolName, GateType>> = {
  'composio.gmail_send': 'outbound_to_real_person',
  'stripe.create_payment_link': 'money_out',
  'terac.post_requisition': 'money_out',
  'render.deploy': 'deploy',
};

const nonSideEffecting = new Set<ToolName>(['web_search', 'web_fetch', 'calc', 'memory_read', 'pioneer.classify', 'simpop.build_panel', 'simpop.poll']);

export const toolDefs = Object.fromEntries(
  toolNames.map((name) => [
    name,
    {
      name,
      description: `Run ${name}`,
      input_schema: schemas[name],
      sideEffecting: !nonSideEffecting.has(name),
      gate: gates[name],
      cost_usd: name === 'calc' ? 0.00001 : 0.001,
      unit: 'call',
      resource: name,
      mock: async (args: unknown) => (name === 'calc' ? { result: calculate((args as { expression: string }).expression) } : mockTool(name, args)),
    } satisfies ToolDef,
  ]),
) as unknown as Record<ToolName, ToolDef>;
