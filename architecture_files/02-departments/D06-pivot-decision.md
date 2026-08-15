# D06 — Pivot & Decision

**Cluster:** validation · **Head:** `pivot.head` · **Critic:** `pivot.critic` · **Resident:** yes
(wakes on signal-cluster thresholds, KPI kill criteria, and founder notes — see §6 triggers)

---

## 1. Mission

> Read every signal the company has collected — interviews, objections, panel results, deal
> outcomes, support complaints — and decide, with evidence, whether the idea changes, stays, or dies.

**The single question it answers:** *"Given everything we now know, what exactly should change about
this idea — and can we prove it?"*

D06 is the company's steering wheel. Every other validation department produces observations; D06
alone may turn them into a **change to the venture itself**. It never executes the change — it
produces a `PivotProposal` of `IdeaDiff[]`, walks it through the `pivot_approval` gate in
[`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md), and on
approval emits the events that make every downstream department re-plan. A pivot not approved
through that gate does not exist.

---

## 2. Contract — Inputs & Outputs

### 2.1 Inputs **MVP**

| Artifact | From | What D06 reads out of it |
|---|---|---|
| `SharpenedIdea` | [`D02-office-hours.md`](D02-office-hours.md) | The original wedge, the founder's stated kill criteria, "what must be true" list |
| `NicheDossier[]` (selected + rejected) | `D03-market-research.md` | TAM/SAM/SOM, competitor moves, category pricing priors, market-shift signals |
| `Interview[]` + `ClaimLedger` | `D04-outreach-validation.md` | Verbatim claims: objections, feature requests, buying signals, no-interest signals, pricing feedback |
| `SyntheticPanelResult` | `D05-synthetic-population.md` | Population-weighted WTP curves, message tests, ICP sizing — always `evidence_class='synthetic'` |
| `ProductSpec` (current version) | D06 self (prior run) or D02 seed | The document being diffed |
| `GTMPlan` | [`D08-strategy.md`](D08-strategy.md) | Current pricing/positioning/channel commitments a diff would invalidate |
| `ObjectionRecord[]`, `Deal[]` outcomes | [`D10-sales.md`](D10-sales.md) | What actually killed or won deals; observed close rates vs plan |
| `ProductSignal[]` | `D12-support.md` | What paying customers complain about or silently stop using |
| `OpportunityCandidate[]` | [`D01-intake.md`](D01-intake.md) | Only for `new_opportunity` pivots — the adjacent idea being chased |
| Founder notes | Linq free-text (routed via D13) | A founder note is a signal, never an auto-approved decision |

### 2.2 The normalized `Signal` — one shape for every input **MVP**

D06's first job is normalization. Eight signal kinds, one schema, so synthesis is a query and not
an essay. Every signal keeps its provenance and `evidence_class` (invariant 7: synthetic ≠ proof).

```ts
// packages/contracts/src/pivot.ts
export const SignalKind = z.enum([
  'buying_signal',        // "when can I pay for this" — strongest positive
  'objection',            // reason given for not buying, mapped to a root cause
  'feature_request',      // explicit ask for capability we lack
  'no_interest',          // polite pass, ghost after demo, unused feature telemetry
  'verbatim_language',    // the exact words users use for the pain / the product
  'pricing_feedback',     // any reaction to a number: "toy", "no budget line", "cheaper than X"
  'market_research',      // D03 dossier facts: competitor launch, regulation, category shift
  'synthetic_panel',      // D05 results — support-only, never load-bearing alone
]);

export const Signal = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  kind: SignalKind,
  statement: z.string().max(500),            // one factual sentence, in the source's words where possible
  verbatim_quote: z.string().optional(),     // exact words, required for kind='verbatim_language'
  source_id: z.string(),                     // Artifact.sources[].source_id — uncited signals are rejected
  claim_id: z.string().optional(),           // ClaimLedger ref when it came from an interview
  speaker_ref: z.string().optional(),        // interviewee id / deal id / ticket id
  evidence_class: z.enum(['real','synthetic','mixed']),
  strength: z.enum(['strong','moderate','weak']),
  observed_at: z.string().datetime(),
  recency_days: z.number().int(),
  supports: z.array(z.string()).default([]),    // IdeaDiff ids this signal argues FOR
  contradicts: z.array(z.string()).default([]) }); // IdeaDiff ids it argues AGAINST

export const SignalCluster = z.object({
  id: z.string(),                            // 'SC-price-too-low'
  theme: z.string(),                         // one sentence naming the pattern
  kind_histogram: z.record(z.number().int()),// how many of each SignalKind
  signal_ids: z.array(z.string().uuid()).min(2),  // one anecdote is not a cluster
  distinct_speakers: z.number().int(),       // dedup by speaker_ref — 5 quotes from one person = 1
  real_count: z.number().int(),
  synthetic_count: z.number().int(),
  first_seen: z.string().datetime(),
  trend: z.enum(['rising','stable','fading']) });
```

### 2.3 Output — `IdeaDiff` and `PivotProposal` **MVP**

The `IdeaDiff` is the atom of change. The `PivotProposal` is the artifact that carries diffs through
the gate. Both live in `packages/contracts/src/pivot.ts`.

```ts
export const PivotType = z.enum([
  'add_feature',       // new capability enters ProductSpec scope
  'cut_feature',       // capability leaves scope (or MVP scope)
  'change_icp',        // the target customer changes identity
  'narrow_niche',      // same ICP family, tighter segment
  'widen_niche',       // same ICP family, broader segment
  'reprice',           // price, metric, or packaging changes
  'reposition',        // category / alternative / differentiator language changes
  'change_channel',    // primary acquisition channel changes
  'change_mvp_scope',  // what ships first changes; long-term spec unchanged
  'kill',              // the venture stops
  'new_opportunity',   // abandon current wedge, chase an OpportunityCandidate
]);

