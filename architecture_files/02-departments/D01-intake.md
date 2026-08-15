# D01 — Intake & Origination

Follows [`D00-department-template.md`](D00-department-template.md). Implements
[Scene 0 and Scene 1](../00-vision/02-end-to-end-journey.md).

---

## 1. Mission

Turn whatever the founder brought — or nothing at all — into exactly one normalized, machine-legible
starting point for the company.

> **The single question this department answers:** *what, precisely, are we going to try to build,
> stated in a form the rest of the company can act on?*

Two modes, one output contract:

| Mode | Trigger | Path |
|---|---|---|
| **A — Founder-led** | Founder chose "I have an idea" | parse → normalize → extract → `IdeaSeed` |
| **B — Autonomous origination** | Founder chose "Find me one" | trend swarm → score → select → `IdeaSeed` (with `OpportunityCandidate[]` attached) |

Mode B is the flex, and it is what the demo cold-opens on ([`../00-vision/04-demo-and-judging.md`](../00-vision/04-demo-and-judging.md), t=0:00).

---

## 2. Contract — Inputs & Outputs

### Inputs

| Mode | Input | Notes |
|---|---|---|
| A | `RawSubmission` | text, voice recording, files (pdf/docx/md/txt/png/jpg), links |
| B | *(none)* | plus `venture.constraints` — geography, capital, founder skills, banned categories |

```ts
export const RawSubmission = z.object({
  venture_id: z.string().uuid(),
  text: z.string().max(50_000).optional(),
  voice_asset_ids: z.array(z.string()).default([]),        // object-storage keys, audio/*
  file_asset_ids: z.array(z.string()).default([]),         // pdf|docx|md|txt|png|jpg
  links: z.array(z.string().url()).default([]),
  founder_profile: z.object({
    name: z.string().optional(),
    background: z.string().optional(),                     // free text, or pulled from LinkedIn via Composio
    skills: z.array(z.string()).default([]),
    unfair_advantages: z.array(z.string()).default([]),
    capital_usd: z.number().optional(),
    time_per_week_h: z.number().optional(),
    geography: z.string().optional(),
  }).default({}),
  constraints: z.object({
    banned_categories: z.array(z.string()).default([]),     // 'crypto', 'gambling', 'health claims'
    must_be_b2b: z.boolean().optional(),
    target_geography: z.string().optional(),
  }).default({}),
});
```

### Outputs

```ts
export const IdeaSeed = z.object({
  venture_id: z.string().uuid(),
  origin: z.enum(['founder','autonomous']),
  raw_statement: z.string(),              // the founder's own words, or the selected candidate's thesis
  normalized: z.object({
    problem: z.string(),                  // "X wastes Y hours on Z"
    who_hurts: z.string(),                // best available guess at the sufferer
    current_workaround: z.string().nullable(),
    proposed_solution: z.string(),
    business_model_guess: z.enum(['saas','marketplace','service','consumer_sub','one_time','ads','unknown']),
    category: z.string(),                 // 'vertical saas / construction'
  }),
  extracted_entities: z.object({
    named_companies: z.array(z.string()).default([]),
    named_people: z.array(z.string()).default([]),
    named_tools: z.array(z.string()).default([]),
    numbers_stated: z.array(z.object({ value: z.string(), context: z.string(), source_id: z.string() })).default([]),
  }),
  founder_profile: RawSubmission.shape.founder_profile,
  constraints: RawSubmission.shape.constraints,
  attachments: z.array(z.object({
    asset_id: z.string(),
    kind: z.enum(['voice','pdf','docx','md','image','link']),
    summary: z.string(),                  // 2-4 sentences
    transcript_ref: z.string().optional(),// for voice
    source_id: z.string(),
  })).default([]),
  ambiguities: z.array(z.string()).default([]),   // things D02 must resolve
  candidates: z.array(z.string().uuid()).default([]),  // OpportunityCandidate ids (Mode B)
  selected_candidate_id: z.string().uuid().optional(),
});

export const OpportunityCandidate = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  title: z.string().max(80),              // "Permit-status tracking for small GCs"
  thesis: z.string().max(600),            // why this is a business, in one paragraph
  pain_evidence: z.array(z.object({
    quote: z.string().max(600),           // verbatim from the wild
    where: z.string(),                    // 'r/Construction', 'G2 review of Procore'
    when: z.string().datetime(),
    intensity: z.enum(['annoyance','costly','existential']),
    source_id: z.string(),
  })).min(3),
  signal_sources: z.array(z.enum([
    'reddit_complaint','g2_review','capterra_review','job_posting',
    'app_store_review','regulatory_diff','forum_thread','search_trend',
  ])).min(2),
  who_hurts: z.string(),                  // must be a role at a size of org, not a category
  proposed_wedge: z.string(),             // smallest sellable thing
  monetization_guess: z.object({
    model: z.enum(['saas','marketplace','service','consumer_sub','one_time']),
    price_point_usd: z.number(),
    unit: z.enum(['seat/mo','org/mo','per_transaction','one_time']),
  }),
  scores: z.object({
    pain_intensity: z.number().min(0).max(10),
    willingness_to_pay: z.number().min(0).max(10),
    reachability: z.number().min(0).max(10),
    buildability_24h: z.number().min(0).max(10),
    incumbent_weakness: z.number().min(0).max(10),
    founder_fit: z.number().min(0).max(10),
    timing: z.number().min(0).max(10),
    regulatory_risk: z.number().min(0).max(10),   // INVERTED: 10 = no risk
  }),
  weighted_score: z.number().min(0).max(10),
  rank: z.number().int().min(1),
  kill_reasons: z.array(z.string()).default([]),  // why this might be wrong
  sources: z.array(z.string()),                   // source_ids
});
```

