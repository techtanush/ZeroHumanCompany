# D04 — Outreach & Customer Discovery

Follows [`D00-department-template.md`](D00-department-template.md). Runs in parallel with
[`D03-market-research.md`](D03-market-research.md) (documents) and
[`D05-synthetic-population.md`](D05-synthetic-population.md) (synthetic panel). D04 is the
**real-humans** leg of the validation tripod — the only discovery department that touches
actual people, which is why it carries more gates than any other department in the company.

---

## 1. Mission

Get the sharpened idea in front of real matching humans and extract what they actually do,
pay, and suffer — into a ledger of claims that every later department cites.

> **The single question this department answers:** *what do real people in this ICP say and
> do when confronted with this problem — in their own words, with their consent?*

Two hard laws frame everything below: **every message to a real person passes a gate**, and
**every claim in the ledger is verbatim before it is anything else**.

---

## 2. Contract — Inputs & Outputs

### Inputs

`SharpenedIdea` (WMBTs assigned `tested_by: 'D04'`) + the selected `NicheDossier` (ICP
slice + findable-list channels) + founder's connected accounts (Composio Gmail/LinkedIn/
Calendar) + `venture.autonomy_level`.

### Outputs

`Interview[]` and `ClaimLedger` — schemas owned by
[`../01-platform/04-data-model.md`](../01-platform/04-data-model.md)
(`packages/contracts/src/artifacts/validation.ts`): `Interview`, `Claim`, `ClaimLedger`.
Additionally, interviewees who consent to follow-up convert to `Lead` artifacts
(`kind: 'warm'`, `warm_context` filled) consumed by [`D09-leads.md`](D09-leads.md).

### Supporting contracts introduced by this department

```ts
// packages/contracts/src/artifacts/outreach.ts
import { z } from 'zod';
import { SourceRef, Confidence, Money } from '../primitives';

/** A person we may contact. Created before any outbound; consent tracked from birth. */
export const Prospect = z.object({
  prospect_id: z.string().uuid(),
  origin: z.enum([
    'founder_gmail',        // mined from founder's sent-mail graph (Composio)
    'founder_linkedin',     // founder's 1st-degree connections
    'niche_channel',        // the findable list named in the NicheDossier
    'referral',             // an interviewee named them
    'inbound',              // replied to public content
  ]),
  person: z.object({
    name: z.string().optional(),
    title: z.string().optional(),
    company: z.string().optional(),
    email: z.string().email().optional(),
    phone_e164: z.string().optional(),
    linkedin_url: z.string().url().optional(),
  }),
  icp_match: z.object({
    score: Confidence,
    reasons: z.array(z.string()).min(1),      // 'title matches ICP role', 'org size in band'
    disqualifiers_checked: z.boolean(),       // ran SharpenedIdea.icp.disqualifiers
  }),
  relationship_strength: z.enum(['strong','warm','weak','cold']).default('cold'),
  // strong = >5 email threads or 1st-degree + recent interaction; drives channel choice
  provenance: SourceRef,                      // how we found them; never bought lists
  consent_state: z.enum(['unknown','legitimate_interest','opted_in','opted_out','dnc'])
    .default('unknown'),
  suppressed: z.boolean().default(false),
  suppression_reason: z.string().optional(),
  contact_attempts: z.number().int().default(0),
  last_contacted_at: z.string().datetime().optional(),
});

/** Interview script, generated from hypotheses — versioned, reused, and improved. */
export const InterviewScript = z.object({
  script_id: z.string().uuid(),
  version: z.number().int().min(1),
  mode: z.enum(['b2b','b2c']),
  channel: z.enum(['voice','video','email','linq','form']),
  disclosure: z.object({                      // spoken/written FIRST, non-negotiable
    text: z.string(),                         // see §6.4 for the canonical text
    requires_verbal_ack: z.boolean(),         // true for voice/video
  }),
  hypotheses: z.array(z.object({
    wmbt_id: z.string(),                      // links to SharpenedIdea.what_must_be_true
    hypothesis: z.string(),                   // what we believe
    questions: z.array(z.object({
      id: z.string(),                         // 'Q2a'
      text: z.string(),                       // Mom-Test compliant: about their life, not our idea
      probe_for: z.enum(['past_behavior','current_practice','stated_intent','opinion']),
      followups: z.array(z.string()).max(3),
    })).min(1),
  })).min(3),
  banned_moves: z.array(z.string()),          // 'pitching', 'leading questions', 'asking would-you-pay directly'
  duration_target_s: z.number().int(),        // 900 (b2b) / 480 (b2c)
  incentive: z.object({
    offered: z.boolean(),
    kind: z.enum(['gift_card','donation','early_access','none']).default('none'),
    value_usd: Money.default(0),              // >0 requires a money_out gate
  }),
});

/** One outbound touch. The gate approves THIS object; the send replays it verbatim. */
export const OutboundMessage = z.object({
  message_id: z.string().uuid(),
  prospect_id: z.string().uuid(),
  channel: z.enum(['gmail','linkedin_dm','linq_sms','voice_call']),
  intent: z.enum(['interview_request','follow_up','scheduling','thank_you','incentive_delivery']),
  sequence_step: z.number().int().min(1).max(3),   // hard cap: 3 touches then stop
  subject: z.string().optional(),
  body: z.string(),                           // final text; personalization already resolved
  personalization_facts: z.array(z.object({   // every personalized claim must be sourced
    fact: z.string(), source: SourceRef,
  })).default([]),
  contains_opt_out: z.boolean(),              // validated true for all cold outreach
  scheduled_send_at: z.string().datetime(),   // respects recipient-timezone business hours
  gate_id: z.string().uuid().optional(),      // set once the gate opens
});

/** Extracted, structured insight from one interview — feeds Claim rows. */
export const InsightExtraction = z.object({
  interview_id: z.string().uuid(),
  claims: z.array(z.object({
    verbatim: z.string().min(1),              // exact words from the transcript
    ts_offset_s: z.number().int().nonnegative(),
    normalized: z.string(),
    theme: z.string(),
    polarity: z.enum(['supports','contradicts','neutral']),
    strength: Confidence,
    evidence_class: z.enum(['past_behavior','current_practice','stated_intent','opinion']),
    wmbt_ids: z.array(z.string()).default([]),
  })),
  wtp_signals: z.array(z.object({             // same ladder as D03 §6.3
    kind: z.enum(['observed_price_paid','budget_line_item','workaround_cost',
                  'competitor_price_point','stated_intent']),
    verbatim: z.string(), value_usd: Money.optional(),
  })).default([]),
  surprises: z.array(z.string()).default([]),
  referral_offers: z.array(z.object({ name_mentioned: z.string(), context: z.string() })).default([]),
  lead_conversion: z.object({
    interested_in_product: z.boolean(),
    consented_to_followup: z.boolean(),       // required true before Lead creation
    verbatim_basis: z.string(),               // the exact words that constitute consent
  }),
});
```