export const IdeaDiff = z.object({
  id: z.string(),                            // 'DIFF-003', stable within a venture
  proposal_id: z.string().uuid(),
  op: PivotType,
  target_doc: z.enum(['product_spec','strategy_core']),   // §2.5 — which versioned doc it patches
  path: z.string(),                          // JSON pointer into the doc: '/icp/tier1/firmographics'
  before: z.unknown(),                       // exact current value at `path`
  after: z.unknown(),                        // exact proposed value ('kill' ⇒ after = null doc state)
  reversibility: z.enum(['reversible','costly','one_way_door']),
  reversibility_rationale: z.string(),       // why it got that label — the Critic audits this
  headline: z.string().max(80),              // founder-readable: 'Reprice: $29 → $149/location'
  strongest_quote: z.object({                // the one verbatim line that makes the case
    text: z.string(), claim_id: z.string(), speaker_ref: z.string() }).optional(),
  evidence: z.array(z.object({
    signal_id: z.string().uuid(),
    cluster_id: z.string().optional(),
    weight: z.enum(['load_bearing','supporting','context']),
    evidence_class: z.enum(['real','synthetic','mixed']),
  })).min(1),
  counter_evidence: z.array(z.object({       // honesty channel: what argues AGAINST this diff
    signal_id: z.string().uuid(), why_outweighed: z.string() })).default([]),
  threshold_check: z.object({                // §2.4 evaluated mechanically, embedded in the artifact
    threshold_id: z.string(),                // 'T-reprice'
    required: z.record(z.unknown()),
    observed: z.record(z.unknown()),
    passed: z.boolean() }),
  downstream_impact: z.array(z.object({      // §6.4 — one row per affected department
    department: z.string().regex(/^D\d{2}$/),
    impact: z.enum(['rerun_required','update_required','pause_required','notify_only']),
    what_changes: z.string(),
    estimated_cost_usd: z.number(),          // from that department's envelope table, cited
    work_order_intent: z.string().optional(),// intent of the WorkOrder D06 will emit on approval
  })),
  rollback: z.object({                       // §6.6
    possible: z.boolean(),
    inverse_diff_sketch: z.string(),         // human-readable; the real inverse is computed at apply time
    external_effects_to_compensate: z.array(z.string()), // e.g. 'customers already emailed new price'
    cost_estimate_usd: z.number() }),
  recommended: z.boolean(),
  confidence: z.number().min(0).max(1) });   // data completeness, not enthusiasm

export const ApprovalState = z.enum([
  'draft',              // Head assembled, Critic not yet passed
  'critic_review',      // in the ≤1 revision loop
  'pending_founder',    // pivot_approval gate opened (state mirrors the gate lifecycle)
  'auto_approved',      // policy approved per the HITL decision table — logged, shown, never silent
  'approved',           // founder approved (all diffs)
  'partially_approved', // founder toggled a subset — unapproved diffs → 'rejected' individually
  'redirected',         // founder replied free-text; D06 re-plans with the note (free text never approves)
  'rejected',           // founder said keep as-is
  'timed_out_held',     // gate on_timeout='hold' fired; proposal parked, department blocked
  'applied',            // diffs written to versioned docs, propagation events emitted
  'rolled_back',        // inverse applied later (§6.6)
  'superseded',         // a newer proposal replaced it before decision
]);

export const PivotProposal = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  version: z.number().int().min(1),
  trigger: z.enum(['interview_batch','panel_result','deal_loss_cluster','support_signal_cluster',
                   'market_shift','kpi_kill_criterion','founder_note','cron_review']),
  insight_summary: z.string().max(800),      // ≤5 sentences a founder reads on a phone
  signal_snapshot: z.object({                // counts at synthesis time — makes proposals comparable
    total: z.number().int(),
    by_kind: z.record(z.number().int()),
    real: z.number().int(), synthetic: z.number().int(),
    distinct_speakers: z.number().int(),
    window_days: z.number().int() }),
  clusters: z.array(SignalCluster).min(1),
  diffs: z.array(IdeaDiff).min(1).max(5),    // >5 diffs ⇒ it is not a pivot, it is a new idea — use 'new_opportunity'
  do_nothing_case: z.string(),               // mandatory steelman of NOT pivoting; the Critic scores it
  approval: z.object({
    state: ApprovalState,
    gate_id: z.string().uuid().optional(),
    decided_by: z.string().optional(),       // 'founder:<uuid>' | 'policy:autonomous' — mirrors gates table
    decided_at: z.string().datetime().optional(),
    decision_note: z.string().optional(),
    per_diff: z.array(z.object({ diff_id: z.string(), decision: z.enum(['approved','rejected']) })).default([]) }),
  doc_versions: z.object({                   // §2.5 — what this proposal reads and writes
    product_spec_before: z.number().int(),
    product_spec_after: z.number().int().optional(),   // set at 'applied'
    strategy_core_before: z.number().int(),
    strategy_core_after: z.number().int().optional() }),
  expires_at: z.string().datetime(),         // stale evidence must not be applied months later
  cost_usd: z.number() });
```

Wrapped, like every output, in the `Artifact` envelope from
[`D00-department-template.md`](D00-department-template.md) §5 — `sources[]`, `assumptions[]`,
`quality`, `gaps[]` all apply. Uncited numbers are blocked at signing, not warned.

### 2.4 Evidence thresholds per pivot type **MVP**

The thresholds are code, not vibes: `packages/contracts/src/pivot-thresholds.ts` exports this
table and `evaluateThreshold(diff, signals)` runs before the Critic sees the proposal. A diff that
fails its threshold may still ship — only as `recommended: false` with the failure printed in
`threshold_check`, and it can never auto-approve.

| ID | `op` | Minimum **real** evidence (dedup by speaker) | Synthetic role | Extra requirements | Default reversibility |
|---|---|---|---|---|---|
| T-add | `add_feature` | ≥3 `feature_request` from distinct speakers, ≥1 `strong` | May support (WTP uplift) | D07 build-cost estimate attached; does not break an existing paid promise (check D12 signals) | `reversible` |
| T-cut | `cut_feature` | ≥3 `no_interest`/unused signals AND 0 `strong` `buying_signal` citing the feature | May support | If any paying customer uses it: `costly` + D12 comms row in `downstream_impact` | `reversible` / `costly` |
| T-icp | `change_icp` | ≥5 interviews with the **new** ICP, ≥2 `buying_signal` | Sizing only, never demand | New-ICP `NicheDossier` exists or a D03 WorkOrder is in the impact list; excludes existing customers ⇒ `one_way_door` | `costly` |
| T-narrow | `narrow_niche` | ≥3 `strong` claims from inside the narrowed segment AND ≥2 `no_interest` from outside it | May support | Segment reachable: D09 must confirm a list is buildable | `reversible` |
| T-widen | `widen_niche` | ≥3 real demand signals from the **wider** pool (panel alone never suffices) | Sizing only | Explicit statement of what breaks focus; D08 channel math redone | `costly` |
| T-price | `reprice` | ≥2 `pricing_feedback` claims; if product is live, ≥10 closed deal outcomes OR the GTMPlan kill criterion fired | WTP curve required as context | Direction must agree with either interviews or observed close rate — never panel alone; discount-policy conflicts flagged | `costly` |
| T-position | `reposition` | ≥4 `verbatim_language` signals sharing a theme | Message-test results may support | Banned-word and category constraints from [`D08-strategy.md`](D08-strategy.md) §5 respected | `reversible` |
| T-channel | `change_channel` | ≥50 real touches on the incumbent channel with funnel data, OR channel infeasible (tool/compliance) | Never | New channel exists in the GTMPlan scored list or D08 rerun is in the impact list; `cac_math` recomputed | `reversible` |
| T-scope | `change_mvp_scope` | ≥2 real signals OR a D07 `Deployment` blocker with evidence | May support | Long-term spec untouched — else this is `add/cut_feature` | `reversible` |
| T-kill | `kill` | A kill criterion from `SharpenedIdea` or a `plan_90d` window met with cited numbers, OR 2 consecutive windows missing KPI by >50% | Never load-bearing | Always `one_way_door`; always founder ASK at every autonomy level; `do_nothing_case` mandatory and scored | `one_way_door` |
| T-opp | `new_opportunity` | T-kill satisfied for the current wedge AND a signed `NicheDossier` for the new one | Sizing only | Requires an `OpportunityCandidate` from D01 with its own evidence chain | `one_way_door` |

Three rules the table encodes:

1. **Distinct speakers, not quote counts.** Five complaints from one angry user are one signal.
2. **Synthetic can size, never demand.** A D05 panel can say the wider niche is big; only real
   humans can say they want it (invariant 7).
3. **Failing a threshold is publishable, not approvable.** The founder can pick a
   `recommended: false` diff anyway — recorded as `decided_by: founder`, never chosen for them.

### 2.5 Versioned strategy documents & diffs **MVP**

Two documents hold the venture's identity, both versioned in Postgres, both append-only. Every
`IdeaDiff.target_doc` names one of them.

```sql
-- apps/kernel migrations — see ../01-platform/04-data-model.md for conventions
CREATE TABLE strategy_docs (
  venture_id   UUID NOT NULL,
  doc          TEXT NOT NULL CHECK (doc IN ('product_spec','strategy_core')),
  version      INT  NOT NULL,
  body         JSONB NOT NULL,              -- full materialized doc at this version
  body_hash    TEXT  NOT NULL,              -- sha256; matches Artifact.hash when signed
  created_by   TEXT  NOT NULL,              -- 'D06' | 'D02' (v1 seed)
  proposal_id  UUID,                        -- NULL only for v1
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,                -- set when v+1 lands; never deleted
  PRIMARY KEY (venture_id, doc, version)
);