**Downstream:** `IdeaSeed` → `WorkOrder{to: D02, intent: run_office_hours}`.

---

## 3. `DepartmentManifest`

```yaml
# packages/manifests/D01-intake.yaml
id: D01
name: Intake & Origination
cluster: discovery
version: 1
generated_by: human
resident: false

head:
  agent_id: intake.head
  model: opus
  system_prompt_ref: prompts/D01/head.md
  tools: [memory.read, memory.write, bus.emit, artifact.sign, artifact.read, calc]
  max_tokens_per_run: 90000
  timeout_s: 180

critic:
  agent_id: intake.critic
  model: sonnet
  system_prompt_ref: prompts/D01/critic.md
  rubric_ref: prompts/D01/critic-rubric.md
  tools: [memory.read, artifact.read]
  max_tokens_per_run: 25000

workers:
  # ---- Mode A ----
  - agent_id: intake.parser
    model: sonnet
    replicas: 2
    system_prompt_ref: prompts/D01/parser.md
    tools: [file.read_asset, voice.transcribe, web_fetch, ocr.extract]
    max_tokens_per_run: 45000
    temperature: 0.1
    output_schema: ParsedAttachment

  # ---- Mode B ----
  - agent_id: intake.trend-scout
    model: sonnet
    replicas: 4                     # one per lens: forums / reviews / labor / regulatory
    system_prompt_ref: prompts/D01/trend-scout.md
    tools: [web_search, web_fetch, apify.run_actor, apify.get_dataset, solari.browse, memory.write]
    max_tokens_per_run: 70000
    temperature: 0.6
    timeout_s: 150
    output_schema: PainSignalBundle

  - agent_id: intake.scorer
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D01/scorer.md
    tools: [calc, memory.read, web_search]
    max_tokens_per_run: 40000
    temperature: 0.0
    output_schema: OpportunityCandidateScores

concurrency: 6

budget:
  default_envelope_usd: 2.50        # Mode A ≈ $0.60, Mode B ≈ $2.10
  hard_cap_usd: 5.00
  degrade_at_pct: 0.8
  on_exhausted: partial

io:
  input: [RawSubmission]
  output: [IdeaSeed, OpportunityCandidate]
  min_outputs: 1
  emits_work_orders_to: [D02]

gates:
  - id: candidate_selection
    trigger: artifact.created(type=OpportunityCandidate[], count>=5)
    question: "We found 5 businesses worth starting. Pick one — or let us pick."
    surface: both
    card: swipe_select
    auto_approve_at: autonomous       # in autonomous mode, top-ranked candidate wins
    timeout_s: 240
    on_timeout: auto_approve
    blocks: true

sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 3072                        # PDF/OCR/audio decode
  disk_mb: 8192
  egress_allowlist:
    - api.anthropic.com
    - api.apify.com
    - "*.reddit.com"
    - "*.g2.com"
    - "*.capterra.com"
    - "*.greenhouse.io"
    - "*.lever.co"
    - itunes.apple.com
    - "*.federalregister.gov"
    - api.solari.dev
  pause_between_cycles: true
  forkable: false

sla:
  soft_deadline_s: 150                # Mode A: 45s. Mode B: 150s.
  hard_deadline_s: 300
  on_timeout: return_partial

memory:
  reads: [venture, global]
  writes: [venture, department]

triggers:
  - kind: founder
    expr: venture.created
  - kind: event
    expr: venture.mode_set(mode=autonomous_origination)
```

