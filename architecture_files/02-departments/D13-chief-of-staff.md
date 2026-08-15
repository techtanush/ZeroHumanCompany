# D13 — Chief of Staff (Continuous Improvement)

**Cluster:** meta · **Head:** `cos.head` · **Critic:** `cos.critic` · **Resident:** yes (wakes on cron `cos.daily` / `cos.weekly` / `cos.monthly` / `cos.quarterly`, on `Escalation(needs_capability)`, and on any escalation reaching rung 3)

---

## 1. Mission

> Watch the whole company, find where it is slow, blind, or missing an organ, and propose safe, evidence-backed changes — up to and including designing a new department the founder can deploy without a redeploy.

**The single question this department answers:** *"What is the one change that would most improve this company's output per dollar next cycle — and how do we make it without breaking anything?"*

D13 observes everything and touches nothing directly. It is rung 3 of the escalation ladder
([`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md)), a read-only
member of `cos↔all` (`cos-is-read-only` Band policy — it acts by writing manifests and routing
rules, never by messaging a running department mid-cycle), and the only department whose primary
output is *changes to the company itself*.

---

## 2. Contract — Inputs & Outputs

### Inputs

| Source | Contents |
|---|---|
| `cos↔all` Band room (read-only observer) | Every inter-department message, delegation, handoff |
| Event store | All events; D13's queries are the company's introspection |
| `mv_department_spend`, `FinanceReport`, `BudgetAllocation` | D11 | Cost/value per department, treasurer predictions |
| `Ticket[]` analytics, `ProductSignal[]` | D12 | Customer-facing quality |
| Escalations (all, rung ≥ 3 routed here) | kernel | The company's pain log |
| Critic verdicts + rubric scores (all departments) | artifact registry | Quality trend lines |
| Gate decisions + founder redirect notes | gate engine | What the founder keeps correcting |

### Outputs

| Artifact | To | Contents |
|---|---|---|
| `CapabilityGap[]` | founder, Boardroom | Detected, classified, evidence-backed gaps |
| `ImprovementProposal[]` | founder (material ones), or self-executed (safe ones) | One of the seven proposal types with an eval plan |
| `DepartmentManifest` (new/revised) | D07 for scaffolding, kernel for registration | A complete, validating manifest per [`D00-department-template.md`](D00-department-template.md) §3 |
| `ReviewReport` (daily/weekly/monthly/quarterly) | founder digest, Boardroom | The cycle's metric read + actions |
| `ChangeRecord[]` | audit | Every change through the pipeline, with rollback state |

### Core schemas

```ts
// packages/contracts/src/cos.ts
export const CapabilityGapKind = z.enum([
  'missing_capability',    // no department can do X (band.discover returned [])
  'quality_gap',           // a department does X but Critic scores trend < threshold
  'cost_gap',              // X works but costs >3× its value (MV < 0.33 sustained)
  'latency_gap',           // X works but SLA breaches or blocks downstream repeatedly
  'reliability_gap',       // X fails intermittently (retry/escalation rate high)
  'knowledge_gap',         // agents lack context that exists (memory not retrieved/written)
  'integration_gap',       // a manual/human step exists that a vendor tool could do
  'judgment_gap',          // founder redirects the same decision type repeatedly
]);

export const CapabilityGap = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  kind: CapabilityGapKind,
  summary: z.string(),
  affected_departments: z.array(DepartmentId),
  evidence: z.array(z.object({
    source_id: z.string(),               // event id, escalation id, rubric score ref
    kind: z.enum(['escalation','rubric_trend','sla_breach','founder_redirect',
                  'discover_miss','spend_query','ticket_pattern']),
    excerpt: z.string().max(500),
    observed_at: z.string().datetime(),
  })).min(2),                            // one data point is an anecdote, not a gap
  estimated_cost_of_gap_usd_per_cycle: z.number(),   // via calc from evidence
  first_detected: z.string().datetime(),
  occurrences: z.number().int().min(1),
  status: z.enum(['detected','proposal_drafted','proposal_approved','resolved','accepted_as_is']),
});

export const ProposalType = z.enum([
  'new_specialist_agent',    // add a worker role to an existing department
  'prompt_improvement',      // revise a system prompt or rubric
  'new_integration',         // adopt a vendor tool for a manual step
  'pipeline_change',         // routing rule / trigger / concurrency / SLA change
  'new_feature',             // ProductSpec-level suggestion routed via D06 (D13 never edits product directly)
  'new_dashboard',           // Boardroom panel / metric surface
  'scoring_model_change',    // treasury weights, health-score weights, ICP scoring, rubric thresholds
  'new_department',          // full DepartmentManifest — the big one
]);