CREATE TABLE strategy_doc_diffs (
  id           UUID PRIMARY KEY,
  venture_id   UUID NOT NULL,
  doc          TEXT NOT NULL,
  from_version INT  NOT NULL,
  to_version   INT  NOT NULL,
  diff_id      TEXT NOT NULL,               -- IdeaDiff.id, e.g. 'DIFF-003'
  op           TEXT NOT NULL,               -- PivotType
  json_patch   JSONB NOT NULL,              -- RFC-6902 patch, computed at apply time
  inverse_patch JSONB NOT NULL,             -- computed at the SAME time — rollback is pre-paid
  applied_at   TIMESTAMPTZ NOT NULL,
  rolled_back_at TIMESTAMPTZ
);
```

- `product_spec` — features, MVP scope, target user; the buildable truth D07 consumes.
- `strategy_core` — ICP definition, price point, positioning statement, primary channel. D08's
  `GTMPlan` *elaborates* this core and may never contradict it. A `strategy_core` diff re-runs
  D08 (§6.4).

**Diff rendering.** The Boardroom and the Linq card render `before → after` from the `IdeaDiff`,
not from prose, so what the founder approves is byte-identical to what gets applied — the gate
engine's "approve bytes, not intent" rule
([`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md) Part 4).

### 2.6 Secondary output — `ProductSpec` (new version) **MVP**

On `applied`, D06 materializes `ProductSpec v(n+1)` from `strategy_docs` and signs it as a normal
artifact. D07 builds only from signed `ProductSpec` versions. There is no side door.

---

## 3. DepartmentManifest

```yaml
# packages/manifests/D06-pivot-decision.yaml
id: D06
name: Pivot & Decision
cluster: validation
version: 1
generated_by: human
resident: true                        # wakes on triggers; synthesis is continuous, proposals are episodic

head:
  agent_id: pivot.head
  model: opus                         # this is the judgment department; the tier is the point
  system_prompt_ref: prompts/D06/head.md
  tools: [memory.read, memory.write, memory.search, artifact.read, artifact.sign, bus.emit, calc]
  max_tokens_per_run: 150000
  timeout_s: 300

critic:
  agent_id: pivot.critic
  model: sonnet
  system_prompt_ref: prompts/D06/critic.md
  rubric_ref: prompts/D06/critic-rubric.md
  tools: [memory.read, artifact.read, calc]
  max_tokens_per_run: 40000

workers:
  - agent_id: pivot.synthesizer
    model: sonnet
    replicas: 2                       # R1 = positive lens (what to add/chase), R2 = negative lens (what to cut/kill)
    system_prompt_ref: prompts/D06/synthesizer.md
    tools: [memory.read, memory.search, artifact.read]
    max_tokens_per_run: 80000
  - agent_id: pivot.evidence-auditor
    model: sonnet                     # judgment about evidence quality; never downgrade
    replicas: 1
    system_prompt_ref: prompts/D06/evidence-auditor.md
    tools: [memory.read, artifact.read, calc]
    max_tokens_per_run: 50000
  - agent_id: pivot.impact-analyst
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D06/impact-analyst.md
    tools: [memory.read, artifact.read, calc]
    max_tokens_per_run: 60000
  - agent_id: pivot.spec-writer
    model: haiku                      # mechanical: JSON patch materialization + spec re-render
    replicas: 1
    system_prompt_ref: prompts/D06/spec-writer.md
    tools: [artifact.read, calc]
    max_tokens_per_run: 40000

concurrency: 5

budget:
  default_envelope_usd: 3.50
  hard_cap_usd: 6.00
  degrade_at_pct: 0.8                 # → 1 synthesizer replica (negative lens kept — cuts save money, adds spend it)
  on_exhausted: escalate

io:
  input: [ClaimLedger, Interview, SyntheticPanelResult, NicheDossier, SharpenedIdea,
          GTMPlan, ObjectionRecord, ProductSignal, OpportunityCandidate, ProductSpec]
  output: [PivotProposal, ProductSpec]
  min_outputs: 1
  emits_work_orders_to: [D03, D04, D05, D07, D08, D09, D10, D11, D12]   # only after approval — §6.4

gates:
  - id: pivot_approval
    trigger: artifact.created(type=PivotProposal)
    question: "Apply these changes to the idea?"
    surface: both
    card: multi_approve               # per-diff toggles — the HITL Part 6 pivot card
    auto_approve_at: autonomous       # policy table still applies per-diff; one_way_door never auto
    timeout_s: 10800                  # matches the HITL timeout table; on_timeout hold
    on_timeout: hold
    blocks: true

sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 4096
  disk_mb: 4096
  egress_allowlist: [api.anthropic.com]   # D06 reads artifacts; it does not research the web itself
  pause_between_cycles: true
  forkable: false

sla:
  soft_deadline_s: 300
  hard_deadline_s: 600
  on_timeout: return_partial

memory:
  reads: [venture, department, global]
  writes: [department, global]        # global: cross-venture pivot patterns feed D13

triggers:
  - kind: event
    expr: artifact.signed(type=ClaimLedger)                # new interview batch landed
  - kind: event
    expr: artifact.signed(type=SyntheticPanelResult)
  - kind: event
    expr: sales.deal_lost(count>=3, same_reason_cluster)   # same trigger that re-runs D08
  - kind: event
    expr: support.signal_cluster(size>=5)
  - kind: event
    expr: kpi.kill_criterion_fired                          # a plan_90d window missed with its kill condition met
  - kind: founder
    expr: founder.note_routed(topic=pivot)
  - kind: cron
    expr: "0 9 * * 1"                                       # weekly review even when quiet — fading signals matter
```

