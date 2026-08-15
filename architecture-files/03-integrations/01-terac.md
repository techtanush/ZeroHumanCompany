# 01 — Terac

> **Tier 1 · the host's track · the demo's spine.** If only one integration is perfect, it is this one.

---

## What it is

Terac is **AI-native panel infrastructure**: an API to *source, screen, hire, verify, and pay real
humans*. It operates a global panel of verified experts — doctors, engineers, lawyers, operators,
parents, hobbyists, niche professionals — and an AI moderator that sources candidates continuously,
verifies credentials, runs an open-ended screening conversation to probe actual domain knowledge,
and scores ongoing performance. Qualified humans are routed to the requester's platform via API,
and paid out automatically on verified completion.

The primitive Terac sells: **"I need a specific kind of human, right now, and I will pay for verified output."**

---

## Our creative angle

Most hackathon uses of Terac will be *"we used Terac to get survey responses."* That's a feature.

Ours is structural: **Terac is the last rung of the entire company's escalation ladder.**

Zeroth's escalation ladder, in order:

```
worker retries          → sibling worker with partial context     (02-agent-runtime.md)
department retries      → Head reassigns, one revision loop
capability gap          → Escalation(needs_capability) → D13 designs a new agent   (D13)
credential gap          → AccountCeremony via Solari + Linq                        (04-solari.md)
budget gap              → Escalation(needs_budget) → Treasury                      (03-stripe.md)
founder judgment        → Escalation(needs_approval) → Linq card                   (06-linq.md)
────────────────────────────────────────────────────────────────────────────────────────
NO AGENT CAN DO THIS    → Escalation(needs_human) → HumanWorkRequisition → HR → TERAC
```

Any of the 13 departments can file a `HumanWorkRequisition`. **HR (the D11 sub-department) is the only
actor allowed to convert one into a hire**, and it does so with the company's own money, against its
own budget, after an explicit ROI test. The hired human's deliverable comes back as a
**first-class `Artifact`** — signed, evidence-carrying, versioned, routed by the same routing rules
as any agent's output. Downstream departments cannot tell whether a `ClaimLedger` entry came from a
Claude worker or a verified ER nurse in Ohio. That is the whole point.

**The pitch: we didn't integrate Terac. We built the company that needs Terac.**

---

## Which departments use it

| Dept | Files a requisition when | Requisition kind |
|---|---|---|
| **D11 / HR** | — (owner: evaluates, hires, pays, QCs, closes) | all |
| **D04 Outreach & Validation** | The founder's network is exhausted or wrong-shaped; `ClaimLedger` has <N interviews in the target ICP | `interview_panel` |
| **D03 Market Research** | A `NicheDossier` claim is load-bearing and `confidence < 0.6` with no citable source | `expert_verification` |
| **D05 Synthetic Population** | Calibration needs real ground truth for an archetype the panel has never seen | `interview_panel` (small n, calibration-tagged) |
| **D06 Pivot** | Two `IdeaDiff`s are evidence-tied and contradictory; needs a human tiebreak from a domain operator | `expert_verification` |
| **D07 Build** | A task is physically not automatable (hardware photo, in-person check, notarization, a portal that requires a licensed identity) | `human_only_task` |
| **D12 Support** | A ticket requires a licensed professional's answer (medical, legal, tax) | `expert_verification` |
| **D08 / D10** | Message/positioning testing against real operators before a public launch | `interview_panel` |

Workers never file requisitions — only Heads, per the inter-department protocol in
[`../00-vision/03-org-chart.md`](../00-vision/03-org-chart.md).

---

## The `HumanWorkRequisition` schema

Lives in `packages/contracts/src/terac.ts`. This is *our* type, not Terac's — HR maps it onto the
vendor API. Keeping it ours is what lets the fallback (a founder-run manual panel) satisfy the same
contract.