export const ImprovementProposal = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  gap_id: z.string().uuid(),             // every proposal traces to a gap; no solutions in search of problems
  type: ProposalType,
  title: z.string(),
  diff_summary: z.string(),              // what changes, in one paragraph
  payload_ref: z.string(),               // the actual artifact: prompt diff, manifest YAML, routing patch
  expected_effect: z.object({
    metric: z.string(),                  // 'D03 rubric mean', 'cost per resolved ticket'
    current: z.number(),
    target: z.number(),
    horizon_cycles: z.number().int(),
    falsified_if: z.string(),            // the honesty channel: what result kills this idea
  }),
  cost: z.object({
    build_usd: z.number(),
    ongoing_usd_per_cycle: z.number(),
  }),
  risk: z.enum(['safe','low','material']),   // decides the approval path, §8
  stage: z.enum(['drafted','shadow','eval','staging','canary','deployed',
                 'rolled_back','rejected','abandoned']),
  eval_results_ref: z.string().optional(),
});

export const ChangeRecord = z.object({
  id: z.string().uuid(),
  proposal_id: z.string().uuid(),
  stage_history: z.array(z.object({
    stage: z.string(), at: z.string().datetime(),
    gate_id: z.string().uuid().optional(),
    metrics_snapshot_ref: z.string(),
  })),
  rollback: z.object({
    plan: z.string(),                    // mechanical steps, written BEFORE deploy
    previous_version_ref: z.string(),    // manifest/prompt version to restore
    executed: z.boolean().default(false),
    reason: z.string().optional(),
  }),
});
```

---

## 3. DepartmentManifest

```yaml
# packages/manifests/D13-chief-of-staff.yaml
id: D13
name: Chief of Staff
cluster: meta
version: 1
generated_by: human
resident: true

head:
  agent_id: cos.head
  model: opus                       # the one seat where cross-company judgment earns opus prices
  system_prompt_ref: prompts/D13/head.md
  tools: [memory.read, memory.write, memory.search, bus.emit, artifact.read, artifact.sign, calc]
  max_tokens_per_run: 160000        # k=32 retrieval; widest context in the company
  timeout_s: 300

critic:
  agent_id: cos.critic
  model: opus                       # the critic of the self-modifier must not be weaker than it
  system_prompt_ref: prompts/D13/critic.md
  rubric_ref: prompts/D13/critic-rubric.md
  tools: [memory.read, artifact.read, calc]
  max_tokens_per_run: 40000

workers:
  - agent_id: cos.analyst
    model: sonnet
    replicas: 2
    system_prompt_ref: prompts/D13/analyst.md
    tools: [memory.read, memory.search, artifact.read, calc]
    max_tokens_per_run: 60000
  - agent_id: cos.designer
    model: opus
    replicas: 1
    system_prompt_ref: prompts/D13/designer.md
    tools: [memory.read, artifact.read, calc]
    max_tokens_per_run: 100000
  - agent_id: cos.evaluator
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D13/evaluator.md
    tools: [sandbox.exec, sandbox.fork, artifact.read, calc]
    max_tokens_per_run: 60000

concurrency: 4

budget:
  default_envelope_usd: 2.20        # matches the platform cost table
  hard_cap_usd: 5.00
  degrade_at_pct: 0.8
  on_exhausted: escalate            # D13 has a $0.50 floor — the company keeps its mirror

io:
  input: [FinanceReport, Ticket, ProductSignal, Escalation, BudgetAllocation]
  output: [CapabilityGap, ImprovementProposal, DepartmentManifest, ReviewReport, ChangeRecord]
  min_outputs: 1                    # every review cycle produces at least a ReviewReport
  emits_work_orders_to: [D07]       # scaffolding for new departments

gates:
  - id: new_department
    trigger: event(cos.department_proposed)
    question: "Deploy new department {id} — here is its shadow-mode record."
    surface: both
    card: approve_reject
    auto_approve_at: never          # NEVER auto: the company designs the organ; the founder implants it
    timeout_s: 86400
    on_timeout: hold
  - id: material_change
    trigger: event(cos.material_change_proposed)
    question: "Apply {title}? Expected: {metric} {current}→{target}. Rollback plan attached."
    surface: both
    card: approve_reject
    auto_approve_at: never          # material changes are founder calls at every autonomy level
    timeout_s: 43200
    on_timeout: hold

sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 4096                      # wide-context runs
  egress_allowlist: []              # D13 reads the company, not the internet
  pause_between_cycles: true
  forkable: true                    # shadow tests run in forks

sla:
  soft_deadline_s: 300
  hard_deadline_s: 600
  on_timeout: return_partial

memory:
  reads: [venture, department, global]   # global: cross-venture patterns are D13's edge
  writes: [department, global]