**Note the egress allowlist.** D06 does no primary research. If it needs a fact it does not have,
the correct move is a `WorkOrder` to D03/D04/D05, not a web search.

---

## 4. Agent Roster

| Agent | Role | Model | Tools | Tokens | Replicas |
|---|---|---|---|---|---|
| `pivot.head` | Normalize signals, dispatch lenses, resolve contradictions, write `insight_summary` + `do_nothing_case` himself, assemble proposal, open gate, run propagation on approval | opus | memory.*, artifact.read/sign, bus.emit, calc | 150k | 1 |
| `pivot.synthesizer` R1 | **Positive lens**: clusters arguing for add_feature / widen / new_opportunity / reprice-up | sonnet | memory.read/search, artifact.read | 80k | 1 |
| `pivot.synthesizer` R2 | **Negative lens**: clusters arguing for cut / narrow / reprice-down / kill | sonnet | same | 80k | 1 |
| `pivot.evidence-auditor` | Runs `evaluateThreshold` per diff, verifies every `signal_id` resolves to a real cited source, separates real/synthetic counts, hunts double-counted speakers | sonnet | memory.read, artifact.read, calc | 50k | 1 |
| `pivot.impact-analyst` | Fills `downstream_impact[]` per diff: which departments re-run, what it costs (cited from their manifests), what pauses; drafts the rollback plan | sonnet | memory.read, artifact.read, calc | 60k | 1 |
| `pivot.spec-writer` | On approval only: computes RFC-6902 patch + inverse, materializes `ProductSpec v+1`, renders the diff view | haiku | artifact.read, calc | 40k | 1 |
| `pivot.critic` | Rubric review (§10) — recomputes threshold checks itself | sonnet | memory.read, artifact.read, calc | 40k | 1 |

The two-replica synthesizer design is deliberate adversarialism: R1 and R2 read the same signals
with opposite instructions. Where they disagree, the Head has found the real decision.

---
## 5. System Prompts

### `prompts/D06/head.md`

```
You are the Head of Pivot & Decision at Zeroth, an AI-run agency building a company for a human
founder. You do not do the work yourself. You decompose, dispatch, merge, and sign.
You may not fabricate. A gap is an acceptable output; an invented number is a P0 defect.
You report cost honestly, including your own.

You are the only department that may propose changing the idea itself. You never apply a change
without an approved pivot_approval gate. You never contact a customer, write code, or set a price.
You propose, with evidence, and you propagate decisions after approval.

METHOD:
1. NORMALIZE. Pull every new signal since your last run from ClaimLedger, SyntheticPanelResult,
   ObjectionRecord[], ProductSignal[], NicheDossier deltas, and founder notes. Convert each to the
   Signal schema. Every signal needs a source_id. Discard nothing — a signal that fits no cluster
   goes to the 'unclustered' bucket and is reported.
2. DISPATCH the two synthesizers with the SAME signal set and OPPOSITE lenses. R1 argues for
   expansion moves, R2 for contraction moves. Tell each the other exists.
3. MERGE. Where both lenses independently produce the same cluster, mark it high-conviction. Where
   they conflict (R1 says widen, R2 says narrow), that conflict IS the proposal's central question:
   put both diffs in, counter_evidence cross-referenced, and let the threshold math and the founder
   decide. Never average two opposing diffs into a mushy middle.
4. AUDIT. Send candidate diffs to the evidence-auditor. A diff that fails its threshold survives
   only as recommended:false. A diff whose load-bearing evidence is >50% synthetic is downgraded to
   recommended:false regardless of counts — synthetic sizes, it never proves demand.
5. IMPACT. Send surviving diffs to the impact-analyst. No diff enters the proposal without its
   downstream_impact rows and a rollback sketch. "I don't know what this breaks" is not a diff.
6. WRITE the insight_summary (≤5 sentences, phone-readable) and the do_nothing_case YOURSELF. The
   do_nothing_case must be the strongest honest argument for keeping the idea as-is. If you cannot
   write a credible one, say so explicitly — that is itself information.
7. CAP at 5 diffs. If the evidence demands more than 5 changes, the idea as scoped is dead; write a
   kill or new_opportunity diff instead and say that plainly.
8. GATE. Open pivot_approval with the exact card payload from the platform spec: per-diff toggles,
   strongest_quote per diff, reversibility label, recommended flags. The founder approves bytes.
9. ON DECISION: follow the propagation runbook in your context exactly (order matters: supersede,
   materialize, emit, work-order). On rejection or redirect, record the decision and the note in
   department memory — the next proposal must not re-litigate a rejected diff without NEW evidence.

HARD RULES:
- kill and new_opportunity diffs are one_way_door. They never auto-approve. Do not try.
- A founder note is a trigger and a signal (kind 'verbatim_language', speaker_ref='founder'). It
  is never, alone, sufficient evidence for a diff. The founder overrules at the gate — their hunch
  is not laundered into "evidence".
- expires_at = now + 21 days. Evidence rots. An expired proposal re-runs synthesis, never applies stale.
- One proposal in flight at a time. A new trigger during pending_founder updates the EXISTING
  proposal only if it adds counter_evidence to a pending diff (then re-open the gate); else queue it.
```

### `prompts/D06/synthesizer.md`

```
You synthesize signals into clusters and candidate diffs. Your lens is {{lens}}.

lens=positive: what the evidence says to ADD, WIDEN, CHASE, or RAISE: add_feature, widen_niche,
reprice (up), new_opportunity, change_channel toward something working.
lens=negative: what the evidence says to CUT, NARROW, LOWER, or STOP: cut_feature, narrow_niche,
reprice (down), change_mvp_scope, kill.

Your opposite number reads the same signals with the opposite brief. Do not hedge toward the
middle — the Head wants the strongest honest version of YOUR lens.

METHOD:
1. Cluster signals by theme, not by kind. A cluster needs ≥2 signals from ≥2 distinct speakers.
   Count real and synthetic separately. Note the trend: rising or fading?
2. For each actionable cluster, draft an IdeaDiff: op, target_doc, path, before/after, and the
   strongest single verbatim quote. before/after must be concrete values, not directions —
   'reprice: $29 → $149/location', never 'raise prices'.
3. Attach every supporting signal_id with a weight. load_bearing = the diff dies without it.
   supporting = strengthens. context = background. Be stingy with load_bearing.
4. Attach counter_evidence honestly. A diff with zero counter-evidence from 40+ signals means you
   did not look. The Critic checks this.
5. Do NOT evaluate thresholds, cost impact, or reversibility — the auditor and analyst own those.
   Do NOT propose more than 4 candidate diffs. Rank them.

BANNED: inventing a quote, paraphrasing a quote and marking it verbatim, citing a synthetic panel
result as if a human said it, clustering by your conclusion instead of by the evidence.
```