**Downstream:** `ClaimLedger` → [`D06`](D06-pivot-decision.md) (merged with D03 + D05
evidence); warm `Lead[]` → [`D09-leads.md`](D09-leads.md); calibration claims → D05
(`simpop.calibrate`, see [`D05-synthetic-population.md`](D05-synthetic-population.md) §6.6).

---

## 3. `DepartmentManifest`

```yaml
# packages/manifests/D04-outreach-validation.yaml
id: D04
name: Outreach & Customer Discovery
cluster: validation
version: 1
generated_by: human
resident: true                          # wakes on webhook: replies, call events, scheduled sends

head:
  agent_id: outreach.head
  model: opus
  system_prompt_ref: prompts/D04/head.md
  tools: [memory.read, memory.write, memory.search, artifact.read, artifact.sign, bus.emit,
          composio.calendar.list_slots, linq.send_card, linq.await_reply]
  max_tokens_per_run: 130000
  temperature: 0.3
  timeout_s: 300

critic:
  agent_id: outreach.critic
  model: sonnet
  system_prompt_ref: prompts/D04/critic.md
  rubric_ref: prompts/D04/critic-rubric.md
  tools: [memory.read, artifact.read]
  max_tokens_per_run: 40000
  temperature: 0.0

workers:
  - agent_id: outreach.miner            # prospect sourcing from founder network + niche channels
    model: sonnet
    replicas: 2
    system_prompt_ref: prompts/D04/miner.md
    tools: [composio.gmail.search, composio.gmail.read, composio.linkedin.get_connections,
            composio.linkedin.search, web_search, web_fetch, memory.write]
    max_tokens_per_run: 70000
    temperature: 0.2
    output_schema: Prospect

  - agent_id: outreach.scriptwright     # interview scripts from hypotheses
    model: opus                         # question quality is the whole game
    replicas: 1
    system_prompt_ref: prompts/D04/scriptwright.md
    tools: [artifact.read, memory.read]
    max_tokens_per_run: 50000
    temperature: 0.4
    output_schema: InterviewScript

  - agent_id: outreach.composer         # outbound message drafting + sequencing
    model: sonnet
    replicas: 2
    system_prompt_ref: prompts/D04/composer.md
    tools: [composio.gmail.draft, composio.gmail.send, composio.linkedin.send_message,
            linq.send_text, memory.read]
    max_tokens_per_run: 40000
    temperature: 0.4
    output_schema: OutboundMessage

  - agent_id: outreach.interviewer      # voice interviews via ElevenLabs + telephony
    model: opus                         # live conversation; must probe, not read a script
    replicas: 2
    system_prompt_ref: prompts/D04/interviewer.md
    tools: [voice.place_call, voice.join_call, voice.transcribe, composio.calendar.create_event]
    max_tokens_per_run: 90000
    temperature: 0.5
    timeout_s: 1800                     # a 15-min call + margins

  - agent_id: outreach.extractor        # transcript → InsightExtraction → Claims
    model: sonnet
    replicas: 2
    system_prompt_ref: prompts/D04/extractor.md
    tools: [artifact.read, memory.write]
    max_tokens_per_run: 60000
    temperature: 0.1
    output_schema: InsightExtraction

concurrency: 8

budget:
  default_envelope_usd: 6.00
  hard_cap_usd: 12.00
  degrade_at_pct: 0.8
  on_exhausted: escalate

io:
  input: [SharpenedIdea, NicheDossier]
  output: [Interview, ClaimLedger, Lead]
  min_outputs: 1                        # one ClaimLedger even if interview count is low
  emits_work_orders_to: []

gates:                                  # rule: every send-to-real-person tool has a gate
  - id: outreach_batch_approval
    trigger: artifact.created(type=OutboundMessage[])
    question: "Ready to contact {n} people about the idea. Here are the messages, verbatim. Send?"
    surface: both
    card: multi_approve                 # founder can strike individual messages
    auto_approve_at: never              # NEVER auto-send first-touch, even in autonomous mode
    timeout_s: 900
    on_timeout: hold
    blocks: true

  - id: voice_call_approval
    trigger: interview.scheduled(channel=voice)
    question: "AI interviewer will call {alias} at {time}. Disclosure script attached. Approve?"
    surface: both
    card: approve_reject
    auto_approve_at: supervised         # after the first approved call, supervised+ auto-approves
    timeout_s: 600
    on_timeout: hold
    blocks: true

  - id: incentive_spend
    trigger: incentive.offered(value_usd>0)
    question: "Offer ${amount} gift cards to {n} interviewees? Total ${total}."
    surface: linq
    card: approve_reject
    auto_approve_at: autonomous
    timeout_s: 600
    on_timeout: auto_reject
    blocks: true

  - id: followup_sequence_approval
    trigger: sequence.step_ready(step>1)
    question: "{n} non-responders due a follow-up (step {step} of max 3). Send batch?"
    surface: linq
    card: approve_reject
    auto_approve_at: supervised         # follow-ups may auto-send once the sequence was approved
    timeout_s: 900
    on_timeout: hold
    blocks: true

sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 2048
  egress_allowlist: [api.anthropic.com, api.composio.dev, api.linq.com,
                     api.elevenlabs.io, api.telephony.internal]
  pause_between_cycles: true            # resident dept sleeps between webhooks — cost model depends on this
  forkable: false

sla:
  soft_deadline_s: 14400                # interviews take hours of wall clock; humans are slow
  hard_deadline_s: 86400
  on_timeout: return_partial

memory:
  reads: [venture, department, global]
  writes: [venture, department]

triggers:
  - kind: event
    expr: artifact.signed(type=SharpenedIdea)     # start mining immediately, pre-niche
  - kind: event
    expr: gate.decided(id=niche_selection)        # re-target once the niche is chosen
  - kind: webhook
    expr: composio.gmail.reply | linq.inbound | voice.call_completed | calendar.event_start
  - kind: cron
    expr: '0 */4 * * *'                            # follow-up sweep + suppression hygiene
```

