import { z } from 'zod';
import { ActorKind, DepartmentId, Usd, Uuid } from './common.js';
import { ArtifactRef, ArtifactType } from './artifacts.js';

/** Event type taxonomy: <domain>.<verb_past_tense>. This list is exhaustive and enforced. */
export const EventType = z.enum([
  'venture.created', 'venture.mode_set', 'venture.autonomy_changed', 'venture.killed',
  'venture.resumed', 'venture.milestone_reached',

  'dept.work_order_issued', 'dept.work_started', 'dept.work_completed', 'dept.work_failed',
  'dept.frozen', 'dept.unfrozen',

  'agent.started', 'agent.tool_used', 'agent.tool_failed', 'agent.finished',
  'agent.retried', 'agent.budget_exceeded',

  'artifact.created', 'artifact.signed', 'artifact.superseded', 'artifact.contested',

  'gate.opened', 'gate.approved', 'gate.rejected', 'gate.redirected',
  'gate.timed_out', 'gate.auto_approved',

  'human.notified', 'human.replied', 'human.call_placed', 'human.call_completed',
  'human.consent_recorded', 'human.dnc_added',

  'terac.requisition_filed', 'terac.hire_posted', 'terac.worker_matched',
  'terac.work_delivered', 'terac.paid',

  'money.metered', 'money.budget_allocated', 'money.budget_exceeded', 'money.budget_degraded',
  'money.revenue_received', 'money.refunded', 'money.payout',

  'build.repo_created', 'build.commit_pushed', 'build.qa_started', 'build.qa_failed',
  'build.qa_passed', 'build.deployed', 'build.rolled_back',

  'sales.lead_created', 'sales.sequence_started', 'sales.reply_received',
  'sales.meeting_booked', 'sales.deal_stage_changed', 'sales.deal_won', 'sales.deal_lost',

  'support.ticket_opened', 'support.ticket_resolved', 'support.signal_filed',

  'ops.daily_briefing_started', 'ops.daily_briefing_published',

  'cos.gap_detected', 'cos.department_designed', 'cos.shadow_test_run', 'cos.department_deployed',

  'bus.degraded', 'bus.recovered',

  'system.kill_switch_engaged', 'system.kill_switch_released',
]);
export type EventType = z.infer<typeof EventType>;

export const BusTransport = z.enum(['band', 'pg_notify', 'none']);

/** The envelope every event carries. `payload` is validated per-type below. */
export const EventEnvelope = z.object({
  id: Uuid,
  seq: z.number().int().optional(),
  venture_id: Uuid,
  ts: z.string(),
  type: EventType,
  actor_kind: ActorKind,
  actor_id: z.string(),
  department_id: DepartmentId.optional(),
  payload: z.record(z.unknown()).default({}),
  trace_id: z.string(),
  causation_id: Uuid.optional(),
  correlation_id: Uuid.optional(),
  bus_transport: BusTransport.default('pg_notify'),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/* Payload schemas for the events that reducers depend on. Anything not listed
 * accepts a free-form record — but the type itself must still be in EventType. */

export const MILESTONES = z.enum([
  'idea_locked', 'market_validated', 'product_live', 'pipeline_active', 'revenue_real',
]);
export type Milestone = z.infer<typeof MILESTONES>;

export const EVENT_PAYLOADS = {
  'venture.created': z.object({
    name: z.string(),
    slug: z.string(),
    mode: z.enum(['founder_led', 'autonomous_origination']),
    autonomy_level: z.enum(['copilot', 'supervised', 'autonomous']),
    founder_id: Uuid,
  }),
  'venture.milestone_reached': z.object({ milestone: MILESTONES }),
  'venture.killed': z.object({ reason: z.string() }),
  'venture.autonomy_changed': z.object({
    autonomy_level: z.enum(['copilot', 'supervised', 'autonomous']),
  }),

  'dept.work_order_issued': z.object({
    work_order_id: Uuid, to_dept: DepartmentId, intent: z.string(), budget_usd: Usd,
  }),
  'dept.work_started': z.object({ work_order_id: Uuid }),
  'dept.work_completed': z.object({ work_order_id: Uuid, artifact: ArtifactRef.optional() }),
  'dept.work_failed': z.object({ work_order_id: Uuid, error: z.string(), attempt: z.number().int() }),

  'artifact.created': z.object({ artifact: ArtifactRef }),
  'artifact.signed': z.object({ artifact: ArtifactRef, quality: z.string(), cost_usd: Usd.default(0) }),
  'artifact.contested': z.object({ artifact: ArtifactRef, defects: z.array(z.string()) }),
  'artifact.superseded': z.object({ artifact: ArtifactRef, superseded_by: Uuid }),

  'gate.opened': z.object({ gate_id: Uuid, gate_type: z.string(), amount_usd: Usd.optional() }),
  'gate.approved': z.object({ gate_id: Uuid, option_id: z.string(), decided_by: z.string() }),
  'gate.auto_approved': z.object({ gate_id: Uuid, option_id: z.string(), reason: z.string() }),
  'gate.rejected': z.object({ gate_id: Uuid, decided_by: z.string(), note: z.string().default('') }),
  'gate.redirected': z.object({ gate_id: Uuid, note: z.string() }),
  'gate.timed_out': z.object({ gate_id: Uuid, on_timeout: z.string() }),

  'money.metered': z.object({
    department_id: DepartmentId, unit: z.string(), resource: z.string(),
    quantity: z.number(), cost_usd: Usd,
  }),
  'money.budget_degraded': z.object({ department_id: DepartmentId, ratio: z.number() }),
  'money.budget_exceeded': z.object({ department_id: DepartmentId, envelope_usd: Usd, spent_usd: Usd }),
  'money.revenue_received': z.object({ amount_usd: Usd, rail: z.string(), external_id: z.string() }),

  'build.deployed': z.object({ url: z.string(), commit_sha: z.string(), environment: z.string() }),
  'sales.lead_created': z.object({ lead_id: Uuid, icp_score: z.number() }),
  'sales.deal_won': z.object({ deal_id: Uuid, amount_usd: Usd }),
  'sales.deal_lost': z.object({ deal_id: Uuid, reason: z.string() }),
  'support.signal_filed': z.object({ theme: z.string(), severity: z.string() }),
  'ops.daily_briefing_started': z.object({
    meeting_date: z.string(),
    timezone: z.string().default('America/Los_Angeles'),
    band_room: z.string().default('executive-briefing'),
    lookback_hours: z.number().int().positive().default(24),
  }),
  'ops.daily_briefing_published': z.object({
    artifact: ArtifactRef,
    band_room: z.string(),
    message_id: z.string().optional(),
  }),
  'cos.gap_detected': z.object({ taxonomy: z.string(), summary: z.string() }),
} as const;

export function eventPayloadSchema(type: EventType): z.ZodTypeAny {
  return (EVENT_PAYLOADS as Record<string, z.ZodTypeAny>)[type] ?? z.record(z.unknown());
}

/** Artifact types whose signing is a load-bearing decision the routing layer reacts to. */
export const SIGNAL_ARTIFACTS: ArtifactType[] = [
  'SharpenedIdea', 'NicheDossier', 'ClaimLedger', 'SyntheticPanelResult', 'ProductSpec',
];
