import { z } from 'zod';
import { Cited, CitedMoney, SourceRef } from './evidence.js';
import { DepartmentId, Quality, Usd, Uuid } from './common.js';

/**
 * Every artifact body schema in the company, keyed by artifact type.
 * Bodies are validated on write by the kernel; `ArtifactRef` is how they travel.
 */

export const ArtifactType = z.enum([
  'IdeaSeed', 'OpportunityCandidate', 'SharpenedIdea', 'NicheDossier',
  'Interview', 'Claim', 'ClaimLedger', 'SyntheticPanelResult', 'IdeaDiff', 'ProductSpec',
  'Deployment', 'BuildFailure', 'GTMPlan', 'LeadBatch', 'Deal', 'Order',
  'Ticket', 'ProductSignal', 'BudgetAllocation', 'HumanWorkRequisition',
  'CapabilityGap', 'DepartmentManifestArtifact',
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const ArtifactRef = z.object({
  type: ArtifactType,
  id: Uuid,
  version: z.number().int().min(1),
  hash: z.string(),
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;

/* ── Discovery ───────────────────────────────────────────────────────────── */

export const FounderProfile = z.object({
  display_name: z.string(),
  email: z.string().email().optional(),
  phone_e164: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  timezone: z.string().default('America/Los_Angeles'),
  background: z.string().default(''),
  unfair_advantages: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
});
export type FounderProfile = z.infer<typeof FounderProfile>;

export const IdeaSeed = z.object({
  raw_statement: z.string().min(1),
  normalized: z.object({
    problem: z.string(),
    who_hurts: z.string(),
    current_workaround: z.string(),
    proposed_solution: z.string(),
    business_model_guess: z.string(),
    category: z.string(),
  }),
  extracted_entities: z.array(z.string()).default([]),
  numbers_stated: z.array(z.object({
    label: z.string(),
    value: z.number(),
    unit: z.string().optional(),
    source_id: Uuid.optional(),
  })).default([]),
  founder_profile: FounderProfile,
  constraints: z.array(z.string()).default([]),
  attachments: z.array(z.object({ uri: z.string(), source_id: Uuid })).default([]),
  ambiguities: z.array(z.string()).default([]),
  candidates: z.array(Uuid).default([]),
  selected_candidate_id: Uuid.optional(),
});
export type IdeaSeed = z.infer<typeof IdeaSeed>;

export const OpportunityCandidate = z.object({
  title: z.string(),
  thesis: z.string().max(600),
  pain_evidence: z.array(z.object({
    verbatim: z.string(),
    where: z.string(),
    when: z.string(),
    intensity: z.number().min(0).max(1),
    source_id: Uuid,
  })).min(3),
  signal_sources: z.array(z.string()).min(2),
  who_hurts: z.string(),
  proposed_wedge: z.string(),
  monetization_guess: z.string(),
  scores: z.object({
    pain_intensity: z.number(), frequency: z.number(), willingness_to_pay: z.number(),
    reachability: z.number(), wedge_clarity: z.number(), competition: z.number(),
    regulatory_risk: z.number(), founder_fit: z.number(),
  }),
  weighted_score: z.number(),
  rank: z.number().int(),
  kill_reasons: z.array(z.string()).default([]),
});

export const WhatMustBeTrue = z.object({
  id: z.string(),
  statement: z.string(),
  test: z.string(),
  tester: z.string(),
  blocking: z.boolean(),
});

export const SharpenedIdea = z.object({
  one_liner: z.string(),
  icp: z.object({
    role: z.string(),
    org_type: z.string(),
    trigger: z.string(),
    named_examples: z.array(z.string()).default([]),
    disqualifiers: z.array(z.string()).default([]),
  }),
  pain: z.object({
    statement: z.string(),
    frequency: z.string(),
    cost_today: z.object({ value: z.number(), unit: z.string(), basis: z.string() }),
    status_quo: z.string().min(1),
  }),
  wedge: z.object({ description: z.string(), ships_in_hours: z.number().max(24) }),
  what_must_be_true: z.array(WhatMustBeTrue).min(4).max(8),
  kill_criteria: z.array(z.object({
    statement: z.string(), measured_by: z.string(), deadline: z.string(),
  })).min(3),
  open_assumptions: z.array(z.object({
    statement: z.string(), invented_by_agent: z.boolean().default(false),
  })).default([]),
  premises: z.array(z.string()).default([]),
  alternatives_considered: z.array(z.object({ option: z.string(), why_not: z.string() })).min(2),
  transcript_ref: z.string().optional(),
});
export type SharpenedIdea = z.infer<typeof SharpenedIdea>;

export const NicheDossier = z.object({
  label: z.string(),
  slice: z.object({ industry: z.string(), size: z.string(), geo: z.string(), trigger: z.string() }),
  tam_usd: CitedMoney,
  sam_usd: CitedMoney,
  som_usd: CitedMoney,
  mrr_12mo_usd: CitedMoney,
  pricing_hypothesis: z.object({
    model: z.string(),
    price: CitedMoney,
    anchor_comparables: z.array(z.string()).default([]),
  }),
  competitors: z.array(z.object({
    name: z.string(),
    pricing: CitedMoney.optional(),
    weakness: z.string(),
    source_ids: z.array(Uuid).min(1),
  })).min(1),
  wedge: z.string(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  reachability: z.object({
    channels: z.array(z.string()).min(1),
    cac_usd: CitedMoney,
  }),
  confidence: z.number().min(0).max(1),
  rank_rationale: z.string(),
});
export type NicheDossier = z.infer<typeof NicheDossier>;

/* ── Validation ──────────────────────────────────────────────────────────── */

export const Claim = z.object({
  interview_id: Uuid,
  speaker_alias: z.string(),
  ts_offset_s: z.number().min(0),
  verbatim: z.string().min(1),
  normalized: z.string(),
  theme: z.string(),
  polarity: z.enum(['supports', 'contradicts', 'neutral']),
  strength: z.number().min(0).max(1),
  evidence_class: z.enum(['past_behavior', 'current_practice', 'stated_intent', 'opinion']),
  targets: z.array(z.string()).default([]),
});
export type Claim = z.infer<typeof Claim>;

export const Interview = z.object({
  subject: z.object({
    alias: z.string(),
    kind: z.enum(['network', 'terac_panel', 'inbound', 'customer']),
    icp_match: z.number().min(0).max(1),
    terac_hire_id: z.string().optional(),
  }),
  channel: z.enum(['voice', 'video', 'email', 'chat', 'in_person']),
  consent: z.object({
    ai_disclosed: z.literal(true),
    disclosure_text: z.string().min(1),
    recording: z.enum(['granted', 'denied', 'not_requested']),
    jurisdiction: z.string(),
    recorded_at: z.string(),
  }),
  duration_s: z.number().min(0),
  transcript_uri: z.string().optional(),
  recording_uri: z.string().optional(),
  script_version: z.string(),
  claims: z.array(Uuid).default([]),
  surprises: z.array(z.string()).default([]),
  interviewer_voice_id: z.string().optional(),
  cost_usd: Usd.default(0),
}).superRefine((v, ctx) => {
  if (v.consent.recording === 'granted' && !v.recording_uri) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recording_uri'],
      message: 'recording_uri is required when consent.recording = "granted"',
    });
  }
});
export type Interview = z.infer<typeof Interview>;

export const ClaimLedger = z.object({
  interview_count: z.number().int().min(0),
  themes: z.array(z.object({
    theme: z.string(),
    supports: z.number().int(),
    contradicts: z.number().int(),
    neutral: z.number().int(),
    net_strength: z.number(),
    representative_quotes: z.array(z.object({ claim_id: Uuid, verbatim: z.string() })).min(1),
    verdict: z.enum(['confirmed', 'contradicted', 'contested', 'insufficient_data']),
  })).default([]),
  what_must_be_true_status: z.array(z.object({
    id: z.string(),
    status: z.enum(['confirmed', 'contradicted', 'untested']),
    evidence_claim_ids: z.array(Uuid).default([]),
  })).default([]),
  contradictions_with_synthetic: z.array(z.object({
    theme: z.string(), real: z.number(), synthetic: z.number(), delta: z.number(), note: z.string(),
  })).default([]),
});
export type ClaimLedger = z.infer<typeof ClaimLedger>;

export const SYNTHETIC_HONESTY_NOTE =
  'Model-based estimate from Census PUMS microdata, not a survey of real respondents.';

export const SyntheticPanelResult = z.object({
  region: z.string(),
  pums_vintage: z.string(),
  seed: z.number().int(),
  archetypes: z.array(z.object({
    label: z.string(),
    attributes: z.record(z.union([z.string(), z.number()])),
    population_weight: z.number().min(0),
  })).min(4),
  questions: z.array(z.object({
    question: z.string(),
    estimate: z.number(),
    ci: z.tuple([z.number(), z.number()]),
    n_eff: z.number().optional(),
    design_effect: z.number().optional(),
    archetype_coverage: z.number().optional(),
    responses: z.array(z.object({
      archetype: z.string(), answer: z.union([z.string(), z.number()]), weight: z.number(),
      rationale: z.string().optional(), coverage: z.number().optional(),
    })).default([]),
  })).default([]),
  calibration: z.object({ n: z.number().int(), delta: z.number(), method: z.string() }).optional(),
  honesty_note: z.literal(SYNTHETIC_HONESTY_NOTE),
});
export type SyntheticPanelResult = z.infer<typeof SyntheticPanelResult>;

export const IdeaDiff = z.object({
  op: z.enum(['ADD', 'CUT', 'NARROW', 'REPRICE', 'PIVOT']),
  target: z.string(),
  before: z.string(),
  after: z.string(),
  evidence: z.array(z.object({
    kind: z.enum(['claim', 'panel', 'market', 'support_signal', 'sales_loss']),
    ref: z.string(),
    weight: z.number().min(0).max(1),
  })).min(1),
  expected_effect: z.string(),
  cost: z.object({ eng_hours: z.number().min(0), usd: Usd }),
  reversibility: z.enum(['reversible', 'costly', 'one_way_door']),
  what_would_reject_this: z.string(),
  recommended: z.boolean(),
});
export type IdeaDiff = z.infer<typeof IdeaDiff>;

export const ProductSpec = z.object({
  version_label: z.string(),
  one_liner: z.string(),
  icp: z.string(),
  venture_kind: z.string(),
  geography: z.string(),
  features: z.array(z.object({
    id: z.string(),
    user_story: z.string(),
    acceptance_criteria: z.array(z.string()).min(1),
    priority: z.enum(['p0', 'p1', 'p2']),
    justified_by: z.array(z.string()).default([]),
  })).min(1),
  non_goals: z.array(z.string()).default([]),
  data_model_sketch: z.string().default(''),
  integrations_required: z.array(z.string()).default([]),
  auth_model: z.string().default('none'),
  stack: z.object({
    hosting: z.literal('render'),
    payments_rail: z.enum(['stripe', 'whop', 'dodo', 'none']),
  }),
  qa_scenarios: z.array(z.string()).min(3),
  pricing: z.object({ model: z.string(), amount_usd: Usd, interval: z.string() }),
  applied_diffs: z.array(Uuid).default([]),
}).superRefine((v, ctx) => {
  v.features.forEach((f, i) => {
    if (f.priority === 'p0' && f.justified_by.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['features', i, 'justified_by'],
        message: `p0 feature "${f.id}" must cite justification (claim or diff id)`,
      });
    }
  });
});
export type ProductSpec = z.infer<typeof ProductSpec>;

