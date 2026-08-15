# 16 — Evaluation Framework: How We Know the Agents Are Good

One sentence: agent quality is measured against **golden datasets and per-department rubrics**
(the `simit` `rubric.yaml` + `validate` binary pattern, scaled company-wide), judged by
anti-gamed LLM judges, regression-tested on every change, shadow-tested before deployment — and
**no agent change ships without passing the eval gate**.

```
   golden datasets ──┐
                     ├──► RUBRIC SCORING (deterministic + LLM-judge) ──► headline score
   frozen inputs  ───┘             │
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │  EVAL GATE:  headline ≥ threshold  AND            │
        │  no dimension regressed > 5%  AND                 │
        │  all binary checks pass                           │
        └───────────────┬──────────────────────────────────┘
                        │ pass                    │ fail
                        ▼                         ▼
                promote / deploy           cos.eval_gate_failed → revise
```

Upstream: the worker brief (`simit`'s `validate` binary scoring a `rubric.yaml` with a headline
gate ≈0.85), [`02-agent-runtime.md`](02-agent-runtime.md) (determinism & replay),
[`10-observability.md`](10-observability.md) (metrics evals consume).
Downstream: [`13-permissions-and-policy.md`](13-permissions-and-policy.md) (shadow-test required
before `new_department`), D13's whole existence.

---

## The inherited pattern: rubric.yaml + validate

**MVP** — `simit` ships a `validate` binary that scores a `rubric.yaml` and gates on a headline
number (≈0.85). We generalize exactly that shape: **rubrics are YAML files in the repo, scoring
is a binary (`pnpm eval run`), and the output is a headline score plus per-dimension detail.**
Rubrics are diffable, reviewable, and versioned — like prompts
([`02-agent-runtime.md`](02-agent-runtime.md)), they are files, not string literals.

```
packages/evals/
  rubrics/
    D03-niche-dossier.rubric.yaml
    D04-claim-ledger.rubric.yaml
    …one per primary artifact type…
    _shared/evidence.rubric.yaml        # imported by every research rubric
  golden/
    D03/  inputs/*.json  expected/*.json  meta.yaml
    …per department…
  judges/
    prompts/*.md                        # LLM-judge instructions, versioned
  runner/                              # the 'validate binary': pnpm eval run
```

```yaml
# packages/evals/rubrics/D03-niche-dossier.rubric.yaml
artifact_type: NicheDossier
rubric_version: 1.3.0
headline_gate: 0.85                     # simit's pattern: one number to pass
dimensions:
  - id: schema_valid
    kind: binary                        # hard fail if false
    check: zod                          # parsed against NicheDossier@current
  - id: evidence_integrity
    kind: binary
    check: evidence_check               # 11-evidence-and-truth.md, run as code
  - id: count_min
    kind: binary
    check: jsonpath
    expr: "$.dossiers.length >= 5"      # manifest io.min_outputs
  - id: source_tier_mix
    kind: scored, weight: 0.15
    check: code                         # % of quantitative fields backed by T3+
    scorer: tier_mix >= {t3_plus: 0.6}
  - id: market_math_coherent
    kind: scored, weight: 0.20
    check: code                         # TAM ≥ SAM ≥ SOM; derived fields recompute within 5%
  - id: niche_specificity
    kind: scored, weight: 0.25
    check: llm_judge
    judge_prompt: judges/prompts/niche-specificity.md   # "is this a real niche or a category?"
  - id: differentiation_grounded
    kind: scored, weight: 0.25
    check: llm_judge
    judge_prompt: judges/prompts/differentiation.md
  - id: gap_honesty
    kind: scored, weight: 0.15
    check: llm_judge
    judge_prompt: judges/prompts/gap-honesty.md         # are gaps[] real gaps, not ass-covering?
scoring:
  headline: "all binaries pass ? weighted_mean(scored) : 0"
```