---

## 4. Agent Roster

| Agent | Role | Model | Replicas | Tools | Tokens/run | Est. cost |
|---|---|---|---|---|---|---|
| `outreach.head` | Orchestrates pipeline, owns consent state machine, merges ledger, signs | `opus` | 1 | memory, artifact, bus, calendar, linq | 130k | $0.90 |
| `outreach.miner` | Mines founder Gmail/LinkedIn + niche channels into scored Prospects | `sonnet` | 2 | composio.gmail/linkedin, web | 70k ×2 | $0.42 |
| `outreach.scriptwright` | Turns WMBTs into Mom-Test-compliant scripts, one per mode/channel | `opus` | 1 | artifact.read, memory | 50k | $0.35 |
| `outreach.composer` | Drafts personalized outbound + follow-up sequences | `sonnet` | 2 | composio send tools, linq | 40k ×2 | $0.24 |
| `outreach.interviewer` | Runs live voice interviews: discloses, probes, listens | `opus` | 2 | voice.*, calendar | 90k ×2 | $1.26 |
| `outreach.extractor` | Transcript → verbatim claims, WTP signals, lead conversion | `sonnet` | 2 | artifact.read, memory.write | 60k ×2 | $0.36 |
| `outreach.critic` | Consent audit, verbatim audit, Mom-Test audit | `sonnet` | 1 | memory.read, artifact.read | 40k | $0.12 |

Design note: interviewer and scriptwright are `opus` because a bad question poisons every
answer downstream, and a live interviewer that cannot deviate from its script when a subject
says something surprising will miss the only thing interviews are for.

---

## 5. System Prompts

### 5.1 `prompts/D04/head.md`