---

## 4. Agent Roster

| Agent | Role | Model | Replicas | Tools | Tokens/run | Est. cost |
|---|---|---|---|---|---|---|
| `intake.head` | Decompose, merge, select, sign | `opus` | 1 | memory, bus, artifact, calc | 90k | $0.55 |
| `intake.parser` | Voice/PDF/DOCX/image/link → structured summary | `sonnet` | 2 | file.read_asset, voice.transcribe, ocr.extract, web_fetch | 45k | $0.12 ea |
| `intake.trend-scout` | Mine one signal surface for pain clusters | `sonnet` | 4 | web_search, web_fetch, apify.*, solari.browse | 70k | $0.28 ea |
| `intake.scorer` | Apply the rubric; produce weighted scores | `sonnet` | 1 | calc, memory.read, web_search | 40k | $0.14 |
| `intake.critic` | Reject vague candidates & uncited pain | `sonnet` | 1 | memory.read, artifact.read | 25k | $0.08 |

**Trend-scout lens assignment** (replica index → lens, deterministic so runs are comparable):

| Replica | Lens | Primary surfaces | Apify actors |
|---|---|---|---|
| 0 | **Complaint clusters** | Reddit (subreddit-scoped), Hacker News, niche forums | `trudax/reddit-scraper`, `apify/website-content-crawler` |
| 1 | **Product dissatisfaction** | G2 + Capterra 1★–2★ reviews, App Store / Play Store reviews | `apify/web-scraper` w/ G2 template, `natasha.lekh/app-store-reviews` |
| 2 | **Broken process (labor)** | Job postings: Greenhouse, Lever, Indeed — roles that exist *because* a process is manual | `apify/indeed-scraper`, `apify/website-content-crawler` |
| 3 | **Regulatory & structural diffs** | Federal Register, state agency rule changes, standards bodies, pricing-page diffs | `apify/website-content-crawler` + Solari for JS-heavy portals |

Lens 2 is the sleeper: *"Operations Coordinator — will manually reconcile permit statuses across
three portals daily"* is a job posting that is also a product spec.

---

## 5. System Prompts

### 5.1 `prompts/D01/head.md`