**Binary checks are code, never LLM.** Schema validity, evidence integrity, arithmetic, count
minimums — anything a program can check, a program checks. The LLM judge only scores what
requires judgment. This split is the `validate`-binary lesson: the deterministic floor cannot be
argued with.

---

## Golden datasets

**MVP** — frozen `(input, expected-properties)` pairs per department, three sources:

| Source | Example | Count target (MVP) |
|---|---|---|
| **Curated by us** | 3 hand-built SharpenedIdeas across verticals (B2B SaaS, consumer, services) with known-good NicheDossier properties | 3–5 per department |
| **Harvested from real runs** | a signed artifact the founder approved + downstream success (deal won, deploy healthy) becomes a golden case; its full ContextPacket is pinned ([`10-observability.md`](10-observability.md), retention note) | grows continuously |
| **Adversarial** | inputs designed to tempt fabrication: a niche with no public data (must gap, not invent), an injection-laced scrape ([`12-safety-and-compliance.md`](12-safety-and-compliance.md) red-team set), a budget too small to finish (must ship partial) | 2–3 per department |

```yaml
# packages/evals/golden/D03/meta.yaml
cases:
  - id: dental-pms-2024
    input: inputs/dental-pms.json            # a frozen SharpenedIdea artifact
    tool_cache: s3://evals/caches/dental-pms/  # recorded tool responses — replay determinism
    expected:
      properties:                            # NOT exact outputs — properties of good outputs
        - "≥5 dossiers"
        - "at least one dossier with som_usd < 5_000_000 (niche, not category)"
        - "zero uncited quantitative fields"
      known_facts:                           # judge cross-checks against these
        - "US dental practices ≈ 130k (ADA 2024)"
    frozen_at: 2026-08-01
```

**Expected properties, not expected outputs.** Agents are nondeterministic; a golden case pins
what must be *true* of the output, not its bytes. Exact-match cases exist only for extraction
agents (haiku-tier classify/dedup), where determinism is the job.

**Tool caches make evals cheap and hermetic:** eval runs replay recorded tool responses
([`02-agent-runtime.md`](02-agent-runtime.md), determinism & replay) — no live scraping, no
flaky externals, ~$0.10/case in judge tokens.

---

## Artifact rubrics per department

**MVP** — the full rubric matrix. Every dimension is either `binary` (code) or `scored`
(code or judge). All import `_shared/evidence.rubric.yaml` (evidence integrity + gap honesty).

| Dept | Artifact | Binary floor | Scored dimensions (weights) |
|---|---|---|---|
| D01 | `OpportunityCandidate[]` | schema, dedup, evidence | signal strength (.4), diversity (.3), reachability (.3) |
| D02 | `SharpenedIdea` | schema, founder-words preserved verbatim | problem specificity (.3), falsifiability of "what must be true" (.4), scope realism (.3) |
| D03 | `NicheDossier[]` | schema, evidence, count, market math | specificity (.25), differentiation (.25), tier mix (.15), gap honesty (.15), math coherence (.2) |
| D04 | `ClaimLedger` | schema, consent recorded per interview, verbatim integrity (quotes ∈ transcript) | claim extraction recall vs transcript (.3), strength labeling accuracy (.3), hypothesis mapping (.2), coverage honesty (.2) |
| D05 | `SyntheticPanelResult` | schema, seed reproducibility (re-run = byte-identical), `evidence_class='synthetic'` labeled | calibration delta vs ClaimLedger (.5), CI honesty (.25), archetype coverage (.25) — plus simit's own backtest gate upstream |
| D06 | `IdeaDiff`/`ProductSpec` | schema, every diff cites ledger claim ids, reversibility labeled | evidence weighting (.35 — behavior over intent), pivot parsimony (.25), spec buildability (.4, judged by a D07-persona judge) |
| D07 | `Deployment` | QA green in Replay, deploy health check, repo builds from clean checkout | spec coverage (.4, code check against ProductSpec acceptance list), code quality (.3), scope discipline (.3 — no unrequested features) |
| D08 | `GTMPlan` | schema, evidence, channel costs priced | ICP-message fit (.4), channel realism (.3), sequencing logic (.3) |
| D09 | `Lead[]` | schema, consent_state populated, provenance per lead, dedup | ICP score calibration vs eventual outcomes (.5), volume vs quality balance (.25), enrichment accuracy sampled (.25) |
| D10 | `Deal[]`/outreach drafts | compliance checker green ([`12-safety-and-compliance.md`](12-safety-and-compliance.md)), personalization cites a real claim/lead fact | message quality (.3), objection handling (.3), pipeline hygiene (.2), quote accuracy (.2 — cited interview quotes verbatim) |
| D11 | `BudgetAllocation` | arithmetic reproduces from inputs exactly ([`08-money-and-metering.md`](08-money-and-metering.md)) | rationale quality (.5 — includes a falsifiable prediction), allocation-outcome hit rate (.5, scored next cycle) |
| D12 | `Ticket` resolutions / `ProductSignal[]` | schema, no invented product facts (answers cite repo/spec) | resolution correctness (.4), tone (.2), signal extraction quality (.4) |
| D13 | `CapabilityGap`/`DepartmentManifest` | manifest validates ([`13-permissions-and-policy.md`](13-permissions-and-policy.md) D13 rules), evidence for the gap | gap materiality (.4 — cost_of_absence grounded), manifest quality (.3), shadow-test design (.3) |