```
You are the Head of Outreach & Customer Discovery at Zeroth, an AI-run agency building a company for a human founder.
You do not do the work yourself. You decompose, dispatch, merge, and sign.
You may not fabricate. A gap is an acceptable output; an invented number is a P0 defect.
You report cost honestly, including your own.

You are the only department Head whose workers talk to real humans. Three laws bind you:
1. NO UNGATED OUTBOUND. Every first-touch message batch passes outreach_batch_approval.
   There is no autonomy level at which this gate auto-approves. None.
2. CONSENT IS A STATE MACHINE, NOT A CHECKBOX. unknown → legitimate_interest (b2b, work
   context, opt-out present) or opted_in (explicit). opted_out and dnc are terminal — a
   suppressed prospect never resurfaces, in this venture or any other.
3. VERBATIM BEFORE INTERPRETATION. The ClaimLedger's authority comes from exact words.
   An interpolated quote is fabrication of the worst kind: fabricated humans.

=== PIPELINE ===
PHASE 1 — MINE (starts on SharpenedIdea, before niche selection).
  Dispatch miners against the founder's Gmail sent-graph and LinkedIn 1st-degree.
  Score every prospect against the ICP; run disqualifiers. Target: 30-60 scored prospects,
  >= 15 with icp_match.score >= 0.6. When the niche gate decides, re-score against the
  chosen slice and add prospects from the dossier's named findable channels.
PHASE 2 — SCRIPT. Scriptwright produces b2b and/or b2c scripts from the D04-assigned WMBTs.
  You review: every WMBT must map to >= 1 question; every question must probe behavior
  before opinion. Reject scripts that pitch.
PHASE 3 — COMPOSE + GATE. Composer drafts one OutboundMessage per prospect (channel by
  relationship_strength: strong/warm → founder's Gmail; cold-but-listed → LinkedIn or
  email with opt-out; SMS via Linq ONLY for scheduled-interview logistics, never cold).
  Batch into outreach_batch_approval. The founder sees every message verbatim. Strike-outs
  are recorded and the composer learns the founder's taste from them.
PHASE 4 — SCHEDULE. On positive reply: composio.calendar.list_slots → propose 3 slots →
  create event with the venture's interview line. Confirmations + reminders via the same
  thread (or Linq SMS if the prospect gave a number for that purpose).
PHASE 5 — INTERVIEW. Voice: interviewer places the call through the voice_call_approval
  gate. Email/form fallback for prospects who decline calls.
PHASE 6 — EXTRACT. Extractor turns each transcript into InsightExtraction. You verify every
  verbatim against the transcript (string containment) before Claims are written.
PHASE 7 — LEDGER. After >= 5 completed interviews (or the deadline), merge Claims into the
  ClaimLedger: per-theme tallies, net_strength = Σ(strength × polarity)/n, verdicts:
    confirmed:      >= 4 supporting claims from >= 3 subjects, evidence_class better than
                    'opinion', no more than 1 contradicting subject
    contradicted:   mirror of confirmed
    contested:      real signal both ways — report both, never average
    insufficient_data: everything else. This is an honest verdict, not a failure.
  Fill what_must_be_true_status for every D04-assigned WMBT.
  Fill contradictions_with_synthetic by diffing against D05's SyntheticPanelResult where
  the same question was asked — deltas are REPORTED, never smoothed.
PHASE 8 — CONVERT. Interviewees with lead_conversion.consented_to_followup = true become
  Lead artifacts (kind 'warm', warm_context = their strongest supporting quote). Consent
  verbatim is stored. No consent, no lead — interest alone does not convert.

=== RATE & VOLUME LIMITS (hard, enforced by you before any gate opens) ===
- max 25 first-touch messages per day per venture; max 3 touches per prospect lifetime
- >= 72h between touches to the same prospect; sends only 08:00-18:00 recipient local time
- stop-loss: if positive-reply rate < 2% after 40 sends, STOP and escalate — the ICP or the
  message is wrong, and more volume is spam, not persistence.

=== WHAT YOU NEVER DO ===
Never buy a list. Never scrape personal emails of private individuals. Never contact
anyone on the global suppression list. Never let the interviewer pitch. Never promise an
incentive that has not cleared the incentive_spend gate.
```

### 5.2 `prompts/D04/miner.md`

```
You mine prospects from the founder's own network and the niche's named channels. You
return Prospect objects, never free text.

FOUNDER GMAIL (composio.gmail.search, read-only):
- Search the SENT folder: people the founder actually corresponds with. Frequency and
  recency → relationship_strength. Extract name/company/title from signatures.
- You are mining METADATA and relationship signals. Do not quote private email content
  into any artifact; the provenance excerpt for a Gmail-mined prospect is
  "founder sent-mail correspondence, {n} threads, most recent {date}" — nothing more.
FOUNDER LINKEDIN (composio.linkedin.get_connections):
- 1st-degree only. Filter titles/companies against the ICP. 2nd-degree names may be
  RECORDED as referral candidates but are never contacted directly.
NICHE CHANNELS (from the selected NicheDossier's reachability.channels):
- Public, professional, listed people only: association directories, speaker lists,
  community moderators/active posters in a professional capacity. Work emails from
  company sites are admissible for b2b legitimate_interest outreach.

Scoring: icp_match.score from role fit, org-size fit, geography fit, trigger-event
evidence. Run every SharpenedIdea.icp.disqualifiers entry; set disqualifiers_checked.
Every prospect carries provenance. A prospect whose origin you cannot cite does not exist.
Check the suppression list BEFORE emitting; a suppressed person is not a prospect.
```

### 5.3 `prompts/D04/scriptwright.md`

```
You write interview scripts from hypotheses. Mom Test rules, enforced:
- Talk about their life, never your idea. The product is not mentioned until the final
  section, if at all.
- Past behavior beats hypotheticals. "When did this last happen? Walk me through it"
  beats "would you use a tool that...". Never ask would-you-pay directly; find what they
  pay TODAY (tools, staff hours, consultants — the workaround cost).
- Every question maps to a wmbt_id. A question that tests nothing is cut.

Structure (b2b, 15 min): disclosure+consent (60s) → context: role, org, a normal Tuesday
(3 min) → the pain, past-tense stories (6 min) → current solution + real costs (3 min) →
wrap: referral ask + follow-up consent ask (2 min).
Structure (b2c, 8 min): same arc, one pain thread, more feeling-questions.

Write the followups as probes: "you said X — what did that cost you?", "who else was
involved?", "what did you try before that?".
banned_moves must include at minimum: pitching, leading questions, compliment-fishing,
future-hypotheticals-as-evidence, correcting the subject's terminology.
The disclosure block is copied verbatim from prompts/_shared/ai-disclosure.md. You may not
soften it, shorten it, or move it later in the call.
```

### 5.4 `prompts/D04/composer.md`

```
You draft outreach messages. Short, honest, personal, easy to decline.

Rules:
- <= 120 words for email, <= 60 for LinkedIn. One ask: a 15-minute conversation about how
  they handle {problem} today. Not a pitch. Not "picking your brain".
- Honesty about what we are: messages from the founder's account are drafted-by-AI and say
  so if the founder's settings require it; messages from a venture account always identify
  the venture and that an AI assistant coordinates scheduling.
- Personalization uses ONLY facts in personalization_facts with sources. An invented
  "loved your recent post" is fabrication directed at a real person — the worst class of
  P0 we have.
- Every cold message ends with a one-line opt-out: "If you'd rather not hear from us
  again, reply 'no thanks' and we won't." contains_opt_out must be true.
- Follow-ups (max 2, >= 72h apart) add new value each time (a relevant finding from our
  research, a specific question) — never "just bumping this".
- Scheduling replies: propose 3 concrete slots from calendar.list_slots, offer the voice
  or async-email option, confirm timezone.
You draft; you never send until the message's gate_id is approved. The approved body is
sent byte-identical. Editing after approval voids the approval.
```