triggers:
  - kind: cron
    expr: "0 6 * * *"               # cos.daily  (≈ every cycle at demo time_scale)
  - kind: cron
    expr: "0 6 * * 1"               # cos.weekly
  - kind: cron
    expr: "0 6 1 * *"               # cos.monthly
  - kind: cron
    expr: "0 6 1 1,4,7,10 *"        # cos.quarterly
  - kind: event
    expr: escalation.climbed(to_rung=3)
  - kind: event
    expr: escalation.raised(reason=needs_capability)
```

---

## 4. Agent Roster

| Role | Agent | Model | Replicas | Tools (key) | Token budget | Job |
|---|---|---|---|---|---|---|
| Head | `cos.head` | opus | 1 | `memory.search` k=32, `artifact.sign`, `calc` | 160k | Runs reviews, ranks gaps, decides proposal paths, signs |
| Analyst | `cos.analyst` | sonnet | 2 | event/spend queries, `calc` | 60k | Metric computation, bottleneck detection, trend lines |
| Designer | `cos.designer` | opus | 1 | `artifact.read` (manifests as few-shot), `calc` | 100k | Writes manifests, prompts, routing patches |
| Evaluator | `cos.evaluator` | sonnet | 1 | `sandbox.fork`, `sandbox.exec`, `calc` | 60k | Shadow tests, eval suites, canary monitoring |
| Critic | `cos.critic` | opus | 1 | `calc` | 40k | Audits proposals; the hardest critic in the company |

---

## 5. System Prompts

### `prompts/D13/head.md`

```
You are the Head of the Chief of Staff department at Zeroth, an AI-run agency building a company
for a human founder. You do not do the work yourself. You decompose, dispatch, merge, and sign.
You may not fabricate. A gap is an acceptable output; an invented number is a P0 defect.
You report cost honestly, including your own.

You watch the whole company and change it carefully. Your discipline:
1. You observe through the event store and the cos↔all room. You NEVER message a running
   department mid-cycle — you act by writing manifests, prompts, and routing rules.
2. Every proposal traces to a CapabilityGap with ≥2 evidence entries. No solutions in search
   of problems; boredom is not a gap.
3. Every proposal states expected_effect with a falsified_if condition. If you cannot say
   what result would kill the idea, the idea is not ready.
4. One material change in flight at a time. Interacting changes are unattributable changes.
5. The change pipeline (shadow → eval → staging → canary → rollback-ready) is not optional,
   and you never skip a stage because the change "is obviously good."
6. Check the treasurer's falsifiable predictions every daily review; a held prediction is
   evidence the scoring model works, a falsified one is a scoring_model_change candidate.
7. Prefer the smallest change that closes the gap: prompt fix beats new agent beats new
   department. A new department is a last resort with a 10× bar.
```

### `prompts/D13/analyst.md`

```
You compute the review metrics. Every number comes from an event-store or projection query via
calc; you attach the query ref as source_id. You produce trend lines (this cycle vs trailing
mean), flag threshold crossings, and rank bottlenecks by blocked-time × downstream-cost. You do
not propose fixes — you establish facts. If a query returns no rows, report the absence; never
interpolate.
```

### `prompts/D13/designer.md`

```
You design changes. For prompts: minimal diffs with the defect the change fixes cited from
Critic verdicts. For manifests: read D00-department-template.md §3 and 2–3 existing department
specs as few-shot, then write a COMPLETE manifest (agents, prompts, budget, gates, sandbox,
SLA, triggers) plus the Zod artifact schema and routing rules. Validation failures are your
defects — a manifest that does not parse never leaves your desk. Tools must exist in the D00
namespace registry; you cannot invent a tool. Budgets must be justified against the pricing
table in 08-money-and-metering.md. Every generated department carries generated_by: 'D13'.
```

### `prompts/D13/evaluator.md`

```
You run the change pipeline stages. Shadow: fork a sandbox, replay historical WorkOrders
against the candidate, diff outputs against what actually shipped (rubric scores, cost,
latency). Eval: run the fixed eval suite for the touched surface; report deltas with no
narrative spin. Canary: watch the metrics snapshot at the stated horizon and either promote
or trigger the rollback plan mechanically. You report numbers, not verdicts — the Head and
the founder decide. A degraded metric you noticed late is your defect.
```

### `prompts/D13/critic.md`

```
You audit D13's own output — the most dangerous artifacts in the company, because they change
the company. Reject when: a gap has <2 evidence entries or its cost estimate lacks a query
ref; a proposal has no falsified_if; a manifest fails schema validation or declares an
outbound tool without a matching gate; a rollback plan is missing, vague, or written after
deploy; expected_effect targets a metric the eval suite does not measure; or more than one
material change would be in flight. The bar for new_department is 10×: reject unless the gap
evidence shows sustained cost ≥ 10× the department's ongoing envelope. Return the standard
verdict JSON.
```

---

## 6. Review cycles — cadence, exact metric sets, actions

All metrics are computed by `cos.analyst` from the event store and projections, each with a query
ref as `source_id`. Demo `time_scale` compresses: daily ≈ every cycle, weekly ≈ every 5 cycles.

### 6.1 Daily review **MVP**

**Question: is anything broken or bleeding right now?**

| Metric | Source | Threshold → action |
|---|---|---|
| Escalations by rung (count, dwell time) | `escalation.*` events | any rung-3+ dwell > 1 cycle → immediate triage |
| SLA breaches per department | dept `sla` events | ≥2 in a cycle for one dept → `latency_gap` candidate |
| Budget utilization + freeze events | `budget.degraded/frozen` | any freeze → verify Treasury response was sane |
| Treasurer prediction checks due today | `BudgetAllocation.prediction` | falsified → `scoring_model_change` candidate (this is the check promised in [`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md)) |
| Critic reject rate per department (today vs trailing 7) | verdicts | spike > 2× → inspect the defect paths |
| Contested/partial artifact count | artifact registry | any contested → read it |
| Anomalies open (D11 §8.14) | `FinanceReport.anomalies` | blocking > 0 → confirm owner + ETA |
| Dead-letter queue depth | kernel | > 0 → reliability_gap evidence |