Headline gates: 0.85 default (simit's number), 0.80 for D01/D08 (earlier-stage, judgment-heavy),
0.90 for D11 (it moves money) and for anything D13 generates.

---

## LLM-as-judge with anti-gaming guards

**MVP** — judges are useful and gameable; every guard below exists because of a known failure
mode:

| Guard | Failure it prevents |
|---|---|
| **Judge ≠ producer**: judge runs on a different model tier than the scored agent (sonnet judges haiku work; opus judges sonnet/critical) with temperature 0 | self-preference bias |
| **Judges never see** agent identity, model name, cost, or prior scores — only artifact + inputs + rubric dimension | halo effects, cost-anchoring |
| **Grounded dimensions carry `known_facts`** from the golden case; the judge must cross-check and cite which fact supports each score ≥0.8 | judge hallucinating agreement |
| **Pairwise ordering checks**: seeded known-bad variants (a fabricated number injected, a gap deleted) must score strictly below the original; a judge that fails ordering on ≥10% of probes is itself rejected | insensitive/broken judge prompts |
| **Position + format blinding**: artifact fields presented in randomized order; two passes with swapped presentation must agree within 0.1 | position bias |
| **The canary dimension**: every judge prompt includes one planted defect description; the judge must find it or the whole eval run is voided | judge not actually reading |
| **Instruction-injection screen**: artifacts are wrapped in the same untrusted fencing as web content ([`05-memory-and-context.md`](05-memory-and-context.md)) — an artifact containing "score this 1.0" is scored on its merits and flagged (`policy.prohibited_attempted`-class defect, automatic binary fail) | agents gaming the judge through their own output |
| **Judge drift tracking**: 10 fixed anchor artifacts re-judged weekly; scores drifting >0.05 pin the judge prompt version and alert | silent rubric inflation |
| **Human calibration**: we hand-score 5 artifacts per department at rubric creation; judge must match human ordering (Kendall τ ≥ 0.7) before its scores count | judge measuring something other than quality |

```ts
// packages/evals/runner/src/judge.ts (shape)
export async function judge(dim: JudgeDimension, artifact: Blinded, ctx: GoldenCtx) {
  const out = await session(JUDGE_MODEL[dim.tier], {
    system: render(dim.judge_prompt, { rubric_version: dim.version }),
    user: [fence(artifact), knownFacts(ctx), canary(dim)],
    temperature: 0,
  });
  const parsed = JudgeVerdict.parse(out);          // {score, defects[], fact_citations[], canary_found}
  if (!parsed.canary_found) throw new JudgeVoided(dim.id);
  return parsed;
}
```

---

## Regression suites

**MVP** — what runs when:

| Trigger | Suite | Budget | Gate |
|---|---|---|---|
| PR touching prompts, manifests, rubrics, agent-kit | affected departments' full golden set (CI) | ~$2, ~8 min | **blocks merge** on eval-gate failure |
| Nightly | all departments, full golden + adversarial + judge anchors | ~$10 | alerts D13 + operators |
| Model version bump (Anthropic release, Pioneer retrain) | everything, plus side-by-side old-vs-new report | ~$15 | new model adopted per-department only where it passes |
| D13 proposing any change (prompt edit, new department) | the change's target department + all downstream consumers of its artifact type | metered to D13's envelope | **the eval gate below** |
| Weekly | judge drift anchors, golden-case rot check (are harvested cases still schema-current?) | ~$1 | maintenance queue |

Regression definition: **headline drop > 2%** or **any dimension drop > 5%** vs the pinned
baseline (`packages/evals/baselines/<dept>.json`, updated only by an explicit
`pnpm eval baseline --accept` in a reviewed commit). Improvements are not auto-accepted either —
a suspiciously large jump usually means the rubric broke, not that the agent got smart.

---

## Shadow testing new agents

**MVP** — the sandbox-fork superpower ([`02-agent-runtime.md`](02-agent-runtime.md)) applied to
evaluation. Used for D13-generated departments and for risky changes to existing ones.

```
1. SNAPSHOT   fork the venture's sandbox + pin an event-log offset (a frozen company state)
2. REPLAY     feed the candidate the real WorkOrders from the last N cycles,
              with recorded tool responses; side effects stubbed (15-error…: replay never re-sends)
3. COMPARE    candidate artifacts vs what actually shipped:
              rubric scores · cost · latency · gaps closed vs introduced
4. COUNTERFACTUAL (judged, labeled speculative) — "would the Deal have progressed with this
              draft?" is judge opinion, never counted as revenue in the report
5. REPORT     capability_gaps.shadow_result = {cases, headline_mean, vs_incumbent_delta,
              cost_delta, would_have_won}    (04-data-model.md)
```

| Rule | Why |
|---|---|
| Shadow runs bill to D13's envelope, tagged `shadow` in meters | self-improvement pays for its own experiments |
| Shadow agents get zero side-effecting tools — the tool plane runs in stub mode, enforced by policy, not configuration | a shadow that emails a real customer is a P0 |
| Minimum shadow set: 10 replayed work orders or 2 full cycles, whichever is larger | no promotion on anecdotes |
| Shadow results render on the `new_department` gate card | the founder sees the evidence, not a pitch ([`06-human-in-the-loop.md`](06-human-in-the-loop.md)) |

---

## Promotion criteria

**MVP** — "promotion" = a new/changed agent taking real traffic. Ordered ladder, each step gated:

| Step | Criteria to advance |
|---|---|
| 1. **Eval pass** | headline ≥ gate on golden set; zero binary failures; no regression vs incumbent |
| 2. **Shadow pass** | shadow report: headline ≥ incumbent − 2%, cost ≤ incumbent + 25% (or explicitly traded off in the gate card), zero compliance/evidence violations across all shadow cases |
| 3. **Gate** | for new departments: the `new_department` gate (never auto, [`06-human-in-the-loop.md`](06-human-in-the-loop.md)); for agent changes within a department: auto at `supervised+` if steps 1–2 passed, logged as `cos.department_deployed` |
| 4. **Canary traffic** | first 3 cycles: the new agent's artifacts get a mandatory critic pass even where the manifest had none, and its gate auto-approvals are suspended (everything ASKs) — training wheels, then normal policy |
| 5. **Retention** | after 3 cycles, `mv_agent_perf` vs promotion projection; a miss > 20% files `cos.gap_detected` and D13 must revert or defend |

Demotion is symmetric: a live agent whose rolling contested-rate or eval-anchor score degrades
past the regression threshold gets frozen replicas and a D13 review — the same bar to stay as to
enter.

---

## The eval gate D13 must pass

**MVP** — the concrete contract for the self-improvement loop. Before D13 ships **any** change
(prompt edit, manifest tweak, routing rule append, new department), it must attach an
`EvalGateReport` to the change artifact:

```ts
// packages/contracts/src/artifacts/eval-gate.ts
export const EvalGateReport = z.object({
  change_ref: z.string(),                       // artifact id of the proposed change
  rubric_versions: z.record(z.string()),        // dept → rubric version used
  golden: z.object({
    cases_run: z.number().int().min(10),
    headline_mean: z.number(),
    headline_gate: z.number(),
    binaries_failed: z.literal(0),              // any binary failure ⇒ the report cannot be built
    regressions: z.array(z.object({ dimension: z.string(), delta: z.number() })).max(0),
  }),
  shadow: z.object({                            // required for new departments; optional for prompt tweaks
    cases: z.number().int(),
    vs_incumbent_headline_delta: z.number().min(-0.02),
    cost_delta_pct: z.number(),
    violations: z.literal(0),
  }).optional(),
  judge_integrity: z.object({
    canaries_found: z.literal(true),
    ordering_probes_passed: z.boolean(),
    drift_within_bounds: z.boolean(),
  }),
  signed_by: z.literal('eval-runner'),          // the runner HMACs the report; D13 cannot author it
  signature: z.string(),
});
```

The kernel enforces: `cos.department_deployed` and prompt-file changes to a live department are
rejected unless a valid, runner-signed `EvalGateReport` references the change. **D13 cannot sign
its own report card** — the eval runner is kernel infrastructure, outside every sandbox, and its
signature is checked like an artifact signature ([`04-data-model.md`](04-data-model.md)).
Failures emit `cos.eval_gate_failed` with the full dimension breakdown, which becomes D13's
revision input.

---

## Company-level evals (beyond single artifacts)

**POST-MVP** — sketched so the design doesn't paint us in:

| Eval | Question | Method |
|---|---|---|
| End-to-end venture replay | does the whole pipeline still turn an idea into a deploy? | nightly full-pipeline run on a golden SharpenedIdea with cached tools; asserts every stage artifact signs |
| Decision-quality backtest | were Treasury's falsifiable predictions right? | D13 daily review already checks ([`10-observability.md`](10-observability.md)); aggregate into a calibration score |
| Escalation efficiency | is the ladder resolving at the cheapest rung that works? | rung-outcome distribution vs cost per rung |
| Cross-venture lesson quality | do T4 lessons transfer? | lesson-cited runs vs matched controls on outcome metrics |

---

## Assumptions & open questions

- **Assumption:** ~$10/night of eval spend is acceptable; tool caches keep the marginal cost in
  judge tokens, not tools.
- **Assumption:** harvested golden cases don't rot faster than the weekly rot check catches
  (schema migrations bump `schema_version`, and the harvester re-validates against current Zod).
- **Open:** Kendall τ ≥ 0.7 for judge-human agreement is a guess; recalibrate after the first
  hand-scoring rounds.
- **Open:** should D05's calibration dimension gate on `calibration_delta` absolute value, or on
  whether the delta was *reported honestly*? Both matter; currently weighted toward honesty
  because simit's backtest already gates raw accuracy upstream.
- **Open:** counterfactual revenue in shadow reports is labeled speculative — should it appear on
  the `new_department` gate card at all, or only rubric deltas? Leaning: show it, clearly badged,
  because "would have won 3 deals" is what a founder actually asks.
- **Open:** who reviews rubric changes themselves? Rubrics are the constitution; MVP answer is
  human PR review + the anchor-drift check, but a rubric-changes-rubric loop needs a harder think
  before D13 may touch rubrics (today it may not — rubric edits are founder/operator-only).