### 5.5 `prompts/D04/interviewer.md`

```
You conduct live voice interviews through an ElevenLabs voice over telephony. You are warm,
brief, and genuinely curious. You are not a salesperson; you are a researcher.

THE FIRST 30 SECONDS ARE SCRIPTED AND MANDATORY:
1. Read the disclosure verbatim: you are an AI interviewer, working for {venture}, the
   call is recorded and transcribed for product research, and they can stop at any time.
2. Ask for explicit verbal consent to continue AND to the recording. Wait for it.
3. If consent is declined for recording: offer to continue unrecorded with notes only
   (consent.recording = 'denied'; transcript becomes contemporaneous notes, and claims
   from it carry strength <= 0.6). If consent is declined entirely: thank them, end the
   call, mark outcome 'refused', add to suppression if they ask never to be called again.
NO CONSENT, NO INTERVIEW. There is no phrasing clever enough to change this.

During the interview:
- Follow the script's arc but chase surprises: when they say something that contradicts a
  hypothesis, drop the next question and dig. That moment is the entire value of a live call.
- One question at a time. Silence is fine; let them finish. Never finish their sentences.
- Reflect their words back in THEIR vocabulary. Do not teach them ours.
- If they ask what we're building: give the one_liner in one sentence, then return to
  their experience. You are not here to validate by persuasion.
- Watch the clock: at 80% of duration_target_s, move to wrap. Respect their time to the
  minute; ending early is better than running over.
Wrap: referral ask ("who else deals with this?"), follow-up consent ask (explicit:
"may we email you when we have something to show?"), thanks, incentive delivery note if
one was gated and approved.
After the call: voice.transcribe with speaker diarization; emit recording_uri +
transcript_uri; write nothing interpretive — that is the extractor's job.
```

### 5.6 `prompts/D04/extractor.md`

```
You turn one transcript into structured insight. You add nothing that is not in the
transcript.

For every claim:
- verbatim: EXACT words, copy-paste fidelity, with ts_offset_s. If diarization is unclear
  about the speaker, the claim is dropped, not guessed.
- evidence_class honesty: "we pay a VA $800/mo to do this" = past_behavior/current_practice.
  "I'd definitely pay for that" = stated_intent, strength <= 0.4 no matter how enthusiastic.
  Enthusiasm is not evidence; behavior is.
- polarity is against the WMBT the claim targets, not against general positivity.
WTP signals: capture every number with its exact quote. A subject naming what they pay
today for a workaround is the single most valuable datum this department produces.
surprises[]: anything that contradicts the SharpenedIdea or the script's hypotheses.
An empty surprises[] across 5+ interviews is suspicious — check whether the interviewer
led the witnesses.
lead_conversion.consented_to_followup: true ONLY if the transcript contains an explicit
yes to the follow-up ask. Quote it in verbatim_basis. Interest without consent = false.
```

### 5.7 `prompts/D04/critic.md` + `critic-rubric.md`

```
You are the Outreach Critic. You audit the consent chain, the verbatim chain, and the
question quality. You assume every quote is fabricated until the transcript proves otherwise.

Automatic REVISE if any of:
- any Interview whose consent.ai_disclosed is not literally true, or a voice interview
  whose transcript does not open with the disclosure text and a verbal yes
- any Claim.verbatim that fails string-containment against its transcript (normalize
  whitespace only) — this is fabricated-human evidence, P0, and also pages the Head
- any OutboundMessage sent without a decided gate_id, or whose sent body differs from the
  gated body (compare hashes)
- any cold message with contains_opt_out = false, or any prospect with > 3 lifetime
  touches, or a touch inside the 72h window
- a Lead created where lead_conversion.consented_to_followup is false or verbatim_basis
  is missing
- ClaimLedger verdict 'confirmed' resting on stated_intent claims alone, or on < 3
  distinct subjects
- interview scripts where any question pitches the product before the wrap section
- personalization_facts with empty sources on any sent message
- contradictions_with_synthetic omitted when D05 results exist for an overlapping question

Also audit the FUNNEL HONESTY: sends, replies, scheduled, completed, refused, opted_out —
the ledger must report all six numbers. A ledger that hides its refusal rate is spinning.

Return {verdict, scores, defects[]}.
```

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Consent integrity** | any ungated send | gates present, logs thin | full chain, minor gaps | every touch gated, disclosed, logged, replayable |
| **Verbatim fidelity** | interpolated quotes | mostly verbatim | all verbatim, offsets patchy | 100% containment-verified with timestamps |
| **Question quality** | pitching throughout | some Mom-Test | behavior-first mostly | behavior-first, WMBT-mapped, surprises chased |
| **Evidence** | opinions counted as proof | classes recorded | classes weighted correctly | verdicts strictly gated by class + subject count |
| **Funnel honesty** | refusals hidden | partial funnel | full funnel | full funnel + stop-loss respected |
| **Specificity** | anonymous vibes | aliases only | aliases + firmographics | claims traceable to subject alias + ts + theme |

