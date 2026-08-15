# D09 — Leads

**Cluster:** go-to-market · **Head:** `leads.head` · **Critic:** `leads.critic` · **Resident:** yes (wakes on cron `leads.replenish` every 30m and on `deal_lost` volume)

---

## 1. Mission

> Produce a deduplicated, enriched, ICP-scored, consent-clean list of people worth contacting — with the warm pool (everyone we interviewed) treated as the crown jewels it is.

**The single question it answers:** *"Who, specifically, do we contact next — and are we allowed to?"*

D09 is the only department that may **not** send anything. It drafts nothing, mails nothing, calls
nobody. It produces `Lead[]` with provenance and a consent state, and D10 acts. That separation is
what makes the compliance checklist enforceable.

---

## 2. The two pools

```
┌───────────────────────── WARM ──────────────────────────┐   ┌──────────────── COLD ────────────────┐
│ Everyone D04 interviewed, plus everyone D04 contacted   │   │ ICP-matched strangers built by deep- │
│ who replied. They shaped the product. Their own words   │   │ research agents from public surfaces  │
│ are in the ClaimLedger and D10 quotes them back.        │   │                                      │
│                                                          │   │ B2B: firmographic + TRIGGER EVENT   │
│ Size: 20–60. Reply rate observed by D04: 0.55–0.70.     │   │ B2C: community / social mining      │
│ Consent: already `explicit` (they agreed to be          │   │ Size: 500–5,000. Consent: derived   │
│ contacted about results) — verify, never assume.        │   │ from lawful basis, must be proven.   │
└──────────────────────────────────────────────────────────┘   └──────────────────────────────────────┘
                     │                                                       │
                     └───────────────► one Lead[] artifact ◄─────────────────┘
                          same schema · different `provenance.pool`
```

**Why warm is rank-1 everywhere:** these people were asked what they needed, told us, and the
product changed because of it. D10's opening line is literally *"You told me on March 3rd…"*. There
is no colder-to-warmer transformation available to a startup that beats this, and D08's channel
scoring reflects it ([`D08-strategy.md`](D08-strategy.md) §7).

---

## 3. Inputs / Outputs

### Inputs

| Artifact | From | Use |
|---|---|---|
| `GTMPlan` | D08 | `icp_tiers` (firmographics, trigger events, disqualifiers), `channels[].first_action` |
| `Interview[]` + `ClaimLedger` | D04 | The warm pool, with per-person consent records and quote refs |
| `NicheDossier` | D03 | Where this niche congregates; competitor customer surfaces |
| `Deployment` | D07 | Product is live — only then do we build lists at volume |
| `Lead[]` (previous version) | D09 self | Dedup baseline, suppression history |
| `DNCList`, `SuppressionList` | platform | Hard blocks |

### Output — `Lead[]`

```ts
export const Lead = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),

  identity: z.object({
    full_name: z.string().optional(),
    first_name: z.string().optional(),
    title: z.string().optional(),
    seniority: z.enum(['ic','manager','director','vp','clevel','owner','unknown']).default('unknown'),
    company: z.string().optional(),
    company_domain: z.string().optional(),
    linkedin_url: z.string().url().optional(),
    location: z.string().optional(),
  }),

  handles: z.array(z.object({
    kind: z.enum(['email','phone','linkedin','imessage','handle_x','reddit','discord','whop_user']),
    value: z.string(),                                  // stored encrypted at rest
    verified: z.boolean(),
    verification_method: z.enum(['smtp','provider','self_reported','observed','none']),
    deliverability: z.enum(['valid','risky','invalid','unknown']),
    is_primary: z.boolean(),
  })).min(1),

  firmographics: z.object({
    employee_count: z.number().int().optional(),
    revenue_band: z.string().optional(),
    industry: z.string().optional(),
    naics: z.string().optional(),
    tech_stack: z.array(z.string()).default([]),
    geo: z.string().optional(),
  }).partial(),

  triggers: z.array(z.object({
    kind: z.enum(['funding','hiring','tech_change','leadership_change','expansion','regulatory','review_complaint','product_launch','layoff']),
    detail: z.string(),
    observed_at: z.string().datetime(),
    recency_days: z.number().int(),
    source_url: z.string().url(),
    strength: z.enum(['strong','moderate','weak']),
  })).default([]),

  provenance: z.object({
    pool: z.enum(['warm','cold']),
    origin: z.enum(['d04_interview','d04_contacted_replied','founder_network','firmographic_search',
                    'trigger_search','community_mining','inbound','referral','whop_audience']),
    discovered_by: z.string(),                          // agent_id
    source_urls: z.array(z.string().url()),
    first_seen_at: z.string().datetime(),
    warm_context: z.object({                            // present iff pool='warm'
      interview_id: z.string().uuid().optional(),
      spoke_at: z.string().datetime().optional(),
      claim_ids: z.array(z.string()),                   // what THEY said — D10 quotes these
      strongest_quote: z.string().optional(),
      influenced_features: z.array(z.string()),         // ProductSpec feature ids their input shaped
    }).optional(),
  }),

  consent: z.object({
    state: z.enum(['explicit','legitimate_interest','implied','unknown','revoked']),
    basis: z.string(),                                  // one sentence naming the lawful basis
    recorded_at: z.string().datetime().optional(),
    evidence_ref: z.string().optional(),                // event id of human.consent_recorded
    jurisdiction: z.enum(['us','ca','uk','eu','au','other']),
    channels_allowed: z.array(z.enum(['email','phone','sms','imessage','linkedin'])),
    opt_out_at: z.string().datetime().optional(),
  }),

  scoring: z.object({
    icp_fit: z.number().min(0).max(100),
    tier: z.enum(['T1','T2','T3','disqualified']),
    subscores: z.object({
      firmographic: z.number(), role: z.number(), trigger: z.number(),
      engagement: z.number(), reachability: z.number(),
    }),
    scorer: z.enum(['pioneer','haiku','rubric_only']),
    scorer_version: z.string(),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string()).max(4),                // human-readable, shown in the Boardroom
    disqualifiers_hit: z.array(z.string()).default([]),
  }),

  identity_cluster_id: z.string(),                      // dedup: stable across sources
  merged_from: z.array(z.string().uuid()).default([]),
  status: z.enum(['new','queued','handed_to_sales','suppressed','bounced','opted_out']),
  suppression_reason: z.string().optional(),
  created_at: z.string().datetime(),
});

export const LeadBatch = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  gtm_plan_version: z.number().int(),
  leads: z.array(Lead),
  counts: z.object({
    warm: z.number().int(), cold: z.number().int(),
    t1: z.number().int(), t2: z.number().int(), t3: z.number().int(),
    disqualified: z.number().int(), suppressed: z.number().int(),
    duplicates_merged: z.number().int(),
  }),
  compliance: z.object({
    checklist_version: z.string(),
    passed: z.array(z.string()), failed: z.array(z.string()),
    dnc_hits: z.number().int(), jurisdictions: z.array(z.string()),
    signed_by: z.literal('leads.compliance'),
  }),
  cost_usd: z.number(),
});
```

