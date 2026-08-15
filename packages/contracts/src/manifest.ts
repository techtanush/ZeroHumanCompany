import { z } from 'zod';
import { ArtifactType } from './artifacts.js';
import { Cluster, DepartmentId, ModelTier, Usd } from './common.js';
import { GateType } from './messages.js';

export const ToolName = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);

export const AgentSpec = z.object({
  agent_id: z.string(),
  model: ModelTier.or(z.string().startsWith('pioneer:')),
  replicas: z.number().int().min(1).default(1),
  system_prompt_ref: z.string(),
  tools: z.array(ToolName).default([]),
  max_tokens_per_run: z.number().int().positive().default(60_000),
});
export type AgentSpec = z.infer<typeof AgentSpec>;

export const CriticSpec = z.object({
  agent_id: z.string(),
  model: ModelTier.default('sonnet'),
  rubric_ref: z.string(),
  max_tokens_per_run: z.number().int().positive().default(30_000),
});

export const DepartmentManifest = z.object({
  id: DepartmentId,
  name: z.string(),
  cluster: Cluster,
  head: AgentSpec,
  critic: CriticSpec.optional(),
  workers: z.array(AgentSpec).default([]),
  concurrency: z.number().int().min(1).default(4),
  budget: z.object({
    default_envelope_usd: Usd,
    hard_cap_usd: Usd,
  }),
  io: z.object({
    input: z.array(ArtifactType).default([]),
    output: ArtifactType,
    min_outputs: z.number().int().min(1).default(1),
  }),
  gates: z.array(GateType).default([]),
  sandbox: z.object({
    image: z.string().default('zeroth/dept-base:latest'),
    cpu: z.number().default(2),
    mem_mb: z.number().default(2048),
    pause_between_cycles: z.boolean().default(true),
    egress_allowlist: z.array(z.string()).default([]),
  }).default({}),
  sla: z.object({
    soft_deadline_s: z.number().int().positive().default(240),
    on_timeout: z.enum(['return_partial', 'fail', 'escalate']).default('return_partial'),
  }).default({}),
  origin: z.enum(['seed', 'cos_generated']).default('seed'),
}).superRefine((m, ctx) => {
  const ids = new Set<string>();
  for (const a of [m.head, ...m.workers]) {
    if (ids.has(a.agent_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workers'],
        message: `duplicate agent_id "${a.agent_id}" in ${m.id}`,
      });
    }
    ids.add(a.agent_id);
  }
  if (m.budget.hard_cap_usd < m.budget.default_envelope_usd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['budget', 'hard_cap_usd'],
      message: 'hard_cap_usd must be >= default_envelope_usd',
    });
  }
});
export type DepartmentManifest = z.infer<typeof DepartmentManifest>;

/* ── Routing ─────────────────────────────────────────────────────────────── */

export const RoutingEmit = z.object({
  work_order: z.object({
    to: DepartmentId,
    intent: z.string(),
    budget_usd: Usd,
    params: z.record(z.unknown()).default({}),
  }).optional(),
  gate: z.object({
    gate_type: GateType,
    department_id: DepartmentId,
    summary: z.string().default(''),
  }).optional(),
});

/**
 * A routing rule fires when its condition matches an appended event.
 * `when` is structured (not a DSL string) so it is testable and D13-writable.
 */
export const RoutingRule = z.object({
  id: z.string(),
  when: z.object({
    event: z.string(),
    artifact_type: ArtifactType.optional(),
    gate_type: GateType.optional(),
    /** Require N distinct signed artifacts of `artifact_type` before firing. */
    min_count: z.number().int().min(1).default(1),
    /** Require these artifact types to all be signed for the venture. */
    all_signed: z.array(ArtifactType).default([]),
    /** Only fire once per venture. */
    once: z.boolean().default(true),
  }),
  emit: z.array(RoutingEmit).min(1),
});
export type RoutingRule = z.infer<typeof RoutingRule>;

export const RoutingTable = z.array(RoutingRule);
export type RoutingTable = z.infer<typeof RoutingTable>;