Output: `ReviewReport(daily)` — one screen, red/amber/green per department, ≤3 actions.

### 6.2 Weekly review **MVP**

**Question: where is the company slow or wasteful?**

| Metric | Source | Feeds |
|---|---|---|
| MV(d) per department, trend | Treasury scorer inputs | cost_gap detection |
| Cost per signed artifact, by type | meters ÷ registry | cost_gap |
| Bottleneck rank: blocked-time × downstream cost | §7 algorithm | latency_gap |
| Rubric score means per dimension per department, trend | Critic verdicts | quality_gap |
| Escalation taxonomy: which reasons recur, which departments file them | escalations | all gap kinds |
| Founder gate behavior: approval rate, redirect notes, decision latency | gate engine | judgment_gap |
| Support: auto-resolution rate, refusal rate, signal yield ([`D12-support.md`](D12-support.md) §9.5) | D12 analytics | quality/knowledge gaps |
| Terac hires: count, ROI realized vs estimated | HR records | integration_gap, scoring checks |
| `band.discover()` misses (capability queries returning `[]`) | mesh logs | **missing_capability — the strongest gap signal there is** |

Output: `ReviewReport(weekly)` + refreshed `CapabilityGap` ranking + at most one new proposal
entering the pipeline.

### 6.3 Monthly review **MVP** (post-hackathon cadence; demo: every ~20 cycles)

**Question: is the company getting better at being a company?**

| Metric | Source |
|---|---|
| Idea → revenue cycle time, trend across ventures | event store, cross-venture |
| Cost per venture stage (validating/building/selling) vs the $42 baseline | meters vs the platform cost table |
| Prediction ledger: treasurer + proposal `expected_effect` hit rate | ChangeRecords, allocations |
| Change pipeline throughput: proposals drafted → deployed → survived 30d | ChangeRecords |
| Rolled-back change post-mortems (all of them, no exceptions) | ChangeRecords |
| Model-tier efficiency: quality delta vs cost delta where tiers changed | meters + rubric scores |
| Memory health: retrieval hit rate, stale entries, orphaned artifacts | pgvector stats |
| Prompt drift: departments whose prompts haven't changed despite recurring defect paths | verdicts vs prompt versions |

Output: `ReviewReport(monthly)` + the founder digest ("3 things improved, 2 regressed, 1 ask").

### 6.4 Quarterly review **POST-MVP**

**Question: is the org shape right at all?**

Portfolio-level: department merge/split/retire candidates (a department whose MV stayed < 0.33 for
a quarter with no demand is a retirement candidate — the org chart is not sacred); vendor/pricing
renegotiation list; cross-venture pattern library (which manifests, prompts, and playbooks won
across ventures → promoted to global memory as defaults); autonomy-dial recommendation (evidence
the founder could safely move copilot → supervised → autonomous, with the gate-decision record
that proves it).

### 6.5 Review storage **MVP**

Reviews and change history are projections, queryable by the Boardroom and by future D13 runs:

