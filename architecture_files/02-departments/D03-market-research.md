# D03 — Market Research

Follows [`D00-department-template.md`](D00-department-template.md). Consumes the
`SharpenedIdea` from [`D02-office-hours.md`](D02-office-hours.md) and runs in parallel with
[`D04-outreach-validation.md`](D04-outreach-validation.md) (real humans) and
[`D05-synthetic-population.md`](D05-synthetic-population.md) (synthetic panel). D03 is the
**documents-and-numbers** leg of that validation tripod: everything it produces comes from
published, citable sources — never from a conversation, never from a model's imagination.

---

## 1. Mission

Turn one sharpened idea into 3–5 ranked, fully-cited niche dossiers the founder can bet on.

> **The single question this department answers:** *where is the money, how much of it is
> reachable, and what would we have to believe for this niche to be worth the next dollar?*

D03 never talks to a human and never invents a number. Its output is only as good as its
citations, and the Critic enforces exactly that.

---

## 2. Contract — Inputs & Outputs

### Input

`SharpenedIdea` (signed, from D02), carrying the `what_must_be_true[]` entries assigned
`tested_by: 'D03'`. Also reads venture memory and institutional memory for prior research in
the same category (see §research memory in section 6.5).

### Output

`NicheDossier[]` — **the schema is owned by
[`../01-platform/04-data-model.md`](../01-platform/04-data-model.md)** (`packages/contracts/
src/artifacts/discovery.ts`). Restated here verbatim so this file is self-contained; if the
two ever diverge, the data-model file wins.

```ts
export const NicheDossier = ArtifactBase.extend({
  artifact_type: z.literal('NicheDossier'),
  label: z.string(),                       // 'Multi-location dental groups, 5-25 chairs, US Southwest'
  slice: z.object({
    industry: z.string(), company_size: z.string(),
    geography: z.string(), trigger_event: z.string().optional(),
  }),
  tam: Cited(Money), sam: Cited(Money), som: Cited(Money),
  mrr_12mo: Cited(Money),
  pricing_hypothesis: z.object({
    model: z.enum(['seat','usage','flat','tiered','marketplace_fee']),
    price_point: Cited(Money),
    anchor_comparables: z.array(SourceRef),
  }),
  competitors: z.array(z.object({
    name: z.string(), url: z.string().optional(),
    pricing: Cited(Money).optional(), weakness: z.string(), sources: z.array(SourceRef).min(1),
  })).min(1),
  wedge: z.string(),
  pros: z.array(z.string()), cons: z.array(z.string()),
  reachability: z.object({
    channels: z.array(z.string()), estimated_cac: Cited(Money).optional(),
  }),
  confidence: Confidence,
  rank_rationale: z.string(),
});
```

### Supporting contracts introduced by this department

These live in `packages/contracts/src/artifacts/research.ts` and are internal to D03's
pipeline (workers → Head). They are not signed artifacts; they are worker output schemas.

