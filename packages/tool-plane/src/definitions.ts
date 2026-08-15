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
  'solari.act',
  'solari.extract',
  'solari.screenshot',
  'composio.gmail_send',
  'stripe.create_payment_link',
  'whop.create_checkout',
  'dodo.create_checkout',
  'terac.post_requisition',
  'elevenlabs.tts',
  'elevenlabs.clone_voice',
  'elevenlabs.create_agent',
  'elevenlabs.place_call',
  'elevenlabs.transcribe',
  'elevenlabs.delete_voice',
  'render.deploy',
  'replay.run_suite',
  'linq.send_card',
  'linq.await_reply',
  'band.publish',
  'pioneer.classify',
  'simpop.build_panel',
  'simpop.poll',
  'leadgen.search',
  'leadgen.enrich',
  'crm.upsert',
  'support.upsert_ticket',
  'metrics.record_signal',
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
  'solari.act': z.object({
    task: z.string().min(1),
    url: z.string().url().optional(),
    session_id: z.string().optional(),
    guards: z.record(z.unknown()).default({}),
  }),
  'solari.extract': z.object({
    task: z.string().min(1),
    url: z.string().url().optional(),
    schema: z.record(z.unknown()).optional(),
    session_id: z.string().optional(),
  }),
  'solari.screenshot': z.object({ session_id: z.string().min(1), full_page: z.boolean().default(true) }),
  'composio.gmail_send': z.object({ to: z.string().min(1), subject: z.string(), body: z.string() }),
  'stripe.create_payment_link': z.object({ name: z.string().min(1), amount_cents: z.number().int().positive(), currency: z.string().default('usd'), price: z.string().optional() }),
  'whop.create_checkout': looseObject,
  'dodo.create_checkout': looseObject,
  'terac.post_requisition': looseObject,
  'elevenlabs.tts': z.object({ text: z.string().min(1), voice_id: z.string().optional(), model_id: z.string().optional() }),
  'elevenlabs.clone_voice': z.object({
    name: z.string().min(1),
    consent_event_id: z.string().min(1),
    audio_base64: z.string().min(1),
    mime_type: z.string().default('audio/mpeg'),
    description: z.string().optional(),
  }),
  'elevenlabs.create_agent': z.object({
    name: z.string().min(1),
    voice_id: z.string().min(1),
    system_prompt: z.string().min(1),
    first_message: z.string().min(1),
  }),
  'elevenlabs.place_call': z.object({
    agent_id: z.string().min(1),
    to_e164: z.string().regex(/^\+[1-9]\d{6,14}$/),
    from_number_id: z.string().optional(),
    disclosure: z.literal(true),
    consent_gate_id: z.string().optional(),
  }),
  'elevenlabs.transcribe': z.object({ audio_url: z.string().url().optional(), audio_base64: z.string().optional(), language_code: z.string().optional() }),
  'elevenlabs.delete_voice': z.object({ voice_id: z.string().min(1), revocation_event_id: z.string().min(1) }),
  'render.deploy': looseObject,
  'replay.run_suite': looseObject,
  'linq.send_card': z.object({
    to: z.string().optional(),
    message: z.record(z.unknown()),
    gate_id: z.string().optional(),
    thread_ref: z.string().optional(),
  }),
  'linq.await_reply': z.object({ gate_id: z.string().optional(), thread_ref: z.string().optional(), timeout_s: z.number().int().positive().default(900) }),
  'band.publish': looseObject,
  'pioneer.classify': looseObject,
  'simpop.build_panel': z.object({ region: z.string().default('CA'), seed: z.number().int().optional(), archetypes: z.number().int().min(4).optional() }),
  'simpop.poll': z.object({ region: z.string().default('CA'), questions: z.array(z.string()).min(1), seed: z.number().int().optional(), archetypes: z.number().int().min(4).optional() }),
  'leadgen.search': z.object({ query: z.string().min(1), icp: z.string().optional(), region: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) }),
  'leadgen.enrich': z.object({ leads: z.array(z.record(z.unknown())).min(1), provider: z.string().optional() }),
  'crm.upsert': z.object({ object_type: z.enum(['lead', 'deal', 'customer', 'ticket']), records: z.array(z.record(z.unknown())).min(1) }),
  'support.upsert_ticket': z.object({ customer_alias: z.string(), subject: z.string(), body: z.string(), severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'), status: z.enum(['open', 'pending', 'resolved', 'escalated']).default('open') }),
  'metrics.record_signal': z.object({ source: z.string().min(1), theme: z.string().min(1), severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'), evidence_refs: z.array(z.string()).default([]), value: z.number().optional() }),
  'github.push': looseObject,
};

const gates: Partial<Record<ToolName, GateType>> = {
  'composio.gmail_send': 'outbound_to_real_person',
  'linq.send_card': 'outbound_to_real_person',
  'stripe.create_payment_link': 'money_out',
  'terac.post_requisition': 'money_out',
  'solari.act': 'account_creation',
  'elevenlabs.clone_voice': 'voice_clone_consent',
  'elevenlabs.place_call': 'outbound_to_real_person',
  'elevenlabs.delete_voice': 'voice_clone_consent',
  'render.deploy': 'deploy',
  'github.push': 'deploy',
};

const nonSideEffecting = new Set<ToolName>([
  'web_search', 'web_fetch', 'calc', 'memory_read', 'pioneer.classify',
  'simpop.build_panel', 'simpop.poll', 'leadgen.search', 'leadgen.enrich',
  'solari.browse', 'solari.extract', 'solari.screenshot', 'linq.await_reply',
  'elevenlabs.transcribe',
]);

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