```ts
export const HumanWorkRequisition = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  filed_by: DepartmentId,                       // 'D04'
  blocks_work_order_id: z.string().uuid().optional(),
  trace_id: z.string(),

  kind: z.enum(['interview_panel', 'expert_verification', 'human_only_task']),

  // WHO. Terac screens against this.
  who: z.object({
    role_description: z.string(),               // 'ER nurse, US, ≥3 yrs bedside, currently practicing'
    must_have: z.array(z.string()),             // hard screens → Terac screening criteria
    nice_to_have: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),   // e.g. 'works at a competitor'
    geo: z.array(z.string()).default([]),       // ISO-3166 country / US state codes
    language: z.array(z.string()).default(['en']),
    count: z.number().int().min(1).max(50),
  }),

  // WHAT. The deliverable, specified tightly enough that QC is mechanical.
  task: z.object({
    title: z.string(),
    brief_md: z.string(),                       // what the human reads
    deliverable_schema_ref: z.string(),         // Zod schema id the output must satisfy
    estimated_minutes: z.number().int(),
    modality: z.enum(['async_written', 'structured_form', 'live_call', 'async_video']),
    attachments: z.array(ArtifactRef).default([]),
  }),

  // WHY. The ROI test's inputs — HR rejects requisitions that can't answer this.
  justification: z.object({
    blocked_decision: z.string(),               // 'cannot sign NicheDossier #3'
    decision_value_usd: z.number(),             // what the blocked decision is worth
    alternatives_tried: z.array(z.string()),    // agent attempts, with event ids
    confidence_without: z.number().min(0).max(1),
    confidence_with_estimate: z.number().min(0).max(1),
  }),

  // MONEY.
  budget: z.object({
    max_usd_per_human: z.number(),
    max_usd_total: z.number(),
    urgency: z.enum(['standard', 'rush']),      // rush ⇒ price premium, tighter SLA
    deadline_at: z.string().datetime(),
  }),

  status: z.enum(['filed','rejected','approved','sourcing','screening',
                  'hired','in_progress','delivered','qc_failed','accepted','paid','cancelled']),
});
```

And the return path:

```ts
export const HumanHire = z.object({
  id: z.string().uuid(),
  requisition_id: z.string().uuid(),
  terac_hire_id: z.string(),                    // vendor id, for the audit trail
  worker: z.object({
    terac_worker_id: z.string(),                // pseudonymous by default
    display_name: z.string(),                   // 'ER Nurse · OH · 7 yrs'  (no PII by default)
    verified_credentials: z.array(z.object({
      claim: z.string(), verified_by: z.string(), verified_at: z.string().datetime(),
    })),
    performance_score: z.number().min(0).max(1).optional(),
  }),
  agreed_rate_usd: z.number(),
  deliverable: ArtifactRef.optional(),          // becomes a normal Artifact on acceptance
  qc: z.object({
    result: z.enum(['pass','fail','partial']),
    checks: z.array(z.object({ name: z.string(), passed: z.boolean(), note: z.string() })),
    reviewed_by: z.string(),                    // 'hr.recruiter' | 'founder'
  }).optional(),
  paid_usd: z.number().optional(),
  paid_at: z.string().datetime().optional(),
});
```

---

## HR's ROI decision rule

This is the part that makes it a *company* and not a wrapper. HR does not approve requisitions
because a department asked nicely. It runs a rule, records a `Decision`, and the rule is visible in
the Boardroom.

```
Δconfidence  = justification.confidence_with_estimate − justification.confidence_without
EV_gain      = Δconfidence × justification.decision_value_usd
cost         = who.count × budget.max_usd_per_human × (1 + rush_premium)
              + hr_overhead_usd(≈ $0.15 of agent time)

APPROVE  iff  EV_gain ≥ ROI_FLOOR × cost
              AND cost ≤ treasury.hr_envelope_remaining
              AND cost ≤ venture.founder_human_spend_cap
              AND deadline is reachable at the requested urgency
```

| Constant | Demo value | Rationale |
|---|---|---|
| `ROI_FLOOR` | `3.0` | A human hire must be worth 3× its cost. Hackathon-honest, not squeezed. |
| `rush_premium` | `0.4` | Assumed; see verification block. |
| `venture.founder_human_spend_cap` | `$50` default, founder-set | Hard ceiling. Set at venture creation, changeable only by the founder over Linq. |
| `treasury.hr_envelope_remaining` | per cycle | From the Budget Meter; HR is a normal department with an envelope. |

**Rejection is a real outcome and we show it.** If `EV_gain < 3× cost`, HR emits
`Escalation(reason='needs_human', severity='degrading')` back to the filing department with
`options[] = [proceed_with_lower_confidence, reduce_count, downgrade_to_synthetic_panel]` and the
department must proceed with `quality: 'partial'` and a recorded `gap`. The company saying *"a human
is not worth it here, ship it contested"* is more impressive than the company spending money.