/* ── Build & GTM ─────────────────────────────────────────────────────────── */

export const Deployment = z.object({
  repo_url: z.string(),
  commit_sha: z.string(),
  service_id: z.string(),
  url: z.string(),
  environment: z.enum(['preview', 'production']),
  health: z.enum(['healthy', 'degraded', 'down', 'unknown']),
  qa: z.object({
    passed: z.boolean(),
    scenarios_total: z.number().int(),
    scenarios_passed: z.number().int(),
    report_uri: z.string().optional(),
  }),
  deployed_at: z.string(),
});
export type Deployment = z.infer<typeof Deployment>;

export const BuildFailure = z.object({
  stage: z.enum(['plan', 'codegen', 'test', 'build', 'deploy', 'qa']),
  summary: z.string(),
  log_excerpt: z.string(),
  failing_scenario: z.string().optional(),
  suggested_fix: z.string().optional(),
  attempt: z.number().int().min(0),
});

export const GTMPlan = z.object({
  positioning: z.string(),
  messaging_pillars: z.array(z.string()).min(1),
  channels: z.array(z.object({
    name: z.string(),
    hypothesis: z.string(),
    expected_cac_usd: CitedMoney.optional(),
  })).min(1),
  pricing: z.object({ model: z.string(), amount_usd: Usd, rationale: z.string() }),
  experiments: z.array(z.object({
    id: z.string(), hypothesis: z.string(), metric: z.string(), success_threshold: z.string(),
  })).default([]),
  launch_sequence: z.array(z.string()).default([]),
});