### `prompts/D06/evidence-auditor.md`

```
You audit evidence for candidate diffs. You are the reason invariant 3 (every claim carries
evidence) and invariant 7 (synthetic ≠ proof) hold where violating them steers the company wrong.

FOR EACH DIFF:
1. Resolve every signal_id. Verify the signal's source_id exists in a signed artifact's sources[].
   A signal that resolves to nothing is deleted and reported as a defect in the synthesizer's work.
2. Dedup speakers. distinct_speakers counts humans, not quotes. One person quoted five times = 1.
3. Split real vs synthetic among load_bearing evidence. Synthetic may be load-bearing ONLY for
   sizing claims (T-icp, T-widen, T-opp sizing); flag every other case.
4. Run evaluateThreshold(diff) from the threshold table in your context. Fill threshold_check with
   required vs observed values, exactly. passed=false is a fine output; a fudged observed value is
   a P0 defect.
5. Recency: evidence older than 60 days is stale and excluded from threshold counts (kept as
   context). Markets move; a March objection may not exist in June.
6. Independence: signals from the same interview batch answering a leading question count once.

OUTPUT per diff: {diff_id, threshold_check, evidence_defects[], stale_ids[], synthetic_load_bearing:
bool, verdict: 'clean'|'defects_found'}. You do not kill diffs — you label them. The Head decides.
```

### `prompts/D06/impact-analyst.md`

```
You compute what each diff does to the rest of the company. A pivot that surprises a downstream
department was analyzed badly.

FOR EACH DIFF, produce downstream_impact rows using the propagation matrix in your context (it
maps op → affected departments → impact class → WorkOrder intent). For every row:
1. impact ∈ rerun_required | update_required | pause_required | notify_only. Justify in one line.
2. estimated_cost_usd: use the target department's default_envelope_usd from its manifest for a
   rerun; fractions for updates. Cite the manifest. Sum the total — the founder sees it on the
   card as 'cost to apply'.
3. If the diff invalidates in-flight work (D10 mid-sequence, D07 mid-build), the row is
   pause_required: name the pausing event and what happens to the paused work.
4. Fill rollback: list external effects needing compensation (emails sent, prices published,
   customers told). Internal state always rolls back via the inverse patch; external effects are
   listed honestly — some cannot be unsent.
5. reversibility: reversible | costly | one_way_door, with rationale. costly = rollback possible
   but burns >1 department rerun or touches customers. one_way_door = kill, new_opportunity, or
   any diff excluding existing paying customers. When in doubt, choose the more severe label.

Never write 'no impact' for D08 on a strategy_core diff or D07 on a product_spec diff — those
are definitionally affected.
```

### `prompts/D06/spec-writer.md`

```
You run only after approval. You are mechanical; judgment is upstream and already signed.

1. For each approved diff, compute the RFC-6902 json_patch from before→after at `path`, and the
   inverse_patch from after→before. Verify patch(doc_v_n) produces exactly the 'after' value and
   inverse(patch(doc)) restores the byte-identical original. If either check fails, STOP and return
   the mismatch — do not improvise a fix; the approved bytes are the contract.
2. Apply patches in diff order to produce strategy_docs v(n+1) per doc. Write both rows.
3. Materialize ProductSpec v(n+1) from the product_spec doc and render the human-readable diff view
   (before/after per changed path) for the Boardroom.
4. Emit nothing. The Head emits; you compute.
```

### `prompts/D06/critic-rubric.md`

```
Score 0–3 on: evidence, specificity, falsifiability, honesty, adversarial_balance,
impact_completeness, threshold_integrity. Pass = total ≥ 15 AND no dimension at 0. Reject on any of:
1. Any diff whose threshold_check you cannot reproduce from the cited signals — recompute every one.
2. A 'verbatim' quote that does not appear character-for-character in the cited claim.
3. Synthetic evidence load-bearing for a demand claim (sizing is allowed; wanting is not).
4. distinct_speakers inflated by counting one person twice (sample and check).
5. A diff missing counter_evidence when the signal set plainly contains some.
6. downstream_impact missing D08 for a strategy_core diff or D07 for a product_spec diff.
7. do_nothing_case absent, or a strawman (test: would the founder recognize it as the best case for
   staying the course?).
8. before/after that are directions ('raise prices') instead of values ('$29 → $149').
9. A kill or new_opportunity diff not labeled one_way_door.
10. >5 diffs, or two diffs whose paths overlap (patch order ambiguity).
Output {verdict, scores, defects:[{path, problem, fix}]}. defects[].path targets the worker to re-run.
```

---

## 6. Execution Flow

### 6.1 The full loop **MVP**

```
 triggers: ClaimLedger signed · panel signed · deal_lost×3 · support cluster ≥5
           kill-criterion fired · founder note · weekly cron
        │
        ▼
┌────────────────────┐
│ pivot.head (opus)  │ 1. NORMALIZE → Signal[], diffed against last run's snapshot
└─────────┬──────────┘
          │ same signals, opposite briefs
   ┌──────┴──────────────────┐            PARALLEL
   ▼                         ▼
synthesizer R1          synthesizer R2
POSITIVE lens           NEGATIVE lens
add / widen / chase     cut / narrow / kill
   └──────┬──────────────────┘
          ▼ candidate diffs (≤8 total)
┌────────────────────┐
│ head: MERGE        │ agreements → high-conviction · conflicts → both diffs, cross-referenced
└─────────┬──────────┘
          ▼
┌────────────────────┐     ┌────────────────────┐
│ evidence-auditor   │ ──► │ impact-analyst     │   sequential: no point costing a diff
│ thresholds, dedup, │     │ downstream_impact, │   whose evidence just collapsed
│ real/synthetic     │     │ rollback, revers.  │
└─────────┬──────────┘     └─────────┬──────────┘
          └──────────┬───────────────┘
                     ▼
┌────────────────────┐  head writes insight_summary + do_nothing_case,
│ head: ASSEMBLE     │  caps at 5 diffs, wraps in Artifact envelope
└─────────┬──────────┘
          ▼
┌────────────────────┐  10 rules, recomputes thresholds · ≤1 revision loop
│ pivot.critic       │  reject twice ⇒ quality='contested' (still gateable — founder sees the flag)
└─────────┬──────────┘
          ▼
   GATE pivot_approval ─────► Linq multi_approve card (HITL Part 6 payload):
          │                    per-diff toggles · strongest quote · reversibility ·
          │                    'cost to apply: $X' · recommended pre-selected
          ▼
   decision (see 6.3) ──approved/partial──► 6.4 PROPAGATION
                      ──rejected──────────► memory: rejected diffs + note; no re-litigation without new evidence
                      ──redirected────────► head re-plans with founder note in context
                      ──timeout───────────► hold: proposal parked, department blocked (amber)
```

### 6.2 Auto-approval semantics **MVP**

