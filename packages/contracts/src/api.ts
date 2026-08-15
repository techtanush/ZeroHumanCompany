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

export const CreateVentureRequest = z.object({
  mode: VentureMode,
  name: z.string().min(1).optional(),
  founder_profile: FounderProfile,
  idea_seed: IdeaSeed.partial({ founder_profile: true }).optional(),
  autonomy_level: AutonomyLevel.default('supervised'),
  spend_cap_usd: z.number().min(0).max(10_000).default(50),
  terac_cap_usd: z.number().min(0).max(10_000).default(200),
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