```ts
// packages/contracts/src/artifacts/research.ts
import { z } from 'zod';
import { SourceRef, Cited, Money, Confidence } from '../primitives';

/** One research question dispatched to a swarm worker. */
export const ResearchTask = z.object({
  task_id: z.string(),                        // 'RT-demand-3'
  swarm: z.enum(['demand','supply','money','niche']),
  question: z.string(),                       // falsifiable, single-clause
  wmbt_id: z.string().optional(),             // SharpenedIdea.what_must_be_true link
  niche_label: z.string().optional(),         // set once niches are enumerated
  budget_tokens: z.number().int().positive(),
  min_sources: z.number().int().min(1).default(2),
});

/** Every worker returns Findings, never prose. */
export const Finding = z.object({
  task_id: z.string(),
  answer: z.string().max(600),
  numbers: z.array(z.object({
    label: z.string(),                        // 'US dental groups with 5-25 chairs'
    value: z.number(),
    unit: z.string(),                         // 'orgs' | 'USD/yr' | 'USD/seat/mo' | '%'
    method: z.enum(['measured','derived','estimated']),
    derivation: z.string().optional(),        // shown when method='derived' — the formula used
    sources: z.array(SourceRef).min(1),       // ← uncited numbers fail Zod, not just the Critic
  })).default([]),
  quotes: z.array(z.object({
    verbatim: z.string().max(400), source: SourceRef,
  })).default([]),
  contradictions: z.array(z.string()).default([]),  // sources that disagree with each other
  gaps: z.array(z.string()).default([]),            // what could not be found — an honest output
  confidence: Confidence,
});

/** Willingness-to-pay signal, ranked by evidence strength (see §6.3). */
export const WtpSignal = z.object({
  kind: z.enum([
    'observed_price_paid',      // strongest: an actual price someone pays today
    'budget_line_item',         // a named budget category this replaces
    'workaround_cost',          // hours × loaded rate of the current manual process
    'competitor_price_point',   // what incumbents charge for adjacent value
    'stated_intent',            // weakest admissible; surveys, forum posts
  ]),
  value_usd: Cited(Money),
  period: z.enum(['one_time','per_month','per_year','per_transaction']),
  applies_to: z.string(),                     // which niche slice
  strength: Confidence,                       // set from kind: observed=0.9 … stated=0.3
});

/** The MRR/ARR scenario model. All arithmetic runs through the `calc` tool. */
export const RevenueScenario = z.object({
  name: z.enum(['bear','base','bull']),
  assumptions: z.object({
    price_usd_mo: Cited(Money),
    reachable_prospects: Cited(z.number()),
    contact_to_trial_pct: z.number().min(0).max(1),
    trial_to_paid_pct: z.number().min(0).max(1),
    monthly_logo_churn_pct: z.number().min(0).max(1),
    new_customers_month1: z.number().int(),
    monthly_new_customer_growth_pct: z.number(),
  }),
  // computed by `calc`, not the LLM:
  mrr_by_month: z.array(Money).length(12),
  mrr_12mo: Money,
  arr_12mo: Money,                            // 12 × mrr_by_month[11]
  customers_12mo: z.number().int(),
  breakeven_month: z.number().int().nullable(), // vs venture cost baseline, null if never
});

/** Head-level ranking record (also projected into the `niches` table). */
export const NicheRanking = z.object({
  niche_label: z.string(),
  scores: z.object({                          // each 0..3, Critic-auditable
    pain_intensity: z.number().min(0).max(3),
    reachability: z.number().min(0).max(3),
    money: z.number().min(0).max(3),
    competitive_gap: z.number().min(0).max(3),
    founder_fit: z.number().min(0).max(3),
    speed_to_revenue: z.number().min(0).max(3),
  }),
  weights: z.object({                         // fixed; changing them requires a version bump
    pain_intensity: z.literal(0.25),
    reachability: z.literal(0.20),
    money: z.literal(0.20),
    competitive_gap: z.literal(0.15),
    founder_fit: z.literal(0.10),
    speed_to_revenue: z.literal(0.10),
  }),
  composite: z.number().min(0).max(3),        // Σ wᵢ·sᵢ, computed by `calc`
  rank: z.number().int().min(1),
  rationale: z.string().max(500),
});
```

**Downstream:** signed `NicheDossier[]` ⇒ the `niche_selection` gate (founder swipes), then
the selected dossier flows to [`D06`](D06-pivot-decision.md) and seeds D04's ICP targeting
and D05's panel questions. The `niches` projection table is populated by a reducer for the
Boardroom ranking view.

---

## 3. `DepartmentManifest`

```yaml
# packages/manifests/D03-market-research.yaml
id: D03
name: Market Research
cluster: discovery
version: 1
generated_by: human
resident: false

head:
  agent_id: market.head
  model: opus
  system_prompt_ref: prompts/D03/head.md
  tools: [memory.read, memory.write, memory.search, artifact.read, artifact.sign,
          bus.emit, calc]
  max_tokens_per_run: 120000
  temperature: 0.2
  timeout_s: 300

critic:
  agent_id: market.critic
  model: sonnet
  system_prompt_ref: prompts/D03/critic.md
  rubric_ref: prompts/D03/critic-rubric.md
  tools: [memory.read, artifact.read, web_fetch]     # web_fetch: to spot-check citations resolve
  max_tokens_per_run: 40000
  temperature: 0.0

workers:
  - agent_id: market.demand              # demand swarm: who hurts, how much, how often
    model: sonnet
    replicas: 3
    system_prompt_ref: prompts/D03/demand.md
    tools: [web_search, web_fetch, apify.run_actor, apify.get_dataset, memory.read, memory.write]
    max_tokens_per_run: 60000
    temperature: 0.3
    output_schema: Finding

  - agent_id: market.supply              # supply swarm: competitors, substitutes, workarounds
    model: sonnet
    replicas: 3
    system_prompt_ref: prompts/D03/supply.md
    tools: [web_search, web_fetch, apify.run_actor, apify.get_dataset, memory.read, memory.write]
    max_tokens_per_run: 60000
    temperature: 0.3
    output_schema: Finding

  - agent_id: market.money               # money swarm: TAM/SAM/SOM inputs, pricing, WTP
    model: sonnet
    replicas: 2
    system_prompt_ref: prompts/D03/money.md
    tools: [web_search, web_fetch, calc, memory.read, memory.write]
    max_tokens_per_run: 70000
    temperature: 0.2
    output_schema: Finding

  - agent_id: market.niche               # niche swarm: enumerate + slice candidate niches
    model: sonnet
    replicas: 2
    system_prompt_ref: prompts/D03/niche.md
    tools: [web_search, web_fetch, memory.read, memory.search]
    max_tokens_per_run: 50000
    temperature: 0.5                     # divergent by design; the Head converges
    output_schema: Finding

concurrency: 10

budget:
  default_envelope_usd: 4.00
  hard_cap_usd: 8.00
  degrade_at_pct: 0.8
  on_exhausted: escalate

io:
  input: [SharpenedIdea]
  output: [NicheDossier]
  min_outputs: 3                         # fewer than 3 dossiers ⇒ quality 'partial'
  emits_work_orders_to: []

gates:
  - id: niche_selection
    trigger: artifact.created(type=NicheDossier[])
    question: "Research is in. Which niche do we commit the next dollar to?"
    surface: both
    card: swipe_select
    auto_approve_at: autonomous          # autonomous mode: rank-1 dossier auto-selected
    timeout_s: 600
    on_timeout: auto_approve
    blocks: true

sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 2048
  egress_allowlist: [api.anthropic.com, api.apify.com, duckduckgo.com, '*']
  # '*' via the web tools proxy only; raw sockets stay closed. See 01-platform/01-system-architecture.md
  pause_between_cycles: true
  forkable: false

sla:
  soft_deadline_s: 300
  hard_deadline_s: 600
  on_timeout: return_partial

memory:
  reads: [venture, department, global]
  writes: [department, global]           # global: category-level lessons survive the venture

triggers:
  - kind: event
    expr: artifact.signed(type=SharpenedIdea)
```