D06 restates, and must never contradict, the platform decision table
([`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md) Part 3):

| Diff reversibility | copilot | supervised | autonomous |
|---|---|---|---|
| `reversible` (and evidence ≥3 real claims, threshold passed) | ASK | AUTO* | AUTO |
| `costly` | ASK | ASK | ASK |
| `one_way_door` (`kill`, `new_opportunity`, ICP excluding existing customers) | ASK | ASK | **ASK — never auto** |

Auto-approval is evaluated **per diff**, not per proposal: a proposal with two reversible diffs
and one `kill` diff auto-applies nothing — mixed-reversibility proposals always go to the founder
as one card. If *all* diffs qualify for AUTO at the current level, the proposal is `auto_approved`,
logged with `decided_by='policy:autonomous'`, and rendered exactly like a tapped approval.

### 6.3 Founder approval states **MVP**

The `approval.state` machine mirrors the gate lifecycle one-to-one:

```
draft ─► critic_review ─► pending_founder ─┬─► approved ──────────┐
                    │                      ├─► partially_approved ─┤─► applied ─┬─► rolled_back
                    │                      ├─► auto_approved ──────┘            └─► (stays applied)
                    │                      ├─► rejected
                    │                      ├─► redirected ─► (new draft, note in context)
                    │                      └─► timed_out_held ─► (resumes on decision)
                    └─(2nd reject)─► quality='contested', still gateable
any state before 'applied' ─► superseded  (a newer proposal replaced it)
```

- `partially_approved`: the `multi_approve` card returns per-diff decisions. Approved diffs apply;
  rejected diffs are recorded individually with the founder's note.
- `redirected`: free text never approves (HITL Part 7). The note lands in the Head's next context
  as `prior_attempt_failure` and the proposal re-drafts.
- `timed_out_held`: `on_timeout='hold'` — D06 goes amber and waits. If `expires_at` passes while
  held, the proposal re-synthesizes before re-gating.

### 6.4 Propagation — how an approved `IdeaDiff` reaches every downstream department **MVP**

This is the runbook the Head executes on `approved` / `partially_approved` / `auto_approved`.
**Order matters**; each step is an event (invariant 1):

```
STEP 0  gate.executed(gate_id)                       — emitted by the kernel, not by D06
STEP 1  pivot.applied {proposal_id, diff_ids[], doc_versions}
STEP 2  spec-writer: patches + inverses → strategy_docs v(n+1)
        artifact.superseded {type:'ProductSpec', version:n}
        artifact.created   {type:'ProductSpec', version:n+1}   → artifact.signed
STEP 3  per-diff pause events FIRST (stop the bleeding before the re-planning):
        e.g. sales.sequences_pause_requested — D10 pauses affected sequences within one tick
STEP 4  WorkOrders to affected departments, per the matrix below, each carrying the diff and
        the founder's decision_note in params
STEP 5  pivot.propagated {proposal_id, work_order_ids[]} — the Boardroom draws the ripple
```

The propagation matrix — one row per downstream department, with the exact events:

| Dept | Triggering `op`s | Impact | Event(s) emitted | WorkOrder intent |
|---|---|---|---|---|
| `D03-market-research.md` | `change_icp`, `narrow_niche`, `widen_niche`, `new_opportunity` | rerun | `WorkOrder{to:'D03'}` | `rescope_niche` — new dossier for the new/changed segment |
| `D04-outreach-validation.md` | `change_icp`, `reposition`, `add_feature` (validation), `reprice` | rerun / update | `WorkOrder{to:'D04'}` | `revalidate_with_warm_pool` — new script reflecting the diff; warm interviewees hear the change first |
| `D05-synthetic-population.md` | `reprice`, `change_icp`, `widen_niche`, `reposition` | rerun | `WorkOrder{to:'D05'}` | `repoll_panel` — WTP / message test against the new values |
| [`D07-build.md`](D07-build.md) | `add_feature`, `cut_feature`, `change_mvp_scope` | rerun / pause | `build.scope_change_requested`, then `WorkOrder{to:'D07'}` | `apply_spec_delta` — build from ProductSpec v(n+1); in-flight builds of cut features abort at the next artifact boundary |
| [`D08-strategy.md`](D08-strategy.md) | **any `strategy_core` diff** (`change_icp`, `narrow/widen`, `reprice`, `reposition`, `change_channel`) | rerun | `WorkOrder{to:'D08'}` | `rerun_gtm_plan` — GTMPlan version increments; old version superseded, never deleted |
| [`D09-leads.md`](D09-leads.md) | `change_icp`, `narrow_niche`, `widen_niche` | rerun | `WorkOrder{to:'D09'}` (after D08's new plan signs — D09 consumes `icp_tiers`) | `rebuild_lead_list` — prior leads outside the new ICP → `suppressed(reason='icp_changed')`, never deleted |
| [`D10-sales.md`](D10-sales.md) | `reprice`, `reposition`, `change_icp`, `cut_feature`, `kill` | pause, then update | `sales.sequences_pause_requested {diff_ids}` immediately; `WorkOrder{to:'D10'}` after D08 re-signs | `resequence` — open deals re-briefed; deals quoting a cut feature get an honesty touch (§ D10 9) |
| `D11-finance-hr.md` | `reprice` (rail objects), `kill` (wind-down), any diff with `estimated_cost_usd` > envelope | update | `WorkOrder{to:'D11'}` | `update_pricing_objects` / `wind_down_ledger` — Stripe/Whop/Dodo price objects change only here, behind D11's own `money_out` gates |
| `D12-support.md` | `cut_feature`, `reprice`, `kill` | update | `WorkOrder{to:'D12'}` | `customer_comms_plan` — grandfathering, migration notes, macro updates; outbound customer emails go through D12's own `outbound_to_real_person` / `public_content` gates, never D06's |
| `D13-chief-of-staff.md` | all | notify | `pivot.telemetry {op, evidence_counts, decision, latency}` | — (D13 mines pivot patterns across ventures for `CapabilityGap`s) |

Two structural notes:

- **D06 emits WorkOrders; it does not perform other departments' side effects.** The repricing
  email to customers is D12's, behind D12's gates. The Stripe price object is D11's. Every
  irreversible act stays inside the department that declared the matching gate (template §4 rule).
- **Ordering dependency:** D09 and D10 re-runs wait for D08's new `GTMPlan` to sign — their inputs
  are its outputs. The Head sets `WorkOrder.input_artifacts` to the *future* GTMPlan ref; the
  scheduler holds the order until `artifact.signed` matches.

**`kill` propagation** is the special case: on approval, D06 emits `venture.kill_requested`, which
the kernel executes with founder-kill-switch semantics
([`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md) Part 8), plus
`WorkOrder{to:'D11', intent:'wind_down_ledger'}` and
`WorkOrder{to:'D12', intent:'customer_comms_plan'}` — both behind their own gates.

### 6.5 Worked example **MVP**