**Three cheaper rungs are tried before Terac, always, and the requisition must show them in
`alternatives_tried`:**
1. D05 synthetic panel (Census-PUMS post-stratified estimate) — ~$0.05, no ground truth.
2. D04 warm network via Composio Gmail/LinkedIn — free, but slow and biased toward the founder's circle.
3. Public expert content mined by D03 — free, but not responsive to *our* question.

Terac is rung 4 because it's the only one that returns a *verified, responsive, on-demand* human.

---

## Integration spec

> **ASSUMPTION:** the endpoint paths, field names, and callback shapes below are our *design* of what
> the Terac API surface looks like, extrapolated from Terac's public description (source, screen,
> hire, verify, pay; API routing of qualified experts; automatic payout on verified completion).
> We have not been issued credentials at the time of writing.
>
> **VERIFY AT HACKATHON (Terac booth, day one, first hour):**
> 1. Base URL, auth scheme (bearer key vs OAuth), and sandbox/test-mode availability.
> 2. Exact create-requisition endpoint and its screening-criteria field shape — do they take
>    free-text role descriptions, structured attributes, or a screener questionnaire?
> 3. Is matching **push (webhook callback)** or **poll**? Get the webhook signature scheme.
> 4. Realistic **time-to-match** for a niche role (this sets whether the 1:50 beat is live or pre-warmed).
> 5. Payment: does Terac charge our account on acceptance, or do we fund a balance up front? Is there
>    a per-hire fee separate from the worker rate?
> 6. Whether worker identity is pseudonymous by default (we want it to be — see Privacy below).
>
> **Every one of these has a fallback that keeps the demo intact.** See "Failure modes" below.
> `packages/integrations/terac/` exposes our own `TeracClient` interface; the vendor shapes live only
> inside the driver, so a shape correction on the day is a one-file change.

### Our client interface (stable; the vendor mapping is internal)

```ts
// packages/integrations/terac/client.ts
export interface TeracClient {
  createRequisition(req: HumanWorkRequisition, opts: { idempotencyKey: string }): Promise<{ terac_requisition_id: string }>;
  getRequisition(id: string): Promise<TeracRequisitionState>;
  listMatches(id: string): Promise<TeracCandidate[]>;
  hire(reqId: string, workerIds: string[], opts: { idempotencyKey: string }): Promise<HumanHire[]>;
  getDeliverable(hireId: string): Promise<{ payload: unknown; artifacts: { url: string; mime: string }[] }>;
  acceptAndPay(hireId: string, opts: { amount_usd: number; idempotencyKey: string }): Promise<{ paid_at: string }>;
  dispute(hireId: string, reason: string, evidence: string[]): Promise<void>;
  cancel(reqId: string, reason: string): Promise<void>;
}
```

### Assumed HTTP surface

```http
POST /v1/requisitions
Authorization: Bearer $TERAC_API_KEY
Idempotency-Key: <sha256(work_order_id|'terac.requisition'|requisition_id)>
Content-Type: application/json

{
  "title": "ER nurse — 20-min structured interview on shift-handoff tooling",
  "audience": {
    "description": "Currently practicing US emergency-department RN, ≥3 years bedside",
    "screening_criteria": [
      {"key": "role", "op": "equals", "value": "registered_nurse"},
      {"key": "specialty", "op": "equals", "value": "emergency"},
      {"key": "years_experience", "op": "gte", "value": 3},
      {"key": "country", "op": "in", "value": ["US"]},
      {"key": "currently_practicing", "op": "equals", "value": true}
    ],
    "count": 5
  },
  "task": {
    "modality": "live_call",
    "estimated_minutes": 20,
    "brief_markdown": "…",
    "response_schema": { "$ref": "https://zeroth.app/schemas/InterviewResponse.json" }
  },
  "compensation": { "per_participant_usd": 25, "currency": "USD" },
  "deadline_at": "2026-08-15T22:00:00Z",
  "urgency": "rush",
  "callback_url": "https://kernel.zeroth.app/webhooks/terac",
  "metadata": { "venture_id": "…", "requisition_id": "…", "trace_id": "…" }
}
```

