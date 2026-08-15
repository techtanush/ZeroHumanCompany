# D05 — Synthetic Population (simit port)

Follows [`D00-department-template.md`](D00-department-template.md). The validation tripod's
third leg, alongside [`D03-market-research.md`](D03-market-research.md) (documents) and
[`D04-outreach-validation.md`](D04-outreach-validation.md) (real humans).

**Provenance:** this department is a port of the `simit` repo
(github.com/Mahin2076/simit) — a Rust/axum/SQLite digital twin of San Francisco built from
real ACS PUMS person microdata. What we keep and what we change:

| simit | Zeroth `services/simpop` |
|---|---|
| SF's 8 PUMAs, hardcoded city profiles | Region selected from the `NicheDossier.slice.geography` |
| Ballot questions, election framing, turnout model | Business questions: WTP, message A/B, ICP sizing; turnout model dropped |
| `validate` binary + `rubric.yaml`, headline gate | Same rubric machinery, run at boot as a health gate |
| Frontend map + tiles + chatter | Dropped. API-only service consumed by the orchestrator |
| Religion layering, value vectors, lifestyle prose | Kept verbatim — persona richness drives answer quality |
| HydraDB evidence recall, news injection | Dropped for MVP (evidence comes from D03's cited corpus) |

What never changes in the port: **PWGTP weights on every agent, post-stratified estimation,
archetype clustering, seeded determinism, and the SQLite prompt cache.** Those five things
*are* the product. Everything else is skin.

---

## 1. Mission

Give the venture a statistically-grounded synthetic panel that answers business questions in
minutes for cents — clearly labeled as a model estimate, never as proof.

> **The single question this department answers:** *what would a demographically-accurate
> population of this region probably say — and how far off has that estimate been when we
> checked it against real people?*

The invariant this department exists to protect (Worker Brief #7): **synthetic ≠ proof.**
Every artifact carries `evidence_class: 'synthetic'` and the honesty note. A synthetic
result can *prioritize* which real interviews to run and *pressure-test* messaging cheaply.
It can never confirm demand on its own.

---

## 2. Contract — Inputs & Outputs

### Inputs

`SharpenedIdea` (WMBTs assigned `tested_by: 'D05'`) + the selected `NicheDossier` (region +
ICP slice) + optionally D04's calibration tuples (real interview shares for overlapping
questions).

### Output

`SyntheticPanelResult` — schema owned by
[`../01-platform/04-data-model.md`](../01-platform/04-data-model.md)
(`packages/contracts/src/artifacts/validation.ts`). Restated verbatim; the data-model file
wins on divergence:

```ts
export const SyntheticPanelResult = ArtifactBase.extend({
  artifact_type: z.literal('SyntheticPanelResult'),
  region: z.string(),                        // 'CA-PUMA-07507'
  pums_vintage: z.string(),                  // 'ACS 2022 5-year'
  seed: z.number().int(),                    // deterministic; simit inheritance
  archetypes: z.array(z.object({
    cluster_index: z.number().int(), label: z.string(),
    attributes: z.record(z.union([z.string(), z.number()])),
    population_weight: z.number(),           // Σ PWGTP
  })).min(4),
  questions: z.array(z.object({
    question: z.string(),
    estimate: z.number().min(0).max(1),
    ci: z.tuple([z.number(), z.number()]),
    per_archetype: z.array(z.object({
      cluster_index: z.number().int(), response: z.union([z.string(), z.number()]),
      weight: z.number(),
    })),
  })),
  calibration: z.object({
    against_interviews: z.number().int(),
    delta: z.number(),                       // reported, never silently applied
    method: z.string(),
  }).optional(),
  honesty_note: z.literal('Model-based estimate from Census PUMS microdata, not a survey of real respondents.'),
});
```

Rows also land in the `archetypes` and `panel_results` projection tables (same file) for
the Boardroom's panel view.

### The `simpop.*` tool contract (what other departments call)

```ts
// packages/contracts/src/tools/simpop.ts — the orchestrator-side client contract
import { z } from 'zod';

export const BuildPanelRequest = z.object({
  venture_id: z.string().uuid(),
  region: z.object({
    state: z.string().length(2),            // 'CA'
    pumas: z.array(z.number().int()).min(1),// [7507..7514]; resolved from geography by the Head
  }),
  n_agents: z.number().int().min(500).max(20000).default(2000),
  seed: z.number().int().default(42),
  icp_filter: z.object({                    // optional sub-population lens (see §6.4)
    min_age: z.number().int().optional(),
    max_age: z.number().int().optional(),
    employed_only: z.boolean().default(false),
    occp_ranges: z.array(z.tuple([z.number(), z.number()])).default([]),
    min_income_quintile: z.number().int().min(0).max(4).optional(),
  }).optional(),
});
export const BuildPanelResponse = z.object({
  panel_id: z.string().uuid(),
  n_agents: z.number().int(),
  total_weight: z.number(),                 // Σ PWGTP — the population this panel represents
  n_archetypes: z.number().int(),
  icp_subpopulation_weight: z.number().optional(),  // Σ PWGTP of agents passing icp_filter
  demographics: z.record(z.record(z.number())),     // marginals: age/race/educ/income/tenure
});

export const PollRequest = z.object({
  panel_id: z.string().uuid(),
  questions: z.array(z.object({
    question_id: z.string(),                // 'WTP-1' — links back to a WMBT
    framing: z.enum(['binary','options','wtp_ladder','ab_test']),
    question: z.string(),                   // neutral wording; see §6.5 rules
    description: z.string(),                // neutral factual context, no outcome leakage
    options: z.array(z.string()).default([]),        // options/ab_test framings
    price_ladder_usd: z.array(z.number()).default([]),// wtp_ladder framing
    variant_a: z.string().optional(),                 // ab_test framing
    variant_b: z.string().optional(),
    population: z.enum(['all','icp_filter']).default('all'),
  })).min(1).max(10),
  model: z.string().default('claude-sonnet-4-6'),
});
export const PollResponse = z.object({
  results: z.array(z.object({
    question_id: z.string(),
    estimate: z.number(),                   // p_yes | top-option share | share at anchor price
    ci: z.tuple([z.number(), z.number()]),  // weighted bootstrap, alpha=0.05
    p_distribution: z.array(z.tuple([z.string(), z.number()])).default([]),
    wtp_curve: z.array(z.object({           // wtp_ladder only: demand at each price
      price_usd: z.number(), share_would_pay: z.number(),
    })).default([]),
    n_agents: z.number().int(),
    n_eff: z.number(),                      // Kish effective sample size
    design_effect: z.number(),
    n_archetypes: z.number().int(),
    n_llm_calls: z.number().int(),
    archetype_coverage: z.number(),         // answered/total; <0.20 ⇒ the call errors instead
    breakdowns: z.record(z.array(z.object({
      key: z.string(), share: z.number(), weight: z.number(), n: z.number().int(),
    }))),
    sample_rationales: z.array(z.string()).max(8),
  })),
  usage: z.object({
    llm_calls: z.number().int(), cache_hits: z.number().int(),
    input_tokens: z.number().int(), output_tokens: z.number().int(), cost_usd: z.number(),
  }),
});

export const CalibrateRequest = z.object({
  panel_id: z.string().uuid(),
  pairs: z.array(z.object({
    question_id: z.string(),
    synthetic_estimate: z.number(),
    real_share: z.number(),                 // from D04's ClaimLedger
    n_real: z.number().int(),               // interview count behind the real share
  })).min(1),
});
export const CalibrateResponse = z.object({
  per_question: z.array(z.object({
    question_id: z.string(), delta: z.number(),      // synthetic − real
    within_ci: z.boolean(),
  })),
  mean_abs_delta: z.number(),
  n_real_total: z.number().int(),
  method: z.literal('paired-share-comparison; deltas reported, never applied as correction'),
  verdict: z.enum(['aligned','divergent','insufficient_real_data']),
  // aligned: mean_abs_delta <= 0.10 and >= 3 pairs with n_real >= 5 each
  // divergent: mean_abs_delta > 0.10 — synthetic results for this venture get confidence *= 0.5
});
```

**Downstream:** `SyntheticPanelResult` → [`D06`](D06-pivot-decision.md) (weighted below
real evidence in the merge); WTP curves → D03's pricing hypothesis check; A/B results →
[`D08-strategy.md`](D08-strategy.md) message testing.

---

## 3. `DepartmentManifest`

D05 is thin by design: the heavy lifting is the Rust service; the department wraps it with
question design and honest reporting.

```yaml
# packages/manifests/D05-synthetic-population.yaml
id: D05
name: Synthetic Population
cluster: validation
version: 1
generated_by: human
resident: false

head:
  agent_id: simpop.head
  model: sonnet                        # orchestration + question design; math lives in Rust
  system_prompt_ref: prompts/D05/head.md
  tools: [memory.read, memory.write, artifact.read, artifact.sign, bus.emit,
          simpop.build_panel, simpop.poll, simpop.calibrate]
  max_tokens_per_run: 80000
  temperature: 0.2
  timeout_s: 300

critic:
  agent_id: simpop.critic
  model: sonnet
  system_prompt_ref: prompts/D05/critic.md
  rubric_ref: prompts/D05/critic-rubric.md
  tools: [memory.read, artifact.read]
  max_tokens_per_run: 30000
  temperature: 0.0

workers:
  - agent_id: simpop.question-designer
    model: opus                        # neutral wording is hard; leading wording poisons the panel
    replicas: 1
    system_prompt_ref: prompts/D05/question-designer.md
    tools: [artifact.read, memory.read]
    max_tokens_per_run: 40000
    temperature: 0.3
    output_schema: PollRequest

concurrency: 3

budget:
  default_envelope_usd: 1.50           # the panel itself costs cents; this is mostly the designer
  hard_cap_usd: 3.00
  degrade_at_pct: 0.8
  on_exhausted: partial

io:
  input: [SharpenedIdea, NicheDossier]
  output: [SyntheticPanelResult]
  min_outputs: 1
  emits_work_orders_to: []

gates: []                              # no real humans, no money out, nothing public — no gates

sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 1024
  egress_allowlist: [api.anthropic.com, simpop.internal]   # the Rust service; LLM calls happen inside it
  pause_between_cycles: true
  forkable: false

sla:
  soft_deadline_s: 240
  hard_deadline_s: 480
  on_timeout: return_partial

memory:
  reads: [venture, department]
  writes: [department]

triggers:
  - kind: event
    expr: artifact.signed(type=SharpenedIdea)
  - kind: event
    expr: artifact.signed(type=ClaimLedger)   # re-wake for calibration once real data lands
```

---

## 4. Agent Roster

| Agent | Role | Model | Replicas | Tools | Tokens/run | Est. cost |
|---|---|---|---|---|---|---|
| `simpop.head` | Region resolution, panel build, poll dispatch, calibration, honest reporting, sign | `sonnet` | 1 | simpop.*, memory, artifact, bus | 80k | $0.24 |
| `simpop.question-designer` | WMBTs → neutral, leakage-free poll questions | `opus` | 1 | artifact.read, memory | 40k | $0.28 |
| `simpop.critic` | Neutrality audit, labeling audit, coverage audit | `sonnet` | 1 | memory, artifact | 30k | $0.09 |
| — `services/simpop` (Rust) | The engine: sampling, clustering, batched polling, aggregation | n/a (calls sonnet internally) | 1 service | — | ~40 batched calls/poll | ~$0.30/poll set |

The department has the smallest roster in the company because the intelligence is in the
service. The one `opus` seat is question design: simit's accuracy came from neutral ballot
descriptions, and a leading business question destroys the estimate exactly the same way.

---

## 5. System Prompts

### 5.1 `prompts/D05/head.md`

```
You are the Head of Synthetic Population at Zeroth, an AI-run agency building a company for a human founder.
You do not do the work yourself. You decompose, dispatch, merge, and sign.
You may not fabricate. A gap is an acceptable output; an invented number is a P0 defect.
You report cost honestly, including your own.

You operate a statistical instrument, not an oracle. Your service samples real Census PUMS
microdata, so its estimates are demographically grounded — and still model-based. Your one
unbreakable law: EVERY number you emit is labeled synthetic. If an artifact you sign could
be mistaken for a survey of real people, you have failed regardless of its accuracy.

=== RUN SEQUENCE ===
1. REGION. Resolve NicheDossier.slice.geography to state + PUMA list. If the geography is
   national or fuzzy, pick the venture's primary metro and record the narrowing in
   assumptions[]. No PUMS coverage for the region (non-US) ⇒ escalate needs_capability;
   never substitute a 'similar' region silently.
2. BUILD. simpop.build_panel with n_agents=2000, seed=42 (both recorded). If the ICP is a
   subset of the general population (it almost always is), pass icp_filter and check
   icp_subpopulation_weight: if the ICP slice is under 3% of panel weight, say so loudly —
   estimates for thin slices have wide CIs and you must report n_eff for the SLICE, not
   the panel.
3. QUESTIONS. Dispatch the question-designer with the D05-assigned WMBTs. You review each
   question against the neutrality rules (§ its prompt). Max 10 questions per run; each
   maps to a WMBT or a NicheDossier field (price_point → wtp_ladder).
4. POLL. simpop.poll. Inspect archetype_coverage and n_eff on every result. Coverage
   below 0.5 on any question: re-run that question once; still low ⇒ report as degraded.
5. CALIBRATE (when D04's ClaimLedger exists). simpop.calibrate with the aligned pairs.
   Report deltas verbatim in calibration{}. NEVER adjust an estimate by the delta — the
   delta is information about trust, not a correction factor. verdict='divergent' ⇒ write
   confidence *= 0.5 into your artifact summary and tell D06 explicitly.
6. SIGN. Assemble SyntheticPanelResult. honesty_note is a literal; the schema enforces it.
   Every assumptions[] entry marks synthetic provenance. evidence_class: 'synthetic' on
   every derived claim.

=== INTERPRETATION RULES (write these into the artifact summary) ===
- An estimate is a WEIGHTED MODEL OPINION of a demographic mirror, not a forecast of
  customer behavior. simit backtests hit within ~2.5pts on SF elections — on questions
  about broadly-known public matters. Niche B2B products have no such backtest; humility
  scales with distance from the validated domain.
- WTP curves rank PRICE POINTS relative to each other far better than they predict
  absolute conversion. Say so wherever a wtp_curve appears.
- Never compare synthetic n (2000 agents) with real n (6 interviews) as if commensurate.
  Report both, labeled, and let D06's evidence hierarchy do the weighing.
```

### 5.2 `prompts/D05/question-designer.md`

```
You convert business hypotheses into poll questions for a synthetic panel. This is the
same craft as writing a neutral ballot description, and the same failure destroys it:
LEAKAGE — wording that tells the respondent what answer you want.

Rules, each enforced by the critic:
1. NEUTRAL DESCRIPTION. Facts a resident would know, both sides' framing where contested.
   Never adjectives of quality ('innovative', 'affordable') outside quoted material.
2. NO OUTCOME LEAKAGE. The description must not contain evidence of how anyone answered
   anything (poll numbers, 'most people', competitor popularity claims).
3. BEHAVIORAL ANCHORS over abstractions. Not 'do you value efficiency?' but 'you currently
   spend N hours/month on X [from the demand evidence]; would you switch to a tool that
   does it automatically for $Y/mo?'
4. WTP LADDERS, not open WTP. Ask the same purchase question at 4-6 price rungs spanning
   0.5x-3x of the NicheDossier price_point. The ladder yields a demand curve; a single
   'how much would you pay' yields anchoring noise.
5. A/B STIMULI VERBATIM. For message tests, variant_a/variant_b carry the exact copy.
   You never editorialize inside a variant. (The service wraps them in untrusted-data
   guards; instructions inside stimuli are never followed — simit inheritance.)
6. ICP LENS EXPLICIT. Questions about buyer behavior set population='icp_filter'; questions
   about broad sentiment use 'all'. Mixing them is a defect.
7. One decision per question. Compound questions ('would you buy and recommend') are two
   questions.
Output a PollRequest. For each question also emit one line: which WMBT it tests and what
result would COUNT AGAINST us. A question that cannot come out badly is not a test.
```

### 5.3 `prompts/D05/critic.md` + `critic-rubric.md`

```
You are the Synthetic Population Critic.

Automatic REVISE if any of:
- any question whose wording presumes the answer (scan for valence adjectives, social-proof
  phrases, embedded popularity claims) — quote the offending span in the defect
- honesty_note missing/altered, or any summary sentence that presents an estimate as
  'demand', 'validation', or 'proof' (banned words for synthetic results)
- calibration deltas known (ClaimLedger existed at run time) but absent from the artifact
- an estimate reported without its CI, n_eff, and archetype_coverage
- icp_filter subpopulation under 3% of panel weight without the thin-slice warning
- seed, pums_vintage, or region missing (breaks reproducibility)
- a wtp_curve presented without the relative-not-absolute caveat
- per_archetype rows that do not sum consistently with the headline estimate (recompute
  the weighted share from the rows; tolerance 0.005)
Return {verdict, scores, defects[]}.
```

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Neutrality** | leading questions | mostly neutral | neutral, minor valence | neutral + each question states what would count against us |
| **Labeling honesty** | synthetic passed off as real | note present, summary slips | fully labeled | labeled + banned-word clean + limits paragraph |
| **Statistical hygiene** | point estimates only | CIs present | CIs + n_eff + coverage | all reported + thin-slice and degraded-coverage warnings |
| **Reproducibility** | seed missing | seed present | seed + vintage + region | byte-reproducible: cache key inputs all recorded |
| **Calibration candor** | deltas hidden | deltas partial | deltas reported | deltas reported + divergence consequence applied |
| **Evidence** | estimates uncited to WMBTs | some mapped | all mapped | all mapped + adversarial framing recorded |

**Pass threshold: ≥ 13/18, with `Labeling honesty` = 3.** No partial credit on labeling —
mislabeled synthetic evidence is the specific lie this department was designed never to tell.

---

## 6. Execution Flow

```
artifact.signed(SharpenedIdea) ─┐
gate.decided(niche_selection) ──┤
                                ▼
                        ┌──────────────┐
                        │ simpop.head  │ resolve geography → {state, pumas[]}
                        └──────┬───────┘
                               ▼
                POST /panels  (services/simpop, Rust)
                PUMS load → sample n=2000 w/ PWGTP → personas → archetypes
                               ▼
                question-designer: WMBTs → PollRequest (≤10 questions, neutral)
                               ▼   head reviews wording
                POST /panels/:id/poll
                ┌─────────────────────────────────────────────┐
                │ cluster → ~12-160 archetypes → batches of 12│
                │ one LLM call per batch (SQLite cache first) │
                │ per-archetype p → post-stratify w/ PWGTP    │
                │ weighted bootstrap CI · breakdowns · n_eff  │
                └──────────────────┬──────────────────────────┘
                               ▼
                [ClaimLedger exists?] ──yes──► POST /panels/:id/calibrate
                               │                 deltas reported, never applied
                               ▼
                simpop.critic (≤1 revision loop)
                               ▼
                SIGN SyntheticPanelResult ── honesty_note enforced by schema
                               │
                 ┌─────────────┼───────────────┐
                 ▼             ▼               ▼
            D06 (merge,   D03 (price      D08 (message
            weighted below curve check)    A/B results)
            real evidence)
```

### 6.1 PUMS ingestion **MVP**

Ported from `sim-core/src/pums.rs` unchanged in substance. An `ingest-pums` job (run at
image build, not at request time) filters the ACS person flat file to the configured
PUMAs and writes a committed subset so the service is self-contained offline:

```sql
-- services/simpop/migrations/0001_pums.sql
CREATE TABLE pums_records (
  serialno TEXT NOT NULL, sporder INTEGER NOT NULL,
  pwgtp REAL NOT NULL CHECK (pwgtp > 0),      -- the person weight; rows without it are dropped
  agep INTEGER NOT NULL, sex INTEGER NOT NULL,
  rac1p INTEGER NOT NULL, hisp INTEGER NOT NULL,
  schl INTEGER NOT NULL, pincp REAL NOT NULL, povpip REAL NOT NULL,
  occp INTEGER NOT NULL, cow INTEGER NOT NULL, esr INTEGER NOT NULL,
  cit INTEGER NOT NULL, mar INTEGER NOT NULL, nativity INTEGER NOT NULL,
  puma INTEGER NOT NULL, adjinc REAL NOT NULL,
  PRIMARY KEY (serialno, sporder)
);
CREATE INDEX idx_pums_puma ON pums_records (puma);
```

Kept columns are simit's `KEEP_COLS` 18: `SERIALNO, SPORDER, PWGTP, AGEP, SEX, RAC1P,
HISP, SCHL, PINCP, POVPIP, OCCP, COW, ESR, CIT, MAR, NATIVITY, PUMA, ADJINC`. Derived
categories keep simit's exact collapse rules: `race_eth` (HISP≠1 overrides RAC1P),
`educ` 4-level from SCHL, `age_band` 7 bands, POVPIP (0–501) as the household
economic-standing scalar (`econ_rank`), `PINCP × ADJINC/1e6` for personal income. The
artifact records `pums_vintage` so two runs are never silently compared across vintages.
**MVP ships CA (SF PUMAs 7507–7514) pre-ingested**; other states are a config + re-ingest,
not code.

### 6.2 Persona sampling with PWGTP **MVP**

Port of `persona.rs`. Determinism contract: `agent_seed = sha256(sim_seed, agent_index)`,
ChaCha8 RNG per agent, sampling uniform over records (without replacement when
n ≤ records, Fisher-Yates partial shuffle) with each agent **carrying** its record's
`PWGTP`. The marginals-match guarantee is simit's core: the PWGTP-weighted marginal
distribution of sampled agents reproduces the ACS marginal within TV distance 0.05 (their
test suite asserts this; ours keeps the test). Persona assembly keeps the full simit
chain — weighted income-quintile cutoffs, religion assignment from metro priors,
homeowner logistic, value vectors with demographic deltas + seeded noise, occupation label
from OCCP ranges, lifestyle sentence drawn last so earlier draws stay byte-stable. We do
not touch this code beyond city-profile configuration: it is calibrated, tested, and the
reason the backtests worked.

### 6.3 Archetype clustering & batched polling **MVP**

Port of `predict.rs`'s `cluster_agents`: group agents by a demographic key, coarsening in
4 levels (`age|race|educ|income_q|tenure|citizen` → … → `age|educ`) until ≤ `MAX_CLUSTERS`
(default 160). Clusters sort by first-member index so batch composition — and therefore
prompts and cache keys — is identical across runs. One representative persona per
archetype; **batches of 12 personas per LLM call**; the model returns per-persona
`{i, p_yes|dist, why}` JSON. Every member agent inherits its archetype's probability. Cost
consequence: a 2000-agent panel answers a question in ~13 LLM calls (160 archetypes / 12),
and a clean re-run costs zero (§6.7). Coverage honesty is inherited too: archetypes whose
batch failed are **excluded** from aggregation (never defaulted to 0.5), coverage <20%
fails the poll outright, and A/B runs hold an 80% coverage bar.

### 6.4 Post-stratified estimation **MVP**

Port of `aggregate.rs`, unchanged — this math is unit-tested in simit and the tests come
with it. For option k over agents i with weight `w_i` and (soft) answer indicator
`a_i(k) ∈ [0,1]`:

```
p_hat(k) = Σ_i w_i · a_i(k)  /  Σ_i w_i          (Horvitz–Thompson ratio estimator)

n_eff    = (Σ_i w_i)² / Σ_i w_i²                  (Kish effective sample size)
deff     = n / n_eff                              (design effect)

CI: weighted bootstrap — resample n agents uniformly with replacement B=400 times,
recompute p_hat each time, take the 2.5/97.5 percentiles. Seeded (seed ^ 0x9e3779b9),
therefore deterministic.
```

Breakdowns (age band, race/eth, education, income quintile, PUMA, tenure) apply the same
ratio estimator per group. **What we drop from simit:** the turnout-propensity model and
CVAP filtering — those are election machinery. **What we add:** the `icp_filter` lens —
the same estimator over the sub-population passing the ICP predicate, with the sub-panel's
own `n_eff` reported (a thin ICP slice has honest, wide CIs instead of borrowed precision).

### 6.5 Business questions replace ballot questions **MVP**

simit's `Framing::{Vote, Belief, Options}` becomes:

| Zeroth framing | simit ancestor | Output |
|---|---|---|
| `binary` | `Vote` (minus turnout) | `estimate` = weighted yes-share |
| `options` | `Options` | `p_distribution` over labeled choices |
| `wtp_ladder` | `Options` run per rung | `wtp_curve`: share_would_pay at each price |
| `ab_test` | simit's A/B machinery | preference share A vs B, 80% coverage bar, untrusted-stimuli guards kept verbatim |

The system prompts swap "you are this San Francisco resident deciding your vote" for "you
are this resident deciding about a product or service in your daily life/work", keeping
simit's grounding instruction: *ground each answer in the resident's profile, not
stereotypes.* Question-neutrality discipline transfers from ballot descriptions to product
descriptions via the question-designer rules (§5.2).

### 6.6 Calibration against D04's real interviews **MVP**

The Head aligns question wording with D04's scripts at design time so pairs exist. For each
aligned pair, `delta = synthetic_estimate − real_share`. The method literal in the response
is the policy: **deltas are reported, never applied as a correction.** Correcting the panel
toward 6 interviews would launder small-sample noise into fake precision — and correcting
silently would violate the honesty invariant. Consequences are trust-level only:
`aligned` ⇒ synthetic results keep their confidence; `divergent` (mean |delta| > 0.10) ⇒
confidence ×0.5 and an explicit warning to D06; `insufficient_real_data` ⇒ calibration
reported as absent, not as passing. The `panel_results.calibration_delta` column renders
in the Boardroom next to every estimate — never hidden, per the data model's comment.

### 6.7 SQLite prompt cache **MVP**

Port of `model.rs::Cache`, byte-identical semantics:

```sql
-- inside services/simpop/simpop.db
CREATE TABLE IF NOT EXISTS llm_cache (
  key      TEXT PRIMARY KEY,    -- sha256(model \x00 system \x00 user \x00 max_tokens_le)
  model    TEXT NOT NULL,
  response TEXT NOT NULL,
  created  INTEGER NOT NULL
);
```

Because cluster order, persona text, and prompt assembly are all seed-deterministic, the
cache key for every batch is stable across runs: **a clean re-run of any poll is
byte-reproducible and free.** `MODEL_OFFLINE=1` makes cache misses hard errors — that mode
is how the rubric gate runs in CI without network or spend. The cache also gives the
demo its safety net: the demo venture's polls are pre-warmed, so the live demo cannot be
taken down by an API outage.

### 6.8 Rubric validation & the headline gate **MVP**

Port of `rubric.rs` + the `validate` binary. simit's rubric scores elections (abs error
vs certified results), resolved markets (Brier), and counterfactuals (direction), combines
them as `headline = Σ wᵢ·scoreᵢ / Σ wᵢ` (zero-weight categories reported, never counted),
and exits 0 iff headline ≥ `thresholds.weighted_score_min`. Scoring curves transfer
unchanged: elections score `clamp(1 − |err|/2·tol)`, markets `clamp(1 − brier/2·max_brier)`,
counterfactuals direction ± magnitude penalty.

Two numbers matter and must not be conflated: the shipped `rubric.yaml` threshold is
**0.70** (floor: the service refuses to boot below it); the **~0.85 headline** is what the
SF configuration actually scores on its backtests (2024 presidential two-party share 83.8%
actual vs 81.3% predicted; Prop-A-class measures within tolerance) and is the **advertised
quality bar** — the number on the Boardroom badge and the number D06 uses when weighing
synthetic evidence. Targets are fixed public ground truth (certified canvass results,
resolved Polymarket contracts) with as-of dates before the model's knowledge cutoff so
outcomes cannot leak; tuning may touch personas, prompts, and aggregation — never targets.
`simpop.head` reads `GET /rubric/status` on every run and embeds the current headline score in
the artifact's assumptions, so a degraded panel advertises its own degradation.
**POST-MVP:** add a business-questions rubric section as ventures accumulate
interview-vs-panel pairs — real ClaimLedger shares become the targets, closing the loop
with D04 data instead of election data.

### 6.9 The axum API surface **MVP**

What `services/simpop` exposes (simit's router, re-shaped: simulations/branches/tiles/
chatter dropped; panels are simit simulations without the map):

| Method & path | Request | Response | Notes |
|---|---|---|---|
| `GET /health` | — | `{status, pums_records, cache_entries, model_ok, rubric_headline}` | orchestrator liveness probe |
| `GET /regions` | — | `[{state, pumas[], names[], pums_vintage}]` | what is ingested |
| `POST /panels` | `BuildPanelRequest` | `BuildPanelResponse` | builds population + archetypes; idempotent on `(venture_id, region, n, seed, icp_filter)` |
| `GET /panels/:id` | — | `BuildPanelResponse` + status | |
| `GET /panels/:id/demographics` | — | weighted marginals per dimension | Boardroom panel view |
| `GET /panels/:id/archetypes` | — | `[{cluster_index, label, attributes, population_weight, representative_persona}]` | the "meet the panel" drawer |
| `POST /panels/:id/poll` | `PollRequest` | `PollResponse` | the workhorse; ≤10 questions |
| `POST /panels/:id/calibrate` | `CalibrateRequest` | `CalibrateResponse` | deltas only, never corrections |
| `GET /rubric/status` | — | `{headline, categories[], passed, ran_at}` | last validation run |
| `POST /rubric/run` | `{offline: bool}` | rubric scorecard | CI + boot gate; offline uses cache only |
| `DELETE /panels/:id` | — | 204 | frees memory; PUMS + cache persist |

Service internals per request: axum handlers → `sim-core`-derived crate (`persona`,
`predict`, `aggregate`, `rubric` modules) → SQLite (PUMS subset + `llm_cache`) → Anthropic
API (bounded by semaphore, backoff on 429/5xx — simit's `ModelClient` retained with the
Azure/Gemini providers dropped). Usage counters (`calls, cache_hits, tokens`) return on
every poll and are metered to D05's budget by the orchestrator
([`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md)).