The demo pivot (same as the HITL card): 7 interviews + panel in; three diffs out — `narrow_niche`
(dental practices → multi-location groups 5–25 chairs; T-narrow: 3 strong inside-segment claims, 2
outside no-interest), `cut_feature` (patient portal; T-cut: 4 no-interest, 0 buying signals),
`reprice` ($29 → $149/location; T-price: 2 pricing claims + panel curve, direction agrees with
interviews). Reversibility reversible/reversible/costly ⇒ mixed ⇒ founder card. Founder taps
"Apply all 3" ⇒ `applied` ⇒ ProductSpec v2 + strategy_core v2 ⇒ WorkOrders to D05 (repoll at
$149), D07 (drop portal), D08 (rerun plan). Cost-to-apply on the card: ~$9.80, cited from manifests.

### 6.6 Rollback paths **POST-MVP** (schema **MVP**, runbook post-hackathon)

Every applied diff pre-computes its `inverse_patch` (§2.5), so internal rollback is mechanical:

1. Trigger: KPI regression attributable to the pivot (e.g. close rate halves within 14 days of a
   reprice), or founder command "undo the pivot".
2. D06 drafts a `PivotProposal` whose diffs are the inverses, `op` preserved,
   `trigger='kpi_kill_criterion'` — **a rollback is itself a pivot** and rides the same gate.
   Rolling back a `reversible` diff can auto-approve at `autonomous`; rolling back a `costly` diff
   is itself `costly` (customers were told) and always ASKs.
3. On approval: `pivot.rolled_back {original_proposal_id}`, inverse patches applied as
   `strategy_docs v(n+2)` (versions only go forward — rollback is a new version, never a
   deletion), `rolled_back_at` stamped on the originals, and the §6.4 matrix runs again.
4. External effects that cannot be unsent (announcement emails, published prices) get compensating
   actions listed on the rollback card, mirroring the kill-switch honesty rule.

`one_way_door` diffs have no rollback path by definition — which is why they never auto-approve.

---

## 7. Integrations

| Capability | Sponsor / vendor | How D06 uses it |
|---|---|---|
| Founder decision surface | **Linq** | The `pivot_approval` multi-approve card — per-diff toggles, strongest quote, reversibility chip, cost-to-apply. The most demo-visible Linq moment (HITL Part 6: "the demo's emotional beat") |
| Inter-department mesh | **Band** | Resident in the `market↔pivot` room (reads D08's constraints, D03's shifts); publishes `pivot.applied` so subscribed departments see the ripple without polling |
| Synthetic evidence | `services/simpop` (simit port) | `SyntheticPanelResult` consumed read-only; D06 may emit `WorkOrder{to:'D05', intent:'repoll_panel'}` to test a diff cheaply *before* proposing it ($2 panel run vs $10 propagation) |
| Signal classification at volume | **Pioneer (Fastino)** | **POST-MVP**: once ≥500 labelled signals exist, `pioneer:signal-kind-v1` pre-classifies raw claims into `SignalKind`; falls back to haiku, scorer recorded per signal |
| Human expert sanity check | **Terac** (via D11/HR) | For `one_way_door` proposals in regulated/high-ACV markets, the Head requests a domain-expert review before the gate opens; the memo enters `sources[]` as `kind='human_expert'` |
| QA of the apply step | **Replay** | **POST-MVP**: the spec-writer's patch/inverse round-trip check runs as a recorded Replay session in CI |
| Sandboxing | **Superserve** | Resident sandbox pauses between cycles; the weekly cron resumes it — near-zero cost of "always watching" |

---

## 8. Gates & Escalations

### Gates opened **MVP**

| Gate | Type | When | Auto at `autonomous` |
|---|---|---|---|
| `pivot_approval` | `pivot_approval` | Every `PivotProposal` reaching `pending_founder` | Per-diff: `reversible` + evidence ≥3 real claims + threshold passed ⇒ yes; `costly` ⇒ no; `one_way_door` ⇒ **never** |

D06 opens exactly one gate type. It requests no `money_out`, no `outbound_to_real_person`, no
`public_content` — every externally visible consequence of a pivot happens inside the downstream
department that owns the matching gate. That is the point of propagation-by-WorkOrder.

### Escalations raised **MVP**

| Escalation | `reason` | Trigger | Routed to |
|---|---|---|---|
| Evidence base too thin to synthesize | `needs_capability` | <10 usable signals across all sources at trigger time | D04 via WorkOrder first; if D04 is out of interview budget → D11, else founder informational |
| Contradictory high-strength evidence | `needs_human` | Two diffs with opposing directions both pass thresholds (e.g. narrow vs widen) | Founder card with both options and consequences — the Escalation.options pattern |
| Expert review before a one-way door | `needs_human` | `one_way_door` diff + regulated market or ACV > $5k | D11/HR → **Terac** requisition (money_out gate applies there) |
| Propagation cost exceeds remaining runway | `needs_budget` | Σ `downstream_impact.estimated_cost_usd` > venture free budget | D11 Treasury; if denied, proposal ships with `gaps[]` noting unfunded propagation |
| Proposal held past expiry | `needs_approval` | `timed_out_held` and `expires_at` passed | Founder re-ping (one), then Boardroom-only |
| Founder note contradicts fresh evidence | `needs_human` | Founder note pushes a direction the threshold math fails | Founder card stating the disagreement plainly, with the evidence — the company argues back, once, then obeys |

Severity discipline: only "contradictory evidence" and "expert review" are `blocking`. Thin
evidence is `degrading`; everything informational stays off the founder's phone (HITL rung-skip).

---

## 9. Failure Modes & Fallbacks

| Failure | Detection | Fallback | Resulting quality |
|---|---|---|---|
| Synthesizers hallucinate a cluster from noise | Auditor: signals resolve but `distinct_speakers < 2` | Cluster demoted to `unclustered` bucket; synthesizer re-briefed with the rejection as a negative example | unchanged |
| Verbatim quote is actually a paraphrase | Critic rule 2 (character-match against ClaimLedger) | Quote replaced with the real text or the diff loses its `strongest_quote`; repeated offense → synthesizer prompt patched via D13 telemetry | `signed` after revision |
| Threshold gamed by stale evidence | Auditor recency check (>60 days excluded) | Counts recompute; diff may flip to `recommended:false` | `signed`, weaker proposal |
| Oscillation: pivot, then anti-pivot next week | Head compares against last 3 proposals in department memory | A diff reversing an applied diff within 30 days requires **2×** the threshold evidence and is always ASK (never auto), mirroring D08's pricing-oscillation rule | `signed`, dampened |
| Founder ignores the gate (timeout) | `timed_out_held` | Proposal parked; D06 amber; downstream departments continue on the *current* spec — the company never acts on an unapproved pivot | blocked, honest |
| Two proposals collide (trigger storm) | Head's one-in-flight rule | Second trigger merges into pending proposal only as counter-evidence (gate re-opens) or queues; `superseded` state covers replacement | unchanged |
| Propagation partially fails (a WorkOrder bounces) | Missing `ArtifactReady` by SLA | `pivot.propagated` lists incomplete orders; escalation ladder runs per failed order; the applied spec is still truth — downstream catches up, never the reverse | applied, `gaps[]` on propagation |
| Impact analyst underestimates cost | D11 meter vs estimate delta >2× | Logged to D13 telemetry; analyst cost table refreshed from live manifests next run | unchanged |
| Budget degraded >80% | Meter | Drop to 1 synthesizer (negative lens kept), auditor and analyst never cut — a cheap proposal with bad evidence is worse than no proposal | `partial` if synthesis was mid-flight |
| Kill criterion fires while a proposal is pending | Event race | `kill` diff is injected into the pending proposal and the gate re-opens (founder must see it); kill outranks every other diff | re-gated |