export const Lead = z.object({
  id: Uuid,
  alias: z.string(),
  company: z.string(),
  role: z.string(),
  contact: z.object({
    email: z.string().optional(),
    phone_e164: z.string().optional(),
    linkedin: z.string().optional(),
  }),
  source_id: Uuid,
  icp_score: z.number().min(0).max(1),
  warm: z.boolean().default(false),
  warm_claim_id: Uuid.optional(),
  consent: z.object({
    basis: z.enum(['opt_in', 'legitimate_interest', 'existing_relationship']),
    suppressed: z.boolean().default(false),
    dnc: z.boolean().default(false),
  }),
});
export type Lead = z.infer<typeof Lead>;

export const LeadBatch = z.object({
  query: z.string(),
  leads: z.array(Lead).default([]),
  suppressed_count: z.number().int().default(0),
  enrichment_provider: z.string().default('mock'),
});

export const Deal = z.object({
  lead_id: Uuid,
  stage: z.enum(['new', 'contacted', 'replied', 'meeting_booked', 'proposal', 'won', 'lost']),
  amount_usd: Usd,
  probability: z.number().min(0).max(1),
  objections: z.array(z.object({ text: z.string(), handled: z.boolean() })).default([]),
  quoted_claim_ids: z.array(Uuid).default([]),
  next_action: z.string().default(''),
  lost_reason: z.string().optional(),
});
export type Deal = z.infer<typeof Deal>;