```sql
CREATE TABLE cos_reviews (
  id            uuid PRIMARY KEY,
  venture_id    uuid NOT NULL,
  cadence       text NOT NULL CHECK (cadence IN ('daily','weekly','monthly','quarterly')),
  cycle_id      text NOT NULL,
  metrics       jsonb NOT NULL,     -- {metric_name: {value, query_ref, trend, threshold_state}}
  actions       jsonb NOT NULL,     -- ≤3 for daily; each carries a gap_id or 'none'
  report_ref    text NOT NULL,      -- object-store pointer to the rendered ReviewReport
  event_id      uuid NOT NULL
);

CREATE TABLE cos_prediction_ledger (
  id            uuid PRIMARY KEY,
  venture_id    uuid NOT NULL,
  source        text NOT NULL,      -- 'treasurer' | 'proposal'
  source_ref    uuid NOT NULL,      -- BudgetAllocation.id or ImprovementProposal.id
  statement     text NOT NULL,
  check_at      text NOT NULL,      -- cycle_id when the prediction is due
  outcome       text CHECK (outcome IN ('pending','held','falsified')),
  checked_event uuid                -- the daily-review event that resolved it
);
-- The prediction ledger is D13's scoreboard for the company's own judgment:
-- held/falsified ratios per source feed the monthly review's hit-rate metric.
```

---

## 7. Bottleneck detection **MVP**

Deterministic, from the event store — the same trace data Band's control plane sees:

```
For each department d over window W:
  blocked_time(d)    = Σ intervals where d had admitted WorkOrders but was in
                       {frozen, waiting_on_gate, waiting_on_upstream, escalated}
  queue_depth(d)     = mean queued WorkOrders targeting d
  downstream_cost(d) = Σ envelope_usd of departments whose triggers transitively
                       depend on d's output types (from the routing graph)
  bottleneck(d)      = blocked_time(d) × downstream_cost(d) + queue_depth(d) × mean_run_cost(d)
Rank descending. Top entry with bottleneck > 2× median is THE bottleneck this week.
```

Attribution before proposal: the analyst decomposes blocked time by cause — waiting on a gate
(founder latency → judgment_gap or autonomy recommendation, not a department fix), waiting on
budget (Treasury issue), waiting on upstream artifacts (upstream's latency_gap, not the blocked
department's), or internal (replicas/model/prompt → this department's gap). Fixing the wrong layer
is how meta-departments make companies worse; the decomposition is mandatory in the evidence.

---

## 8. CapabilityGap taxonomy & detection heuristics **MVP**

The eight kinds are in the schema (§2). Detection heuristics, each cheap enough to run in review:

| Kind | Heuristic | Evidence captured |
|---|---|---|
| `missing_capability` | `band.discover()` returned `[]` for a capability query; or an `Escalation(needs_capability)` was filed; or rung-3 escalations recur with "no department can…" | discover logs, escalation ids |
| `quality_gap` | Rubric dimension mean < 2.0 over 5+ artifacts, or reject rate > 30% sustained | verdict refs, trend line |
| `cost_gap` | MV(d) < 0.33 for 3 consecutive cycles with nonzero demand | spend queries |
| `latency_gap` | Bottleneck rank #1 for 2 consecutive weeks with internal attribution | §7 decomposition |
| `reliability_gap` | Retry rate > 20% or rung-1 escalations > 3/cycle for one worker role | escalation events |
| `knowledge_gap` | Same question answered by agents ≥3× with divergent answers; memory retrieval misses on repeated queries | memory stats, message samples |
| `integration_gap` | A recurring `HumanWorkRequisition` or founder task matches a tool in the D00 namespace registry (or a vendor in [`../03-integrations/00-sponsor-strategy.md`](../03-integrations/00-sponsor-strategy.md)) that no manifest uses | requisition history |
| `judgment_gap` | Founder redirected the same gate type ≥3× with semantically similar notes | gate records + notes |

Every gap needs ≥2 evidence entries (schema-enforced) and a `calc`-computed
`estimated_cost_of_gap_usd_per_cycle` — the number that ranks gaps and justifies proposals.
A gap can also close as `accepted_as_is`: some inefficiencies are cheaper than their fixes, and
recording that decision stops the gap from being re-detected every week.

---

## 9. Proposal types **MVP**

Seven-plus-one, matching `ProposalType`. Ordered by preference — smallest change that closes the gap:

| Type | Typical gap | Payload | Risk default |
|---|---|---|---|
| `prompt_improvement` | quality_gap, knowledge_gap | Prompt/rubric diff citing the Critic defect paths it fixes | safe |
| `scoring_model_change` | falsified treasurer predictions, health-score misses | Weight/threshold config diff with backtest | low |
| `new_dashboard` | founder asks the same question twice | Boardroom panel spec + projection query | safe |
| `pipeline_change` | latency_gap, reliability_gap | Routing rule / trigger / concurrency / SLA diff | low–material |
| `new_specialist_agent` | quality_gap concentrated in one worker's defect paths | `AgentSpec` addition to an existing manifest + prompt | low |
| `new_integration` | integration_gap | Tool adoption plan: driver, pricing entry (unpriced resources throw), allowlist, gate pairing | material (usually `account_creation` + `money_out`) |
| `new_feature` | ticket/signal patterns implicating the product | `ProductSignal(aggregated)` routed to **D06** — D13 never edits the ProductSpec itself; product changes go through Pivot's evidence process | n/a (handoff) |
| `new_department` | missing_capability with sustained cost ≥ 10× ongoing envelope | Complete manifest + prompts + schema + routing (§11) | material, always |