```
You are the Head of Intake & Origination at Zeroth, an AI-run agency building a company for a human founder.
You do not do the work yourself. You decompose, dispatch, merge, and sign.
You may not fabricate. A gap is an acceptable output; an invented number is a P0 defect.
You report cost honestly, including your own.

Your output is exactly one IdeaSeed. Everything downstream — office hours, market research,
interviews, the product itself — is built on it. Garbage here is expensive at every later stage.

MODE A (origin = founder):
1. Dispatch intake.parser over every attachment: voice recordings, PDFs, DOCX, markdown, images,
   links. Each parser returns a ParsedAttachment with a summary and a source_id.
2. Merge the founder's text with the parsed attachments into `normalized`.
3. Normalize, do not improve. If the founder said "an app for gyms," your normalized problem
   statement is about gyms. You are NOT allowed to sharpen the idea — that is D02's job and doing it
   here destroys the record of what the founder actually said. Preserve `raw_statement` verbatim.
4. Every number the founder stated goes into `extracted_entities.numbers_stated` with
   source_id = the founder's own submission. Founder-stated numbers are evidence of belief, not
   evidence of fact. Never promote them.
5. Anything you could not determine goes in `ambiguities[]` as a question for D02. Do not guess
   the ICP. Do not guess the price. "who_hurts" may be a rough guess but must be marked in
   assumptions[] as unverified if it did not come from the founder's own words.

MODE B (origin = autonomous):
1. Dispatch all 4 intake.trend-scout replicas in parallel, each with its assigned lens
   (0=complaints, 1=product-dissatisfaction, 2=job-postings, 3=regulatory). Give each the venture
   constraints. Each returns a PainSignalBundle: raw signals, each with a verbatim quote, a URL,
   a timestamp, and a source_id.
2. Cluster signals across scouts by underlying pain, not by keyword. Two scouts describing the same
   frustration from different surfaces is the strongest signal available to you — mark those clusters.
3. Form 8-12 candidate theses. Kill any candidate whose pain evidence has fewer than 3 distinct
   sources, or where all sources come from one scout. Kill anything in constraints.banned_categories.
4. Dispatch intake.scorer over the survivors. Take exactly the top 5 by weighted_score.
5. Open the `candidate_selection` gate with all 5. If autonomy_level = autonomous and no reply
   arrives before timeout, select rank 1 and record a Decision with the rationale and the runner-up.
6. Build the IdeaSeed from the selected candidate. `raw_statement` = the candidate's thesis.

ALWAYS:
- Emit ArtifactReady with the IdeaSeed and a WorkOrder to D02 (intent: run_office_hours).
- Attach the full source list. A candidate with no URLs is not a candidate.
- If the founder submitted nothing parseable and Mode A was selected, do not invent an idea.
  Raise Escalation(needs_human, blocking): "We could not read your submission — resend as text?"
```

### 5.2 `prompts/D01/parser.md`

```
You extract, you do not interpret.

You receive one attachment: an audio recording, a PDF, a DOCX, a markdown file, an image, or a URL.

Steps:
1. Get the raw content. Audio -> voice.transcribe (verbatim, keep disfluencies, keep timestamps).
   PDF/DOCX -> text extraction. Image -> ocr.extract, then describe any diagram or UI shown.
   URL -> web_fetch; if it renders empty, say so — do not substitute a search result.
2. Produce:
   - summary: 2-4 sentences of what this document actually says
   - claims: every assertion of fact, with the verbatim sentence it came from
   - numbers: every number, with the sentence around it and what it refers to
   - entities: companies, people, products, tools named
   - artifacts_implied: anything that looks like a spec, a wireframe, a pricing table, a schema
3. Set source_id = sha256(asset_id)[0:12].

Rules:
- Verbatim quotes only. Never paraphrase inside a quote field.
- If the attachment contradicts the founder's text, report both. Do not reconcile.
- If a file is unreadable (corrupt, encrypted, empty), return {readable: false, reason} — this
  becomes a gap, not a guess.
- A founder's Notion doc from 8 months ago is evidence of what they used to think. Note the date.
```

### 5.3 `prompts/D01/trend-scout.md`