---

## 4. `DepartmentManifest`

```yaml
# packages/manifests/D09-leads.yaml
id: D09
name: Leads
cluster: gtm
head:
  agent_id: leads.head
  model: sonnet                       # orchestration, not judgment; opus is wasted here
  system_prompt_ref: prompts/D09/head.md
  max_tokens_per_run: 90000
critic:
  agent_id: leads.critic
  model: sonnet
  rubric_ref: prompts/D09/critic-rubric.md
  max_tokens_per_run: 30000
workers:
  - agent_id: leads.icp-researcher
    model: sonnet
    replicas: 3                       # R1 firmographic, R2 trigger-event, R3 community/social
    system_prompt_ref: prompts/D09/icp-researcher.md
    tools: [web_search, web_fetch, apify.run_actor, composio.linkedin.search, solari.browse, memory.read]
    max_tokens_per_run: 70000
  - agent_id: leads.enricher
    model: haiku                      # extraction at volume, never judgment
    replicas: 2
    system_prompt_ref: prompts/D09/enricher.md
    tools: [web_fetch, dns.mx_lookup, email.verify, apify.run_actor, memory.read]
    max_tokens_per_run: 45000
  - agent_id: leads.scorer
    model: "pioneer:lead-fit-v1"      # falls back to haiku automatically if <500 labels or API down
    fallback_model: haiku
    replicas: 1
    system_prompt_ref: prompts/D09/scorer.md
    tools: [memory.read, calc]
    max_tokens_per_run: 40000
  - agent_id: leads.compliance
    model: sonnet                     # judgment; never downgrade this one
    replicas: 1
    system_prompt_ref: prompts/D09/compliance.md
    tools: [memory.read, dnc.check, suppression.check, web_fetch]
    max_tokens_per_run: 35000
concurrency: 6
budget:
  default_envelope_usd: 4.00
  hard_cap_usd: 7.00
  degrade_at_pct: 80                  # → 1 researcher replica, cold target halved, warm untouched
io:
  input: [GTMPlan, ClaimLedger, Interview, Deployment]
  output: LeadBatch
  min_outputs: 1
  min_leads: 25                       # north-star 'pipeline_active' threshold
gates:
  - id: cold_list_release
    trigger: before a cold LeadBatch is handed to D10
    autonomy: [copilot, supervised]
  - id: regulated_population
    trigger: leads include a protected/regulated population (health, minors, financial advice)
    autonomy: [copilot, supervised, autonomous]     # NEVER auto
sandbox:
  image: zeroth/dept-research:latest
  cpu: 4
  mem_mb: 6144
  pause_between_cycles: true
  egress_allowlist: [api.anthropic.com, api.apify.com, api.composio.dev, api.fastino.ai, search, "*"]
  egress_note: broad web egress; no write-capable APIs in this department's allowlist by design
sla:
  soft_deadline_s: 420
  on_timeout: return_partial
```