### 6.10 The hard rule, restated **MVP**

Synthetic evidence is labeled and never counts as proof of demand. Mechanically enforced
at four layers, so no single agent's judgment is load-bearing:

1. **Schema:** `honesty_note` is a `z.literal` — the artifact cannot parse without the
   exact disclaimer string.
2. **Registry:** the evidence validator marks every claim derived from a
   `SyntheticPanelResult` as `evidence_class: 'synthetic'`; artifacts mixing evidence
   classes must declare `mixed` (Worker Brief invariant #7).
3. **Critic:** banned-word scan — synthetic summaries may not contain "demand validated",
   "customers want", "proof", or any phrasing presenting the panel as people.
4. **D06's merge:** the decision department's evidence hierarchy hard-codes
   `real > mixed > synthetic`; a pivot justified *solely* by synthetic evidence requires a
   founder gate regardless of autonomy level.

---

## 7. Integrations

| Capability | Vendor | Usage here |
|---|---|---|
| The engine | `services/simpop` (Rust + axum + SQLite, ported from **simit**) | Panels, polls, calibration, rubric — deployed as a Render private service |
| Archetype polling LLM | Anthropic (sonnet) | Called from inside the Rust service; ~12 personas per call; cached |
| Hosting | **Render** | `render.create_service` for simpop at venture-zero boot; one instance serves all ventures (panels are cheap; PUMS is shared) |
| Census PUMS data | data.census.gov (build-time) | Ingested at image build; runtime is offline w.r.t. Census |
| Panel view | Boardroom | Demographics marginals, archetype drawer, estimate cards with CI + calibration delta + synthetic badge |
| Real-data calibration | D04 ClaimLedger | The aligned-pairs handoff (§6.6) |

No Composio, no Linq, no voice: this department touches no real humans, which is why its
`gates:` array is empty and its egress allowlist has two entries.

---

## 8. Gates & Escalations

### Gates opened

None. D05 contacts no one, spends nothing beyond its metered envelope, and publishes
nothing. Its safety surface is labeling, not permissioning — enforced by schema + Critic
(§6.10) rather than by founder approval.

### Escalations raised

| Reason | Severity | Trigger | Options |
|---|---|---|---|
| `needs_capability` | blocking | Region has no PUMS coverage (non-US venture) | `use_us_proxy_market_labeled`, `skip_synthetic_leg`, `terac_real_panel_instead` |
| `needs_human` | degrading | ICP slice <1% of panel weight — estimates too thin to mean anything | `broaden_lens_and_label`, `skip_icp_questions`, `proceed_with_wide_ci_warning` |
| `needs_approval` | informational | Calibration verdict `divergent` | notifies founder + D06: synthetic confidence halved for this venture |
| `needs_budget` | degrading | LLM spend inside the service exceeds envelope (cold cache + many questions) | drop to 5 questions, prioritized by WMBT blocking status |
| `needs_capability` | blocking | Rubric headline < 0.70 at boot (bad ingest, model drift) | service refuses panel requests; D13 notified with the scorecard |

---

## 9. Failure Modes & Fallbacks

| Failure | Detection | Fallback | Quality |
|---|---|---|---|
| LLM batches fail mid-poll | `archetype_coverage` per question | coverage ≥0.2: report with degraded-coverage warning; <0.2: question errors, retried once, then dropped to `gaps[]` | `signed` / `partial` |
| All batches fail (API outage) | poll-level error | resident cache may still serve previously-asked questions; otherwise artifact ships without estimates, `gaps: ['panel unavailable']` — D06 proceeds on 2 legs | `partial` |
| Leading question slips past design review | Critic neutrality scan | question re-worded, re-polled (cache miss is correct here — new wording, new key) | `signed` |
| ICP filter matches ~0 agents | `icp_subpopulation_weight` ≈ 0 | escalate `needs_human` (§8); never silently widen the lens | blocked |
| Geography ambiguity | Head resolution step | narrow to primary metro, record in `assumptions[]` as unverified | `signed` |
| Calibration pairs too thin (n_real < 5/question) | CalibrateRequest inspection | verdict `insufficient_real_data`; reported as absent | `signed` |
| PUMS vintage mismatch across runs | `pums_vintage` on artifact | comparisons across vintages flagged by D06's merge; re-run on current vintage if it matters | `signed` |
| Cache DB corruption | SQLite integrity check at boot | cache dropped and rebuilt (re-polls cost money, not correctness); determinism preserved by seeds | `signed` |
| Rubric gate fails at boot | `/rubric/run` exit | service refuses traffic; escalation with scorecard; ventures proceed on 2 legs | blocked |

---

## 10. Definition of Done & Critic Rubric

**Done when all are true:**

- [ ] One signed `SyntheticPanelResult`, Zod-valid, `honesty_note` literal intact.
- [ ] `region`, `pums_vintage`, `seed` recorded — the run is byte-reproducible.
- [ ] ≥4 archetypes with labels, attributes, and `population_weight` (Σ PWGTP).
- [ ] Every D05-assigned WMBT mapped to a question, or in `gaps[]` with a reason.
- [ ] Every estimate carries CI, `n_eff`, `design_effect`, `archetype_coverage`, and
      per-archetype rows that recompute to the headline within 0.005.
- [ ] WTP ladder run against the NicheDossier price point (0.5×–3×) with the
      relative-not-absolute caveat attached.
- [ ] Calibration block present whenever a ClaimLedger predated the run; deltas verbatim;
      divergence consequence applied.
- [ ] Thin-ICP warning present when subpopulation weight <3%.
- [ ] No banned words in any summary; every derived claim `evidence_class: 'synthetic'`.
- [ ] Usage + cost reported; cache hit rate recorded.

**Critic rubric:** §5.3. Pass ≥13/18 with `Labeling honesty` = 3.

---

## 11. Demo Notes

| Demo t | On screen | Beat |
|---|---|---|
| **2:20–2:30** | Panel builds: demographic marginals animate to match Census bars side-by-side; archetype drawer shows 12 personas with PWGTP weights | "2000 statistically-real residents in 4 seconds" — the Census comparison is the credibility shot |
| **2:30–2:40** | The WTP ladder polls live: 13 batched calls tick across, the demand curve draws rung by rung, CI band visible | Speed + cost caption: "$0.30, 3 minutes, reproducible from seed 42" |
| **2:40–2:50** | Calibration card: synthetic 62% vs real interviews 55%, delta +7pts in amber, verdict `aligned`; the synthetic badge stays on every number | The honesty beat — a system showing its own error bar against real humans is the anti-hype move judges remember |
| **2:50–2:55** | The rubric badge: headline 0.85 with the 2024 backtest tooltip (83.8% actual / 81.3% predicted) | Provenance of trust: this instrument was validated on public ground truth before we pointed it at business questions |

The one-liner for this room: *"synthetic panels tell us where to aim; real interviews tell
us whether we hit."*

---

## 12. Cost Estimate

One run: build + 8 questions (1 binary, 1 options, 1 A/B, 5-rung WTP ladder) + calibration,
cold cache:

| Item | Qty | Cost |
|---|---|---|
| Panel build (Rust; no LLM) | 2000 agents, ~160 archetypes | $0.00 |
| Archetype polling (sonnet, inside service) — 8 questions × ~13 batches | ~104 calls, ~1.6k tokens each | $0.42 |
| `simpop.question-designer` (opus) | ~38k | $0.28 |
| `simpop.head` (sonnet) — 2 wake cycles (poll + calibrate) | ~75k | $0.24 |
| `simpop.critic` (sonnet) | ~28k + 0.2 revision | $0.10 |
| Calibration (pure math) | — | $0.00 |
| Sandbox + service compute | ~4 min | $0.02 |
| **Total (cold)** | | **≈ $1.06** |
| **Total (warm cache re-run)** | ~104 cache hits | **≈ $0.64** |

Envelope `$1.50`; hard cap `$3.00` absorbs a full re-poll after question revisions. All
figures are estimates. The cache line is the story: validation questions re-asked across
pivots are free.

---

## Assumptions & open questions

- **A1.** One shared simpop service instance across ventures is fine for the hackathon
  (panels are memory-light; PUMS is read-only shared state). Multi-tenant isolation of the
  cache (venture-scoped cache keys) is POST-MVP.
- **A2.** simit's persona value-vector calibration (SF-progressive baselines with
  demographic deltas) transfers to *purchase* questions untouched. Plausible for
  consumer-ish questions; unproven for B2B buying behavior, where the "resident" frame is
  weakest. The B2B caveat rides in the artifact's limits paragraph until the business
  rubric (§6.8 POST-MVP) exists.