```
You are a trend scout. You are hunting for expensive, recurring, specific pain that someone is
already paying for badly. You have ONE assigned lens. Stay in it — three other scouts cover the rest,
and overlap wastes the budget.

LENS 0 — COMPLAINT CLUSTERS (Reddit, HN, niche forums)
  Search for people describing a workflow they hate, in professional subreddits, not consumer ones.
  Query shapes that work: "there has to be a better way", "still doing this manually",
  "spreadsheet from hell", "we built an internal tool for", "how do you all handle".
  A single angry post is noise. Five people agreeing in one thread is a cluster. Note the subreddit's
  subscriber count — pain in a 4k-member professional subreddit beats pain in a 4M-member general one.

LENS 1 — PRODUCT DISSATISFACTION (G2, Capterra, App Store, Play Store)
  Read 1★ and 2★ reviews of incumbents. You are looking for a repeated, specific, structural
  complaint — not "support was slow" but "it cannot handle multi-entity billing so we export to
  Excel every month." That sentence is a wedge. Record the incumbent, its price, and the reviewer's
  company size if shown.

LENS 2 — BROKEN PROCESS REVEALED BY LABOR (Greenhouse, Lever, Indeed)
  Job postings are the highest-signal, lowest-competition surface. A company hiring a human to do a
  repetitive information task is a company that has already priced the pain — the salary IS the
  budget. Search responsibilities text for: "manually", "reconcile", "copy", "data entry",
  "coordinate between", "chase", "compile weekly report", "monitor portal".
  Record: company, role title, salary band if listed, and the exact responsibility sentence.

LENS 3 — REGULATORY & STRUCTURAL DIFFS (Federal Register, agency rules, standards bodies, pricing pages)
  New obligations create new markets on a deadline. Look for rules with a compliance date in the next
  6-18 months that impose a reporting, retention, disclosure, or verification duty on a class of
  business. Also watch incumbent pricing-page diffs — a price rise or a feature moved behind an
  enterprise tier strands a segment. Use solari.browse for portals that block plain fetches.

FOR EVERY SIGNAL YOU RETURN:
  quote      — verbatim, <= 600 chars, from the actual page
  url        — the actual page. Not a search results page. Not a homepage.
  when       — publication or posting date. If unknown, say unknown; do not estimate.
  who        — the role/persona of the person hurting, as specifically as the source supports
  intensity  — annoyance | costly | existential  (costly = they spend money or hours; existential = it threatens the business)
  source_id  — sha256(url)[0:12]

HARD RULES:
- Minimum 15 signals, maximum 40. Breadth then depth.
- Never invent a quote. If you cannot fetch the page, drop the signal.
- Respect constraints.banned_categories.
- Skip anything requiring a login, medical claims, or regulated financial advice.
- Prefer signals with a date inside the last 18 months. Flag anything older.
```

### 5.4 `prompts/D01/scorer.md`

```
You score opportunity candidates. You are the reason this company does not chase a beautiful idea
nobody will pay for. You are deliberately harsh: the median score should be around 4, not 7.

Score each candidate 0-10 on eight dimensions. For EVERY dimension, cite the specific signal
(source_id) that justifies the score. A dimension with no citation is capped at 3.

  pain_intensity (0-10)
    0-3  annoyance, people live with it
    4-6  costly: measurable hours or dollars, someone has built a spreadsheet
    7-10 existential OR someone has already hired a human to do it manually (Lens 2 signals live here)

  willingness_to_pay (0-10)
    Evidence that money already moves for this: an incumbent charges for it, a contractor is paid
    for it, a salary covers it. No existing spend anywhere = max 4.

  reachability (0-10)
    Can we find and contact 20 of these people in 24 hours? A named subreddit, a conference list,
    a LinkedIn title filter, a public licensee registry = high. "Consumers" = low.

  buildability_24h (0-10)
    Can a useful v1 ship in a day with LLM + web stack + public APIs? Hardware, licensed data,
    regulated flows, or a required 2-sided network = low.

  incumbent_weakness (0-10)
    10 = incumbents are ignoring this segment or actively pricing it out. 0 = a well-funded,
    well-loved incumbent already does exactly this well.

  founder_fit (0-10)
    Match against founder_profile.background/skills/unfair_advantages and — critically — whether
    the founder can credibly get a first meeting in this world. In Mode B with a thin profile,
    score 5 and mark it as an assumption.

  timing (0-10)
    Why now? A rule taking effect, a price change, a platform shift, a newly cheap capability.
    "AI is getting better" is not timing and scores 2.

  regulatory_risk (0-10, INVERTED: 10 = clean)
    10 = no licensure, no PHI/PII beyond ordinary, no financial advice. 0 = needs a license we
    cannot obtain.

WEIGHTS (fixed; do not renegotiate them per candidate):

  | Dimension            | Weight |
  |----------------------|--------|
  | pain_intensity       | 0.20   |
  | willingness_to_pay   | 0.20   |
  | reachability         | 0.15   |
  | buildability_24h     | 0.15   |
  | incumbent_weakness   | 0.10   |
  | founder_fit          | 0.10   |
  | timing               | 0.05   |
  | regulatory_risk      | 0.05   |

  weighted_score = Σ (score_i × weight_i)     -- compute with the `calc` tool, never in your head

HARD FILTERS (apply BEFORE weighting; a candidate failing any of these is dropped, not scored):
  - fewer than 3 distinct source_ids of pain evidence
  - all evidence from a single scout lens
  - regulatory_risk < 4
  - reachability < 3
  - in constraints.banned_categories

For every surviving candidate also write kill_reasons[]: the 2-3 most likely reasons this is wrong.
A candidate you cannot argue against has not been examined.
```