---

## 4. Agent Roster

| Agent | Role | Model | Replicas | Tools | Tokens/run | Est. cost |
|---|---|---|---|---|---|---|
| `market.head` | Decomposes into ResearchTasks, merges Findings, runs the TAM math via `calc`, ranks, signs | `opus` | 1 | memory, artifact, bus, calc | 120k | $0.85 |
| `market.demand` | Pain evidence: forums, reviews, job posts, "hiring for this manually" signals | `sonnet` | 3 | web_search, web_fetch, apify | 60k ×3 | $0.54 |
| `market.supply` | Competitor landscape: incumbents, substitutes, the ugly Gumroad template | `sonnet` | 3 | web_search, web_fetch, apify | 60k ×3 | $0.54 |
| `market.money` | Sizing inputs, pricing benchmarks, WTP signals; owns the numbers | `sonnet` | 2 | web_search, web_fetch, calc | 70k ×2 | $0.42 |
| `market.niche` | Enumerates 6–10 candidate slices before the Head culls to 3–5 | `sonnet` | 2 | web_search, memory.search | 50k ×2 | $0.30 |
| `market.critic` | Citation audit, formula audit, ranking audit; spot-fetches URLs | `sonnet` | 1 | memory.read, web_fetch | 40k | $0.12 |

Design note: `market.money` is the only worker with `calc`. Numbers converge through one
role, so a formula error has one home and one owner. The Head re-runs all money arithmetic
through `calc` before signing anyway — LLM math on money is banned platform-wide
([`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md)).

---

## 5. System Prompts

### 5.1 `prompts/D03/head.md`

```
You are the Head of Market Research at Zeroth, an AI-run agency building a company for a human founder.
You do not do the work yourself. You decompose, dispatch, merge, and sign.
You may not fabricate. A gap is an acceptable output; an invented number is a P0 defect.
You report cost honestly, including your own.

Your input is a SharpenedIdea. Your output is 3-5 NicheDossier artifacts, ranked.

=== DECOMPOSITION ===
1. Read SharpenedIdea. Extract the what_must_be_true entries assigned to D03 — these are
   research questions you MUST answer, before any question you generate yourself.
2. Dispatch the NICHE swarm first: "enumerate 6-10 concrete slices of this market". A slice
   is industry × company-size × geography, optionally × trigger event. "SMBs" is not a slice.
3. For each surviving slice, dispatch in parallel:
   - DEMAND swarm: evidence the pain exists in THIS slice (forum threads, 1-star reviews of
     incumbents, job postings for manual versions of the work, Reddit/community complaints).
   - SUPPLY swarm: who serves this slice today, at what price, with what gaps. Include
     non-obvious competitors: spreadsheets, consultants, $9 templates, in-house tools.
   - MONEY swarm: org counts for the slice (census/NAICS, industry associations, directory
     sizes), pricing benchmarks from comparable products, WTP signals per the WtpSignal kinds.

=== EVIDENCE RULES (non-negotiable) ===
- Every number carries sources[]. method='measured' needs a primary source. method='derived'
  needs the formula in `derivation` AND sources for every input. method='estimated' needs the
  basis stated and confidence <= 0.5.
- Two INDEPENDENT sources for any number that reaches a dossier's tam/sam/som/price fields.
  Independent means different publishers, not two pages of the same vendor's content.
- A vendor sizing its own market is a tier-4 source (see prompts/_shared/evidence-rules.md).
  It may corroborate, never anchor.
- When sources contradict, report BOTH with the spread. Do not average away a contradiction.
- What you cannot find goes to gaps[]. gaps[] is a deliverable, not a failure.

=== SIZING METHOD (do the math with `calc`, never in your head) ===
For each niche, compute TAM two ways:
  Top-down:   TAM_td = N_orgs(slice) × ACV_expected        [USD/yr]
  Bottom-up:  TAM_bu = Σ_segments ( count_s × price_s × 12 ) [USD/yr]
Reconcile: if TAM_td and TAM_bu differ by more than 3×, that is a finding — investigate which
input is wrong before writing either number. The dossier reports the RECONCILED figure with
both derivations in sources.
  SAM = TAM × reachable_share      reachable_share = fraction addressable by our
                                   geography, language, channel list, and product form —
                                   each factor cited or labeled 'estimated'
  SOM = SAM × capture_rate_3yr     capture_rate_3yr <= 0.05 unless a cited comparable
                                   (a competitor's disclosed customer count vs market size)
                                   justifies more. Justify the number, never default silently.
mrr_12mo comes from the RevenueScenario model (base case), computed by `calc`:
  MRR(1) = new_customers_month1 × price
  MRR(t) = MRR(t-1) × (1 - churn) + new(t) × price,   new(t) = new(t-1) × (1 + growth)
  ARR_12 = 12 × MRR(12)
Run bear/base/bull. The dossier's mrr_12mo is the BASE case; bear and bull go in the body
with their assumption deltas.

=== RANKING ===
Score each niche 0-3 on: pain_intensity, reachability, money, competitive_gap, founder_fit,
speed_to_revenue. Weights are fixed: 0.25/0.20/0.20/0.15/0.10/0.10. composite = Σ wᵢsᵢ via
`calc`. Every score of 3 needs a one-line justification citing a Finding. rank_rationale on
each dossier must say why it beat or lost to its neighbors — comparative, not absolute.

=== CONFIDENCE ===
Dossier confidence = min(evidence_confidence, coverage_confidence) where evidence_confidence
reflects source tiers and corroboration, coverage_confidence reflects gaps[] against the
required fields. A dossier with an uncited SOM cannot exceed 0.4. Never present confidence
as precision — it is a statement about evidence quality.

=== ESCALATION ===
If, for EVERY candidate niche, you cannot produce a TAM with two independent sources, stop
and raise Escalation(needs_human): the market may be too new or too opaque for desk research.
Offer: 'proceed_with_labeled_estimates' | 'commission_terac_expert' | 'skip_to_interviews'.
Do not paper over an evidence desert with confident prose.
```

### 5.2 `prompts/D03/demand.md` — demand swarm worker

```
You are a demand researcher. You find evidence that a specific pain exists in a specific
slice of the market. You return a Finding, never prose.

Where to look, in order of evidence value:
1. People PAYING to solve it: job postings for manual versions of the work ("hiring a
   coordinator to chase invoices"), Upwork/Fiverr gig volume and rates, agency service pages.
2. People COMPLAINING with specifics: 1-star and 2-star G2/Capterra reviews of incumbents
   (the complaint text is the gold, not the star), Reddit and niche-forum threads with
   engagement numbers, support communities of adjacent tools.
3. People SEARCHING: only as corroboration, never as primary evidence.

Rules:
- Every quote is verbatim, with a SourceRef including URL and retrieved_at. Paraphrase in
  `answer`; never inside `quotes`.
- Count things when you can: "17 of the 40 most recent 1-star reviews name reporting" beats
  "many users complain about reporting". Record the denominator.
- Complaints about a competitor are demand evidence ONLY if the complainer matches the slice.
  A Fortune-500 admin's complaint tells you nothing about 10-person dental offices.
- No results is a result. Write it to gaps[] with the queries you tried.
```

### 5.3 `prompts/D03/supply.md` — supply swarm worker

```
You are a competitive-landscape researcher for one market slice. Return a Finding.

Enumerate everyone the buyer could give money to instead of us:
- Direct competitors (same job, same buyer). Get: name, URL, pricing page contents (verbatim
  numbers + plan names), target segment, last-funding/size signal if public.
- Substitutes: spreadsheet templates, consultants, marketplaces, an ugly-but-free workflow.
- Status quo: doing nothing, or a human absorbing the work (link to demand swarm's job-post
  evidence when it exists).

For each competitor record a WEAKNESS, evidenced: a review quote, a missing feature on their
own pricing page, a segment they explicitly do not serve. "Their UX is dated" without a
source is an opinion and will be stripped.

Pricing rules:
- Copy prices EXACTLY as published, with plan name, unit, and billing period. Note
  "contact sales" as its own datum — an enterprise-gated price is a wedge signal.
- If a price is only available via a review or third-party post, cite it and set
  confidence <= 0.5.

A hallucinated competitor is a P0 defect. Every name must have a resolving URL. If you are
not sure it exists, it does not go in the Finding.
```

### 5.4 `prompts/D03/money.md` — money swarm worker

```
You are the sizing-and-pricing researcher. You own every number that feeds TAM/SAM/SOM,
pricing benchmarks, and willingness-to-pay. Return a Finding.

Sizing inputs you hunt for, in tier order:
  T1  Government/statistical: Census County Business Patterns, NAICS counts, BLS, Eurostat.
  T2  Industry associations and regulators: member counts, licensee registries.
  T3  Paid-research summaries (Gartner/IBISWorld figures quoted in public articles) — cite
      the quoting article; label the chain.
  T4  Vendor claims about their own market — corroboration only.
Record the slice definition next to every count. "Dental practices" and "dental groups with
5+ chairs" differ by 20x; a count without its definition is worthless.

WTP signals, strongest first (fill the WtpSignal shape):
  observed_price_paid > budget_line_item > workaround_cost > competitor_price_point > stated_intent
For workaround_cost derive: hours/period × loaded hourly rate (cite the wage source, e.g.
BLS OES for the role) and show the multiplication in `derivation`.

Pricing benchmarks: assemble the price ladder of 3-6 comparables (from the supply swarm's
verbatim prices where possible), positioned by value metric (per seat / per org / per
transaction). Our price_point hypothesis must sit ON that ladder with a stated reason for
its rung.

You have `calc`. Use it for every multiplication. An arithmetic error in your Finding is
treated as fabrication.
```

### 5.5 `prompts/D03/niche.md` — niche swarm worker

```
You enumerate candidate niches. Diverge; the Head converges. Return a Finding whose
`answer` lists 6-10 candidate slices with one line of reasoning each.

A valid slice names: industry (specific vertical), company size band, geography, and
optionally a trigger event. Test each against:
- Homogeneity: would 20 buyers in this slice describe the pain in the same words?
- Findability: is there a list? (directory, registry, association roster, LinkedIn filter,
  conference attendees). Name the list. D04 will need it.
- Budget: does this slice already pay for adjacent software? Name one thing they pay for.
Search memory.search(global) first: if a prior venture researched an overlapping category,
start from its surviving niches and its recorded dead ends. Do not re-discover a dead end.
```

### 5.6 `prompts/D03/critic.md` + `critic-rubric.md`

```
You are the Market Research Critic. You audit dossiers as a hostile investor would.

Automatic REVISE if any of:
- any tam/sam/som/mrr_12mo/price_point value whose sources[] is empty or whose method is
  'measured' without a T1/T2 source
- TAM top-down and bottom-up derivations absent, or present but differing >3x without a
  reconciliation note
- SOM > 0.05 × SAM without a cited comparable justifying the capture rate
- any competitor without a resolving URL (spot-check up to 6 with web_fetch; a 404 or a
  domain-parking page = hallucinated competitor = P0)
- pricing_hypothesis.price_point not positioned against >= 3 anchor_comparables
- fewer than 3 dossiers, or two dossiers whose slices are not meaningfully distinct
- ranking scores present without per-score justification, or composite ≠ Σ wᵢsᵢ (recompute)
- confidence > 0.4 on any dossier with an uncited money field
- a WMBT question assigned to D03 that no dossier addresses and no gap records
- gaps[] empty on every dossier (statistically impossible; silence means hiding)

Also verify the honesty texture: bear/base/bull scenarios must differ in assumptions, not
just outputs; a 'contradictions' entry in any Finding must surface in the dossier's cons or
gaps, not vanish in the merge.

Return {verdict, scores, defects[]} with defects[].path pointing into the dossier body so
the Head re-runs only the swarm that produced the defect.
```

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Evidence** | uncited money fields | citations exist, tiers ignored | two-source rule mostly held | every number two-sourced or explicitly `estimated`, tiers respected |
| **Specificity** | segment-level slices | some named slices | all slices concrete | slices concrete + findable list named for each |
| **Falsifiability** | no reconciliation, no gaps | gaps listed | TAM reconciled both ways | reconciled + each dossier states what evidence would demote it |
| **Honesty** | contradictions hidden | some flagged | spreads reported | contradictions reported with both sources and a stated resolution or open gap |
| **Math integrity** | LLM arithmetic | calc used sometimes | calc used for money fields | all money math via calc, derivations reproducible |
| **Comparative ranking** | absolute scores only | weights applied | rationale comparative | rank flips traceable to specific findings |

**Pass threshold: ≥ 13/18, with `Evidence` = 3 and `Math integrity` ≥ 2.** Evidence has no
partial credit here for the same reason Honesty has none in D02: an uncited market number is
the exact failure mode this department exists to prevent.

---

## 6. Execution Flow

```
artifact.signed(SharpenedIdea)
        │
        ▼
┌───────────────┐   Phase 1: read WMBTs assigned to D03; memory.search(global)
│  market.head  │   for prior research in this category (hits become priors, cited
└──────┬────────┘   as kind='memory' sources with their original source_id chain)
       │
       ▼  Phase 2: NICHE swarm (2 replicas, divergent)
   6-10 candidate slices ──► Head culls to 3-5 (homogeneity, findability, budget)
       │
       ▼  Phase 3: fan-out per surviving niche (parallel, concurrency 10)
 ┌──────────────┬───────────────┬───────────────┐
 │ DEMAND ×3    │ SUPPLY ×3     │ MONEY ×2      │
 │ pain evidence│ competitors + │ org counts,   │
 │ w/ verbatim  │ verbatim      │ price ladder, │
 │ quotes       │ pricing       │ WTP signals   │
 └──────┬───────┴───────┬───────┴───────┬───────┘
        └───────────────┼───────────────┘
                        ▼
        Phase 4: MERGE + MATH (Head, all via `calc`)
        TAM_td vs TAM_bu → reconcile → SAM → SOM
        RevenueScenario bear/base/bull → mrr_12mo (base)
        cross-check: contradictions[] surface as cons/gaps
                        ▼
        Phase 5: RANK — 6 scores × fixed weights → composite → rank
                        ▼
        market.critic (≤1 revision loop; defects re-run only the guilty swarm)
                        ▼
        SIGN NicheDossier[] (3-5, ranked)
                        │
                        ▼
        GATE niche_selection ── swipe_select ── founder picks (or rank-1 auto)
                        │
                        ▼
        selected dossier → D06; niches projection updated; research memory written
```

### 6.1 Source validation & provenance **MVP**

Every fetched page becomes a row in `sources`
([`../01-platform/04-data-model.md`](../01-platform/04-data-model.md)): URI, content hash,
snapshot to object storage, publisher, and a `reliability` prior from the tier table below.
Claim-level linkage goes through `artifact_sources` with a `json_pointer` per dossier field —
this is what powers the Boardroom's "explain this number" drawer.

| Tier | Source class | `reliability` prior | May anchor a money field? |
|---|---|---|---|
| T1 | Government / statistical (Census CBP, NAICS, BLS) | 0.90 | yes |
| T2 | Associations, regulators, licensee registries | 0.80 | yes |
| T3 | Named research quoted in public articles | 0.60 | yes, with the quote chain cited |
| T4 | Vendor/competitor self-published claims | 0.35 | no — corroboration only |
| T5 | Forums, social, anonymous posts | 0.25 | no — demand texture only |

Two-source independence rule: the two sources anchoring any dossier money field must have
different publishers. `sources.content_hash` dedup catches the syndicated-article trap
(same wire copy on two domains counts as one source).

### 6.2 Anti-hallucination rules **MVP**

Restating the platform invariants as this department's local law:

1. Zod first: `Finding.numbers[].sources` has `.min(1)` — an uncited number fails parsing
   before the Critic ever sees it.
2. Signing second: `registry.sign()` blocks any `Cited` field with empty sources (platform
   rule, [`../01-platform/04-data-model.md`](../01-platform/04-data-model.md) §sign path).
3. Critic third: spot-fetches competitor URLs; a non-resolving competitor is a P0.
4. No silent averaging: contradictory sources are reported as a spread with both citations.
5. No compounding estimates: a `derived` number may consume at most one `estimated` input;
   chains of estimates collapse confidence to ≤0.3 and get flagged in `assumptions[]`.
6. Memory hits are citations too: a prior-venture figure enters as a source with its
   original chain, re-dated — stale (>12mo) figures must be re-verified or downgraded.

### 6.3 Willingness-to-pay evidence ladder **MVP**

The `WtpSignal.kind` enum is ordered. Strength defaults: `observed_price_paid` 0.9,
`budget_line_item` 0.75, `workaround_cost` 0.6, `competitor_price_point` 0.5,
`stated_intent` 0.3. A pricing_hypothesis anchored *only* on stated_intent cannot push the
dossier's confidence above 0.4 — people lie cheaply in surveys, which is exactly why D04
exists. D04's interview-derived WTP claims later supersede these desk signals in D06's
merge.

### 6.4 Scenario modeling **MVP**

`RevenueScenario` runs three parameter sets through the same recurrence (§5.1). House rules:
bear/base/bull must differ on at least three assumption fields with a one-line basis each;
churn below 2%/mo requires a cited comparable; `breakeven_month` compares cumulative gross
margin against the venture's metered burn from
[`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md). The
Boardroom renders the three MRR curves on the dossier card.

### 6.5 Research memory **MVP** (write) / **POST-MVP** (cross-venture retrieval UI)

On signing, the Head writes to memory
([`../01-platform/05-memory-and-context.md`](../01-platform/05-memory-and-context.md)):

| Tier | Kind | Content |
|---|---|---|
| department | `source_excerpt` | Every T1/T2 excerpt with source_id — the reusable evidence base |
| venture | `artifact_summary` | 10-line summary per dossier + the ranking table |
| global | `lesson` | Category-level: "US dental-group counts: CBP NAICS 621210 is the anchor; vendor X's figure is 3× inflated" |

Global lessons are how venture #2 in an adjacent category starts warm. Dead ends are lessons
too: a niche scored ≤1.0 composite is written with *why*, so the niche swarm never
re-proposes it unmodified.

### 6.6 Reporting format **MVP**

The Boardroom dossier card, top to bottom: label · composite score + rank · TAM/SAM/SOM
funnel (hover = derivation + sources) · MRR scenario sparklines · price ladder with our
hypothesis highlighted · top-3 competitors with weaknesses · demand quotes carousel ·
amber `gaps[]` strip · confidence dial. The `niche_selection` gate card is the same content
compressed to Linq-size: label, one number (base-case MRR-12), one quote, one risk.

---

## 7. Integrations

| Capability | Vendor | Usage here |
|---|---|---|
| Structured scraping (reviews, directories, job boards) | **Apify** | `apify.run_actor` for G2/Capterra review dumps, job-post searches, directory counts; `get_dataset` returns typed rows that become sources with the actor run URL as URI |
| General search + page fetch | Anthropic `web_search` / `web_fetch` | All swarms; fetches are snapshotted to object storage for provenance |
| Deterministic arithmetic | `calc` (local) | Every TAM/SAM/SOM/MRR computation; LLM math on money is banned |
| Niche selection surface | **Linq** + Boardroom | `swipe_select` gate card; founder can pick from their phone |
| Prior-venture priors | CompanyOS memory (pgvector) | `memory.search(global)` before any fresh research |
| Expert fallback | **Terac** (via escalation → D11/HR) | When desk research bottoms out, the escalation option `commission_terac_expert` files a human requisition for a domain expert's 30-minute market brief — the human's output enters as a `human_expert` source |

---

## 8. Gates & Escalations

### Gates opened

| Gate id | Trigger | Card | Blocks | Autonomous behavior |
|---|---|---|---|---|
| `niche_selection` | dossiers signed | `swipe_select` | yes | rank-1 auto-selected at 600s; `Decision` records runner-up and the score margin |

D03 sends nothing to real humans and spends no money outside its LLM/tool envelope, so it
opens no `outbound_to_real_person` or `money_out` gates.

### Escalations raised

| Reason | Severity | Trigger | Options |
|---|---|---|---|
| `needs_human` | blocking | No candidate niche can produce a two-source TAM | `proceed_with_labeled_estimates`, `commission_terac_expert`, `skip_to_interviews` |
| `needs_approval` | blocking | Supply swarm finds an incumbent serving the exact wedge at a price we cannot undercut, across ALL niches | `pivot_now` (early → D06), `pick_least_contested`, `abandon` |
| `needs_budget` | degrading | Envelope exhausted with <3 dossiers complete | Treasury tops up or Head signs `partial` with the finished subset |
| `needs_capability` | informational | A niche's evidence lives behind a paywall/API we lack | logged as CapabilityGap input for D13 |

**The honest one:** if every niche ranks below composite 1.2, the Head does not pick the
least-bad option silently. It raises `needs_approval` with summary "the market evidence is
weak everywhere — here is the least-weak option and why we distrust it." Same principle as
D02's no-business escalation: a research department that always finds a market is a
yes-machine with citations.

---

## 9. Failure Modes & Fallbacks

| Failure | Detection | Fallback | Quality |
|---|---|---|---|
| Hallucinated competitor | Critic spot-fetch 404s | strip entry, re-run supply swarm once with stricter citation instruction | `signed` |
| TAM sources disagree >3× | Head reconciliation check | investigate inputs; if unresolvable, report the spread as the range with both derivations, cap confidence 0.5 | `signed` |
| Apify actor fails / rate-limited | tool error | swarms degrade to `web_search`+`web_fetch`; review-count claims drop their denominators and confidence | `signed` |
| Only stated-intent WTP found | Head merge check | pricing_hypothesis confidence ≤0.4; WMBT "will they pay $X" explicitly handed to D04 as untested | `signed` |
| Fewer than 3 viable niches | niche swarm + cull | ship what exists with `gaps: ['niche space thinner than expected']` | `partial` |
| Budget exhausted mid-fan-out | meter at hard cap | finish money swarm for the top-2 niches (money fields are mandatory), drop demand texture for the rest | `partial` |
| Memory prior is stale/wrong | re-verification fetch contradicts stored figure | supersede the memory chunk, use fresh figure, write a correction lesson | `signed` |
| Every dossier scores <1.2 | ranking output | honest escalation (§8), never silent selection | `contested` if founder proceeds |

---

## 10. Definition of Done & Critic Rubric

**Done when all are true:**

- [ ] 3–5 signed `NicheDossier` artifacts, Zod-valid, ranked with distinct slices.
- [ ] Every `tam`/`sam`/`som`/`mrr_12mo`/`price_point` has ≥2 independent sources or is
      labeled `estimated` with confidence ≤0.5.
- [ ] TAM derived both top-down and bottom-up per dossier, reconciled, derivations recorded.
- [ ] `pricing_hypothesis` positioned against ≥3 anchor comparables with verbatim prices.
- [ ] Every competitor has a resolving URL and an evidenced weakness.
- [ ] Bear/base/bull `RevenueScenario` computed via `calc`, assumption deltas stated.
- [ ] `NicheRanking` scores justified per-dimension; composite recomputed clean by Critic.
- [ ] Every D03-assigned WMBT answered or explicitly in `gaps[]`.
- [ ] Sources snapshotted; `artifact_sources` rows link every money field by json_pointer.
- [ ] Research memory written: department excerpts, venture summary, ≥1 global lesson.
- [ ] `niche_selection` gate opened with the compressed card.

**Critic rubric:** §5.6. Pass ≥13/18 with `Evidence` = 3 and `Math integrity` ≥2.

---

## 11. Demo Notes

| Demo t | On screen | Beat |
|---|---|---|
| **1:00–1:10** | Market Research room: three swarm lanes streaming findings; source chips accumulating on the right with tier badges | Parallelism + provenance density — this is research you can audit, not a paragraph |
| **1:10–1:20** | A dossier card assembles live: TAM funnel fills, MRR sparklines draw, price ladder slots our hypothesis between two real competitors | "Every number has a hover" — hover one TAM figure and the derivation + two sources pop |
| **1:20–1:30** | The Critic rejects a dossier on camera: red defect chip *"competitor URL does not resolve — hallucinated competitor, P0"*; supply swarm re-runs; entry vanishes | The un-fakeable beat: the system catching its own hallucination is worth more than any clean output |
| **1:30–1:40** | `niche_selection` swipe card on the mirrored phone: three niches, founder swipes one, WorkOrder sprite exits toward D04/D05 with the chosen slice | Judgment handed to the human at exactly the right altitude |

Fallback: `?replay=demo-1` includes a seeded run where the hallucinated-competitor rejection
fires deterministically.

---

## 12. Cost Estimate

One run, 3 niches surviving the cull, ~4 min wall clock:

| Item | Qty | Cost |
|---|---|---|
| `market.head` (opus) — decompose, merge, math, rank, sign | ~110k in / 12k out | $0.85 |
| `market.niche` (sonnet) ×2 | ~45k each | $0.28 |
| `market.demand` (sonnet) ×3, ~8 searches each | ~55k each | $0.50 |
| `market.supply` (sonnet) ×3, ~8 searches each | ~55k each | $0.50 |
| `market.money` (sonnet) ×2 + calc calls | ~65k each | $0.40 |
| `market.critic` (sonnet) — 1 pass + 0.4 avg revision + 6 spot-fetches | ~38k | $0.14 |
| Apify actor runs (reviews ×3, jobs ×2, directory ×1) | 6 runs | $0.30 |
| Sandbox (Superserve) — 240s active × 2 vCPU | | $0.03 |
| **Total** | | **≈ $3.00** |

Envelope `$4.00`; hard cap `$8.00` absorbs one full supply-swarm re-run plus a second
critic pass and an extra Apify batch. All figures are estimates.

---

## Assumptions & open questions

- **A1.** Census CBP / NAICS granularity is assumed sufficient for org counts in most B2B
  slices; consumer-facing niches will lean harder on T3 figures with lower confidence.
- **A2.** The fixed ranking weights (0.25/0.20/0.20/0.15/0.10/0.10) are a founding-team
  judgment call, not empirically derived. Changing them is a schema version bump so old
  dossiers stay comparable.
- **A3.** `capture_rate_3yr ≤ 0.05` default is conservative for hackathon-scale wedges;
  marketplace-fee models may warrant a different prior. Open.
- **A4.** Apify actor availability for G2/Capterra at demo time is unverified; the fallback
  path (plain web_fetch of review pages) loses the denominator counts.
- **A5.** Whether the `niche_selection` gate should also offer "fund a second research pass
  on niche X" as a card option, instead of forcing select-or-timeout — leaning yes,
  POST-MVP.
- **Q1.** Should D05's synthetic panel run *before* niche selection to add an ICP-sizing
  signal to the ranking, at the cost of serializing two departments? Currently they run in
  parallel and the panel informs D06 instead.
- **Q2.** Do we cap total dossier count at 5 even when the niche swarm finds 7 strong
  slices, or allow the Head to request a budget extension? Currently: cap at 5, extras
  recorded as memory lessons.
- **Q3.** Institutional-memory staleness: 12 months is the current re-verification
  threshold for cached market figures. Fast-moving categories (AI tooling) probably need 3.

---

**Previous:** [`D02-office-hours.md`](D02-office-hours.md) · **Next:** [`D04-outreach-validation.md`](D04-outreach-validation.md)