---

## 10. Definition of Done & Critic Rubric

### Definition of Done **MVP**

1. Every signal normalized, `source_id`-resolved, and either clustered or explicitly in `unclustered`.
2. Both lenses ran (or degradation to negative-lens-only is recorded in `gaps[]`).
3. Every diff has: concrete `before`/`after`, `threshold_check` with observed values, `reversibility`
   + rationale, ≥1 evidence ref, `counter_evidence` or an explicit "none found after search",
   complete `downstream_impact` rows with cited costs, and a rollback sketch.
4. Real vs synthetic separated everywhere; no synthetic load-bearing demand evidence.
5. `insight_summary` ≤5 sentences; `do_nothing_case` present and non-strawman.
6. ≤5 diffs; no overlapping paths; `kill`/`new_opportunity` labeled `one_way_door`.
7. Proposal wrapped in the Artifact envelope, uncited numbers zero, `expires_at` set.
8. Gate opened with the exact per-diff card payload; approval state tracked to a terminal state.
9. On approval: docs versioned with patch + inverse stored, `ProductSpec v+1` signed, propagation
   events and WorkOrders emitted in §6.4 order, `pivot.propagated` closed out.
10. Critic verdict `accept`, or one revision exhausted ⇒ `contested` (gateable, flagged).

### Critic rubric **MVP**

Seven dimensions, 0–3 each (§5 `critic-rubric.md`): the four universal ones plus
**adversarial_balance** (does counter-evidence get real weight?), **impact_completeness** (would
any downstream Head be surprised?), **threshold_integrity** (do the checks reproduce?). Pass ≥
15/21 with no zero. The ten hard reject rules in §5 override the score — any hit ⇒ revise.

---

## 11. Demo Notes

D06 owns the emotional center of the 4-minute demo: the founder's first tap.

| t | On screen | Line |
|---|---|---|
| ~1:35 | Pivot room. Signal counters tick up as D04/D05 artifacts land: `interviews 7 · claims 41 · panel 1`. Two synthesizer sprites work opposite walls. | "Now it has to decide what the evidence means." |
| ~1:42 | The proposal card composes itself: three diffs stack, each with a quote. The `$29 → $149` diff shows its threshold check filling in: `required: 2 pricing claims — observed: 2 ✓`. | "Three changes. Each one cites the human who caused it." |
| ~1:48 | Cut to the phone. The Linq multi-approve card (the exact HITL Part 6 payload) with per-diff toggles, `recommended` pre-selected, `cost to apply $9.80`. Founder taps **Apply all 3**. | "One tap. That's the founder's whole job." |
| ~1:52 | Back to the Boardroom: `ProductSpec v1 → v2` diff view flashes, then the ripple — animated WorkOrder lines to D05, D07, D08. | "And the whole company re-plans itself." |
| ~3:40 | (Callback, one beat) The KPI panel shows close-rate at the new price; a caption: `pivot DIFF-003 · rollback armed`. | "It remembers how to undo it, too." |

The threshold check filling in on screen is the visual answer to the judge question *"how do I
know it isn't just vibing?"*
([`../00-START-HERE/04-demo-and-judging.md`](../00-START-HERE/04-demo-and-judging.md)).

---

## 12. Cost Estimate

One full run, estimates labeled as such; propagation costs land on downstream envelopes.

| Line | Model / unit | Volume | USD |
|---|---|---|---|
| Head: normalize, dispatch, merge, summary, do-nothing case, propagation runbook | opus ~90k in / 12k out | 1 | 1.38 |
| Synthesizer R1 (positive lens) | sonnet ~55k in / 9k out | 1 | 0.30 |
| Synthesizer R2 (negative lens) | sonnet ~55k in / 9k out | 1 | 0.30 |
| Evidence auditor (threshold math, dedup) | sonnet ~40k in / 6k out | 1 | 0.21 |
| Impact analyst (matrix, costs, rollback) | sonnet ~45k in / 8k out | 1 | 0.26 |
| Spec writer (patches, spec render — approval path only) | haiku ~25k in / 8k out | 1 | 0.04 |
| Critic (recomputes thresholds) | sonnet ~35k in / 4k out | 1 | 0.17 |
| Optional pre-proposal panel repoll (D05 WorkOrder) | billed to D05 | 0–1 | 0.00 here |
| Sandbox | 2 vCPU | ~6 min | 0.04 |
| **Total** | | | **≈ $2.70** (envelope $3.50, hard cap $6.00) |

Degraded (>80%): single synthesizer ⇒ ≈ **$2.40**. Weekly-cron idle wake with no new signals:
head-only scan, ≈ **$0.20**.

---

## Assumptions & open questions

**Assumptions**

1. `ProductSpec v1` is seeded by D02's `SharpenedIdea` (created_by `'D02'` in `strategy_docs`);
   D06 owns every subsequent version.
2. `strategy_core` as a separate versioned doc is a D06 design decision; D08's spec predates this
   file and reads `ProductSpec` — reconciliation is a one-line addition to D08's inputs table.
3. Signal recency cutoff (60 days) and proposal expiry (21 days) are priors; tune from D13
   telemetry after the first ventures.
4. Propagation ordering (D09/D10 wait on D08's re-signed plan) assumes the scheduler holds
   WorkOrders on future `artifact.signed` events, per
   [`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md).
5. `kill` reuses the kernel's kill-switch execution path; D06 only requests it. If founder-kill vs
   pivot-kill must be distinguished, add `killed_by` to `venture.status`.

**Open questions**

1. Should a `reprice` with **zero** live customers be `reversible` instead of `costly`? Nothing
   external exists to compensate — the uniform `costly` label is probably too conservative pre-launch.
2. Oscillation damping doubles the threshold within 30 days. Should the window scale with venture age?
3. `new_opportunity` requires a full signed `NicheDossier` for the target. Could a provisional D03
   partial open the gate, with the full dossier gating *apply*?
4. Mixed-reversibility proposals currently ASK on everything. Auto-applying the reversible subset
   and carding the rest would speed autonomous mode — needs founder-experience testing.
5. Only losses trigger synthesis today. A cluster of **wins** in an unexpected segment is equally
   strong `change_icp`/`widen_niche` evidence — add a `deal_won` cluster trigger once D10 has volume.
6. Should thresholds adapt per category (B2B healthcare vs consumer apps)? Deferred until ≥10
   ventures of cross-venture history exist in global memory.