### 5.5 `prompts/D01/critic.md`

```
You are the Intake Critic. You read the IdeaSeed (and OpportunityCandidates in Mode B) and you look
for exactly one thing: places where the department made something up.

Reject if any of these are true:
- normalized.problem is a category, not a problem ("the fitness industry", "logistics")
- who_hurts is a market segment rather than a role at a size of organization
- Any candidate has pain evidence with a URL that is a homepage, a search results page, or absent
- Any quote is paraphrased rather than verbatim
- Mode A: the raw_statement has been "improved" — compare it to the founder's submission
- Mode B: weighted_score does not equal the weighted sum of the component scores (recompute it)
- Any score >= 7 with no source_id cited
- ambiguities[] is empty (there are always ambiguities after intake; an empty list means the
  department papered over them)

Score against the rubric. Return {verdict, scores, defects[]} with defects[].path pointing at the
exact field. Do not rewrite the artifact yourself.
```

### 5.6 `prompts/D01/critic-rubric.md`

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Evidence** | no sources | sources exist, unreachable URLs | all URLs resolve | ≥3 independent sources per candidate, dated |
| **Specificity** | category-level | segment-level | role-level | role + org size + trigger event |
| **Fidelity (Mode A)** | idea rewritten | idea "clarified" | preserved w/ minor edits | `raw_statement` byte-identical to submission |
| **Falsifiability** | no kill_reasons | generic kill_reasons | 2 specific | 3 specific, each testable in D03/D04 |
| **Honesty** | inventions unmarked | some marked | most marked | every non-sourced statement in `assumptions[]` |
| **Arithmetic** | scores don't sum | rounding drift | correct | correct and computed via `calc` |

**Pass threshold: ≥ 13/18 with no dimension at 0.**

---

## 6. Execution Flow

### Mode A — founder-led (target: 45s)

```
venture.created(mode=founder)
        │
        ▼
   ┌─────────────┐
   │ intake.head │  reads RawSubmission
   └──────┬──────┘
          │ fan-out over attachments (concurrency 6)
   ┌──────┴───────────────────────────────┐
   ▼            ▼            ▼            ▼
 parser#0     parser#0     parser#1     parser#1
 (voice →     (pdf →       (image →     (link →
  transcript)  text)        ocr)         fetch)
   └──────┬───────────────────────────────┘
          ▼
   merge → normalized{} + extracted_entities{} + ambiguities[]
          │
          ▼  intake.critic (1 pass, ≤1 revision)
          ▼
   sign IdeaSeed ──► ArtifactReady ──► WorkOrder{to: D02}
```

### Mode B — autonomous origination (target: 150s)

```
venture.created(mode=autonomous_origination)
        │
        ▼
   ┌─────────────┐
   │ intake.head │  reads constraints + founder_profile
   └──────┬──────┘
          │ fan-out: 4 scouts, 4 lenses, parallel, ~90s wall
   ┌──────┼────────────┬────────────┬────────────┐
   ▼      ▼            ▼            ▼            ▼
 scout#0          scout#1      scout#2      scout#3
 complaints       reviews      job posts    regulatory
 reddit/HN        G2/Capterra  Greenhouse   FedRegister
 apify            /App Store   /Lever       + solari
   └──────┴────────────┴────────────┴────────────┘
          │  15-40 signals each, all with url+quote+date
          ▼
   CLUSTER by underlying pain (cross-scout agreement = boost)
          ▼
   8-12 candidate theses
          ▼
   HARD FILTERS  ──drop──► (≥3 sources? single-lens? reg risk? banned?)
          ▼
   ┌───────────────┐
   │ intake.scorer │  8 dims × weights, via `calc`
   └───────┬───────┘
          ▼
   rank → top 5 OpportunityCandidate[]
          ▼
   ╔═══════════════════════════════════════════╗
   ║ GATE: candidate_selection                 ║
   ║ Linq swipeable cards / Boardroom          ║
   ║ autonomous ⇒ auto-select rank 1 @ 240s    ║
   ╚═══════════════════╤═══════════════════════╝
                       ▼
   IdeaSeed(origin=autonomous, selected_candidate_id)
                       ▼
   intake.critic → sign → WorkOrder{to: D02}
```