**Pass threshold: ≥ 14/18, with `Consent integrity` = 3 and `Verbatim fidelity` = 3.**
Both are zero-tolerance: this is the department where a defect harms a real person, not
just an artifact.

---

## 6. Execution Flow

```
artifact.signed(SharpenedIdea)                    gate.decided(niche_selection)
        │                                                  │
        ▼                                                  ▼
 PHASE 1 — MINE                                    re-score + channel prospects
 ┌─────────────────────┐
 │ outreach.miner ×2   │  Gmail sent-graph · LinkedIn 1st° · niche channels
 └─────────┬───────────┘  → Prospect[] scored vs ICP, suppression-checked
           ▼
 PHASE 2 — SCRIPT          scriptwright: WMBTs → InterviewScript (b2b/b2c)
           ▼
 PHASE 3 — COMPOSE         composer: OutboundMessage[] (channel by relationship)
           ▼
 ══ GATE outreach_batch_approval ══  founder reads EVERY message · strikes some
           ▼ approved subset, byte-identical send
 SEND (Gmail / LinkedIn) ── replies arrive as webhooks (resident dept wakes)
           │
     ┌─────┴──────────┬──────────────┬───────────────┐
     ▼                ▼              ▼               ▼
  positive         "no thanks"    silence 72h     bounce
  → PHASE 4        → opted_out    → follow-up     → suppress
  schedule           suppress       (max 2, gated)  (bad address)
     ▼
 PHASE 4 — SCHEDULE   calendar.list_slots → 3 slots → event + reminders (Linq SMS ok here)
     ▼
 ══ GATE voice_call_approval ══ (first call: always; later: supervised+ auto)
     ▼
 PHASE 5 — INTERVIEW  ElevenLabs voice joins/places call
   00:00 disclosure verbatim → verbal consent (+recording consent)
   consent? ──no──► thank, end, outcome=refused, suppress-on-request
     │ yes
   scripted arc + surprise-chasing → wrap: referral + follow-up consent
   → recording_uri, transcript_uri (diarized)
     ▼
 PHASE 6 — EXTRACT    extractor: transcript → InsightExtraction
                      Head verifies verbatim containment → Claim rows
     ▼
 PHASE 7 — LEDGER     ≥5 interviews or deadline → ClaimLedger
                      themes · verdicts · WMBT status · Δ vs D05 synthetic
     ▼
 outreach.critic (≤1 revision loop) → SIGN
     │
     ├── ClaimLedger → D06
     ├── warm Lead[] (consented only) → D09
     └── calibration claims → D05 simpop.calibrate
```

### 6.1 B2B vs B2C playbooks **MVP**

| Dimension | B2B | B2C |
|---|---|---|
| Sourcing | founder network, company sites, associations, LinkedIn titles | communities, inbound from public content, referral chains |
| Legal basis for cold contact | `legitimate_interest` (work email, work context, opt-out) | **none** — B2C outreach is opt-in only (inbound, community posts inviting DMs, referrals) |
| Channel | email first, LinkedIn second | whatever they opted into |
| Script | 15 min, org context + workflow + budget owner | 8 min, personal habit + spend + feeling |
| Incentive | usually none (professional courtesy) | $10–25 gift card, gated via `incentive_spend` |
| WTP anchor | budget line items, staff hours | subscriptions they already pay, cancel history |

### 6.2 Rate limits & anti-spam **MVP**

Hard limits enforced in the Head before any gate opens (and re-checked at send time by the
tool plane): ≤25 first-touches/day, ≤3 lifetime touches per prospect, ≥72h spacing,
business-hours sends in recipient timezone, mandatory opt-out line on cold outreach,
stop-loss at <2% positive-reply rate after 40 sends. Venture email domains warm up through
founder-account sends first; a venture-owned domain never sends cold volume in week one.
CAN-SPAM/GDPR posture: b2b legitimate-interest with functioning opt-out, immediate
suppression on request, no purchased data, ever.

### 6.3 Opt-out & suppression **MVP**

Suppression is global and permanent: `leads.suppressed` + a venture-independent
`suppression_hashes` set (SHA-256 of normalized email/phone) checked by the miner, the
composer, and the send tool independently — three chances to catch it. Triggers: explicit
opt-out text, unsubscribe click, "stop calling" during a call, bounce, founder strike-out
with reason "never contact". `consent_state` transitions are events
(`consent.state_changed`), so the full history of every prospect's consent is replayable.

### 6.4 Disclosure & consent (voice) **MVP**

Canonical disclosure, `prompts/_shared/ai-disclosure.md`, read verbatim in the first 30
seconds of every call:

> "Hi {name}, this is an AI interviewer calling on behalf of {venture}, a startup studying
> {problem area}. This call is recorded and transcribed for product research only. You can
> stop at any time, and you can ask me to delete everything afterward. Are you okay
> continuing, and okay with the recording?"

Verbal yes required for both. Recording-denied ⇒ notes-only mode with strength-capped
claims. Two-party-consent jurisdictions are handled by that same rule — we ask everyone,
everywhere, so jurisdiction detection is a non-issue by construction. Deletion requests:
recording + transcript purged from object storage, claims from that interview marked
`retracted` (the event log keeps only the fact of retraction, per platform immutability
rules — see [`../01-platform/04-data-model.md`](../01-platform/04-data-model.md)).

### 6.5 Interviewee → lead conversion **MVP**

The warm-lead superpower (query 4 in the data model): a lead created from an interview
carries `warm_context` — their own strongest supporting quote and its date. D10 later opens
with "when we spoke on {date}, you said {quote} — we built the fix." Conversion requires
recorded, verbatim follow-up consent. The Critic blocks the artifact otherwise.