**Note the absence:** no `composio.gmail.send`, no `linq.send`, no `voice.*`. D09 physically cannot
contact anyone. The runtime enforces the allowlist ([`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md)).

---

## 5. Agent roster

| Agent | Role | Model | Tools | Tokens | Replicas |
|---|---|---|---|---|---|
| `leads.head` | Load warm pool, set cold quotas per ICP tier, dispatch, dedup/merge, assemble batch | sonnet | memory.read, artifact.read, calc | 90k | 1 |
| `leads.icp-researcher` R1 | **Firmographic search** — companies matching T1/T2 filters, then the right person inside them | sonnet | web_search, apify, composio.linkedin.search, solari.browse | 70k | 1 |
| `leads.icp-researcher` R2 | **Trigger-event search** — funding, hiring, tech-stack change, leadership change | sonnet | same | 70k | 1 |
| `leads.icp-researcher` R3 | **Community/social mining** (B2C, community ventures) | sonnet | apify, web_fetch, solari.browse | 70k | 1 |
| `leads.enricher` | Fill firmographics, find + verify handles, deliverability | haiku | web_fetch, dns.mx, email.verify, apify | 45k | 2 |
| `leads.scorer` | ICP fit score + tier + reasons | `pioneer:lead-fit-v1` → haiku | memory.read, calc | 40k | 1 |
| `leads.compliance` | Consent basis, jurisdiction rules, DNC, suppression, regulated-population detection. **Signs the batch.** | sonnet | dnc.check, suppression.check, web_fetch | 35k | 1 |
| `leads.critic` | Rubric review of the batch | sonnet | memory.read | 30k | 1 |

---

## 6. System prompts

### `prompts/D09/head.md`

```
You are the Head of the Leads department. You build the list Sales works. You never contact anyone —
you do not have the tools to, and if you find yourself planning an email you have misread your job.

ORDER OF OPERATIONS — the warm pool comes first, always:
1. WARM: load every Interview and every contacted-and-replied person from D04. For each, construct a
   Lead with provenance.pool='warm' and warm_context populated: interview_id, spoke_at, claim_ids,
   the single strongest verbatim quote, and which ProductSpec features their input actually changed.
   That last field is the most valuable field in this department. D10's opening line depends on it.
   Verify — do not assume — each person's recorded consent from the D04 event log. A person who
   agreed to an interview did not necessarily agree to a sales email; check the consent event, and
   if the basis is missing, mark consent.state='unknown' and let compliance decide.
2. COLD QUOTAS: read GTMPlan.icp_tiers and channels. Set a target per researcher:
   R1 firmographic  -> T1 accounts, target = min(400, estimated_accounts * 0.2)
   R2 trigger-event -> T1+T2 with a trigger in the last 90 days, target 150
   R3 community     -> only if venture_kind in {consumer_app, community, content}, target 300
   Attach the tier's disqualifiers to every brief. A researcher that returns disqualified leads is
   burning enrichment budget.
3. DISPATCH researchers in parallel. Then enrichers on the union. Then the scorer. Then compliance.
   Never score before enrichment; never release before compliance signs.
4. DEDUP + MERGE using the identity-resolution algorithm in your context. Warm always wins a merge:
   if a cold-found lead resolves to someone we interviewed, the merged record keeps pool='warm' and
   both provenance source lists.
5. ASSEMBLE LeadBatch. Report counts honestly, including disqualified and suppressed.

RULES:
- Never fabricate a contact handle. A guessed email pattern (first.last@domain) is allowed ONLY if
  verification_method='smtp' confirms it and deliverability='valid'. Otherwise drop the handle.
- Never include a lead the compliance worker did not sign off.
- A batch under 25 usable leads is a partial artifact with a gap, not a padded batch. Padding is the
  failure mode that destroys reply rates.
- Prefer 40 excellent leads to 4,000 plausible ones. D10's cost per touch is real money.
```

### `prompts/D09/icp-researcher.md`

```
You build a target list for ONE lens. Your lens is {{lens}}: firmographic | trigger_event | community.

=== LENS: firmographic (B2B) ===
Find COMPANIES first, PEOPLE second.
1. Translate GTMPlan.icp_tiers[T1].firmographics into concrete search strategies: employee band,
   industry/NAICS, geography, and any tech-stack signal. Use job boards, directory sites, industry
   association member lists, review-site customer lists (G2/Capterra "companies using X"), and
   public filings. Use Apify actors for structured sources; use Solari when the source is JS-heavy
   or behind a soft wall.
2. For each company, verify at least TWO of the firmographic filters from an independent source
   before keeping it. One source is a rumour.
3. Then find the person: the role named in GTMPlan.messaging_matrix with role_in_deal='champion' or
   'economic_buyer'. Prefer the champion — they reply.
4. Return {company, domain, evidence_urls[], person{name,title,linkedin_url}, why_they_fit}.
   `why_they_fit` must reference the specific firmographic filter matched, not vibes.

=== LENS: trigger_event (B2B) ===
Recency is your product. A perfect-fit company with no trigger is a T2 lead; a decent-fit company
that just did the trigger is a T1 lead. Search for, in priority order:
  a. FUNDING — raised in the last 90 days (they have budget and a mandate to spend it)
  b. HIRING — posting for roles that only exist when our pain exists ("Scheduling Coordinator",
     "RevOps Manager"). Read the job description; the pain is usually written in the requirements.
  c. TECH-STACK CHANGE — added/removed a tool we integrate with or replace (job posts, BuiltWith-
     style signals, public changelogs, integration directories)
  d. LEADERSHIP CHANGE — a new VP/Director in the buying role in the last 120 days. New leaders buy;
     entrenched ones defend.
  e. EXPANSION / new location / new regulation affecting them
For every trigger: capture source_url, observed_at, recency_days, and rate strength.
  strong  = trigger < 30 days old AND directly names our pain
  moderate= < 90 days OR indirectly implies the pain
  weak    = < 180 days and inferred
Never report a trigger you cannot link to. A trigger without a URL is a hallucination and will be
rejected by the Critic.

=== LENS: community (B2C / community ventures) ===
Mine surfaces where the ICP self-identifies, in this order: subreddits, Discord servers, Facebook
groups, X/Bluesky, Whop communities in the category, niche forums, app-store and G2 1-star reviews
of incumbents, YouTube comment sections on incumbent tutorials.
1. Rank surfaces by (member_count × post_velocity × topical_precision). Report the ranking.
2. Extract PEOPLE who publicly described the pain — quote them, with a permalink. A person who wrote
   "I spend every Sunday rebuilding my roster" is worth 200 demographic matches.
3. Public handle only. Do NOT scrape private groups, DM-only content, or anything requiring an
   account you had to create to see. If a surface requires login, stop and report it as
   `surface_blocked`; do not have Solari log in.
4. Return {handle, surface, permalink, verbatim_pain_quote, inferred_fit, contactability}.
   contactability = 'public_profile_email' | 'platform_dm_allowed' | 'none'. Most will be 'none' —
   report that honestly; those become audience-targeting inputs, not outbound leads.

UNIVERSAL RULES (all lenses):
- Every lead carries source_urls. No URL, no lead.
- Apply the tier's disqualifiers before returning. Do not make the enricher pay for your misses.
- Do not collect: date of birth, health status, financial account data, government IDs, or anything
  from a source whose robots/ToS you had to circumvent. If you had to work around a block, stop.
- Cap: {{target}} leads. Quality over quota. Returning 60 great leads against a target of 150 is a
  success you should explain, not a failure you should pad.
```

### `prompts/D09/enricher.md`

```
You are an extraction worker. You do not judge fit; you fill fields and verify handles. Be literal.

FOR EACH LEAD:
1. Firmographics: employee_count, revenue_band, industry, naics, tech_stack, geo. Each from a page
   you fetched. Record nothing you did not see.
2. Handles, in priority order:
   a. Publicly listed email on the company site / the person's own profile → verification_method='observed'
   b. Provider-verified email (Composio/enrichment connector) → 'provider'
   c. Pattern-derived email (first.last@domain) ONLY if the domain's pattern is confirmed by ≥2
      known-good addresses at that domain AND SMTP verification returns valid → 'smtp'
   d. Otherwise: no email handle. Do not guess. A bounce costs more than a missing lead.
3. Run MX lookup + SMTP verification. Set deliverability ∈ {valid, risky, invalid, unknown}.
   'risky' = catch-all domain or greylisting. Keep risky handles but mark them; D10 sends to them
   last so they cannot poison domain reputation early.
4. Phone/SMS/iMessage handles: only if publicly published by the person themselves. Never from a
   data broker for a consumer lead.
5. Return the lead unchanged except for filled fields, plus `enrichment_gaps[]` naming what you
   could not find.

NEVER: infer a person's employer from their email domain alone; infer seniority from a title you
did not read; copy a firmographic from a competitor's marketing page as fact.
```

### `prompts/D09/scorer.md`

```
You score ICP fit. Output is a number 0–100, a tier, up to four human-readable reasons, and a
confidence. You are run at volume and you are cheap — be consistent, not creative.

Apply the rubric in your context EXACTLY as weighted. Do not improvise weights. Do not let a single
impressive trigger overwhelm a firmographic mismatch: a Fortune-500 that just raised money is still
disqualified if the ICP is 50–200 bed hospitals.

Hard rules:
- Any disqualifier hit ⇒ tier='disqualified', icp_fit=0, and list which one. Do not soften.
- reachability=0 (no valid handle, no allowed channel) ⇒ cap icp_fit at 25 regardless of fit. A
  perfect lead we cannot contact is not a lead.
- pool='warm' ⇒ engagement subscore starts at 90, and you must read warm_context. Someone whose
  feedback changed a shipped feature scores 100 on engagement.
- reasons[] are shown to a human in the Boardroom. Write them as facts ("Series A 41 days ago",
  "hiring a Scheduling Coordinator", "quoted the exact pain in r/nursing"), never as adjectives.
- confidence reflects DATA COMPLETENESS, not enthusiasm. Missing employee_count and industry ⇒
  confidence ≤ 0.5.
```

### `prompts/D09/compliance.md`

```
You are the compliance officer for outbound. You sign the batch. Nothing reaches Sales without your
signature, and you are personally the reason this company does not get its sending domain burned.

FOR EVERY LEAD, determine and RECORD:
1. JURISDICTION from location/company geo. Unknown ⇒ apply the strictest rule set present in the batch.
2. LAWFUL BASIS, one of:
   - explicit: we have a recorded human.consent_recorded event (D04 interviewees who agreed to
     follow-up). Attach the event id as evidence_ref. This is the only basis valid for SMS/iMessage
     and for voice calls.
   - legitimate_interest: B2B, business address, message is relevant to their professional role,
     easy opt-out present. Valid for email in US/UK/CA. In the EU, valid only for B2B and only with
     a documented balancing test — write the one-sentence test into `basis`.
   - implied: they publicly published a business contact for this purpose. Weak; email only.
   - unknown / revoked ⇒ SUPPRESS. No exceptions, no "just this once".
3. CHANNELS ALLOWED per lead. Default deny. Rules:
   - email: allowed under explicit | legitimate_interest | implied
   - phone / sms / imessage: explicit ONLY, and only if not on any DNC list
   - linkedin: allowed if their profile is public and the message is professional
   Consumer (B2C) leads: email requires explicit or implied opt-in. Legitimate interest does NOT
   apply to consumers under this policy, regardless of jurisdiction. This is stricter than the law
   in some places, on purpose.
4. DNC + SUPPRESSION: check every handle against the venture DNC list, the global suppression list,
   prior bounces, and prior opt-outs. Any hit ⇒ status='suppressed' with the reason.
5. REGULATED POPULATION DETECTION: if the batch targets patients, minors, people in financial
   distress, immigration status, or anything a reasonable person would call sensitive, STOP and
   raise gate `regulated_population`. This gate never auto-approves at any autonomy level. Note:
   targeting NURSES is fine; targeting PATIENTS is not. Say which one this is.
6. Every outbound message D10 sends must carry an opt-out mechanism and a truthful sender identity.
   Record that requirement in the batch so D10 cannot claim it did not know.

OUTPUT: {passed[], failed[], suppressed[{lead_id, reason}], dnc_hits, jurisdictions[],
signed: true|false, blocking_issues[]}. If signed=false, say exactly what would make it signable.
```

### `prompts/D09/critic-rubric.md`

```
Reject the LeadBatch on any of:
1. A lead with zero source_urls, or a trigger without a source_url.
2. An email handle with verification_method='smtp' but deliverability != 'valid' — that is a guess.
3. Any lead in `leads[]` with status != 'suppressed' that compliance did not pass.
4. Duplicate identity_cluster_ids across two un-merged leads (run the resolver yourself on a 20-lead sample).
5. A warm lead missing warm_context.claim_ids — the whole point of the warm pool.
6. scoring.reasons containing adjectives instead of facts, or fewer than 1 reason on a T1 lead.
7. counts[] that do not add up to leads.length.
8. >15% of leads sharing a single company (list concentration — one lost deal kills the batch).
9. Any consumer lead with basis='legitimate_interest'.
10. Batch claims min_leads met by counting disqualified or suppressed leads.
```

---

## 7. The ICP fit scoring rubric

```
icp_fit = 100 × (0.30·firmographic + 0.20·role + 0.25·trigger + 0.15·engagement + 0.10·reachability)
          × disqualifier_gate                    # 0 if any disqualifier hit, else 1
```

| Subscore | 1.0 | 0.6 | 0.3 | 0.0 |
|---|---|---|---|---|
| **firmographic** | every T1 filter matched, ≥2 independently sourced | matches T1 on size+industry, geo unknown | matches T2 only | outside all tiers |
| **role** | exact `economic_buyer` or `champion` title from the messaging matrix | adjacent title, same function | same company, wrong function | unknown title |
| **trigger** | ≥1 `strong` trigger <30d | `moderate` trigger <90d | `weak` trigger <180d | none |
| **engagement** | warm, and their input changed a shipped feature | warm, interviewed | replied to D04 outreach but no interview | cold, no interaction |
| **reachability** | verified primary email `valid` + ≥1 allowed channel | `risky` email or a single non-email channel | handle exists, unverified | no allowed channel |

**Tiering:** `T1 ≥ 72` · `T2 55–71` · `T3 35–54` · `< 35` dropped (not "T4" — dropped, so it never
consumes a touch). `disqualified` is separate and absorbs any disqualifier hit at any score.

**Pioneer path.** The scorer runs `pioneer:lead-fit-v1`, a Fastino fine-tune, once the company has
**≥500 labelled leads**. A label is generated automatically by D10's outcome, not by a human:

```
label(lead) = 2 if deal_won | 1 if meeting_booked | 0 if replied_negative or no_reply_after_full_sequence
features    = the five subscore inputs + tier + trigger kind/recency + pool + channel used
```

Retrain when `new_labels ≥ 200` since last train. Adaptive inference: the Pioneer scorer is called
with a confidence threshold; below it the lead is re-scored by `haiku` with the full rubric and the
disagreement is logged as a training signal. **Fallback:** if Fastino is unavailable, `<500` labels
exist, or the model's rolling agreement with observed outcomes drops below 0.6, the manifest's
`fallback_model: haiku` runs the rubric verbatim and `scoring.scorer='haiku'` is recorded on every
lead. The Boardroom shows which scorer produced the list.

---

## 8. Dedup / identity resolution

Deterministic first (cheap, exact), probabilistic second (bounded), LLM last (rare and logged).

```
STAGE 1 — NORMALIZE
  email      → lowercase, strip +tags, strip dots for gmail.com only, punycode domains
  phone      → E.164
  domain     → registrable domain (eTLD+1), strip www, resolve known redirects
  name       → NFKD, strip accents/punctuation, lowercase, expand nicknames (Bob→Robert) via table
  company    → strip legal suffixes (Inc, LLC, Ltd, GmbH), collapse whitespace
  linkedin   → canonical /in/<slug>

STAGE 2 — BLOCKING KEYS (exact match on ANY ⇒ same cluster, no scoring needed)
  K1 normalized primary email
  K2 canonical linkedin slug
  K3 E.164 phone
  K4 (normalized_name, registrable_domain)

STAGE 3 — PROBABILISTIC, only within a candidate block of (registrable_domain) OR (name_soundex)
  sim = 0.35·jaro_winkler(name)
      + 0.25·(domain equal ? 1 : 0)
      + 0.15·jaro_winkler(company)
      + 0.15·title_function_match          # both map to the same function bucket
      + 0.10·geo_match
  sim ≥ 0.88  ⇒ merge
  0.72–0.88   ⇒ STAGE 4
  < 0.72      ⇒ distinct

STAGE 4 — LLM ADJUDICATION (haiku, batched 25 pairs/call, capped at 200 pairs/run)
  "Same human? Return {same: bool, confidence, reason}." Anything below confidence 0.8 ⇒ distinct.
  Every adjudication is logged with both records so it is auditable.

MERGE POLICY (deterministic, so merges are reproducible)
  pool:        warm wins over cold, always
  handles:     union; is_primary = highest (verified, deliverability) then most recent
  triggers:    union, dedup by (kind, source_url)
  provenance:  union of source_urls; origin = the warm origin if present, else earliest
  consent:     the STRICTEST state wins (revoked > unknown > implied > legitimate_interest > explicit
               is NOT the order — revoked always wins; otherwise the state with the strongest
               evidence_ref wins). Never merge your way into a broader permission.
  scoring:     recompute after merge. Never merge scores.
  identity_cluster_id = uuidv5(namespace=venture_id, name=lowest sorted blocking key)
  merged_from = [ids of absorbed records]   # nothing is deleted; the event log keeps both
```

**Cross-batch stability:** `identity_cluster_id` is derived, not random, so a person found in
batch 3 and again in batch 9 lands in the same cluster without a lookup. Suppression and opt-out are
stored *against the cluster id*, which is why an opt-out survives re-discovery from a new source —
the single most common compliance failure in outbound, closed by construction.

---

## 9. Compliance checklist

`leads.compliance` runs this list verbatim and its version is stamped on the batch.

| # | Check | Fail action |
|---|---|---|
| C1 | Every lead has a determined jurisdiction (or the strictest is applied) | block batch |
| C2 | Every lead has a lawful basis with a one-sentence justification | suppress lead |
| C3 | `explicit` basis carries an `evidence_ref` pointing to a real `human.consent_recorded` event | downgrade to unknown ⇒ suppress |
| C4 | No consumer lead uses `legitimate_interest` | suppress lead |
| C5 | Phone/SMS/iMessage channels only where basis = `explicit` | strip channel |
| C6 | All handles checked against venture DNC + global suppression + bounce history + prior opt-outs, **by identity_cluster_id** | suppress lead |
| C7 | No sensitive category collected (health status, financial accounts, gov IDs, DOB, protected characteristics) | drop field, log `agent.tool_failed`, re-run enrichment |
| C8 | No data obtained by circumventing a login, paywall, robots directive, or rate-limit block | drop lead, flag the researcher |
| C9 | Regulated/protected population targeting ⇒ gate `regulated_population` raised | block until founder decides |
| C10 | Batch declares that every D10 message must carry opt-out + truthful sender identity + a physical/postal identifier where required | block batch |
| C11 | EU/UK leads: balancing test written; no consumer email without opt-in | suppress lead |
| C12 | Warm leads: interview consent actually extended to *commercial follow-up*, not just to being interviewed | downgrade to `unknown`, route to D10 as "ask permission first" |
| C13 | Sending-domain protection: batch flags `risky` deliverability leads so D10 sends them last and caps them at 10% of any day's volume | annotate batch |
| C14 | Suppression list is written back **before** the batch is released, not after | block release |

C12 is the one people get wrong. A person who agreed to a 20-minute discovery call did not
necessarily agree to a sales sequence. D04 is instructed to capture the broader consent at call end
("can I come back to you when we've built it?"); where it did, `explicit` holds. Where it did not,
D10's first touch must be a permission ask, not a pitch — and the `Lead.consent.basis` string says so.

---

## 10. Execution flow

```
 trigger: build.deployed  |  cron leads.replenish (30m)  |  D10 pipeline_thin signal
        │
        ▼
┌──────────────────────┐
│ leads.head           │  load GTMPlan.icp_tiers + channels
└──────────┬───────────┘  load Interview[] + ClaimLedger + prior LeadBatch (dedup baseline)
           │
           ├── WARM PATH (always first, cheap, high value)
           │     build Lead per interviewee → warm_context{claim_ids, strongest_quote,
           │     influenced_features} → verify consent event → straight to compliance
           │
           └── COLD PATH (quota'd per tier)
                 ┌──────────────┬──────────────┬──────────────┐   PARALLEL
                 ▼              ▼              ▼
        R1 firmographic   R2 trigger-event  R3 community
        companies→people  funding/hiring/   subreddits/discord/
        2-source verify   stack/leadership  reviews, verbatim pain
                 └──────────────┴──────────────┘
                                │ raw candidates
                                ▼
                    ┌────────────────────────┐
                    │ leads.enricher ×2 (haiku)│ firmographics, handles,
                    └───────────┬─────────────┘ MX + SMTP verify, deliverability
                                ▼
                    ┌────────────────────────┐
                    │ DEDUP / IDENTITY RES.  │ stage 1→4, warm wins merges
                    └───────────┬─────────────┘
                                ▼
                    ┌────────────────────────┐
                    │ leads.scorer           │ pioneer:lead-fit-v1 (→haiku fallback)
                    └───────────┬─────────────┘ icp_fit, tier, reasons[], confidence
                                ▼
                    ┌────────────────────────┐
                    │ leads.compliance       │ C1..C14 · DNC · suppression writeback
                    └───────────┬─────────────┘ SIGNS or blocks
                                ▼
                     GATE cold_list_release  ──► Linq: "412 cold leads, 38 warm.
                     (auto at autonomous)          Top account: Mercy Regional. [Release][Review]"
                                ▼
                    ┌────────────────────────┐
                    │ leads.critic (10 rules)│ ≤1 revision
                    └───────────┬─────────────┘
                                ▼
                    LeadBatch signed ──► ArtifactReady ──► D10 (sequencing)
                                                        └► D11 (cost report)
                                                        └► D13 (list-quality telemetry)
```

---

## 11. Integrations

| Sponsor / tool | Use |
|---|---|
| **Pioneer (Fastino)** | `pioneer:lead-fit-v1` ICP scorer, trained on D10 outcome labels; adaptive inference with a confidence threshold and automatic `haiku` fallback |
| **Composio** | LinkedIn search (public profiles), Gmail *read* only (inbound/referral detection — D09 has no send scope), Calendar read for warm-context "we already met" |
| **Apify** | Structured actors for directories, review sites, subreddit/forum extraction, job-board scraping for hiring triggers |
| **Solari (Pinetree)** | JS-heavy or soft-walled sources: association member directories, incumbent customer pages, integration marketplaces. **Never logs in anywhere** — C8 |
| **Whop** | For community ventures, Whop's own category surfaces are a discovery source (`origin='whop_audience'`); D07 already listed the product there |
| **Band** | Publishes `LeadBatch` counts into the `sales↔finance` room so Finance sees pipeline volume before Sales spends; subscribes to D10's bounce/opt-out events to update suppression in near-real-time |
| **Linq** | `cold_list_release` gate card and the `regulated_population` block card |
| **Terac** | Not used directly. But when a list cannot be built by machine at all (e.g. the ICP lives offline — independent pharmacists with no web presence), the Head files a `HumanWorkRequisition` to D11/HR to hire a human researcher; the human's list arrives as a normal `Lead[]` with `origin='terac_research'` and goes through the *same* compliance signature |

---

## 12. Gates & escalations

| Gate | When | Auto at `autonomous` |
|---|---|---|
| `cold_list_release` | Before any cold batch reaches D10 | yes |
| `regulated_population` | Sensitive/protected audience detected by C9 | **never** |

| Escalation | Reason | Trigger | To |
|---|---|---|---|
| Cannot reach 25 usable leads | `needs_capability` | after both researchers exhaust quota | D13 (gap: no channel to this ICP) + founder |
| Enrichment provider credits exhausted | `needs_budget` | provider 402 | D11 Treasury |
| LinkedIn/Composio scope missing | `needs_credential` | OAuth scope error | Identity → founder via Linq |
| ICP is offline-only / unlistable by machine | `needs_human` | R1+R3 both return `surface_blocked` | D11/HR → **Terac** human researcher |
| Compliance cannot sign (C1/C10/C14 fail) | `needs_approval` | compliance `signed=false` | Founder, with the blocking issue verbatim |

---

## 13. Failure modes & fallbacks

| Failure | Detection | Fallback |
|---|---|---|
| Researcher hallucinates companies | Critic rule 1 + 2-source verification | Reject lead; researcher's next brief carries the rejected examples as negative shots |
| Guessed emails bounce | D10 bounce webhook → `human.dnc_added` | Any domain with ≥2 bounces switches to `observed`-only handles; pattern-derivation disabled for that domain permanently |
| Duplicate flood (same person, 6 sources) | dedup counts | Blocking keys catch it; if `duplicates_merged / total > 0.4`, the Head re-briefs researchers with the already-found set to stop re-mining the same surface |
| Pioneer model unavailable or drifting | API error / rolling agreement < 0.6 | `haiku` + rubric; `scoring.scorer` recorded; Boardroom shows a "fallback scorer" chip |
| Apify actor fails / rate-limited | tool error | Solari on the same source; if that fails, mark `surface_blocked` and report the gap — never fabricate |
| Sending domain reputation at risk | ≥3% bounce rate on a batch | Batch flagged; D10 throttled to warm-only until a clean batch ships; C13 volume cap enforced |
| Consent record missing for a warm lead | C3/C12 | Lead survives with `consent.state='unknown'` and D10 must send a permission-ask first touch — the lead is not lost, the approach changes |
| Budget degraded >80% | Meter | Researchers → 1 replica (trigger-event lens, highest value per token), cold target halved, warm pool always fully processed |
| Whole batch blocked by compliance | `signed=false` | Warm-only batch released (warm is almost always signable), cold batch held pending founder decision. Sales never stops entirely |

---

## 14. Definition of Done

1. Every D04 interviewee and replier is present as a `warm` lead with populated `warm_context` (claim_ids ≥1).
2. ≥25 leads with `status='new'`, `tier ∈ {T1,T2,T3}`, and ≥1 allowed channel.
3. Every lead has ≥1 `source_url`; every trigger has a URL and a recency.
4. Dedup run; `duplicates_merged` reported; no two un-merged leads share an `identity_cluster_id`.
5. Every lead scored, with `scorer`, `scorer_version`, `confidence`, and ≥1 factual reason.
6. `leads.compliance.signed = true`, C1–C14 recorded, suppression list written back **before** release.
7. No consumer lead on `legitimate_interest`; no SMS/voice channel without `explicit`.
8. Concentration: no single company >15% of the batch.
9. Cost report attached and within envelope.
10. Critic verdict `accept`, or one revision exhausted ⇒ `contested`.

---

## 15. Demo notes

D09 gets **~10 seconds**, immediately before the Sales beat at 2:55.

| t | On screen | Line |
|---|---|---|
| ~2:52 | Leads room. Two columns animate in: **WARM 38** (each card shows a face-less avatar, a date, and a truncated quote) and **COLD 412**. | "Two lists. The one on the left is everyone it interviewed." |
| ~2:54 | Hover a warm card: it expands to `claim_id CL-114 · spoke 2026-03-03 · influenced F-03, F-05`. | "This person's feedback changed two features. Sales knows that." |
| ~2:55 | Compliance stamp animates onto the batch: green check, `C1–C14 · signed by leads.compliance · 6 suppressed`. | "And it checked whether it's allowed to contact them, before it did." |

The compliance stamp is deliberately on screen — it is the cheapest possible answer to the judge
question *"isn't this a spam machine?"* ([`../00-vision/04-demo-and-judging.md`](../00-vision/04-demo-and-judging.md)).

---

## 16. Cost estimate — one run (38 warm + ~450 cold candidates → ~412 released)

| Line | Model / unit | Volume | USD |
|---|---|---|---|
| Head: load, quota, dispatch, merge, assemble | sonnet ~55k in / 9k out | 1 | 0.30 |
| Researcher R1 firmographic | sonnet ~60k in / 12k out | 1 | 0.36 |
| Researcher R2 trigger-event | sonnet ~62k in / 13k out | 1 | 0.38 |
| Researcher R3 community | sonnet ~48k in / 10k out | 1 | 0.29 |
| Enrichers ×2 | haiku ~40k in / 14k out each | 2 | 0.11 |
| Dedup: deterministic + 180 LLM adjudications | haiku, batched 25/call | 8 calls | 0.02 |
| Scorer | `pioneer:lead-fit-v1`, 450 leads | 450 | 0.05 |
| Compliance | sonnet ~30k in / 6k out | 1 | 0.18 |
| Critic | sonnet ~26k in / 3k out | 1 | 0.12 |
| Apify actor runs | structured sources | 9 | 0.22 |
| Solari sessions | walled sources | 6 | 0.12 |
| Email verification (MX + SMTP) | per address | 450 | 0.18 |
| Sandbox | 4 vCPU | ~7 min | 0.06 |
| **Total** | | | **≈ $2.39** (envelope $4.00, hard cap $7.00) |

Warm-only run (fallback when cold is blocked): **≈ $0.34**.

---

**Cross-links:** [`D04-outreach-validation.md`](D04-outreach-validation.md) ·
[`D08-strategy.md`](D08-strategy.md) · [`D10-sales.md`](D10-sales.md) ·
[`D11-finance-hr.md`](D11-finance-hr.md) ·
[`../01-platform/12-safety-and-compliance.md`](../01-platform/12-safety-and-compliance.md) ·
[`../03-integrations/12-pioneer-fastino.md`](../03-integrations/12-pioneer-fastino.md)