export const Order = z.object({
  deal_id: Uuid,
  rail: z.enum(['stripe', 'whop', 'dodo']),
  external_id: z.string(),
  amount_usd: Usd,
  currency: z.string().default('usd'),
  status: z.enum(['requested', 'pending', 'paid', 'failed', 'refunded']),
  test_mode: z.boolean().default(true),
  idempotency_key: z.string(),
});
export type Order = z.infer<typeof Order>;

/* ── Ops & self-improvement ──────────────────────────────────────────────── */

export const Ticket = z.object({
  customer_alias: z.string(),
  channel: z.enum(['email', 'chat', 'linq', 'web']),
  subject: z.string(),
  body: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['open', 'pending', 'resolved', 'escalated']),
  resolution: z.string().optional(),
});

export const ProductSignal = z.object({
  source: z.enum(['support', 'sales', 'build', 'usage']),
  theme: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  occurrences: z.number().int().min(1),
  evidence_refs: z.array(z.string()).min(1),
  recommendation: z.string(),
});

export const BudgetAllocation = z.object({
  cycle_id: Uuid,
  allocations: z.array(z.object({
    department_id: DepartmentId,
    envelope_usd: Usd,
    hard_cap_usd: Usd,
    rationale: z.string(),
  })).min(1),
  total_usd: Usd,
  runway_usd: Usd,
});

export const HumanWorkRequisition = z.object({
  title: z.string(),
  description: z.string(),
  deliverable: z.string(),
  acceptance_criteria: z.array(z.string()).min(1),
  budget_usd: Usd,
  deadline: z.string(),
  vendor: z.enum(['terac', 'manual']).default('terac'),
  external_id: z.string().optional(),
  status: z.enum(['drafted', 'posted', 'matched', 'delivered', 'accepted', 'paid', 'cancelled']),
});

