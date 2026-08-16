import { z } from 'zod';
import { AutonomyLevel, DepartmentId, Usd, Uuid, VentureMode } from './common.js';
import { Quality } from './common.js';
import { FounderProfile, IdeaSeed } from './artifacts.js';
import { GateDecision } from './messages.js';

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    trace_id: z.string(),
    retryable: z.boolean(),
    details: z.record(z.any()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/* ── Venture settings (founder-editable, persisted per venture) ───────────── */

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

/** When the company works and meets, in the founder's timezone. */
export const MeetingSchedule = z.object({
  timezone: z.string().default('America/Los_Angeles'),
  /** Agents work between these local times; outside them the floors are dark. */
  work_start: HHMM.default('09:00'),
  work_end: HHMM.default('17:00'),
  /** Department heads meet the CEO/executives to align on goals. */
  exec_meeting_time: HHMM.default('07:00'),
  exec_meeting_minutes: z.number().int().min(5).max(180).default(30),
  /** Whole-company meeting where the leads address every agent (all rooms empty into the exec room). */
  all_hands_time: HHMM.default('09:00'),
  all_hands_minutes: z.number().int().min(5).max(120).default(15),
  /** After the workday: the improvement branch mines gaps and proposes new capabilities. */
  improvement_time: HHMM.default('17:30'),
  days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).default(['mon', 'tue', 'wed', 'thu', 'fri']),
});
export type MeetingSchedule = z.infer<typeof MeetingSchedule>;

export const VoiceSettings = z.object({
  consent_given: z.boolean().default(false),
  consent_at: z.string().optional(),
  consent_event_id: z.string().optional(),
  consent_text_version: z.string().default('v1'),
  voice_id: z.string().optional(),
  voice_name: z.string().optional(),
  status: z.enum(['none', 'consented', 'sample_uploaded', 'cloned', 'revoked']).default('none'),
  sample_meta: z.object({
    mime_type: z.string(),
    bytes: z.number().int(),
    duration_s: z.number().optional(),
    uploaded_at: z.string(),
  }).optional(),
  revoked_at: z.string().optional(),
});
export type VoiceSettings = z.infer<typeof VoiceSettings>;

export const WorkspaceSettings = z.object({
  /** Absolute local path the agency (D07 Build) is allowed to work inside. */
  workspace_root: z.string().optional(),
  /** Same value under the alias the architecture docs use. */
  agency_workspace_path: z.string().optional(),
  source: z.enum(['typed', 'picker', 'none']).default('none'),
  granted_at: z.string().optional(),
  permissions: z.array(z.enum(['generated_code', 'build_artifacts', 'repo_work'])).default(['generated_code', 'build_artifacts', 'repo_work']),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

export const VentureSettings = z.object({
  workspace: WorkspaceSettings.default({}),
  meetings: MeetingSchedule.default({}),
  voice: VoiceSettings.default({}),
  /** Which integrations the founder acknowledged during onboarding (status only, never secrets). */
  integrations_ack: z.array(z.string()).default([]),
  linq_test_message: z.object({ sent_at: z.string(), delivered: z.boolean(), confirmed_by_founder: z.boolean().default(false), degraded: z.string().optional() }).optional(),
  founder_notes: z.string().default(''),
  /** Founder-set ceilings on Stripe-funded spend. `monthly_usd: 0` = no monthly ceiling. */
  spend_limits: z.object({
    total_usd: z.number().min(0).max(100_000).default(50),
    monthly_usd: z.number().min(0).max(100_000).default(0),
  }).default({}),
});
export type VentureSettings = z.infer<typeof VentureSettings>;

export const CreateVentureRequest = z.object({
  mode: VentureMode,
  name: z.string().min(1).optional(),
  founder_profile: FounderProfile,
  idea_seed: IdeaSeed.partial({ founder_profile: true }).optional(),
  autonomy_level: AutonomyLevel.default('supervised'),
  spend_cap_usd: z.number().min(0).max(10_000).default(50),
  terac_cap_usd: z.number().min(0).max(10_000).default(200),
  settings: VentureSettings.partial().optional(),
});
export type CreateVentureRequest = z.infer<typeof CreateVentureRequest>;

export const CreateVentureResponse = z.object({
  venture_id: Uuid,
  trace_id: z.string(),
  first_work_order_id: Uuid,
  sse_url: z.string(),
});
export type CreateVentureResponse = z.infer<typeof CreateVentureResponse>;

export const EmitEventRequest = z.object({
  venture_id: Uuid,
  type: z.string(),
  actor_kind: z.enum(['agent', 'founder', 'system', 'webhook', 'human_hire']).default('agent'),
  actor_id: z.string(),
  department_id: DepartmentId.optional(),
  payload: z.record(z.any()).default({}),
  causation_id: Uuid.optional(),
  correlation_id: Uuid.optional(),
  trace_id: z.string(),
  idempotency_key: z.string(),
});
export type EmitEventRequest = z.infer<typeof EmitEventRequest>;

export const CreateWorkOrderRequest = z.object({
  venture_id: Uuid,
  from: DepartmentId.or(z.literal('kernel')).default('kernel'),
  to: DepartmentId,
  intent: z.string(),
  input_artifacts: z.array(z.record(z.any())).default([]),
  params: z.record(z.any()).default({}),
  budget_usd: Usd,
  success_criteria: z.array(z.string()).default([]),
  trace_id: z.string().optional(),
});
export type CreateWorkOrderRequest = z.infer<typeof CreateWorkOrderRequest>;

export const CreateArtifactRequest = z.object({
  venture_id: Uuid,
  type: z.string(),
  body: z.record(z.any()),
  produced_by: z.string(),
  department_id: DepartmentId,
  work_order_id: Uuid.optional(),
  sources: z.array(z.record(z.any())).default([]),
  quality: Quality.default('draft'),
  gaps: z.array(z.string()).default([]),
  cost_usd: Usd.default(0),
  lineage_id: Uuid.optional(),
});
export type CreateArtifactRequest = z.infer<typeof CreateArtifactRequest>;

export const GateDecisionRequest = GateDecision;

export const SseEnvelope = z.object({
  seq: z.number().int(),
  event: z.enum(['event', 'projection', 'gate', 'budget', 'department', 'toast', 'heartbeat']),
  venture_id: Uuid,
  type: z.string(),
  payload: z.record(z.any()),
  trace_id: z.string(),
});
export type SseEnvelope = z.infer<typeof SseEnvelope>;

export const Liveness = z.object({
  idea_locked: z.boolean().default(false),
  market_validated: z.boolean().default(false),
  product_live: z.boolean().default(false),
  pipeline_active: z.boolean().default(false),
  revenue_real: z.boolean().default(false),
});
export type Liveness = z.infer<typeof Liveness>;

export const VentureProjection = z.object({
  id: Uuid,
  founder_id: Uuid,
  name: z.string(),
  slug: z.string(),
  mode: VentureMode,
  autonomy_level: AutonomyLevel,
  status: z.enum(['active', 'paused', 'killed', 'graduated']),
  time_scale: z.number(),
  trace_id: z.string(),
  liveness: Liveness,
  spend_usd: Usd.default(0),
  kill_switch: z.boolean().default(false),
  created_at: z.string(),
});
export type VentureProjection = z.infer<typeof VentureProjection>;
