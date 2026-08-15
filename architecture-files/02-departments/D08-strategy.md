# D08 — Strategy

**Cluster:** go-to-market · **Head:** `strategy.head` · **Critic:** `strategy.critic` · **Resident:** no (re-runs on `ProductSignal` clusters and monthly)

---

## 1. Mission

> Read the entire venture history — office hours, market research, every interview claim, and the feature set that actually shipped — and produce the one document Sales executes against.

**The single question it answers:** *"Who do we sell this to, at what price, through which channel, and what do we say?"*

D08 is the only department that reads *everything*. Its distinguishing property is that it is
grounded in what was **actually built** (D07's `Deployment`), not what was hoped for. A GTM plan that
promises a feature that got descoped is a P0 defect here.

---

## 2. Inputs / Outputs

### Inputs

| Artifact | From | Why it's needed |
|---|---|---|
| `SharpenedIdea` | D02 | The original wedge, kill criteria, and the founder's own framing |
| `NicheDossier` (selected + rejected) | D03 | TAM/SAM/SOM, competitor pricing, CAC priors by category. Rejected niches matter: they define who we are *not* for |
| `ClaimLedger` + `Interview[]` | D04 | Verbatim language. Positioning is written in customers' words or it isn't positioning |
| `SyntheticPanelResult` | D05 | Willingness-to-pay curve by archetype, population-weighted |
| `ProductSpec v2` | D06 | Promised scope |
| `Deployment` | D07 | **Shipped** scope. Any delta vs ProductSpec is a messaging constraint |
| `ObjectionRecord[]` | D10 | On re-runs: what actually killed deals |
| `ProductSignal[]` | D12 | On re-runs: what customers complain about |

### Output — `GTMPlan`

```ts
export const GTMPlan = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  version: z.number().int(),
  based_on: z.object({ product_spec_version: z.number().int(), deployment_id: z.string().uuid() }),

  positioning: z.object({
    statement: z.string(),                 // the strict template, see §6
    category: z.string(),                  // the category we compete in, named
    alternative: z.string(),               // what they do TODAY (usually a spreadsheet, not a competitor)
    differentiator: z.string(),
    proof: z.array(z.object({ claim: z.string(), evidence_ref: z.string() })).min(1),
    anti_positioning: z.array(z.string()), // "not for hospitals over 500 beds"
  }),

  icp_tiers: z.array(z.object({
    tier: z.enum(['T1','T2','T3']),
    label: z.string(),
    firmographics: z.record(z.union([z.string(), z.array(z.string())])),  // size, industry, geo, stack
    trigger_events: z.array(z.string()),   // what makes them buy NOW
    disqualifiers: z.array(z.string()),
    estimated_accounts: z.number().int(),
    evidence_refs: z.array(z.string()),
    expected_acv_usd: z.number(),
    expected_close_rate: z.number(),       // 0–1
  })).min(2),

  channels: z.array(z.object({
    id: z.string(),                        // 'warm_interview_list'
    name: z.string(),
    tier_fit: z.array(z.enum(['T1','T2','T3'])),
    reach: z.number().int(),               // addressable per 30 days
    expected_reply_rate: z.number(),
    expected_meeting_rate: z.number(),
    expected_close_rate: z.number(),
    cost_per_1k_touches_usd: z.number(),
    expected_cac_usd: z.number(),          // MUST show its arithmetic in `cac_math`
    cac_math: z.string(),                  // human-readable formula with the numbers substituted
    payback_months: z.number(),
    confidence: z.enum(['high','medium','low']),
    score: z.number(),                     // §7 scoring model
    rank: z.number().int(),
    first_action: z.string(),              // exactly what D09/D10 must do first
  })).min(3),

  pricing: z.object({
    model: z.enum(['free','one_time','subscription','usage','hybrid']),
    tiers: z.array(z.object({
      name: z.string(), price_usd: z.number(), interval: z.enum(['once','month','year']),
      includes: z.array(z.string()), excludes: z.array(z.string()),
      target_icp_tier: z.enum(['T1','T2','T3']),
      rationale: z.string(), evidence_refs: z.array(z.string()),
    })).min(1),
    anchor_tier: z.string(),
    expansion_path: z.string(),
    discount_policy: z.object({ max_pct: z.number(), who_may_approve: z.string(), triggers: z.array(z.string()) }),
    rail: z.enum(['stripe','whop','dodo']),      // decided here, executed by D07/D10/D11
    rail_rationale: z.string(),
  }),

  objection_matrix: z.array(z.object({
    id: z.string(),                        // 'OBJ-price'
    objection: z.string(),
    frequency_prior: z.enum(['high','medium','low']),
    root_cause: z.enum(['price','trust','timing','authority','fit','status_quo','security','integration']),
    response: z.string(),
    proof_to_attach: z.string(),
    escalate_if: z.string(),
    source: z.enum(['predicted','observed']),
    observed_count: z.number().int().default(0),
  })).min(6),

  messaging_matrix: z.array(z.object({
    persona: z.string(),                   // 'charge nurse', 'unit manager', 'CFO'
    role_in_deal: z.enum(['user','champion','economic_buyer','blocker','influencer']),
    pain_in_their_words: z.string(),       // verbatim from ClaimLedger, quoted
    quote_ref: z.string(),                 // claim_id
    value_prop: z.string(),
    proof_point: z.string(),
    cta: z.string(),
    banned_words: z.array(z.string()),     // words this persona reacts badly to
    subject_lines: z.array(z.string()).min(3),
  })).min(3),

  plan_90d: z.array(z.object({
    window: z.enum(['d0_14','d15_30','d31_60','d61_90']),
    objective: z.string(),
    kpi: z.object({ metric: z.string(), target: z.number(), unit: z.string() }),
    owner_department: z.string(),          // 'D09' | 'D10' | 'D07'
    actions: z.array(z.string()),
    kill_criteria: z.string(),             // what makes us abandon this window's bet
  })).length(4),

  scope_delta_warnings: z.array(z.string()),   // promised-but-not-shipped: Sales may not claim these
  confidence: z.enum(['high','medium','low']),
  sources: z.array(z.string()),
});
```

---

## 3. `DepartmentManifest`

```yaml
# packages/manifests/D08-strategy.yaml
id: D08
name: Strategy
cluster: gtm
head:
  agent_id: strategy.head
  model: opus
  system_prompt_ref: prompts/D08/head.md
  max_tokens_per_run: 140000
critic:
  agent_id: strategy.critic
  model: sonnet
  rubric_ref: prompts/D08/critic-rubric.md
  max_tokens_per_run: 35000
workers:
  - agent_id: strategy.positioning
    model: opus                      # judgment-heavy, single replica, worth the tier
    replicas: 1
    system_prompt_ref: prompts/D08/positioning.md
    tools: [memory.read, artifact.read, calc]
    max_tokens_per_run: 70000
  - agent_id: strategy.pricing
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D08/pricing.md
    tools: [memory.read, artifact.read, web_search, web_fetch, solari.browse, calc]
    max_tokens_per_run: 60000
  - agent_id: strategy.channel
    model: sonnet
    replicas: 2                      # one B2B-lens, one B2C/community-lens
    system_prompt_ref: prompts/D08/channel.md
    tools: [memory.read, artifact.read, web_search, web_fetch, apify.run_actor, calc]
    max_tokens_per_run: 55000
  - agent_id: strategy.messaging
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D08/messaging.md
    tools: [memory.read, artifact.read]
    max_tokens_per_run: 60000
concurrency: 5
budget:
  default_envelope_usd: 3.00
  hard_cap_usd: 5.00
  degrade_at_pct: 80
io:
  input: [ProductSpec, Deployment, ClaimLedger, NicheDossier, SyntheticPanelResult]
  output: GTMPlan
  min_outputs: 1
gates:
  - id: public_positioning
    trigger: before positioning copy is used on any public surface (Lovable site, Whop listing)
    autonomy: [copilot, supervised]
  - id: pricing_approval
    trigger: before pricing is written to Stripe/Whop/Dodo products
    autonomy: [copilot, supervised]     # money-adjacent; auto-approves only at 'autonomous'
sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 4096
  pause_between_cycles: true
  egress_allowlist: [api.anthropic.com, api.apify.com, "*.g2.com", "*.capterra.com", search]
sla:
  soft_deadline_s: 300
  on_timeout: return_partial
```

---

## 4. Agent roster

| Agent | Role | Model | Tools | Tokens |
|---|---|---|---|---|
| `strategy.head` | Reads full venture history, briefs workers with different slices, merges, resolves contradictions, writes the 90-day plan itself | opus | artifact.read, memory.read, calc | 140k |
| `strategy.positioning` | Positioning statement, category, anti-positioning, proof chain | opus | artifact.read, memory.read | 70k |
| `strategy.pricing` | Packaging, tiers, WTP curve, discount policy, payment rail | sonnet | + web_search, solari.browse (competitor pricing pages), calc | 60k |
| `strategy.channel` ×2 | Enumerate and score channels; replica A = B2B outbound/partnership lens, replica B = community/content/marketplace lens | sonnet | + apify, web_search, calc | 55k each |
| `strategy.messaging` | Per-persona matrix, subject lines, banned words, verbatim quote sourcing | sonnet | artifact.read (ClaimLedger) | 60k |
| `strategy.critic` | Rubric review, especially evidence and the shipped-vs-promised delta | sonnet | artifact.read | 35k |

---

## 5. System prompts

### `prompts/D08/head.md`

```
You are the Head of Strategy for an autonomous company. You have read more about this venture than
any human ever will: the office hours transcript, every market dossier we rejected and the one we
chose, every word of every customer interview, the synthetic population panel, and the actual
deployed feature set.

Your output is the GTMPlan. Sales executes it literally, so vagueness here becomes wasted money
three departments downstream.

METHOD:
1. FIRST compute the scope delta: ProductSpec v2 features vs Deployment features actually live and
   QA-green. Anything promised and not shipped goes into scope_delta_warnings and MAY NOT appear in
   positioning, pricing tiers, or messaging. We do not sell vapor. This step is non-negotiable and
   comes before you brief anyone.
2. Brief four workers with DIFFERENT slices, not the same context:
   - positioning: SharpenedIdea + ClaimLedger themes + competitor set + shipped features
   - pricing:     SyntheticPanelResult WTP + competitor pricing + ClaimLedger budget claims + NicheDossier ACV priors
   - channel A:   NicheDossier (B2B lens) + trigger events + warm interview list size
   - channel B:   NicheDossier (community/consumer lens) + Whop viability + content surfaces
   - messaging:   ClaimLedger verbatims, grouped by speaker role
3. MERGE and RESOLVE. Contradictions are the point of having four workers. Where pricing says
   $99/mo and the panel says the median archetype pays $29, you do not average — you decide, and you
   write the decision and the loser's argument into the artifact.
4. WRITE THE 90-DAY PLAN YOURSELF. It has four windows, each with one objective, one numeric KPI,
   one owning department, and an explicit kill criterion. A window without a kill criterion is a
   wish.
5. RANK CHANNELS by the scoring model in your context. Top-ranked channel's `first_action` must be
   something D09 or D10 can execute today without asking a question.

HARD RULES:
- Every number in the artifact carries an evidence_ref or is labelled `assumption` with the prior
  it came from. Uncited numbers are blocked at artifact signing (platform invariant 3).
- The warm list from D04 is ALWAYS a channel and is almost always rank 1. People who helped shape
  the product convert. Do not be clever and bury it.
- Never propose a channel we cannot run: every channel must map to a tool the company actually has
  (Composio/Gmail, Linq, ElevenLabs voice, Whop, content on the Lovable site).
- If confidence is low, say low. A low-confidence plan with a cheap first test beats a confident
  plan with no test.
```

### `prompts/D08/positioning.md`

```
You write the positioning. One statement, and it must fit this template exactly:

  For [ICP tier 1, specifically] who [trigger situation, in their words],
  <PRODUCT> is a [category] that [core capability that actually shipped].
  Unlike [the alternative they use TODAY], we [differentiator],
  which matters because [consequence in their words, with a quote].

RULES:
1. "The alternative" is almost never a competitor. It is a spreadsheet, a group chat, a Sunday
   night, an intern. Read the ClaimLedger for what people ACTUALLY do today and name that.
2. Every clause must be defensible with a claim_id or a dossier source_id. Attach them in `proof`.
3. The category must be one the buyer already has a budget line for, or you must explain how they
   get budget. Inventing a category is a 12-month project; we have 90 days.
4. Write anti-positioning: at least three explicit "not for" statements. A product for everyone
   converts nobody, and Sales needs disqualifiers.
5. Banned: "AI-powered", "revolutionary", "seamless", "next-generation", "game-changing",
   "leverage", "empower", "platform" (unless it literally is one). If you cannot say what it does
   without those words, you do not understand it yet — go back to the interviews.
6. Test your statement against three real interview subjects by name: would this sentence make
   THEM lean in? Write that check into `proof`.
```

### `prompts/D08/pricing.md`

```
You set price and packaging. Price is a positioning decision, not a math decision — but you must
show the math anyway.

INPUTS: SyntheticPanelResult (population-weighted willingness-to-pay by archetype), ClaimLedger
budget claims ("we pay $400/mo for X today"), competitor pricing pages (fetch them — do not
remember them), NicheDossier ACV priors.

PROCEDURE:
1. Build the WTP table: archetype -> population weight -> p50 and p75 willingness to pay. Report it.
2. Find the VALUE ANCHOR: what does the pain cost them today, in dollars or hours×wage? Quote the
   interview. Price is a fraction of that, never a multiple of your costs.
3. Choose the metric before the number. What does the customer buy one more of? (seats, shifts,
   locations, messages). The metric must be something they can predict; unpredictable metrics kill
   B2B deals.
4. Three tiers maximum. Name the anchor tier — the one you actually want sold — and make it the
   middle one. The top tier exists to make the middle one reasonable; the bottom exists to remove
   the "too expensive to try" objection, not to make money.
5. Every tier's `includes` must be features that are LIVE in the Deployment. Check the scope delta.
6. Payment rail: stripe (US/EU, direct) | whop (consumer/community, where the storefront IS the
   channel) | dodo (international, merchant-of-record needed). Justify in rail_rationale.
7. Discount policy: max %, who approves, and the two or three triggers where a discount is allowed
   (annual prepay, design partner, logo rights). Sales will otherwise invent one.

Output the reasoning, not just the number. If the panel and the interviews disagree on price, say
so and pick the interviews — real money beats simulated money, and say that in the rationale.
```

### `prompts/D08/channel.md`

```
You enumerate and score acquisition channels. Replica A takes the B2B/outbound/partnership lens;
replica B takes the community/content/marketplace/consumer lens. Both score with the SAME model.

FOR EACH CHANNEL, produce every field, and produce cac_math as a literal string a human can check:

  expected_cac = cost_per_1k_touches / (1000 * reply_rate * meeting_rate * close_rate)

Example you must imitate in form:
  "warm_interview_list: $0.90 / (1000 * 0.62 * 0.55 * 0.35) = $0.90 / 119.35 = $0.0075... "
  -- and when the arithmetic produces an absurd number, SAY SO and add the real cost driver
  (agent time, voice minutes) rather than shipping a fake $0.01 CAC.

RULES:
1. Rates must be sourced: NicheDossier category priors, D04's actual observed reply rate on the
   warm list, or a stated industry benchmark with a URL. Never invent a conversion rate silently.
2. Score channels using the model in your context. Report score AND rank AND confidence.
3. Every channel needs a `first_action` that D09 or D10 can execute with tools we have. "Do SEO" is
   not a first action. "Publish 6 comparison pages on the Lovable site targeting '<competitor>
   alternative' " is.
4. Include at least one channel with a 7-day proof cycle. We need a signal fast, not a strategy
   that pays off in month 9.
5. Explicitly enumerate channels you REJECTED and why (cost, compliance, no tooling, too slow).
   Sales will ask.
```

### `prompts/D08/messaging.md`

```
You build the messaging matrix. Every row is a persona; every cell must be defensible.

RULES:
1. `pain_in_their_words` is a VERBATIM quote from the ClaimLedger with its claim_id. Not a
   paraphrase. Not a synthesis. If no interview covers a persona, mark that row
   source:'assumption' and flag it to the Head — a persona we never talked to is a risk, not a row.
2. Value prop must be one sentence, in second person, containing a number where one exists.
3. Proof point: a live product capability, a named customer behaviour from an interview, or a
   number from the dossier. Never a testimonial we do not have.
4. Subject lines: three per persona, under 42 characters, no colons, no emoji, lowercase is fine.
   At least one must reference the person's own situation rather than the product.
5. Banned words per persona: derive from the interviews. Nurses hate "workforce optimization".
   Founders hate "solution". Write down what each persona actually flinched at.
6. Map each persona to role_in_deal. Sales sequences differently for a champion than an economic
   buyer, and D10 reads this field literally.
```

### `prompts/D08/critic-rubric.md`

```
Reject the GTMPlan on any of these:
1. Any number without an evidence_ref or an explicit `assumption` label.
2. A pricing tier or messaging claim referencing a feature in scope_delta_warnings (selling vapor).
3. A channel whose expected_cac is stated without cac_math, or whose cac_math does not evaluate to
   the stated number. Recompute every one.
4. Fewer than 3 channels scored, fewer than 2 ICP tiers, fewer than 6 objections, fewer than 3
   personas.
5. The warm interview list (D04) is absent from channels, or ranked below a cold channel without an
   explicit written reason.
6. A 90-day window with no numeric KPI or no kill criterion.
7. Positioning containing any banned word, or whose "alternative" is a competitor when the
   ClaimLedger clearly shows people use a spreadsheet.
8. A channel with no `first_action`, or a first_action requiring a tool the company does not have.
9. Confidence stated as high while >40% of underlying claims have strength 'weak'.
Output {verdict, defects:[{code, where, why, minimal_fix}]}.
```

---

## 6. Execution flow

```
 ArtifactReady(Deployment)  +  ProductSpec v2 already signed
             │
             ▼
   ┌─────────────────────┐
   │ strategy.head (opus)│  load EVERYTHING: SharpenedIdea, all NicheDossiers,
   │                     │  ClaimLedger, Interview[], SyntheticPanelResult,
   │                     │  ProductSpec v2, Deployment
   └──────────┬──────────┘
              │  STEP 0 — SCOPE DELTA
              │  ProductSpec.features ∩ Deployment.qa.passed  ⇒ sellable[]
              │  ProductSpec.features \ sellable              ⇒ scope_delta_warnings[]
              │
   ┌──────────┴────────────┬──────────────┬───────────────┬──────────────┐
   ▼                       ▼              ▼               ▼              ▼
positioning(opus)     pricing(sonnet)  channel-A      channel-B     messaging
 template + proof      WTP table        B2B lens      community      verbatim
 anti-positioning      value anchor     score+rank     lens          matrix
 3 named testers       3 tiers, rail    cac_math       Whop/content  subject lines
   │                       │              │               │              │
   └──────────┬────────────┴──────────────┴───────────────┴──────────────┘
              ▼
   ┌─────────────────────┐   contradiction resolution (documented, not averaged)
   │ strategy.head merge │   channel dedup + global re-rank
   │                     │   HEAD WRITES plan_90d itself
   └──────────┬──────────┘
              ▼
   ┌─────────────────────┐  8-point rubric; recomputes every cac_math
   │ strategy.critic     │  ≤1 revision loop
   └──────────┬──────────┘
              ▼
        GATE pricing_approval ──► Linq card: 3 tiers + rationale + [Approve][Change price][Ask]
        GATE public_positioning ─► only when copy hits Lovable site / Whop listing
              ▼
        GTMPlan signed ──► ArtifactReady
              ├──► D09  (icp_tiers + channels.first_action  ⇒ lead list construction)
              ├──► D10  (messaging_matrix + objection_matrix + pricing ⇒ sequences)
              ├──► D07  (pricing ⇒ Stripe/Whop product objects; positioning ⇒ Lovable copy)
              └──► D11  (pricing.rail ⇒ which rail Treasury reconciles)
```

**Re-run trigger:** `sales.deal_lost(count>=3, same reason_cluster)` or monthly cron. On re-run the
Head loads `ObjectionRecord[]` and flips matching `objection_matrix` rows from `predicted` to
`observed` with counts — the plan learns from the field. Version increments; old version superseded,
never deleted.

---

## 7. The channel scoring model

Every channel gets one score. The formula is fixed so two runs are comparable.

```
score = 100
      × W_econ  × econ
      × W_speed × speed
      × W_fit   × fit
      × W_conf  × confidence_factor
      × feasibility            (0 or 1 — hard gate)

econ              = clamp( ln(expected_acv / expected_cac) / ln(20), 0, 1 )
                    # LTV:CAC of 20 = 1.0; of 3 ≈ 0.37; below 1 → 0
speed             = 1 / (1 + weeks_to_first_signal / 4)
fit               = fraction of T1 accounts reachable through this channel (0–1)
confidence_factor = {high:1.0, medium:0.75, low:0.5}
feasibility       = 1 if (tool exists) AND (compliance-clean per D09 checklist) else 0

W_econ=0.40  W_speed=0.25  W_fit=0.25  W_conf=0.10     (weights sum to 1; multiply by 4 to normalize)
```

Worked, for ShiftSwap (nurse shift-swapping, T1 = 50–200 bed hospitals, ACV $3,480/yr):

| Channel | reach/30d | reply | mtg | close | $/1k | expected CAC | cac_math | weeks | fit | conf | **score** | rank |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Warm interview list (D04)** | 38 | 0.62 | 0.55 | 0.35 | $14 | **$117** | `14/(1000×0.62×0.55×0.35)` = 14/119.4 per 1k → ×1000/38 reach-adjusted = $117 | 0.5 | 0.9 | high | **89** | 1 |
| Cold email, unit managers (Composio/Gmail) | 2,400 | 0.07 | 0.28 | 0.18 | $22 | **$623** | `22/(1000×0.07×0.28×0.18)` = 22/3.53 = $6.23/lead ×100 | 2 | 0.8 | medium | 61 | 2 |
| Linq iMessage to opted-in nurses | 310 | 0.31 | 0.40 | 0.22 | $46 | **$1,686** | `46/(1000×0.31×0.40×0.22)` = 46/27.3 | 1 | 0.5 | low | 44 | 3 |
| Nurse-manager Facebook/Reddit communities (content) | 9,000 impr | 0.009 | 0.35 | 0.15 | $9 | **$1,905** | `9/(1000×0.009×0.35×0.15)` = 9/0.47 | 6 | 0.6 | medium | 38 | 4 |
| Staffing-agency partnership | 12 accts | 0.25 | 0.66 | 0.30 | $180 | **$3,636** | `180/(1000×0.25×0.66×0.30)` = 180/49.5 | 10 | 0.95 | low | 31 | 5 |
| Paid search "shift swap software" | 900 clicks | — | 0.06 | 0.20 | $3,100 | **$258k**→infeasible | volume too thin, CPC $3.44 | 2 | 0.4 | low | **0** (feasibility) | — |

Rejected and why: LinkedIn Ads (no budget authority, CPM > CAC target), conferences (no physical
presence — would need a Terac human, filed as a future `HumanWorkRequisition` idea), SEO from scratch
(>16 weeks to first signal, fails the 7-day-proof requirement as a *primary* bet; kept as a d31_60
background action on the Lovable site).

---

## 8. Worked pricing example — ShiftSwap

**Step 1 — WTP from `SyntheticPanelResult`** (post-stratified on ACS PUMS, question: *"Would your
unit pay $X/month for a tool that lets nurses swap shifts without the charge nurse rebuilding the
roster?"*)

| Archetype | Pop. weight | p50 WTP/unit/mo | p75 |
|---|---|---|---|
| A3 — mid-size hospital, 40–80 nurses/unit | 0.29 | $210 | $340 |
| A5 — large system unit, 80+ | 0.18 | $390 | $610 |
| A7 — small rural, <25 | 0.22 | $70 | $120 |
| A9 — staffing-agency-heavy unit | 0.11 | $280 | $455 |
| others | 0.20 | $95 | $160 |
| **Weighted p50** | | **$189** | |

**Step 2 — value anchor from `ClaimLedger`**
> CL-114, Maria R., charge nurse, 2026-03-03: *"Sunday night is four hours of my life every week
> rebuilding the roster, and I'm not paid for three of them."*
> CL-131, unit manager: *"An unfilled shift goes to agency at 2.1× our internal rate — that's about
> $840 for one twelve."*

Anchor: 4 hrs/wk × $48/hr loaded = **$832/mo of charge-nurse time**, plus one avoided agency shift
per month ≈ **$440 net**. Total pain ≈ **$1,272/unit/mo**. Price at ~15% of value captured.

**Step 3 — metric.** Per **unit**, not per seat. Interviews (CL-140, CL-152) show seat counts churn
weekly and nobody can predict them; units don't. Predictability beats revenue-maximization here.

**Step 4 — tiers.**

| Tier | Price | Includes (all live in `Deployment`) | Excludes | Target | Rationale |
|---|---|---|---|---|---|
| Unit | **$149**/unit/mo | shift posting, browse, swap request + approval, email notify | analytics, SSO, multi-unit roll-up | T2 (small/rural, A7) | Under A7's p50 of $70? No — deliberately above; A7 is a T2 land-grab tier, sold annually at $1,490 to clear the bar |
| **Unit Pro** *(anchor)* | **$289**/unit/mo | + swap-rule policy engine, overtime guardrails, export, audit log | SSO, API | **T1 (A3, A5)** | 23% of A3's p50 WTP ($210)? No — $289 sits between A3 p50 $210 and p75 $340. Prices at the p65. Interviews beat the panel: two A3 managers said they already pay $400+/mo for scheduling software (CL-118, CL-127) |
| System | **$1,900**/mo, 10 units incl. | + multi-unit roll-up, SSO, API, priority support | — | T1 upmarket (A5) | Anchors Pro. Sells rarely; makes $289 read as cheap |

**Anchor tier:** Unit Pro. **Expansion path:** unit → adjacent units in the same hospital →
System. **Discount policy:** max 20%, approved by `strategy.head` only, triggers = annual prepay
(15%), design partner with logo rights (20%), 3+ units at once (10%). Sales may not stack.

**Rail:** `stripe` — US-only B2B, invoices needed, subscription with net-30 for System tier.
(`whop` rejected: buyers are hospital administrators with POs, not a community. `dodo` unused at
`geography=us`.)

**Where panel and interviews disagreed:** panel weighted-p50 = $189; interviews said $400+ is
already being paid. We priced to the interviews ($289) and recorded the panel's dissent —
real money beats simulated money, and if close rate at $289 lands under 20% the d15_30 kill
criterion fires a repricing test at $199.

---

## 9. Integrations

| Sponsor / tool | Use |
|---|---|
| **Solari (Pinetree)** | `strategy.pricing` fetches live competitor pricing pages that are JS-rendered or gated behind a "request a demo" wall |
| **Apify** | `strategy.channel` measures community surface size (subreddit/forum member counts, post velocity) to fill `reach` honestly |
| **Whop** | Channel B evaluates the Whop marketplace as an acquisition surface, not just a billing rail — for consumer/community ventures the storefront is a *channel* with its own discovery |
| **Stripe / Dodo** | `pricing.rail` decision; D07 materializes the Products/Prices, D11 reconciles against the chosen rail |
| **Lovable** | Positioning + tier table become the marketing site copy (gated by `public_positioning`) |
| **Linq** | Pricing approval card to the founder — three tiers, one tap |
| **Band** | Publishes `GTMPlan` into the `market↔pivot` room so D06 sees the strategy constraints; joins `sales↔finance` read-only to observe discount pressure |
| **Pioneer (Fastino)** | Not used at first run. Once D10 has ≥500 labelled objections, the objection classifier that feeds `objection_matrix.observed_count` runs on the fine-tuned model |

---

## 10. Gates & escalations

| Gate | When | Auto at `autonomous` |
|---|---|---|
| `pricing_approval` | Before prices are written to Stripe/Whop/Dodo | yes (money-out is still separately gated in D11) |
| `public_positioning` | Before copy appears on the Lovable site or Whop listing | yes |

| Escalation | Reason | Trigger |
|---|---|---|
| No sellable feature set | `needs_capability` | scope delta leaves zero p0 features live → back to D07, plan blocked |
| Contradictory evidence, cannot pick a price | `needs_human` | Panel and interviews differ >3× and both are high-strength → founder card with both options |
| Every channel scores feasibility 0 | `needs_capability` | Company lacks the tool for every viable channel → D13 `CapabilityGap` |
| Compliance blocks the top channel | `needs_human` | e.g. outbound to a regulated population → D09 compliance + founder |
| Need a domain expert to validate pricing in a regulated market | `needs_human` | low confidence + high ACV → D11/HR files a **Terac** requisition for an expert review |

---

## 11. Failure modes & fallbacks

| Failure | Detection | Fallback |
|---|---|---|
| Thin `ClaimLedger` (<5 interviews) | Head, at load | Lean on `SyntheticPanelResult` for pricing, mark `confidence:'low'`, and set the d0_14 objective to "get 10 more interviews" rather than "sell" |
| Competitor pricing pages unfetchable | pricing worker tool errors | Use NicheDossier ACV priors; mark those rows `assumption`; never invent a competitor price |
| Channel worker returns absurd CAC (< $1) | Critic recomputation | Force inclusion of agent-time and voice-minute costs from the Budget Meter, recompute |
| Both channel replicas converge on the same 3 channels | Head merge | Head forces replica B to produce 3 additional channels outside replica A's set before merging |
| GTMPlan promises unshipped features | Critic rule 2 | Automatic revise; Head rewrites tiers from `sellable[]` only |
| Budget degraded >80% | Meter | Drop to 1 channel replica (B2B lens only), messaging matrix limited to 3 personas, positioning stays on opus — it is the one thing worth the tokens |
| Re-run oscillation (price changes every cycle) | Head, comparing versions | Pricing may change at most once per 30 days unless close-rate kill criterion fired. Recorded as a rule, enforced by the Critic |

---

## 12. Definition of Done

1. `scope_delta_warnings` computed from the actual `Deployment`, and no tier/message references a warned feature.
2. ≥2 ICP tiers with firmographics, trigger events, disqualifiers, and estimated account counts.
3. ≥3 channels, each with `cac_math` that evaluates correctly, a rank, a confidence, and a `first_action` executable with existing tooling.
4. Warm interview list present as a channel with a stated rank.
5. Pricing: ≥1 tier, an anchor named, a metric justified, a discount policy, and a rail with rationale.
6. ≥6 objections with root-cause classification and an attached proof.
7. ≥3 personas, each with a verbatim `pain_in_their_words` + `quote_ref`, and 3 subject lines.
8. Exactly 4 `plan_90d` windows, each with a numeric KPI, an owning department, and a kill criterion.
9. Every number cited or explicitly labelled `assumption`.
10. Critic verdict `accept` (or one revision exhausted → `contested`).

**Critic rubric:** §5 `critic-rubric.md`, 9 checks, any hit ⇒ revise.

---

## 13. Demo notes

D08 is not a headline beat — it is the **connective tissue** shown for ~8 seconds between Build
(2:55) and Sales, and again inside the Sales beat when an email visibly uses a `messaging_matrix`
row.

| t | On screen | Line |
|---|---|---|
| ~2:56 | Strategy room; a single card flips open: the positioning statement in the template, with three clickable evidence chips (claim ids) | "It wrote positioning out of the actual interviews." |
| ~2:58 | The channel table renders with `cac_math` visible as text under each row. Warm list is rank 1, highlighted. | "It ranked channels by CAC — and showed the arithmetic." |
| 3:00 | Cursor hovers a Sales email; a tooltip shows *"messaging_matrix / persona: charge nurse / quote CL-114"* — the email's first line is that quote. | "This is why the email is not cold." |

Kept deliberately short. Judges reward *visible reasoning*, and the two artifacts that show it are
`cac_math` and the evidence chip.

---

## 14. Cost estimate — one run

| Line | Model | Volume | USD |
|---|---|---|---|
| Head: full history load + brief + merge + 90-day plan | opus, ~95k in / 14k out | 1 | 1.47 |
| Positioning | opus, ~40k in / 5k out | 1 | 0.58 |
| Pricing (incl. 4 competitor page fetches via Solari) | sonnet, ~48k in / 9k out | 1 | 0.28 |
| Channel ×2 (incl. 3 Apify surface-size runs) | sonnet, ~42k in / 8k out each | 2 | 0.49 |
| Messaging | sonnet, ~50k in / 11k out | 1 | 0.32 |
| Critic (recomputes CAC math) | sonnet, ~28k in / 3k out | 1 | 0.13 |
| Solari sessions | 4 pages | 4 | 0.08 |
| Apify actor runs | 3 | 3 | 0.06 |
| Sandbox | 2 vCPU | ~5 min | 0.03 |
| **Total** | | | **≈ $3.44** (envelope $3.00 → typically runs at `degrade_at_pct`; hard cap $5.00) |

Degraded (>80%): channel drops to 1 replica, messaging to 3 personas ⇒ ≈ **$2.55**.

---

**Cross-links:** [`D03-market-research.md`](D03-market-research.md) ·
[`D04-outreach-validation.md`](D04-outreach-validation.md) ·
[`D05-synthetic-population.md`](D05-synthetic-population.md) ·
[`D06-pivot-decision.md`](D06-pivot-decision.md) · [`D07-build.md`](D07-build.md) ·
[`D09-leads.md`](D09-leads.md) · [`D10-sales.md`](D10-sales.md) ·
[`../01-platform/11-evidence-and-truth.md`](../01-platform/11-evidence-and-truth.md)
