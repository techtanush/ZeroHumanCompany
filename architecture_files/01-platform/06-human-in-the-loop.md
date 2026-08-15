# 06 — Human-in-the-Loop: The Approval Protocol

This is the file that makes "zero-human" honest. The company runs without a human on the critical
path — but there are exactly eight kinds of action it will not take alone, and one ladder it climbs
when it is stuck. Both are enforced by the kernel, not by prompt instructions.

**Two distinct mechanisms, often confused. Keep them separate:**

| | **Escalation** | **Gate** |
|---|---|---|
| Means | "I am blocked and cannot proceed" | "I can proceed, but this action is irreversible" |
| Trigger | failure, missing capability, no budget | policy: the action type requires approval |
| Climbs the ladder | yes | no — a gate goes straight to its decider |
| Resolution | someone unblocks it (possibly by hiring a human) | approve / reject / redirect |
| Table | `escalations` | `gates` |

An Escalation can *produce* a Gate (rung 5 asks the founder). A Gate never produces an Escalation
unless it times out with `on_timeout='escalate_terac'`.

---

## Part 1 — The escalation ladder

```
  ┌─ rung 0 ────────────────────────────────────────────────────────────┐
  │ AGENT RETRY          same agent, same input, backoff 2s/8s          │
  │ ≤2 attempts · cost: ~1 run · owner: runtime                         │
  └────────────────────────────┬────────────────────────────────────────┘
                               │ still failing
  ┌─ rung 1 ────────────────────▼───────────────────────────────────────┐
  │ SIBLING WORKER       reassign to another replica WITH the partial   │
  │ ≤1 attempt · owner: Head · records why the first one failed         │
  └────────────────────────────┬────────────────────────────────────────┘
  ┌─ rung 2 ────────────────────▼───────────────────────────────────────┐
  │ DEPARTMENT HEAD      re-plan: different tool, narrower slice,       │
  │                      accept partial with gaps[], or request budget  │
  │ owner: Head · may emit Escalation(needs_budget) → D11               │
  └────────────────────────────┬────────────────────────────────────────┘
  ┌─ rung 3 ────────────────────▼───────────────────────────────────────┐
  │ CHIEF OF STAFF (D13) cross-department view: is another dept already │
  │                      able to do this? is this a CapabilityGap?      │
  │ owner: cos.head · may reroute, may file a CapabilityGap, may        │
  │        authorize a Terac requisition directly for known-human tasks │
  └────────────────────────────┬────────────────────────────────────────┘
  ┌─ rung 4 ────────────────────▼───────────────────────────────────────┐
  │ FOUNDER (Linq)       one rich iMessage card, multiple-choice,       │
  │                      with a recommended option pre-selected         │
  │ owner: gateway-linq · timeout applies · quiet hours respected       │
  └────────────────────────────┬────────────────────────────────────────┘
  ┌─ rung 5 ────────────────────▼───────────────────────────────────────┐
  │ TERAC HUMAN HIRE     HR files a requisition, sources/screens/hires  │
  │                      a verified human, pays them, and the output    │
  │                      re-enters the artifact pipeline as a Source    │
  │ owner: finance.recruiter · gated by money_out                       │
  └─────────────────────────────────────────────────────────────────────┘
```

**Rung-skip rules** (the ladder is a default, not a religion):

| Condition | Behavior |
|---|---|
| `reason='needs_credential'` | Skip to rung 4 (founder). No agent can invent a credential. |
| `reason='needs_budget'` | Skip to D11 Treasury; only reaches rung 4 if Treasury denies and `runway < request` |
| Task is **provably** human-only (notarization, in-person, licensed advice, ID verification) | Skip to rung 5, but the money_out gate still applies |
| `severity='informational'` | Never climbs. Logged, shown in the Boardroom, no interrupt. |
| Founder is in `copilot` autonomy | Rungs 0–2 still run silently; anything reaching rung 3 goes to rung 4 |
| Kill switch active | No rung executes. All escalations are parked. |