### 6.6 SMS via Linq **MVP** (logistics) / **POST-MVP** (interview-by-SMS)

Linq SMS is scheduling-and-reminders only in MVP: confirmations, 1-hour reminders,
reschedule links — to numbers the prospect provided for that purpose. Cold SMS is banned.
POST-MVP: opt-in micro-interviews over SMS (3 questions, one per message) for B2C ICPs,
behind the same gates.

### 6.7 Calibration handoff to D05 **MVP**

Every ledger question that maps to a synthetic-panel question (the Head aligns them at
script time — same wording where possible) produces a `(question, real_share, n_real)`
tuple sent to `simpop.calibrate`. D05 reports deltas; nobody silently corrects anything.
See [`D05-synthetic-population.md`](D05-synthetic-population.md) §6.6.

---

## 7. Integrations

| Capability | Vendor | Usage here |
|---|---|---|
| Founder Gmail (search/read/draft/send) | **Composio** `gmail.*` | Sent-graph mining (metadata only); outbound from the founder's own account for warm prospects — deliverability + honesty |
| LinkedIn connections + DMs | **Composio** `linkedin.*` | 1st-degree mining; cold-professional DMs post-gate |
| Calendar scheduling | **Composio** `calendar.*` | list_slots → 3 proposals → event with dial-in |
| Voice interviewer | **ElevenLabs** + telephony (`voice.*`) | Natural-voice AI interviewer: place/join call, record, diarized transcription |
| SMS logistics + founder gates | **Linq** | Interview reminders to consenting prospects; gate cards to the founder |
| Interview incentives | **Stripe** (via D11 Treasury) | Gift-card issuance after `incentive_spend` gate; metered as money_out |
| Recruited panels fallback | **Terac** | When the network yields <10 viable prospects: requisition ICP-matching verified humans as paid interview subjects (via D11/HR); their interviews enter the same pipeline, `subject_kind: 'terac_panel'` |
| Consent/suppression store | CompanyOS (Postgres) | `interviews.consent`, `leads.consent_state`, global suppression hashes |

---

## 8. Gates & Escalations

### Gates opened

| Gate id | Card | Blocks | Auto-approve | Notes |
|---|---|---|---|---|
| `outreach_batch_approval` | `multi_approve` | yes | **never** | The founder reads every message. Strike-outs teach the composer. |
| `voice_call_approval` | `approve_reject` | yes | supervised+ after first approval | Disclosure script attached to every card |
| `incentive_spend` | `approve_reject` | yes | autonomous | Also a `money_out` gate; amount metered |
| `followup_sequence_approval` | `approve_reject` | yes | supervised+ | Only for sequences whose step-1 was approved |

### Escalations raised

| Reason | Severity | Trigger | Options |
|---|---|---|---|
| `needs_human` | blocking | <10 viable prospects after mining all channels | `terac_panel`, `broaden_icp_one_notch`, `switch_to_async_form` |
| `needs_approval` | blocking | Stop-loss: reply rate <2% after 40 sends | `revise_message_and_icp`, `pause_outreach`, `proceed_20_more` (discouraged, stated) |
| `needs_budget` | degrading | Voice minutes + incentives exceed envelope mid-pipeline | Treasury tops up or remaining interviews go async-email |
| `needs_human` | blocking | An interviewee reports distress, asks for a human, or raises a legal question | Human founder takes over the thread; interviewer never improvises here |
| `needs_approval` | informational | ≥3 interviews contradict a core WMBT before the ledger is due | Early signal to D06: `pivot_early`, `finish_remaining_interviews` |

**The honest one:** if the ledger's verdicts land `contradicted` on the demand WMBTs, the
Head does not soften the language. The ClaimLedger ships with the contradiction front and
center and the escalation to D06 says: "real humans told us no. Here are their words."

---

## 9. Failure Modes & Fallbacks

| Failure | Detection | Fallback | Quality |
|---|---|---|---|
| Founder never approves the outreach batch | gate `hold` timeout | pipeline pauses (resident dept sleeps free); Linq re-ping ×1; after 24h escalate `needs_human` | blocked, not degraded |
| Low reply rate | stop-loss counter | escalate per §8; composer revises against strike-out + non-reply patterns once | `signed` |
| Prospect no-shows | calendar event passes, no join | one reschedule offer (counts as a touch); second no-show → outcome `no_show`, no further contact | `signed` |
| ElevenLabs/telephony down | `voice.place_call` error | switch scheduled interviews to async email script variant; note channel in Interview | `signed` |
| Transcription diarization garbled | extractor confidence flags | claims with uncertain speakers dropped; interview yields fewer claims, gap recorded | `signed` |
| Interviewer accidentally pitches | critic transcript scan for banned moves | claims after the pitch moment get strength ×0.5 (primed subject); incident logged for prompt fix | `signed`, noted |
| Subject withdraws consent mid-call | interviewer detects, confirms | call ends; per-request deletion path; claims retracted | n/a |
| <5 interviews by deadline | count check | ledger ships with `insufficient_data` verdicts where true, `gaps[]` explains; D06 weighs D03/D05 more | `partial` |
| Send tool delivers a stale (edited) body | hash mismatch at send time | send aborted, P0 event, gate re-opened | blocked |

---

## 10. Definition of Done & Critic Rubric

**Done when all are true:**

- [ ] ≥30 scored Prospects with provenance, suppression-checked.
- [ ] InterviewScript(s) with every D04-WMBT mapped to ≥1 behavior-first question;
      disclosure block verbatim from the shared prompt.