```jsonc
// 201 Created
{
  "id": "req_9f2c…",
  "status": "sourcing",
  "estimated_match_at": "2026-08-15T19:40:00Z",
  "estimated_total_usd": 125.00
}
```

### Callbacks we consume

`POST https://kernel.zeroth.app/webhooks/terac`, HMAC-signed. Each maps 1:1 onto an event from the
`terac.*` namespace in [`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md).

| Callback `type` | → Zeroth event | Reducer effect |
|---|---|---|
| `requisition.sourcing` | `terac.hire_posted` | Requisition card animates to "sourcing"; Boardroom shows a live candidate counter |
| `candidate.matched` | `terac.worker_matched` | Candidate chip appears with verified credentials + performance score |
| `hire.accepted` | `terac.worker_matched` (status `hired`) | HR reserves the funds in the meter; `money.metered` written |
| `work.delivered` | `terac.work_delivered` | Deliverable enters QC (below) |
| `work.cancelled` / `worker.dropped` | `terac.requisition_filed` (re-source) | Auto re-source once, then escalate |
| `payment.settled` | `terac.paid` | Ledger entry; `money.metered` finalized against HR envelope |

**Webhook handling rules** (identical to every other webhook in the system):
- Verify HMAC before parsing. Unverified payloads are logged and dropped, never processed.
- Body is stored raw in `webhook_deliveries` before the reducer runs.
- `processed_messages` dedupes on the vendor event id → at-least-once delivery, exactly-once effect.
- Respond `200` within 2s; all work happens on the queue.
- **Poll fallback:** if no callback arrives within `expected_match_seconds × 2`, a BullMQ repeatable
  job polls `getRequisition()` every 15s. The demo path uses the poller regardless, because a
  10-second stage silence is worse than a redundant GET.

---

## Sequence: block → requisition → hire → artifact → payment

```
D04 Head        HR (D11)        Kernel          Terac API        Human          Founder
   │               │               │               │               │               │
   │ network dry;  │               │               │               │               │
   │ ClaimLedger   │               │               │               │               │
   │ n=2 of 8      │               │               │               │               │
   │──Escalation(needs_human)─────►│               │               │               │
   │  + HumanWorkRequisition       │               │               │               │
   │               │◄──route───────│               │               │               │
   │               │               │               │               │               │
   │           ┌───┴───┐           │               │               │               │
   │           │ROI    │ EV=$210   │               │               │               │
   │           │rule   │ cost=$125 │               │               │               │
   │           │       │ 210 < 3×125 → would REJECT│               │               │
   │           │       │ …but count 5→3 ⇒ $75, EV=$180 ≥ 3×? no    │               │
   │           │       │ ⇒ narrow ICP, decision_value re-scored $600│               │
   │           └───┬───┘  APPROVE, n=3, $75        │               │               │
   │               │──Decision(recorded, visible)─►│               │               │
   │               │                               │               │               │
   │               │ (autonomy=autonomous ⇒ no gate; spend ≤ cap)  │               │
   │               │──createRequisition()─────────►│               │               │
   │               │◄─201 {req_id, eta}────────────│               │               │
   │               │                               │──source+screen──►│            │
   │               │◄──candidate.matched ×3────────│  (AI moderator) │             │
   │               │──hire([w1,w2,w3])────────────►│               │               │
   │               │──money.metered (reserve $75)─►│               │               │
   │               │                               │──brief────────►│              │
   │               │                               │               │ 20-min call   │
   │               │                               │               │ w/ D04 voice  │
   │               │                               │               │ interviewer   │
   │               │                               │               │ (14-elevenlabs)│
   │               │◄──work.delivered ×3───────────│◄──────────────│               │
   │           ┌───┴───┐                           │               │               │
   │           │  QC   │ schema · length · specificity · contradiction · plagiarism │
   │           └───┬───┘  pass 3/3                 │               │               │
   │               │──acceptAndPay()──────────────►│──payout──────►│               │
   │               │◄──payment.settled─────────────│               │               │
   │               │──Artifact(HumanInterview[]) signed────────────────►           │
   │◄──ArtifactReady(from=D11, on behalf of D04)───│               │               │
   │               │                               │               │──Linq: "hired │
   │               │                               │               │  3 ER nurses, │
   │ merges into ClaimLedger; indistinguishable    │               │  $75, 3 new   │
   │ from agent-sourced claims except provenance   │               │  claims" ────►│
```

**Note the shape of the ROI loop.** HR's first pass *rejects*, and instead of giving up it
**renegotiates the requisition** (fewer humans, tighter ICP, which raises `decision_value_usd`
because a narrower decision is worth more). That negotiation happens in the `hr↔all` Band room
([`02-band.md`](02-band.md)) and it is the single most "this is a company" moment in the demo.

---

## Three concrete use cases

### 1. ICP interview panel when the founder's network runs dry — `interview_panel`

**Trigger.** D04's `network-miner` exhausts the founder's Gmail/LinkedIn graph (via Composio) and
`ClaimLedger.interviews_in_icp < GTM_MIN_INTERVIEWS` (default 8). This is the *normal* case — most
first-time founders don't know 8 ER nurses.

**Requisition.** `count: 5`, `modality: live_call`, 20 minutes, $25/participant.

**The good part:** the hired humans are interviewed by **D04's voice-interviewer in the founder's
cloned voice** ([`14-elevenlabs-voice.md`](14-elevenlabs-voice.md)), with the AI-disclosure script at
call open. Terac supplies the human; ElevenLabs supplies the interviewer; the transcript flows into
the same `Claim` extraction pipeline as a warm-network call. Terac-sourced claims carry
`provenance: 'terac_panel'` and are **weighted identically** to warm claims but flagged in the
evidence drawer, because a paid participant and a friend have different biases and we say so.

**Deliverable schema:** `InterviewResponse` → `Claim[]` → merged into `ClaimLedger`.

### 2. Expert verification of a low-confidence claim — `expert_verification`

**Trigger.** D03 wants to sign a `NicheDossier` containing *"ED shift-handoff software is procured at
the hospital-system level, not the department level, with 9–14 month cycles."* That single claim
determines the entire GTM motion (bottom-up self-serve vs enterprise). The `money` worker found two
contradictory blog posts. `confidence = 0.45`. Under the evidence rules in
`../01-platform/11-evidence-and-truth.md`, it **cannot be signed**.

**Requisition.** `count: 2`, `modality: structured_form`, 10 minutes, $40/expert. `who.role_description`:
*"Hospital-system procurement lead or clinical informatics director, US, involved in ≥1 software
purchase >$50k in the last 24 months."* The brief hands the expert the claim verbatim and asks:
agree/disagree, cycle length, who signs, and what would change their answer.

**Deliverable → artifact.** Both experts return structured verdicts. The claim's confidence is
re-scored to `0.85` with `source_id`s pointing at the two verified experts. D03 signs the dossier —
or, if the experts *disagree with the agents*, D03 **rewrites the dossier and D08's entire channel
plan changes**. Show that version: the company being corrected by a human it hired is a better beat
than the company being confirmed.

**Cost of not doing it:** an enterprise-length sales cycle attempted with a self-serve motion — every
downstream department's work wasted. `decision_value_usd` here is the whole GTM budget, so the ROI
test passes easily and *visibly*.

### 3. A task no agent can do at all — `human_only_task`

**Trigger.** D07 needs the venture's product listed in a directory / app store / partner portal whose
signup requires a **licensed professional's identity attestation** — a real credentialed person
asserting, under their own name, that the listing is accurate. Solari can drive the browser
([`04-solari.md`](04-solari.md)); it cannot *be* a licensed nurse. There is no prompt that fixes this.

Other members of this class, all of which we'd handle identically:
- Notarization / wet signature.
- A physical-world observation (photograph a shelf, confirm a location is open).
- Any attestation where **the value is precisely that a legally accountable human made it.**

**Requisition.** `count: 1`, `modality: async_written` + attachment, $60, `urgency: rush`.
`must_have: ['active RN license', 'willing to attest under own name']`.

**Why this one is the strongest on stage:** it is the case where no amount of model improvement helps.
It makes the architectural claim unarguable — the escalation ladder *has* to end in a human, so the
company that ends there on purpose is better designed than the one that fails there by accident.

---

## Quality control on human output

Human output is **not** trusted more than agent output. It goes through a QC gate before it becomes a
signed artifact, and the gate is mechanical wherever possible so it runs in seconds on stage.

| Check | How | On failure |
|---|---|---|
| **Schema** | Zod-validate against `task.deliverable_schema_ref` | Auto-request revision once via Terac (`revision_requested`) |
| **Effort floor** | Word count, response time vs `estimated_minutes`, non-empty on every required field | Revision request |
| **Specificity** | `haiku` classifier: does the answer contain concrete nouns/numbers, or is it generic? Scored 0–1, floor 0.5 | Revision request |
| **Internal contradiction** | `sonnet` pass over the response against itself and against the brief | Flag for HR review |
| **Cross-panel contradiction** | If `count > 1`, cluster responses. **Disagreement is a signal, not a failure** — it becomes `ClaimLedger.contradiction_count` and lowers confidence honestly | Never fails; always recorded |
| **Copy-paste / LLM-generated** | Similarity check across panel responses + against the brief text itself | `qc_failed` → dispute |
| **Credential relevance** | Do the verified credentials Terac returned actually match `who.must_have`? | Reject the *hire*, re-source, don't pay |

```
delivered → [schema] → [effort] → [specificity] → [contradiction] → [similarity] → accept
                │           │            │                              │
                └───────────┴────────────┘                              │
                     revision_requested (max 1)                         │
                                │                                       │
                          still failing ──────────────────────────► qc_failed
                                                                        │
                                          ┌─────────────────────────────┤
                                          │                             │
                                   dispute() + re-source        pay anyway if the
                                   (bad-faith output)           failure is ours
                                                                (ambiguous brief)
```

**We pay for ambiguous briefs.** If QC fails and the root cause is that *our* brief was
under-specified, HR pays in full, records a `Decision` with `rationale: 'brief defect, ours'`, and
files a `ProductSignal` against its own requisition template. A company that stiffs workers for its
own bad instructions is not a company we want to demo.

**Founder override.** At `autonomy_level ∈ {copilot, supervised}`, or for any hire over
`$founder_review_threshold` (default $100), the accepted deliverable is shown on a Linq card before
payment: *"3 nurses delivered. Preview attached. Pay $75?"*

---

## Cost model

| Line item | Demo value | Notes |
|---|---|---|
| Interview participant, 20 min | **$25** | assumed market rate; the ROI rule reads it from config, not from a constant |
| Expert verification, 10 min structured | **$40** | premium for credentialed judgment, not time |
| Human-only task, rush | **$60** | includes the rush premium |
| Terac platform fee | **`ASSUMPTION: 15–20%` of worker rate** | **VERIFY AT BOOTH.** Modeled as `terac_fee_pct` in config; the ROI rule already multiplies it in |
| HR agent overhead per requisition | ~$0.15 | Claude tokens for the ROI evaluation + QC passes |
| **Demo total human spend** | **~$135–160** | 3 nurses ($75) + 2 experts ($80) with one requisition narrowed — under the $50 default cap only if the founder raises it on stage, which is *itself a Linq beat* |

**Metering.** Every hire writes to `meters` with `(venture_id, department='D11', agent='hr.recruiter',
work_order_id, kind='terac_hire', usd)`. Human labor sits in the same P&L as tokens and
sandbox-seconds — the Boardroom's cost panel shows *"$4.10 compute · $155 human labor"* side by side.
That single line is the most compelling artifact in the whole product: **the company knows what
humans cost it.**

**Treasury interaction.** HR's envelope is funded like any department's, and after 3:15 it is funded
partly out of **real Stripe revenue** ([`03-stripe.md`](03-stripe.md)). If the demo lands that
ordering — revenue arrives, Treasury reallocates, HR's human-hiring envelope grows — the company has
literally *earned the money it uses to hire people.*

---

## Privacy, consent, and worker treatment

Non-negotiable, and we volunteer these before a judge asks:

- **Pseudonymous by default.** We request and store `terac_worker_id` + a display descriptor
  (`"ER Nurse · OH · 7 yrs"`). We do not ingest names, emails, or phone numbers unless the modality
  requires it (live call), and then only for the call's duration in `services/voice`.
- **Disclosure.** Every brief opens with: *"This work was commissioned by an autonomous AI company on
  behalf of a human founder. Your responses will be used to make product decisions. A human reviews
  payment."* Live calls carry the AI-disclosure script from [`14-elevenlabs-voice.md`](14-elevenlabs-voice.md).
- **No dark patterns on pay.** Rate is stated up front, we do not reduce it after delivery, and QC
  failure paths above default toward paying.
- **Right to refuse.** A worker declining after reading the brief costs us nothing and is not held
  against them; we re-source.
- **Data minimization.** Deliverables are stored under the venture's object-storage prefix with the
  venture's retention policy. Worker identifiers are never passed to any other vendor.

---

## Failure modes and fallback

| Failure | Detection | Behavior |
|---|---|---|
| **API unreachable / auth rejected** | Circuit breaker on `TeracClient`, 3 failures in 60s | Driver swaps to `MockTeracDriver`, which replays the seeded requisition from `?replay=demo-1`. The Boardroom shows a **`terac: replayed`** chip — we degrade *visibly*, never silently. |
| **No match within deadline** | Poller sees `sourcing` past `deadline_at` | Auto-widen once: relax `nice_to_have`, expand `geo`, +25% rate (still within `max_usd_total`). Then `Escalation(needs_human)` to the founder with options `[widen further, proceed without, cancel]`. |
| **Match is slower than the demo** (most likely real risk) | `estimated_match_at` > stage budget | **Pre-file the requisition during setup**, so the 1:50 beat shows a *live* `candidate.matched` callback landing on a requisition filed 20 minutes earlier. The ROI decision, the hire call, the QC, and the payment are all still live. Say this out loud — "we filed this before we walked on stage; everything after the match is live." |
| **Webhook not delivered** | No callback within `2× eta` | Poller takes over. Both paths are idempotent on the vendor event id. |
| **Deliverable fails QC twice** | QC gate | `dispute()`, re-source once with an improved brief, then proceed `partial` with a recorded gap. |
| **Payment fails** | `acceptAndPay` non-2xx | Retry ×3 with the same idempotency key; then `Escalation(needs_human, blocking)` to the founder. **We never mark work accepted-and-unpaid silently.** |
| **Terac has no sandbox mode** | Discovered at the booth | Run the demo against production with real, small dollars. The spend is ~$150 and the fact that it's *real money for real people* is the point. Budget for it. |
| **Total vendor absence** | — | `HumanWorkRequisition` is our schema. The fallback driver posts the requisition to the founder over Linq as a "you're the panel" card. The architecture is unchanged; only the sourcing rung is. |

---

## Demo beat — 1:50

On screen, in order, ~20 seconds:

1. **The wall.** D04's card turns amber: *"ClaimLedger: 2 of 8 target interviews. Founder network exhausted."*
2. **The requisition.** A card slides into the D11/HR room: *"5 × ER nurse, US, ≥3 yrs, 20-min call, $25 ea, by 22:00."*
3. **The ROI rule, visible.** `EV $210 · cost $125 · floor 3× → REJECT`. Then, one beat later, the
   renegotiation in the `hr↔all` room and `n=3, narrowed ICP, EV $600 · cost $75 → APPROVE`.
   *This is the moment. The company argued with itself about money and won.*
4. **The API call.** `POST /v1/requisitions → 201`. Requisition status animates `sourcing`.
5. **Matches land.** Three candidate chips appear with verified credentials and performance scores.
6. **Hired.** `terac.hire_posted → terac.worker_matched`. The cost panel's **human labor** line ticks
   from $0 to $75, next to the compute line.
7. **Narration:** *"That is the escalation ladder's last rung. When the company can't do something,
   it doesn't fail and it doesn't hallucinate — it hires."*

The delivered transcripts and the QC pass are shown at 2:10 folded into the pivot evidence, so the
human's output is visibly *causing* the pivot the founder approves on their phone.

---

## Track-winning pitch sentence

> **"Every other team integrated Terac. We built the company whose org chart requires it — a 13-department
> business whose escalation ladder ends, by design, in HR filing a requisition, running an ROI test
> against its own budget, and hiring a verified human with money the company earned itself."**

---

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`02-band.md`](02-band.md) (the `hr↔all` room) ·
[`03-stripe.md`](03-stripe.md) (where HR's budget comes from) ·
[`14-elevenlabs-voice.md`](14-elevenlabs-voice.md) (who interviews the humans we hire) ·
[`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md) (`terac.*` events)