**Every rung transition is an event** (`escalation.raised`, `escalation.climbed`,
`escalation.resolved`) carrying `from_rung`, `to_rung`, `elapsed_s`, `cost_so_far_usd`. The
Boardroom animates this as the sprite walking out of its room
([`09-boardroom-ui.md`](09-boardroom-ui.md)).

```ts
// apps/kernel/src/escalation/ladder.ts
const LADDER = ['agent_retry','sibling_worker','department_head',
                'chief_of_staff','founder','terac_hire'] as const;

async function climb(esc: Escalation): Promise<Resolution> {
  for (const rung of rungsFor(esc)) {                 // applies skip rules above
    const r = await HANDLERS[rung](esc);
    emit('escalation.climbed', { esc_id: esc.id, rung, outcome: r.status });
    if (r.status === 'resolved') return r;
    if (r.status === 'abandoned') break;              // e.g. founder said "drop it"
    esc = { ...esc, rung, detail: esc.detail + '\n' + r.note };
  }
  return { status: 'unresolved' };                     // dept records gaps[], work ships partial
}
```

The last line is deliberate: **an unresolved escalation degrades an artifact, it does not fabricate
one.** `quality='partial'` with `gaps[]` is always a legal outcome.

---

## Part 2 — Gate types

Eight. This list is closed; adding a ninth is a schema change, not a prompt change.

| Gate type | Fires when | Default risk | Reversible | Typical requester |
|---|---|---|---|---|
| `money_out` | any real-money spend: Terac hire, paid API signup, ad spend, domain purchase | high | no | D11 |
| `public_content` | anything published under the company's name: site copy, X post, LinkedIn, Whop listing | medium | yes | D08, D10 |
| `outbound_to_real_person` | first email/DM/call to a human who has not opted in | medium | no | D04, D10, D12 |
| `account_creation` | signing up for a third-party service as the company | medium | partly | Identity service (any dept) |
| `pivot_approval` | applying an `IdeaDiff` to the `ProductSpec` | high | costly | D06 |
| `deploy` | pushing a build to a live URL customers can reach | medium | yes | D07 |
| `refund` | issuing money back to a customer | medium | no | D11, D12 |
| `new_department` | D13 deploying a generated `DepartmentManifest` into the running company | high | yes | D13 |

Each is declared per department in `DepartmentManifest.gates[]`. **A department cannot open a gate
type it did not declare**, and the tool plane refuses the underlying tool call unless a matching
approved gate exists ([`02-agent-runtime.md`](02-agent-runtime.md), tool allowlist).

---

## Part 3 — Autonomy levels

`ventures.autonomy_level ∈ {copilot, supervised, autonomous}`. This is the dial, and this table is
the whole semantics of it.

### Decision table — what auto-approves at each level

`ASK` = founder decides · `AUTO` = auto-approved, logged, shown · `AUTO*` = auto-approved **only if**
the condition holds, else ASK · `NEVER` = never auto-approves at any level