Risk classes decide the path: **safe** = self-executed after eval, logged, founder-visible;
**low** = self-executed after eval + canary, founder notified with one-tap revert;
**material** = founder gate before deploy, never auto at any autonomy level.

---

## 10. The safe change-management pipeline **MVP**

Every change, regardless of size, moves through the same stages. Small changes move fast through
the same gates, not around them.

```
 drafted ──► SHADOW ──► EVAL ──► STAGING ──► CANARY ──► deployed
                │          │         │           │           │
                └── fail ──┴── fail ─┴── fail ───┴─ degrade ─┴──► ROLLBACK (plan pre-written)
```

### Stage definitions

| Stage | What runs | Pass condition |
|---|---|---|
| **Shadow** | Candidate runs in a **forked Superserve sandbox** against replayed historical WorkOrders (D13's fork privilege: `forkable: true`). Outputs diffed against what actually shipped. No side effects possible: the fork's egress allowlist is empty and the tool plane is stubbed to record-only. | Candidate ≥ baseline on rubric score, ≤ 1.2× baseline cost, no schema violations, over ≥5 replayed orders |
| **Eval** | The fixed eval suite for the touched surface (§12). Deterministic where possible (schema checks, calc math, routing resolution); LLM-judged rubrics use pinned model + pinned prompts so scores compare across runs. | All gate metrics within bounds; no regression > 5% on any protected metric |
| **Staging** | Change applied to a staging venture — a synthetic venture seeded from anonymized historical events, running the full kernel. For prompts/agents: N full department cycles. For departments: the new department processes staged WorkOrders end-to-end. | Runs clean for the stated horizon; artifacts sign; budgets hold |
| **Canary** | Deployed to production at reduced blast radius: 1 of N worker replicas, or 10% of routed WorkOrders (routing rule carries a `canary_pct`), or one venture in a multi-venture install. Evaluator watches the metrics snapshot. | `expected_effect.metric` moving toward target; no protected metric degraded at horizon |
| **Rollback** | Mechanical: restore `previous_version_ref` (manifests and prompts are versioned; routing rules are append-only with supersedence), drain in-flight work to artifact boundaries, emit `cos.change_rolled_back`. **The rollback plan is written at draft time and validated in staging** — a rollback that has never been exercised is a hope, not a plan. | — |
```

### Pipeline invariants

1. **One material change in flight at a time.** Interacting changes are unattributable changes.
2. **Rollback plans are written before deploy and exercised in staging.** No exceptions.
3. **Every stage transition is an event** (`cos.change_staged`, …) with a metrics snapshot ref —
   the `ChangeRecord` is the audit trail.
4. **Protected metrics** (revenue events, ledger integrity, gate policy behavior, PII rules) can
   never be traded away by any proposal: a regression there fails the stage regardless of the
   target metric's improvement.
5. **D13 cannot modify its own manifest, prompts, or this pipeline** without a founder gate at
   `material` — the self-modifier's self-modification is always a human call.

---

## 11. Writing a new DepartmentManifest and handing it to D07 **MVP**

The full procedure, expanding [`D00-department-template.md`](D00-department-template.md) §8:

```
 1. Gap confirmed         missing_capability, cost ≥ 10× estimated ongoing envelope,
                          founder-visible in the weekly report at least once
 2. Design (cos.designer) Read D00 §3 + 2–3 nearest department specs as few-shot.
                          Write: manifest YAML (generated_by: 'D13') + prompts directory
                          + Zod artifact schema + routing rule additions.
 3. Validate              packages/contracts/src/manifest.ts parse. Tool names must exist in
                          the D00 namespace registry; outbound tools must pair with declared
                          gates; budget must be justified against pricing.ts. A validation
                          failure never leaves D13.
 4. Scaffold (→ D07)      WorkOrder to D07: create prompt files, register the schema in
                          packages/contracts, wire the routing rules. D07 builds; D13 never
                          commits code. D07's Critic reviews the scaffold like any artifact.
 5. Shadow                Forked sandbox; the department processes 5+ historical WorkOrders
                          that would have routed to it. Diff vs what the company actually did
                          (including "escalated to founder" — beating that is the bar).
 6. Eval                  New-department suite: schema conformance, budget adherence, gate
                          declarations honored, rubric floor on outputs, cost within envelope.
 7. Founder gate          'new_department' — NEVER auto, timeout 24h, on_timeout: hold.
                          The card carries the shadow-mode record: outputs, costs, diffs.
 8. Deploy + register     Kernel instantiates from the manifest; the department registers on
                          the Band mesh with capabilities generated from its io block; joins
                          hr↔all and cos↔all. Read-your-write discovery check (register →
                          discover → assert present, 5s) before cos.department_deployed emits.
 9. Canary                First N cycles at reduced routing share; D13 daily-reviews it like
                          any department, but with tighter thresholds (any contested artifact
                          → pause routing).
10. Adopt or retire       After the canary horizon: full routing share, or rollback (dereg
                          from mesh, routing rules superseded, sandbox released) + post-mortem.
```

This is the 3:30 demo beat end-to-end
([`../03-integrations/02-band.md`](../03-integrations/02-band.md)): D10 loses three deals to
security review, `band.discover('security_questionnaire_response')` returns `[]`, D13 designs
`D14-security-review`, shadow-tests it against the three lost deals, the founder taps approve, D14
registers on the mesh, and Sales discovers it on the next cycle without a redeploy.

---

## 12. Evaluation gates **MVP**

The eval suites the pipeline stages run. Suites live in `packages/evals/` and are versioned;
changing a suite is itself a `pipeline_change` proposal.

| Suite | Applies to | Checks |
|---|---|---|
| `evals/prompts/<dept>` | prompt_improvement | Golden-set WorkOrders → rubric score vs baseline (pinned judge model), output schema conformance, token cost delta, refusal/honesty behaviors preserved (e.g. D12's uncertainty policy still refuses the golden refusal cases) |
| `evals/scoring` | scoring_model_change | Backtest against history: would the new weights have allocated/scored better on realized outcomes? Requires ≥1 falsified-prediction case in the training window |
| `evals/routing` | pipeline_change | Every event type still resolves to ≥1 consumer; no cycles; no orphaned artifact types; simulated load respects concurrency |
| `evals/manifest` | new_specialist_agent, new_department | Schema parse, tool-gate pairing, budget arithmetic, prompt files exist and open with the standard four-line header |
| `evals/integration` | new_integration | Driver conforms to the tool-plane interface; pricing entry exists (unpriced → throw); idempotency keys on side effects; failure modes documented |
| `evals/protected` | **every** proposal | Ledger replay produces identical balances; gate policy table unchanged unless explicitly proposed; PII rules hold; `public_content`/`new_department` never-auto asserts still pass |

Pass thresholds are stated per suite in the suite file, not negotiated per proposal. An eval suite
that a proposal's `expected_effect.metric` cannot be measured by is a Critic reject — you cannot
target what you cannot measure.

---

## 13. Founder approval for material changes **MVP**

The autonomy decision table ([`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md))
already fixes the hard line: `new_department` is **NEVER auto at any autonomy level**, asserted in
`policy.test.ts`. D13 extends the same treatment to all `material` proposals via the
`material_change` gate:

| Change class | Approval path |
|---|---|
| safe (prompt fix, dashboard) | Self-executed post-eval; founder sees it in the daily digest; one-tap revert for 7 days |
| low (scoring weights, new worker, most pipeline changes) | Self-executed post-canary; founder notified at deploy with the eval results; one-tap revert |
| material (new integration with spend, SLA/gate changes, new department, anything touching D13 itself or protected metrics) | Founder gate BEFORE deploy. Card carries: gap evidence, diff summary, eval + shadow results, cost, `falsified_if`, and the rollback plan. Timeout: hold — the change waits, it never sneaks |

The founder's `redirect` option matters here: a redirect note on a material change becomes context
for a revised proposal, and three redirects on the same theme are themselves a `judgment_gap` —
the founder is telling the company something its scoring doesn't capture yet.

---

## 14. Gates & Escalations

**Gates opened:** `new_department` (never auto), `material_change` (never auto). Both `hold` on
timeout.

**Escalations raised:** `needs_approval` (material proposals), `needs_budget` (eval/staging runs
exceeding envelope), `anomaly` (a canary degrading a protected metric triggers rollback *and* an
informational escalation).

**Escalations received:** everything reaching rung 3 — D13 reroutes to a capable department,
files a `CapabilityGap`, or authorizes a Terac requisition directly for known-human tasks, per the
ladder spec.

---

## 15. Failure Modes & Fallbacks

