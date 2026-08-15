import { z, type ZodTypeAny } from 'zod';
import type { GateType, ToolCtx } from './index.js';
import { calculate } from './calc.js';
import { mockTool } from './mock.js';
import { workspaceTool } from './workspace.js';

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
  'terac.request_feasibility',
  'terac.get_feasibility',
  'terac.list_opportunities',
  'terac.get_submissions',
  'terac.launch_opportunity',
  'terac.approve_submission',
  'terac.mcp_call',
  'workspace.list',
  'workspace.read_file',
  'workspace.write_file',
  'workspace.exec',
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
  'terac.post_requisition': z.object({
    role: z.string().min(1),
    task: z.string().min(1),
    panel: z.string().optional(),
    count: z.number().int().positive().default(1),
    timeline_hours: z.number().int().positive().default(72),
    title: z.string().optional(),
    project_id: z.string().optional(),
    venture_id: z.string().optional(),
    create_draft: z.boolean().default(true),
    budget_usd: z.number().nonnegative().optional(),
  }),
  'terac.request_feasibility': z.object({ task: z.string().min(1), panel: z.string().min(1), count: z.number().int().positive().optional(), timeline_hours: z.number().int().positive().optional() }),
  'terac.get_feasibility': z.object({ request_id: z.string().min(1) }),
  'terac.list_opportunities': z.object({ status: z.string().optional(), projectId: z.string().optional(), limit: z.number().int().positive().max(100).optional() }),
  'terac.get_submissions': z.object({ opportunity_id: z.string().min(1), status: z.string().optional() }),
  'terac.launch_opportunity': z.object({ opportunity_id: z.string().min(1), amount_usd: z.number().nonnegative().optional() }),
  'terac.approve_submission': z.object({ submission_id: z.string().min(1) }),
  /** Read-only / drafting Terac MCP tools by name; launching/approving/stopping is refused here. */
  'terac.mcp_call': z.object({ tool: z.string().regex(/^terac_/), args: z.record(z.unknown()).default({}) }),
  'workspace.list': z.object({ path: z.string().default('.'), depth: z.number().int().min(1).max(4).default(2) }),
  'workspace.read_file': z.object({ path: z.string().min(1), max_bytes: z.number().int().positive().max(200_000).default(60_000) }),
  'workspace.write_file': z.object({ path: z.string().min(1), content: z.string(), mkdirs: z.boolean().default(true) }),
  'workspace.exec': z.object({ command: z.string().min(1), timeout_s: z.number().int().positive().max(600).default(120) }),
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
  'terac.launch_opportunity': 'money_out',
  'terac.approve_submission': 'money_out',
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
  'terac.get_feasibility', 'terac.list_opportunities', 'terac.get_submissions', 'terac.mcp_call',
  'workspace.list', 'workspace.read_file',
]);

const WORKSPACE_TOOLS = new Set<ToolName>(['workspace.list', 'workspace.read_file', 'workspace.write_file', 'workspace.exec']);

const DESCRIPTIONS: Partial<Record<ToolName, string>> = {
  'terac.post_requisition': 'Ask Terac (human-labor MCP) for real humans: submits a feasibility request and drafts an opportunity. Spends nothing until terac.launch_opportunity.',
  'terac.request_feasibility': 'Terac MCP: can a panel be sourced for this task/audience, and at what cost per participant? Poll with terac.get_feasibility.',
  'terac.get_feasibility': 'Terac MCP: fetch a feasibility request; when status is RESPONDED, costPerParticipant is the confirmed price.',
  'terac.list_opportunities': 'Terac MCP: list our opportunities with status, pricing and timeline.',
  'terac.get_submissions': 'Terac MCP: list expert submissions for an opportunity (screen_passed, in_progress, awaiting_review, approved...).',
  'terac.launch_opportunity': 'Terac MCP: launch a DRAFT opportunity. COMMITS REAL MONEY and starts recruiting humans; requires the money_out gate.',
  'terac.approve_submission': 'Terac MCP: approve an awaiting_review submission, which pays the expert (money_out gate).',
  'terac.mcp_call': 'Call any read-only or drafting Terac MCP tool by name (terac_get_context, terac_list_filters, terac_create_project, ...).',
  'workspace.list': 'List files in the folder the founder granted the agency (the build workspace).',
  'workspace.read_file': 'Read a file inside the granted workspace.',
  'workspace.write_file': 'Create or overwrite a file inside the granted workspace. Use for generated code, configs, and docs.',
  'workspace.exec': 'Run an allow-listed shell command (npm/pnpm/node/git/tests/build) inside the granted workspace and return stdout/stderr.',
  'replay.run_suite': 'Run the Replay QA suite against the built product; returns pass/fail with a time-travel recording for failures. Run before any deploy.',
  'github.push': 'Push the workspace to the venture repository (deploy gate).',
  'render.deploy': 'Deploy the built product to Render (deploy gate).',
  'linq.send_card': 'Send the founder an iMessage card via Linq (outbound_to_real_person gate).',
  'composio.gmail_send': 'Send an email from the company Gmail via Composio (outbound_to_real_person gate).',
  'elevenlabs.place_call': 'Place a phone call in the founder\'s cloned voice; must disclose AI in the first utterance (outbound_to_real_person gate).',
  'band.publish': 'Post a message to a Band group chat room (the department planning channel).',
};

export const toolDefs = Object.fromEntries(
  toolNames.map((name) => [
    name,
    {
      name,
      description: DESCRIPTIONS[name] ?? `Run ${name}`,
      input_schema: schemas[name],
      sideEffecting: !nonSideEffecting.has(name),
      gate: gates[name],
      cost_usd: name === 'calc' ? 0.00001 : 0.001,
      unit: 'call',
      resource: name,
      mock: async (args: unknown, ctx: ToolCtx) =>
        name === 'calc'
          ? { result: calculate((args as { expression: string }).expression) }
          : WORKSPACE_TOOLS.has(name)
            ? workspaceTool(name, args, ctx)
            : mockTool(name, args),
    } satisfies ToolDef,
  ]),
) as unknown as Record<ToolName, ToolDef>;