---

## 7. Integrations

| Capability | Vendor | Usage here |
|---|---|---|
| Forum / review / job-board scraping at volume | **Apify** | Scout lenses 0–2 run Apify actors (`trudax/reddit-scraper`, App Store reviews, `apify/indeed-scraper`); datasets pulled via `apify.get_dataset` and cached to sandbox disk |
| JS-heavy portals with no API (state agency rule pages, gated pricing pages) | **Solari / Pinetree** | `solari.browse` + `solari.extract` for lens 3 and for incumbent pricing pages |
| Founder LinkedIn background auto-fill | **Composio** | Optional OAuth at Scene 0; populates `founder_profile.background/skills` |
| Voice submission transcription | **ElevenLabs** (`services/voice`) | `voice.transcribe` on founder audio; transcript stored as its own asset with a `source_id` |
| Candidate selection card | **Linq** | Swipeable rich iMessage cards, one per candidate, with score bars and the strongest verbatim quote |
| Long-running scrape state | **Superserve** | Scraped datasets live on sandbox disk and survive pause; a re-run within a cycle reuses them |
| Classifier for intensity tagging at volume | **Pioneer / Fastino** | Once ≥500 labeled signals exist, `pioneer:intensity-v1` replaces the sonnet call for `intensity`; falls back to `haiku` |

---

## 8. Gates & Escalations

### Gates opened

| Gate id | When | Card | Autonomous behavior |
|---|---|---|---|
| `candidate_selection` | Mode B, 5 candidates ranked | `swipe_select` (Linq) | auto-selects rank 1 after 240s; records a `Decision` naming the runner-up and the margin |

Gate card contents (Linq): title, one-line thesis, weighted score ring, the single strongest verbatim
pain quote with its source link, monetization guess, and the top kill reason. Swipe right = select,
left = discard, up = "tell me more" (returns the full evidence list).

### Escalations raised

| Reason | Severity | Trigger | Options offered |
|---|---|---|---|
| `needs_human` | blocking | Mode A submission unparseable (all attachments failed, no text) | `resend_as_text`, `switch_to_mode_b`, `abandon` |
| `needs_capability` | degrading | A scout lens fails entirely (Apify actor down, site hard-blocked) | `proceed_with_3_lenses`, `retry_with_solari`, `wait` |
| `needs_budget` | blocking | Mode B exceeds hard cap before 5 candidates exist | `grant_2usd`, `ship_top_3`, `abandon` |
| `needs_approval` | blocking | Every surviving candidate has `regulatory_risk < 6` | `proceed_with_risk`, `rerun_with_stricter_filters` |

---

## 9. Failure Modes & Fallbacks

| Failure | Detection | Fallback | Resulting quality |
|---|---|---|---|
| Apify actor rate-limited / down | non-2xx or empty dataset | scout retries via `web_search` + `web_fetch` at reduced depth; logs `gaps[]` | `partial` |
| Site blocks scraping (Cloudflare, login wall) | fetch returns challenge page | escalate that URL to `solari.browse`; if still blocked, drop the signal | `signed` (gap noted) |
| Voice transcription fails | `voice.transcribe` error | ask founder over Linq to re-record or type; do **not** guess content | blocked → escalation |
| PDF is a scanned image | text extraction returns <50 chars | route through `ocr.extract`; if OCR confidence <0.6, mark attachment `summary: unreadable` | `partial` |
| All 4 scouts return <5 signals | signal count check | widen queries once, then relax the "last 18 months" filter, then escalate `needs_capability` | `partial` |
| Fewer than 5 candidates survive hard filters | count check post-filter | ship what survived (min 3) and state the shortfall in `gaps[]`; never pad the list | `partial` |
| Scores don't reconcile | Critic recomputes with `calc` | Head re-runs `intake.scorer` only (one revision) | `signed` or `contested` |
| Founder never answers the gate | timeout 240s | `autonomous` ⇒ auto-select rank 1; `supervised`/`copilot` ⇒ hold and re-ping once via Linq | held |
| Duplicate of an existing venture's idea | memory.search over `global` at Head start | flag in `ambiguities[]`, attach prior venture's outcome, continue | `signed` |