| Gate type | copilot | supervised | autonomous | Condition for AUTO* |
|---|---|---|---|---|
| `money_out` ≤ $5 | ASK | AUTO* | AUTO* | dept envelope has room **and** cumulative cycle spend < 60% of `founders.spend_cap_usd` |
| `money_out` $5–$25 | ASK | ASK | AUTO* | as above **and** `expected_value_usd ≥ 2 × amount` recorded |
| `money_out` > $25 | ASK | ASK | **ASK** | — (never auto) |
| `money_out` — Terac hire | ASK | ASK | AUTO* | within `founders.terac_cap_usd` **and** `why_agent_cannot` is non-empty **and** ≤2 hires this cycle |
| `public_content` | ASK | ASK | **ASK** | **NEVER auto.** Public speech under the founder's brand is always a human call. |
| `outbound_to_real_person` — warm (interviewed, opted in) | ASK | AUTO | AUTO | — |
| `outbound_to_real_person` — cold, ≤50/day | ASK | ASK | AUTO* | consent_state ≠ `dnc`/`opted_out`, compliance checks green ([`12-safety…`](12-safety-and-compliance.md)) |
| `outbound_to_real_person` — voice call | ASK | ASK | AUTO* | disclosure script attached, recording consent path set for jurisdiction, number not on DNC |
| `account_creation` — free, API/OAuth | AUTO | AUTO | AUTO | — |
| `account_creation` — free, browser ceremony | ASK | AUTO* | AUTO | no payment method required |
| `account_creation` — paid | ASK | ASK | ASK | — (it's also a `money_out`) |
| `pivot_approval` — reversible diff | ASK | AUTO* | AUTO | `reversibility='reversible'` and evidence ≥3 claims |
| `pivot_approval` — `one_way_door` | ASK | ASK | **ASK** | — |
| `deploy` — preview env | AUTO | AUTO | AUTO | — |
| `deploy` — production, QA green | ASK | AUTO* | AUTO | all `qa_runs` for the deployment passed in Replay |
| `deploy` — production, QA red/flaky | ASK | ASK | ASK | — |
| `refund` ≤ $50 | ASK | AUTO* | AUTO | order exists, ≤1 refund for this customer |
| `refund` > $50 | ASK | ASK | ASK | — |
| `new_department` | ASK | ASK | ASK | **NEVER auto.** The company may design an organ; the founder implants it. |

Two lines are non-negotiable and are asserted in tests:

```ts
// apps/kernel/src/gates/policy.test.ts
it('never auto-approves public content or new departments', () => {
  for (const level of ['copilot','supervised','autonomous'] as const)
    for (const t of ['public_content','new_department'] as const)
      expect(decide({ gate_type: t, autonomy_level: level } as Gate).auto).toBe(false);
});
```

The demo runs `autonomous`. That is the point: the founder taps twice (a pivot and the new
department) in four minutes, and everything else moves on its own.

---

## Part 4 — Gate lifecycle

```
                      ┌──────────────────────────────────────────────┐
   requestGate()      │              policy engine                    │
        │             │  autonomy × gate_type × conditions            │
        ▼             └───────┬──────────────────────┬───────────────┘
   ┌─────────┐   auto-approve │                      │ ask
   │ opening │◄───────────────┘                      ▼
   └────┬────┘                              ┌────────────────┐
        │                                   │ batcher (≤20s) │
        │                                   └───────┬────────┘
        ▼                                           ▼
 ┌──────────────┐                          ┌─────────────────┐
 │auto_approved │                          │    pending      │──quiet hours──► deferred
 └──────┬───────┘                          └───┬───┬───┬─────┘
        │                                      │   │   │
        │                    approve ◄─────────┘   │   └────────► timeout
        │                    reject   ◄────────────┘                 │
        │                    redirect ◄───────────────────┐          ▼
        ▼                        │                        │   on_timeout ∈
 ┌─────────────┐          ┌──────▼──────┐          ┌──────┴─────┐  {auto_approve,
 │  EXECUTE    │◄─────────│  approved   │          │ redirected │   auto_reject,
 │  the action │          └─────────────┘          └────────────┘   hold,
 └──────┬──────┘                                    (re-plans with   escalate_terac}
        │                 ┌─────────────┐            founder's note)
        ▼                 │  rejected   │──► dept records gaps[], continues without it
   gate.executed          └─────────────┘
```

### States

| State | Meaning | Terminal |
|---|---|---|
| `pending` | Awaiting a founder decision | no |
| `auto_approved` | Policy approved it; action executed; still fully logged | yes |
| `approved` | Founder approved | yes |
| `rejected` | Founder rejected; the requesting department must proceed without the action | yes |
| `redirected` | Founder chose "do it differently" + free-text note → new WorkOrder with the note in context | yes |
| `timed_out` | `expires_at` passed; `on_timeout` applied | yes |
| `expired` | The underlying work order was cancelled before a decision | yes |
| `cancelled` | Kill switch, or the requesting department withdrew | yes |

### Execution is idempotent and gate-bound

```ts
// apps/kernel/src/gates/execute.ts
async function executeApproved(gate: Gate) {
  // The action was serialized at request time. We do NOT re-ask the agent what it wanted.
  const { tool, args } = ActionSpec.parse(gate.action);
  assert(toolAllowedFor(gate.department_id, tool), 'gate/tool mismatch');
  const res = await toolPlane.invoke(tool, args, {
    idempotency_key: gate.idempotency_key,      // → Stripe/Terac/Composio
    gate_id: gate.id,
  });
  emit('gate.executed', { gate_id: gate.id, result_ref: res.ref });
}
```

**Why the action is frozen at request time:** if we re-prompted the agent after approval, the
founder would be approving a description while the company executes something else. The founder
approves *bytes*, not intent.

### Timeouts

| Gate type | `timeout_s` (prod) | demo (`time_scale`) | `on_timeout` |
|---|---|---|---|
| `money_out` | 3600 | 45s | `auto_reject` |
| `public_content` | 7200 | 60s | `hold` |
| `outbound_to_real_person` | 1800 | 30s | `auto_reject` |
| `account_creation` | 1800 | 30s | `hold` (the ceremony is paused, resumable) |
| `pivot_approval` | 10800 | 90s | `hold` |
| `deploy` | 1800 | 30s | `auto_approve` if QA green, else `hold` |
| `refund` | 3600 | 45s | `auto_approve` (customer-favorable default) |
| `new_department` | 86400 | 120s | `hold` |

`hold` means: the work order suspends at the last artifact boundary, the department goes `blocked`
(amber room in the Boardroom), and it resumes the moment a decision arrives — hours later is fine,
because the Superserve sandbox is paused, not destroyed.

### Quiet hours

If `now()` is inside `founders.quiet_hours` and `risk != 'high'`, the gate is **deferred**: not
sent, held in the batch queue, delivered at the end of quiet hours. `risk='high'` gates
(`money_out > $25`, `pivot_approval` one-way, `new_department`) ring through. `timeout_s` does not
run during quiet hours.

---

## Part 5 — Batching (don't send nine texts)

Nothing destroys the "the founder never opens a laptop" story faster than a phone buzzing nine
times. The batcher is mandatory.

```
BATCH WINDOW
  open a batch on the first pending gate
  hold for min(20s, 0.1 × shortest timeout_s in batch)
  flush early if: risk='high' gate arrives  OR  batch reaches 6 gates
  group key: (venture_id, gate_type_family)
     families: money | content | outreach | product | infra
```

| Batch shape | Card sent |
|---|---|
| 1 gate | Single decision card for that gate type |
| 2–6 same family | One **stacked card**: swipeable, per-item Approve/Reject, plus "Approve all (N)" |
| Mixed families | One **digest card**: N items grouped by family, each expandable; "Approve all safe (N)" approves only `risk='low'` items |
| >6 gates | Digest card + a line: "Open the Boardroom to review all N" with a deep link |

```ts
// services/gateway-linq/src/batch.ts
type Batch = { id: string; venture_id: string; gates: Gate[]; opened_at: number };

function shouldFlush(b: Batch, now: number) {
  return b.gates.some(g => g.risk === 'high')
      || b.gates.length >= 6
      || now - b.opened_at >= Math.min(20_000, 100 * minTimeout(b.gates));
}
```

Approving a stack emits N separate `gate.approved` events with the same `batch_id` — the audit
trail stays per-gate even though the founder made one tap.

---

## Part 6 — The Linq card payloads

Rich interactive iMessage, one card shape per gate type. All cards share a frame:

```ts
// packages/contracts/src/linq.ts
export const LinqCardBase = z.object({
  gate_id: z.string().uuid(),
  batch_id: z.string().uuid().optional(),
  venture_name: z.string(),
  department: z.string(),               // 'Market Research'
  headline: z.string().max(80),
  subline: z.string().max(140),
  risk: z.enum(['low','medium','high']),
  expires_in_s: z.number().int(),
  buttons: z.array(z.object({
    id: z.string(), label: z.string().max(24),
    style: z.enum(['primary','secondary','destructive']),
    consequence: z.string().max(120),   // shown on long-press
  })).min(2).max(4),
  deep_link: z.string().url(),          // boardroom /gate/:id
  reply_hint: z.string().optional(),    // 'Reply with a note to redirect'
});
```

**`money_out`**
```json
{ "headline": "Spend $18.00 — hire 3 verified ER nurses",
  "subline": "Outreach ran out of network. Terac panel, 20-min interviews, delivered by 6pm.",
  "risk": "high",
  "fields": [
    {"label":"Amount","value":"$18.00"},
    {"label":"Why no agent can do it","value":"Requires licensed clinical experience"},
    {"label":"Expected value","value":"Unblocks 'what must be true' #2"},
    {"label":"Runway after","value":"$41.20"}],
  "buttons": [
    {"id":"approve","label":"Approve $18","style":"primary","consequence":"Terac posts the job now; charged on delivery"},
    {"id":"cheaper","label":"Cap at $9","style":"secondary","consequence":"Hires 1 nurse instead of 3"},
    {"id":"reject","label":"Skip","style":"destructive","consequence":"Validation ships with gaps[] on clinical claims"}] }
```

**`public_content`** — always ASK. Card carries the *rendered* content, not a description.
```json
{ "headline": "Publish landing page copy",
  "subline": "zeroth-dental.com — hero, 3 sections, pricing",
  "preview": {"kind":"image","uri":"s3://…/lp-preview.png"},
  "fields": [{"label":"Claims made","value":"3 quantitative — all cited"},
             {"label":"Cited sources","value":"ADA 2024 practice survey, 2 interviews"}],
  "buttons": [{"id":"approve","label":"Publish"},{"id":"edit","label":"Change tone"},{"id":"reject","label":"Not yet"}] }
```

**`outbound_to_real_person`** — the *exact* message, plus the consent basis.
```json
{ "headline": "Email 12 warm leads",
  "subline": "All 12 were interviewed by us. Each email quotes their own words.",
  "sample": {"to":"P3 — ops lead, 40-person dental group",
             "subject":"You said approvals were your worst hour",
             "body":"On March 3 you told us…"},
  "fields": [{"label":"Consent basis","value":"Interviewed + opted in"},
             {"label":"Suppressed","value":"2 (DNC), not included"}],
  "buttons": [{"id":"approve","label":"Send 12"},{"id":"sample","label":"Send 1 first"},{"id":"reject","label":"Hold"}] }
```

**`account_creation`** — the ceremony card ([`07-identity-and-accounts.md`](07-identity-and-accounts.md)).
```json
{ "headline": "GitHub needs a 2FA code",
  "subline": "Creating the company's own GitHub org: zeroth-dental",
  "fields": [{"label":"Step","value":"Phone verification"},
             {"label":"Sent to","value":"your number, from GitHub"}],
  "input": {"kind":"otp","length":6,"placeholder":"6-digit code"},
  "buttons": [{"id":"submit","label":"Send code","style":"primary"},
              {"id":"abort","label":"Cancel signup","style":"destructive"}] }
```
The company **never asks the founder for a password.** It asks for the one-time factor only, and
the code is written straight into the Solari session by the identity service — it never enters an
agent's context.

**`pivot_approval`** — the demo's emotional beat. One card, N diffs, per-diff toggles.
```json
{ "headline": "3 changes to the idea",
  "subline": "Based on 7 interviews and the Census panel",
  "diffs": [
    {"id":"d1","op":"NARROW","before":"Dental practices","after":"Multi-location groups, 5-25 chairs",
     "quote":"“I'm one office. I'd never pay for this.” — P2","reversibility":"reversible","recommended":true},
    {"id":"d2","op":"CUT","before":"Patient-facing portal","after":"—",
     "quote":"“Patients call. They won't use an app.” — P5, P6","reversibility":"reversible","recommended":true},
    {"id":"d3","op":"REPRICE","before":"$29/mo","after":"$149/mo per location",
     "quote":"“$29 sounds like a toy.” — P4","reversibility":"costly","recommended":true}],
  "buttons": [{"id":"approve_all","label":"Apply all 3","style":"primary"},
              {"id":"approve_selected","label":"Apply selected"},
              {"id":"reject_all","label":"Keep as-is","style":"destructive"}] }
```

**`deploy`**
```json
{ "headline": "Deploy to production",
  "subline": "12 QA scenarios green in Replay · commit 4f2a91c",
  "fields": [{"label":"URL","value":"https://zeroth-dental.onrender.com"},
             {"label":"QA","value":"12/12 passed"},{"label":"Rollback","value":"one tap, 40s"}],
  "buttons": [{"id":"approve","label":"Ship it"},{"id":"reject","label":"Hold"}] }
```

**`refund`**
```json
{ "headline": "Refund $149 to Ridgeview Dental",
  "subline": "Ticket #41: feature they bought for is delayed 3 weeks",
  "fields": [{"label":"Customer since","value":"6 days"},{"label":"Prior refunds","value":"0"},
             {"label":"Support recommendation","value":"Refund + keep access 30d"}],
  "buttons": [{"id":"approve","label":"Refund $149"},{"id":"partial","label":"Refund 50%"},{"id":"reject","label":"Decline"}] }
```

**`new_department`** — the finale.
```json
{ "headline": "Zeroth wants to add a department",
  "subline": "Security Review (D14) — we lost 3 deals at security questionnaires",
  "fields": [{"label":"Evidence","value":"3 lost deals, $4,470 ARR"},
             {"label":"Shadow test","value":"Would have unblocked 2 of 3"},
             {"label":"Cost","value":"$1.10 per questionnaire"},
             {"label":"Reversible","value":"Yes — retire in one tap"}],
  "buttons": [{"id":"approve","label":"Hire the department","style":"primary"},
              {"id":"shadow","label":"Keep in shadow mode"},
              {"id":"reject","label":"No"}] }
```

---

## Part 7 — Reply parsing

Linq delivers structured button taps **and** free text. Both are accepted.

```ts
// services/gateway-linq/src/parse.ts
export function parseReply(msg: InboundLinq): GateDecision {
  // 1. Structured button tap — the happy path, unambiguous.
  if (msg.action_id) return { gate_id: msg.gate_id!, option_id: msg.action_id, source: 'button' };

  // 2. OTP-shaped reply to an account_creation gate awaiting a code.
  if (/^\s*\d{6}\s*$/.test(msg.text) && awaitingOtp(msg.thread_id))
    return { gate_id: gateFor(msg.thread_id), option_id: 'submit',
             secret: msg.text.trim(), source: 'otp' };   // ← routed to vault, never to an agent

  // 3. Deterministic keyword match, case-insensitive, whole-word.
  const kw = matchKeyword(msg.text);   // yes|y|ok|approve|go|ship → approve
                                       // no|n|stop|reject|hold    → reject
                                       // kill|halt|freeze         → KILL SWITCH
  if (kw === 'kill') return { kind: 'kill_switch', source: 'keyword' };
  if (kw) return { gate_id: mostRecentPending(msg.from), option_id: kw, source: 'keyword' };

  // 4. Anything else = a redirect with a note. We do NOT LLM-guess approve/reject.
  return { gate_id: mostRecentPending(msg.from), option_id: 'redirect',
           note: msg.text, source: 'freetext' };
}
```

**Rule: free text never approves.** An ambiguous message becomes a `redirect` — the department
re-plans with the founder's note in its `ContextPacket.assignment.prior_attempt_failure`. This is
strictly safer than an LLM classifying "hmm, maybe later" as consent. If no gate is pending, free
text is filed as a founder note on the venture timeline and routed to D13.

Multi-gate batches disambiguate by ordinal: `"1 and 3 yes, 2 no"` parses to per-gate decisions;
anything that doesn't parse cleanly across a batch falls back to sending the digest again with
"tap to decide" — once, then `hold`.

---

## Part 8 — The kill switch

One founder action halts the venture. Reachable from: the Boardroom header, the Linq keyword
`KILL`/`HALT`/`FREEZE`, and `POST /ventures/:id/kill`.

```
KILL SEMANTICS  (all of this within one scheduler tick, ≤1s)

 1. ventures.status = 'killed'; venture.killed event appended.
 2. Every pending gate → 'cancelled'. No queued action executes.
 3. Every reservation → 'released'. Budget stops accruing.
 4. Orchestrator sends AbortSignal to every running agent_run in the venture.
 5. Every Superserve sandbox → pause() (NOT destroy — forensics survive).
 6. BullMQ: repeatable jobs for this venture removed; queued work orders → 'cancelled'.
 7. Tool plane: all credential_grants for the venture revoked (revoked_at = now()).
 8. Band: the venture's rooms are closed; outbound mesh messages dropped.
 9. In-flight external effects: NOT retracted. See below.
10. Boardroom: floor plan desaturates, banner "HALTED by founder at 14:02:11".
```

**What kill cannot undo, stated honestly:** an email already handed to Gmail, a Stripe charge
already captured, a Terac job already posted, a deploy already live. The kill switch stops
*future* effects within a tick and lists in-flight effects on the halt banner with a one-tap
compensating action where one exists (`refund`, `retract Terac job`, `rollback deploy`,
`send correction email`). Pretending otherwise would be a lie the demo can't survive a judge poking.

`resume` (`venture.resumed`) requires an explicit founder action, re-issues credential grants,
un-pauses sandboxes, and re-queues work orders from their last artifact boundary. Gates cancelled
by the kill are **not** auto-reopened — the departments re-request them, so the founder never
approves something they halted an hour ago by accident.

### Related, softer controls

| Control | Effect | Undo |
|---|---|---|
| **Freeze department** | One department → `frozen`, its envelope → 0, sandbox paused | Thaw (D11 or founder) |
| **Autonomy downshift** | `autonomous → supervised → copilot`; pending gates re-evaluated under the stricter policy | Upshift |
| **Spend cap** | `founders.spend_cap_usd`; on breach, all `money_out` → ASK regardless of level | Raise cap |
| **Pause venture** | Same as kill minus credential revocation; intended for "let me look at this" | Resume |

---

## Part 9 — Auditability

Every gate produces a complete record answerable to a judge asking *"who decided this?"*:

```sql
SELECT g.gate_type, g.status, g.decided_by, g.decided_option_id, g.decision_note,
       g.opened_at, g.decided_at, (g.decided_at - g.opened_at) AS latency,
       g.action, g.preview, g.amount_usd, g.channel,
       e.type AS effect_event, e.payload AS effect
FROM gates g
LEFT JOIN events e ON e.correlation_id = g.id AND e.type = 'gate.executed'
WHERE g.venture_id = $1 ORDER BY g.opened_at;
```

`decided_by` is `'founder:<uuid>'`, `'policy:autonomous'`, or `'timeout:auto_approve'` — three
distinct, never-conflated values. An auto-approved gate is exactly as auditable as a tapped one,
which is the entire argument that autonomy here is legible rather than hand-wavy.