export const CapabilityGap = z.object({
  taxonomy: z.enum([
    'missing_department', 'missing_tool', 'weak_prompt', 'bad_routing',
    'budget_starvation', 'model_mismatch', 'missing_data',
  ]),
  summary: z.string(),
  evidence_refs: z.array(z.string()).min(2),
  occurrences: z.number().int().min(1),
  proposed_fix: z.string(),
  expected_impact: z.string(),
  risk: z.enum(['low', 'medium', 'high']),
});
export type CapabilityGap = z.infer<typeof CapabilityGap>;

export const DepartmentManifestArtifact = z.object({
  department_id: z.string(),
  manifest_yaml: z.string().min(1),
  generated_by: z.string(),
  shadow_test: z.object({
    cases: z.number().int(),
    passed: z.number().int(),
    report_uri: z.string().optional(),
  }).optional(),
});

/* ── Registry ────────────────────────────────────────────────────────────── */

export const ARTIFACT_SCHEMAS = {
  IdeaSeed,
  OpportunityCandidate,
  SharpenedIdea,
  NicheDossier,
  Interview,
  Claim,
  ClaimLedger,
  SyntheticPanelResult,
  IdeaDiff,
  ProductSpec,
  Deployment,
  BuildFailure,
  GTMPlan,
  LeadBatch,
  Deal,
  Order,
  Ticket,
  ProductSignal,
  BudgetAllocation,
  HumanWorkRequisition,
  CapabilityGap,
  DepartmentManifestArtifact,
} as const satisfies Record<ArtifactType, z.ZodTypeAny>;

export function artifactSchema(type: ArtifactType): z.ZodTypeAny {
  return ARTIFACT_SCHEMAS[type];
}

/** Which department owns (may produce) each artifact type. */
export const ARTIFACT_OWNER: Record<ArtifactType, DepartmentId> = {
  IdeaSeed: 'D01',
  OpportunityCandidate: 'D01',
  SharpenedIdea: 'D02',
  NicheDossier: 'D03',
  Interview: 'D04',
  Claim: 'D04',
  ClaimLedger: 'D04',
  SyntheticPanelResult: 'D05',
  IdeaDiff: 'D06',
  ProductSpec: 'D06',
  Deployment: 'D07',
  BuildFailure: 'D07',
  GTMPlan: 'D08',
  LeadBatch: 'D09',
  Deal: 'D10',
  Order: 'D10',
  Ticket: 'D12',
  ProductSignal: 'D12',
  BudgetAllocation: 'D11',
  HumanWorkRequisition: 'D11',
  CapabilityGap: 'D13',
  DepartmentManifestArtifact: 'D13',
};

/**
 * JSON pointers that must be backed by at least one real (non-synthetic) source
 * before an artifact of that type may be signed. Enforced in kernel/sign.ts.
 */
export const LOAD_BEARING_POINTERS: Partial<Record<ArtifactType, string[]>> = {
  NicheDossier: ['/tam_usd', '/sam_usd', '/som_usd', '/mrr_12mo_usd', '/pricing_hypothesis/price', '/reachability/cac_usd'],
  IdeaDiff: ['/evidence'],
};

export const StoredArtifact = z.object({
  id: Uuid,
  venture_id: Uuid,
  type: ArtifactType,
  version: z.number().int().min(1),
  lineage_id: Uuid,
  body: z.record(z.unknown()),
  body_hash: z.string(),
  schema_version: z.string(),
  quality: Quality,
  gaps: z.array(z.string()).default([]),
  produced_by: z.string(),
  department_id: DepartmentId,
  work_order_id: Uuid.optional(),
  sources: z.array(SourceRef).default([]),
  signature: z.string().optional(),
  signed_at: z.string().optional(),
  cost_usd: Usd.default(0),
  created_at: z.string(),
});
export type StoredArtifact = z.infer<typeof StoredArtifact>;