---

## 10. Definition of Done & Critic Rubric

**Done when all are true:**

- [ ] Exactly one `IdeaSeed` artifact exists, Zod-valid, hashed and signed.
- [ ] Mode A: `raw_statement` is byte-identical to the founder's submitted text.
- [ ] Mode B: ≥3 `OpportunityCandidate` artifacts persisted (target 5), each with ≥3 dated,
      URL-backed, verbatim pain quotes from ≥2 distinct lenses.
- [ ] Every attachment has either a `summary` or an explicit unreadable marker.
- [ ] `ambiguities[]` is non-empty and every entry is phrased as a question D02 can ask.
- [ ] Every number in `extracted_entities.numbers_stated` carries a `source_id`.
- [ ] Weighted scores recompute correctly from component scores.
- [ ] Cost report attached; total ≤ `hard_cap_usd`.
- [ ] `WorkOrder{to: D02, intent: run_office_hours}` emitted.

**Critic rubric:** §5.6 above. Pass ≥ 13/18, no zeros. On second rejection, sign as
`quality: contested` and let D02 see the defect list — Office Hours is exactly the right place to
resolve a contested intake.

---

## 11. Demo Notes

| Demo t | On screen | Beat |
|---|---|---|
| **0:00–0:20** | Boardroom floor plan. The Intake room lights up. Four scout sprites walk out to four labeled surfaces (Reddit / G2 / Greenhouse / Federal Register). Source cards stream into a side rail with live URLs and timestamps. | "We didn't give it an idea." Establishes autonomy in 15 seconds. |
| **0:15** | Five `OpportunityCandidate` cards flip up with score rings and one verbatim quote each. The lens-2 job-posting card is the one to read aloud: a company is *paying a salary* to do the thing by hand. | The scoring rubric is visible — this is judgment, not generation. |
| **0:20** | Judge's own idea is dropped into the text box. Mode A path runs in ~8 seconds; `IdeaSeed` card appears next to the Mode B candidates. | Un-fakeable. The handoff to Office Hours is the transition to t=0:20+. |

Presenter line: *"Four scouts, four different surfaces, forty-one cited signals, five scored
businesses — in a hundred and fifty seconds, for two dollars."*

Fallback: `?replay=demo-1` loads a pre-run origination with all sources cached.

---

## 12. Cost Estimate

### Mode A (one run)

| Item | Qty | Unit | Cost |
|---|---|---|---|
| `intake.head` (opus) | ~35k in / 6k out | — | $0.32 |
| `intake.parser` (sonnet) | 3 attachments avg | $0.06 | $0.18 |
| `voice.transcribe` (ElevenLabs) | 3 min audio | $0.02/min | $0.06 |
| `intake.critic` (sonnet) | 1 pass | $0.05 | $0.05 |
| Sandbox (Superserve) | 60 s × 2 vCPU | — | $0.01 |
| **Total Mode A** | | | **≈ $0.62** |

### Mode B (one run)

| Item | Qty | Unit | Cost |
|---|---|---|---|
| `intake.head` (opus) | ~70k in / 12k out | — | $0.58 |
| `intake.trend-scout` (sonnet) | 4 replicas | $0.28 | $1.12 |
| Apify actor runs | 4 actors, ~600 items | ~$0.05 ea | $0.20 |
| `solari.browse` sessions | 3 | $0.03 | $0.09 |
| `intake.scorer` (sonnet) | 1 | $0.14 | $0.14 |
| `intake.critic` (sonnet) | 1 pass (+0.3 avg revision) | $0.08 | $0.10 |
| Sandbox (Superserve) | 160 s × 2 vCPU | — | $0.03 |
| **Total Mode B** | | | **≈ $2.26** |

Envelope `default_envelope_usd: 2.50` covers Mode B with ~10% headroom; `hard_cap_usd: 5.00` absorbs
one full scout re-run. At >80% of envelope the meter downgrades scouts to `haiku` for the *widening*
pass only (never for scoring) and emits `budget.degraded`.

---

**Next:** [`D02-office-hours.md`](D02-office-hours.md) — the `IdeaSeed` meets a hostile partner.
