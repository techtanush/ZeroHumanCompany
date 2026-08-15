import { z } from 'zod';
import { DepartmentId, Usd, Uuid } from './common.js';
import { ArtifactRef } from './artifacts.js';

export const WorkOrder = z.object({
  id: Uuid,
  venture_id: Uuid,
  from: DepartmentId.or(z.literal('kernel')),
  to: DepartmentId,
  intent: z.string(),
  input_artifacts: z.array(ArtifactRef).default([]),
  params: z.record(z.unknown()).default({}),
  budget_usd: Usd,
  soft_deadline_at: z.string().optional(),
  success_criteria: z.array(z.string()).default([]),
  trace_id: z.string(),
  attempt: z.number().int().default(0),
});
export type WorkOrder = z.infer<typeof WorkOrder>;

export const WorkOrderStatus = z.enum([
  'queued', 'admitted', 'running', 'partial', 'done', 'failed', 'cancelled',
]);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatus>;

export const ArtifactReady = z.object({
  id: Uuid,
  venture_id: Uuid,
  from: DepartmentId,
  work_order_id: Uuid,
  artifact: ArtifactRef,
  quality: z.enum(['signed', 'partial', 'contested']),
  gaps: z.array(z.string()).default([]),
  cost_usd: Usd,
  trace_id: z.string(),
});
export type ArtifactReady = z.infer<typeof ArtifactReady>;

export const EscalationReason = z.enum([
  'needs_human', 'needs_budget', 'needs_capability', 'needs_credential', 'needs_approval',
]);

export const EscalationRung = z.enum([
  'agent_retry', 'sibling_worker', 'department_head', 'chief_of_staff', 'founder', 'terac_hire',
]);

export const DecisionOption = z.object({
  id: z.string(),
  label: z.string(),
  consequence: z.string(),
});
export type DecisionOption = z.infer<typeof DecisionOption>;

export const Escalation = z.object({
  id: Uuid,
  venture_id: Uuid,
  from: DepartmentId,
  reason: EscalationReason,
  severity: z.enum(['blocking', 'degrading', 'informational']),
  summary: z.string(),
  detail: z.string().default(''),
  options: z.array(DecisionOption).default([]),
  suggested_option_id: z.string().optional(),
  rung: EscalationRung.default('department_head'),
  blocks_work_order_id: Uuid.optional(),
  trace_id: z.string(),
});
export type Escalation = z.infer<typeof Escalation>;

/* ── Gates ───────────────────────────────────────────────────────────────── */

export const GateType = z.enum([
  'money_out', 'public_content', 'outbound_to_real_person', 'account_creation',
  'pivot_approval', 'deploy', 'refund', 'new_department', 'niche_selection', 'voice_clone_consent',
]);
export type GateType = z.infer<typeof GateType>;

export const GateStatus = z.enum([
  'pending', 'auto_approved', 'approved', 'rejected', 'redirected',
  'timed_out', 'expired', 'cancelled',
]);
export type GateStatus = z.infer<typeof GateStatus>;

export const GateRequest = z.object({
  venture_id: Uuid,
  gate_type: GateType,
  requested_by: z.string(),
  department_id: DepartmentId,
  /** The exact side effect, replayable verbatim on approval. */
  action: z.object({
    tool: z.string(),
    args: z.record(z.unknown()).default({}),
  }),
  preview: z.record(z.unknown()).default({}),
  options: z.array(DecisionOption).min(1),
  suggested_option_id: z.string().optional(),
  amount_usd: Usd.optional(),
  risk: z.enum(['low', 'medium', 'high']).default('medium'),
  reversible: z.boolean().default(false),
  channel: z.enum(['linq', 'boardroom', 'auto']).default('boardroom'),
  timeout_s: z.number().int().positive().default(900),
  on_timeout: z.enum(['auto_approve', 'auto_reject', 'hold', 'escalate_terac']).default('hold'),
  idempotency_key: z.string(),
  work_order_id: Uuid.optional(),
  trace_id: z.string(),
});
export type GateRequest = z.infer<typeof GateRequest>;

export const GateRecord = GateRequest.extend({
  id: Uuid,
  status: GateStatus,
  decided_by: z.string().optional(),
  decided_option_id: z.string().optional(),
  decision_note: z.string().optional(),
  opened_at: z.string(),
  expires_at: z.string(),
  decided_at: z.string().optional(),
});
export type GateRecord = z.infer<typeof GateRecord>;

export const GateDecision = z.object({
  option_id: z.string(),
  decided_by: z.string(),
  decision: z.enum(['approve', 'reject', 'redirect']),
  note: z.string().default(''),
});
export type GateDecision = z.infer<typeof GateDecision>;