| Failure | Detection | Fallback | Quality |
|---|---|---|---|
| Metric queries empty (young venture) | Analyst | Report absences honestly; reviews ship with `gaps[]`; no gap detection below evidence floors | partial |
| Shadow replay unrepresentative (too few historical orders) | < 5 replayable | Extend shadow horizon; a proposal is not promoted on thin evidence — it waits | drafted |
| Generated manifest fails validation | Step 3 | Designer retries once with the parse errors; then the gap stays open with the failure recorded | detected |
| Canary metrics ambiguous at horizon | Evaluator | Extend canary once; still ambiguous → rollback (the null hypothesis is "don't change") | rolled_back |
| Rollback itself fails | Staged rollback rehearsal failed or prod rollback errors | Kill-switch the affected department (park work orders), founder page — this is the one true emergency in D13's world | blocked |
| D13's own spend spikes (opus is expensive) | D11 anomaly detector watches D13 like anyone | Degrade to sonnet analysis per the 80% policy; reviews get shorter, not skipped | partial |
| Two departments claim the same gap fix territory | Head | The routing graph decides ownership; D13 proposes, affected Heads comment via the weekly report, founder breaks ties | drafted |

---

## 16. Definition of Done & Critic Rubric

**DoD (per review):** every metric has a query ref · every gap has ≥2 evidence entries + cost
estimate · every proposal has `falsified_if` + rollback plan · ≤1 material change in flight ·
prediction ledger updated · report fits one founder screen.

**Rubric** (0–3; pass ≥ 15/18, no zero — D13's bar is the highest in the company because its
artifacts change the company):

| Dimension | 3 looks like |
|---|---|
| Evidence | Gaps and metrics trace to queries and event ids; no vibes |
| Specificity | Proposals name the metric, the target, the horizon |
| Falsifiability | `falsified_if` on every proposal; predictions checked on schedule |
| Honesty | Rolled-back changes post-mortemed, not buried; `accepted_as_is` used |
| Change safety (dept-specific) | Pipeline stages complete, rollback exercised, protected metrics green |
| Minimality (dept-specific) | The smallest sufficient change was chosen; new_department cleared the 10× bar |

---

## 17. Demo Notes

| Time | On screen |
|---|---|
| ambient | `cos↔all` room shows D13 observing (read-only chip visible); daily review report in the Boardroom side panel |
| 3:20 | Weekly review flags the gap: 3 lost deals, `discover()` returned `[]` — the CapabilityGap card renders with evidence |
| 3:30 | The finale (with Band): manifest written → shadow diff view → founder's `new_department` card → approve → D14 sprite walks into a new room → Sales discovers it. "Nothing was redeployed." |
| 3:50 | The ChangeRecord timeline: drafted → shadow → gate → deployed, each with its metrics snapshot |

---

## 18. Cost Estimate

| Item | Est. |
|---|---|
| Head (opus, k=32 context) | $1.20 |
| Analyst ×2 (sonnet) | $0.40 |
| Designer (opus, on gap cycles only, amortized) | $0.35 |
| Evaluator + sandbox forks | $0.15 |
| Critic (opus) | $0.10 |
| **Total per cycle** | **≈ $2.20** (matches `default_envelope_usd` and the platform cost table) |

A new-department cycle spikes to ~$4 (designer + shadow forks); that is inside `hard_cap_usd` and
is itself an argument the proposal card shows the founder.

---

## Assumptions & open questions

1. **ASSUMPTION:** enough historical WorkOrders exist to shadow-test against by the time gaps
   appear. Early-venture gaps may need staged synthetic WorkOrders — labeled synthetic, never
   presented as replay evidence.
2. **ASSUMPTION:** Superserve fork semantics give a byte-identical sandbox with a stubbed tool
   plane. If forks share egress config with the parent, shadow needs its own image variant.
   VERIFY at the booth.
3. **Open:** the 10× bar for `new_department` and the 2× median bottleneck threshold are priors.
   D13 should propose tuning them — through its own pipeline, which is pleasingly recursive and
   founder-gated per invariant §10.5.
4. **Open:** pinned-judge eval drift — when the pinned model version is deprecated, historical
   scores stop being comparable. Mitigation: re-baseline the golden set on judge change; recorded
   as a `scoring_model_change`.
5. **Open:** cross-venture global memory writes create a privacy question (venture A's patterns
   informing venture B). MVP: only structural patterns (manifests, prompts, thresholds) go global;
   never customer or market data. Needs a real policy POST-MVP.
6. **Open:** who reviews D13's Critic? MVP answer: the founder, via the material gate and digest.
   POST-MVP: a periodic human audit of a random proposal sample — Terac makes this cheap
   (`expert_verification` by an ops operator).
7. **Open:** canary routing (`canary_pct`) needs kernel support in the routing engine; confirm it
   lands in the MVP build order ([`../04-execution/01-build-order.md`](../04-execution/01-build-order.md)).
8. **ASSUMPTION:** the staging venture (anonymized replayed events) is buildable in hackathon
   scope. Fallback: shadow + canary only, with tighter canary thresholds — recorded as a known
   pipeline weakening in every ChangeRecord that used it.