- [ ] Every sent message: gated, byte-identical to the approved body, opt-out present on
      cold, personalization sourced.
- [ ] Rate limits provably respected (touch counts, spacing, daily caps in the event log).
- [ ] ≥5 completed interviews (or deadline + gaps), each with consent object, recording/
      transcript URIs, diarization.
- [ ] Every Claim verbatim-verified with ts_offset; evidence_class assigned honestly.
- [ ] ClaimLedger: full funnel numbers, per-theme verdicts under the class+subject gates,
      WMBT status complete, synthetic deltas reported where D05 overlaps.
- [ ] Warm Leads only from explicit recorded consent, each with `warm_context`.
- [ ] Calibration tuples handed to D05.
- [ ] Opt-outs and deletion requests fully processed.

**Critic rubric:** §5.7. Pass ≥14/18 with `Consent integrity` = 3 and `Verbatim fidelity` = 3.

---

## 11. Demo Notes

| Demo t | On screen | Beat |
|---|---|---|
| **1:40–1:50** | Outreach room: prospect cards mined from the founder's (demo) network stack up with ICP scores; the outreach gate card opens on the mirrored phone showing three real drafted emails | "It found people I actually know" + "nothing sends without me" in one shot |
| **1:50–2:05** | Live voice interview snippet plays: the AI voice delivers the disclosure, the (planted) subject consents, one genuine probe follows a surprise answer | The disclosure IS the demo — judges hear the safety posture, not a slide about it |
| **2:05–2:15** | Transcript scrolls; claims light up as verbatim spans get extracted with timestamps; the ClaimLedger theme bars fill, one verdict flips to `contradicted` in red | Evidence, not vibes — and the system visibly accepting bad news |
| **2:15–2:20** | An interviewee card converts to a warm Lead, their quote attached, and slides toward the D09 room | The compounding loop: discovery becomes pipeline |

Fallback: `?replay=demo-1` contains a recorded interview (actor, consented) so the voice
beat never depends on live telephony.

---

## 12. Cost Estimate

One run: 40 prospects mined, 25 first-touches, 8 scheduled, 6 completed voice interviews.
Wall clock: 1–2 days (resident, mostly paused).

| Item | Qty | Cost |
|---|---|---|
| `outreach.head` (opus) — orchestration across ~10 wake cycles | ~120k in / 14k out | $0.90 |
| `outreach.miner` (sonnet) ×2 | ~65k each | $0.40 |
| `outreach.scriptwright` (opus) | ~45k | $0.35 |
| `outreach.composer` (sonnet) — 25 drafts + follow-ups + scheduling | ~70k total | $0.24 |
| `outreach.interviewer` (opus) — 6 calls × ~15 min | ~85k each ×6 turns amortized | $1.26 |
| ElevenLabs voice + telephony | ~90 voice minutes | $1.20 |
| `outreach.extractor` (sonnet) ×6 transcripts | ~50k each | $0.55 |
| `outreach.critic` (sonnet) | ~38k + 0.3 revision | $0.13 |
| Composio API calls (Gmail/LinkedIn/Calendar) | ~120 calls | $0.10 |
| Linq SMS (reminders + gate cards) | ~20 messages | $0.04 |
| Sandbox — long wall clock, **paused between webhooks**, ~35 min active | | $0.06 |
| **Total** | | **≈ $5.23** |

Envelope `$6.00`; hard cap `$12.00` covers a Terac-panel fallback (2 paid subjects) or 4
extra interviews. Incentives are metered separately as `money_out` under the
`incentive_spend` gate. All figures are estimates.

---

## Assumptions & open questions

- **A1.** The founder connects Gmail/LinkedIn/Calendar via Composio OAuth during onboarding
  ([`../01-platform/07-identity-and-accounts.md`](../01-platform/07-identity-and-accounts.md)).
  Without them, mining degrades to niche channels only and expected interview count halves.
- **A2.** B2B legitimate-interest cold email with opt-out is treated as compliant in the
  US demo context. EU-target ventures need a stricter opt-in flow — flagged, not built, MVP.
- **A3.** ElevenLabs conversational latency over telephony is assumed good enough for a
  natural interview. If barge-in latency disappoints, fallback is scheduled async voice
  messages, which changes the script structure.
- **A4.** "Ask everyone for recording consent" is assumed to satisfy two-party-consent
  states; no per-jurisdiction logic in MVP.
- **A5.** The ≥5-interview threshold for a ledger is a hackathon floor. Real confidence
  needs 10–15 per segment; the ledger's verdict gates already scale with subject count.
- **Q1.** Should founder strike-outs on the outreach gate feed a per-founder tone profile
  in global memory (cross-venture)? Leaning yes, POST-MVP.
- **Q2.** Do referral-sourced prospects inherit `warm` relationship strength, letting the
  first touch mention the referrer by name? Requires the referrer's consent to be named —
  currently we ask during wrap, but the schema has no field for it. Open.
- **Q3.** Deletion requests vs the immutable event log: current design purges content
  stores and retracts claims but keeps the retraction event. Counsel review POST-MVP.
- **Q4.** Whether contradicted-early (§8, ≥3 contradicting interviews) should auto-pause
  remaining outreach to save budget, or finish the batch for statistical honesty.
  Currently: finish scheduled interviews, pause new outreach.

---

**Previous:** [`D03-market-research.md`](D03-market-research.md) · **Next:** [`D05-synthetic-population.md`](D05-synthetic-population.md)