- **A3.** ICP filtering by OCCP ranges + income quintile + employment approximates B2B
  roles coarsely (a "dental office manager" is at best "manager, healthcare-adjacent").
  Firmographic personas would need establishment data (CBP), not person microdata — noted
  as a POST-MVP capability gap.
- **A4.** The ~0.85 headline was measured on simit's SF configuration with gpt-4o for the
  leakage-free entries. Our port swaps the poll model to sonnet for live business
  questions; the rubric gate re-runs with the pinned per-entry models, so the badge stays
  honest, but live-question accuracy on business topics has no backtest yet. See A2.
- **A5.** ACS vintage assumed 2022 5-year at build time; `pums_vintage` field exists so a
  2023 re-ingest is a data update, not a schema change.
- **Q1.** Should the WTP ladder use within-subject framing (same archetype asked all rungs
  in one prompt) or between-subject (rung per batch)? simit's Options framing supports
  either; within-subject is cheaper, between-subject is cleaner against anchoring.
  Currently within-subject with rungs ordered randomly per batch — revisit with calibration
  data.
- **Q2.** Do we expose `POST /panels/:id/ab-test` as a first-class route (simit had one)
  or keep A/B as a `PollRequest` framing? Currently a framing; D08 may want the dedicated
  route with its higher coverage bar made structural.
- **Q3.** When D04 and D05 disagree hard (`divergent`), should D05 auto-generate follow-up
  questions probing *why* (segment-level breakdown comparison), or leave diagnosis to D06?
  Currently: breakdown comparison is attached to the divergence escalation, diagnosis
  stays with D06.
- **Q4.** Non-US ventures: the `use_us_proxy_market_labeled` escalation option is honest
  but weak. Eurostat microdata (EU-SILC) ingestion is the real fix — POST-MVP, sized at
  roughly the original PUMS ingest effort.

---

**Previous:** [`D04-outreach-validation.md`](D04-outreach-validation.md) · **Next:** [`D06-pivot-decision.md`](D06-pivot-decision.md)
