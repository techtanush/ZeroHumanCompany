# D12 — Customer Support & Retention

**Cluster:** ops · **Head:** `support.head` · **Critic:** `support.critic` · **Resident:** yes (wakes on every inbound message webhook, on `money.refunded`/`charge.dispute.created`, on cron `support.followup` every 15m, and on cron `support.health` hourly)

---

## 1. Mission

> Answer every customer quickly and honestly, refuse to answer when uncertain, turn every ticket into product intelligence, and keep the customers the company already paid to win.

**The single question this department answers:** *"Is every customer who talks to us better off afterward — and did the company learn something from it?"*

D12 is a listening post as much as a help desk: churn signals route to D06, bugs route to D07,
billing routes to D11, and everything scores into customer health. A ticket that closes without
producing a `ProductSignal`, a KB entry, or a health-score update was only half worked.

---

## 2. Contract — Inputs & Outputs

### Inputs

| Artifact / event | From | Use |
|---|---|---|
| Inbound email | Composio Gmail webhook | Ticket intake |
| Inbound iMessage/SMS | Linq webhook | Ticket intake (customers who opted in) |
| In-app support widget POST | The venture's own product (built by D07) | Ticket intake |
| `charge.refunded`, `charge.dispute.created`, `invoice.payment_failed` | D11 via routing | Billing tickets, dispute evidence tickets |
| `customer.subscription.*` | Stripe via D11 | Support tier, churn events |
| `Deployment` + product docs | D07 | KB seed material; known-issue list |
| `Deal[]`, `Order` | D10 | Customer identity, plan, promised scope |
| `ClaimLedger` | D04 | What this customer said they needed (warm-pool customers) |

### Outputs

| Artifact | To | Contents |
|---|---|---|
| `Ticket[]` | Boardroom, D13 | Full lifecycle records with resolution class |
| `ProductSignal[]` | D06 (reassess), D07 (bugs) | Structured product intelligence from tickets |
| `KBEntry[]` | The venture's public help center + agent retrieval | Generated, versioned answers |
| `CustomerHealth[]` | D10 (expansion), D11 (dunning tone), Boardroom | Scored per customer |
| `BugReport` | D07 via `support↔build` room | Repro steps + Replay recording link |
| Refund delegation | D11 | Support cannot call Stripe; it files |
| `HumanWorkRequisition` | D11/HR | Licensed-professional answers (medical/legal/tax) |

### Core schemas

```ts
// packages/contracts/src/support.ts
export const TicketChannel = z.enum(['email','imessage','sms','in_app','system']);
// 'system' = tickets D11/Stripe events open, e.g. disputes

export const TicketCategory = z.enum([
  'how_to','bug','billing','refund_request','account_access','feature_request',
  'churn_intent','complaint','legal_medical_tax','abuse_spam','unknown',
]);

export const Ticket = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  channel: TicketChannel,
  customer_ref: z.string(),                       // vault handle, never a raw email in the body
  subscription_tier: z.enum(['free','trial','paid','enterprise','unknown']),
  category: TicketCategory,
  category_confidence: z.number().min(0).max(1),
  severity: z.enum(['low','normal','high','urgent']),
  sentiment: z.enum(['positive','neutral','frustrated','angry']),
  status: z.enum(['new','classified','auto_answered','awaiting_customer','escalated_human',
                  'escalated_dept','resolved','closed','reopened']),
  messages: z.array(z.object({
    at: z.string().datetime(),
    from: z.enum(['customer','agent','human_expert','system']),
    body_ref: z.string(),                         // object-store pointer; PII stays out of events
    answered_by: z.string().optional(),           // agent_id or terac hire id
    uncertainty: z.number().min(0).max(1).optional(),   // the responder's own estimate
  })),
  linked: z.object({
    order_id: z.string().uuid().optional(),
    bug_report_id: z.string().uuid().optional(),
    refund_delegation_id: z.string().uuid().optional(),
    kb_entry_ids: z.array(z.string()).default([]),
    product_signal_ids: z.array(z.string()).default([]),
  }),
  sla: z.object({
    first_response_due: z.string().datetime(),
    resolution_due: z.string().datetime(),
    breached: z.boolean().default(false),
  }),
  resolution: z.object({
    class: z.enum(['auto_answered','kb_link','bug_filed','refunded','human_expert',
                   'churn_saved','churn_lost','no_action','unresolvable']),
    csat: z.number().min(1).max(5).optional(),    // from the follow-up ask, if answered
  }).optional(),
});

export const ProductSignal = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  kind: z.enum(['bug','missing_feature','confusing_ux','pricing_objection','performance',
                'churn_reason','downgrade','dispute_reason','praise']),
  summary: z.string(),
  severity: z.enum(['low','normal','high']),
  evidence: z.array(z.object({
    ticket_id: z.string().uuid(),
    quote: z.string().max(500),                   // the customer's words, verbatim
    source_id: z.string(),                        // ticket message ref — signals carry evidence
  })).min(1),                                     // a signal with no ticket behind it is invented
  occurrences: z.number().int().min(1),
  first_seen: z.string().datetime(),
  routed_to: z.enum(['D06','D07','D08','D10','D11']),
});

export const KBEntry = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  body_md: z.string(),
  version: z.number().int().min(1),
  status: z.enum(['draft','published','stale','retired']),
  derived_from: z.array(z.string().uuid()),       // ticket ids that birthed/updated it
  product_version: z.string(),                    // Deployment id it was verified against
  verified_at: z.string().datetime(),
  publish_gate_id: z.string().uuid().optional(),  // KB is public_content — gated
});

export const CustomerHealth = z.object({
  customer_ref: z.string(),
  venture_id: z.string().uuid(),
  score: z.number().min(0).max(100),
  band: z.enum(['healthy','watch','at_risk','critical']),
  components: z.object({                          // §9 formula inputs, kept for audit
    usage: z.number(), support: z.number(), billing: z.number(),
    sentiment: z.number(), tenure: z.number(),
  }),
  churn_risk_flags: z.array(z.string()).default([]),
  computed_at: z.string().datetime(),
  evidence: z.array(z.string()),                  // event/query refs per component
});
```

---

## 3. DepartmentManifest

```yaml
# packages/manifests/D12-support.yaml
id: D12
name: Customer Support & Retention
cluster: ops
version: 1
generated_by: human
resident: true

head:
  agent_id: support.head
  model: sonnet
  system_prompt_ref: prompts/D12/head.md
  tools: [memory.read, memory.write, bus.emit, artifact.sign, artifact.read]
  max_tokens_per_run: 60000
  timeout_s: 120

critic:
  agent_id: support.critic
  model: sonnet
  system_prompt_ref: prompts/D12/critic.md
  rubric_ref: prompts/D12/critic-rubric.md
  tools: [memory.read, artifact.read]
  max_tokens_per_run: 20000

workers:
  - agent_id: support.triage
    model: pioneer:zeroth-ticket-triage      # Fastino fine-tune; falls back to haiku
    replicas: 2
    system_prompt_ref: prompts/D12/triage.md
    tools: [memory.read]
    max_tokens_per_run: 8000
    temperature: 0.0
  - agent_id: support.resolver
    model: sonnet
    replicas: 3
    system_prompt_ref: prompts/D12/resolver.md
    tools: [memory.read, memory.search, artifact.read, composio.gmail.send, linq.send_text]
    max_tokens_per_run: 40000
  - agent_id: support.kb
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D12/kb.md
    tools: [memory.read, memory.write, artifact.read, web_fetch]
    max_tokens_per_run: 40000
  - agent_id: support.repro
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D12/repro.md
    tools: [sandbox.exec, replay.start_recording, replay.stop, replay.get_session, artifact.read]
    max_tokens_per_run: 50000
  - agent_id: support.retention
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D12/retention.md
    tools: [memory.read, artifact.read, composio.gmail.send, linq.send_text]
    max_tokens_per_run: 30000

concurrency: 8

budget:
  default_envelope_usd: 0.80        # matches the platform cost table; triage is haiku-cheap
  hard_cap_usd: 2.50
  degrade_at_pct: 0.8
  on_exhausted: escalate            # D12 has a $0.50 floor — support never goes dark

io:
  input: [Ticket, Deployment, Deal, Order, ClaimLedger]
  output: [Ticket, ProductSignal, KBEntry, CustomerHealth, BugReport]
  min_outputs: 0                    # a quiet day is legal
  emits_work_orders_to: [D07]       # bug repro handoffs

gates:
  - id: outbound_reply
    trigger: event(support.reply_drafted(first_contact=true))
    question: "Send this first reply to {customer}?"
    surface: boardroom
    card: approve_reject
    auto_approve_at: supervised     # replies to inbound tickets are warm, not cold outreach
    timeout_s: 1800
    on_timeout: hold
  - id: kb_publish
    trigger: artifact.created(type=KBEntry)
    question: "Publish this help-center article?"
    surface: both
    card: approve_reject
    auto_approve_at: never          # public_content is NEVER auto, per platform policy
    timeout_s: 7200
    on_timeout: hold
  - id: refund_delegation
    trigger: event(support.refund_proposed)
    question: "Refund ${amount} for ticket {id}? Reason: {reason}."
    surface: linq
    card: approve_reject
    auto_approve_at: autonomous     # ≤$50 first-refund AUTO*; D11 re-checks before executing
    timeout_s: 3600
    on_timeout: auto_approve

sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 2048
  egress_allowlist: [api.composio.dev, api.linq.app, api.replay.io]
  pause_between_cycles: true
  forkable: false

sla:
  soft_deadline_s: 180
  hard_deadline_s: 360
  on_timeout: return_partial

memory:
  reads: [venture, department]
  writes: [department]

triggers:
  - kind: webhook
    expr: composio.gmail.inbound | linq.inbound | product.support_widget
  - kind: event
    expr: money.refunded | money.dispute_opened | sales.deal_lost(reason=churn)
  - kind: cron
    expr: "*/15 * * * *"            # support.followup
  - kind: cron
    expr: "0 * * * *"               # support.health — recompute CustomerHealth
```

---

## 4. Agent Roster

| Role | Agent | Model | Replicas | Tools (key) | Token budget | Job |
|---|---|---|---|---|---|---|
| Head | `support.head` | sonnet | 1 | `bus.emit`, `artifact.sign` | 60k | Queue owner, escalation decisions, signs signals |
| Triage | `support.triage` | pioneer/haiku | 2 | `memory.read` | 8k | Classify, severity, route — cheap and fast |
| Resolver | `support.resolver` | sonnet | 3 | `composio.gmail.send`, `linq.send_text`, `memory.search` | 40k | Drafts and sends answers within the uncertainty policy |
| KB writer | `support.kb` | sonnet | 1 | `memory.write`, `web_fetch` | 40k | Generates and maintains help-center entries |
| Repro | `support.repro` | sonnet | 1 | `sandbox.exec`, `replay.*` | 50k | Reproduces bugs, records evidence, files to D07 |
| Retention | `support.retention` | sonnet | 1 | outbound tools | 30k | Health scoring, churn plays, follow-ups |
| Critic | `support.critic` | sonnet | 1 | `artifact.read` | 20k | Audits outbound quality + signal evidence |

The triage tier is the Pioneer fine-tune showcase: thousands of short classification calls at
$0.10/M instead of sonnet prices, with haiku as the automatic fallback per the `ModelTier` schema.

---

## 5. System Prompts

### `prompts/D12/head.md`

```
You are the Head of Customer Support & Retention at Zeroth, an AI-run agency building a company
for a human founder. You do not do the work yourself. You decompose, dispatch, merge, and sign.
You may not fabricate. A gap is an acceptable output; an invented number is a P0 defect.
You report cost honestly, including your own.

You own the ticket queue. Rules you enforce:
1. Every inbound message becomes a Ticket within one wake, even spam (category=abuse_spam,
   auto-closed). Nothing sits unclassified.
2. The uncertainty policy is not advisory. A resolver that answers below the confidence bar
   has committed a defect even if the answer was right.
3. Enterprise/paid tickets outrank free/trial at equal severity. Disputes outrank everything.
4. Every resolved ticket must produce at least one of: KB link used, KB entry drafted,
   ProductSignal, health-score update. "Closed, learned nothing" is a rubric failure.
5. You never promise features, refunds above policy, or timelines. Those route out.
Sign ProductSignals only when every one carries a verbatim customer quote with a source_id.
```

### `prompts/D12/triage.md`

```
You classify one inbound message. Output JSON only:
{category, category_confidence, severity, sentiment, language, customer_known: bool,
 dedupe_of: ticket_id|null}
Severity rules: urgent = money lost, data lost, security, or an angry paid customer;
high = paid customer blocked, dispute, churn_intent; normal = default; low = feature ideas, praise.
If category_confidence < 0.6, output category=unknown — a wrong route is worse than a slow one.
Never draft an answer. Never address the customer.
```

### `prompts/D12/resolver.md`

```
You draft replies to classified tickets. Before writing, gather: the KB search results, the
customer's order/subscription, their ClaimLedger quotes if warm-pool, and the known-issue list.

THE UNCERTAINTY POLICY — you MUST NOT send an answer when any of these hold:
- Your own confidence in factual correctness is below 0.8 (state it in the draft metadata).
- The answer depends on product behavior you cannot verify in the KB or the Deployment docs.
- The category is legal_medical_tax — always route to a licensed human via HR requisition.
- The ticket asks about money beyond published pricing — route to billing handoff (D11).
- The customer is angry AND paid AND this is their second+ contact on the same issue —
  escalate to a human touch, do not send another bot answer.
- Answering requires promising anything: features, dates, refunds, exceptions.
In every such case you output an escalation draft instead, with your best partial answer
attached for the human's benefit — never sent to the customer.

When you do answer: cite the KB entry ids you relied on, quote the customer's own words when
confirming their issue, one clear next step, no hedging filler. If the fix is a workaround for
a known bug, say so honestly and link the ticket to the bug id.
```

### `prompts/D12/kb.md`

```
You maintain the knowledge base. Sources: resolved tickets (3+ occurrences of the same
question ⇒ draft an entry), Deployment docs from D07, and diffs between product versions.
Every entry states the product_version it was verified against. When D07 ships, you re-verify
every published entry touching changed surfaces and mark stale ones. You never publish —
publishing is a gate; you draft and file. Style: task-titled ("How do I…"), steps first,
one screenshot placeholder max, under 300 words.
```

### `prompts/D12/repro.md`

```
You reproduce reported bugs. Procedure: build minimal repro steps from the ticket, execute
them against the deployed product in a sandbox with a Replay recording running, and capture:
steps, expected vs actual, recording session id, product version, and frequency
(always/sometimes/once). If you cannot reproduce in 3 attempts, file as unconfirmed with your
attempts logged — never file "works on my machine" as a resolution. Output a BugReport into
the support↔build room. You do not fix bugs. You do not speculate about root cause beyond
one sentence.
```

### `prompts/D12/retention.md`

```
You run health scoring and retention plays. The health formula is deterministic (calc-style
weights in the spec §9); you compute components from event queries, never estimate them.
Plays are chosen from the playbook by band transition, not invented per customer. Every
outbound play message is warm (they are a customer), honest (no fake "just checking in" if
usage cratered — name it), and singular (one message per play, no sequences without replies).
Churn saves you cannot honor (discounts beyond authority, feature promises) route to D10/D11.
```

### `prompts/D12/critic.md`

```
You audit D12 output. Reject when: an outbound reply was sent with uncertainty > 0.2 recorded;
a ProductSignal lacks a verbatim quote with source_id; a KB entry lacks a product_version;
a bug was filed without repro steps or an unconfirmed label; a health score's components
don't recompute to the published score; or any customer PII appears in an event body instead
of a vault ref. Return the standard verdict JSON.
```

---

## 6. Execution Flow

```
  Gmail ─┐
  Linq ──┼─► webhook ─► Ticket(new) ─► triage (pioneer/haiku) ─► classified
  in-app ┘                                    │
          ┌───────────────────────────────────┼───────────────────────────────┐
          ▼                    ▼              ▼               ▼               ▼
      how_to/bug          billing/refund   legal_medical   churn_intent    abuse_spam
          │                    │              _tax             │               │
      resolver             D11 handoff     HR requisition   retention      auto-close
     (uncertainty          (§8.5)          (licensed        play (§10)
      policy §8.3)                          human)
          │
   ┌──────┴───────┐
   ▼              ▼
 answer ok    must NOT answer
   │              │
 send reply   escalate_human (founder or Terac) with partial attached
   │
 resolve ─► KB check ─► ProductSignal? ─► health update ─► follow-up cron (+24h CSAT ask)
```

Numbered:

1. **Intake** (§8.1): webhook → raw payload stored → `Ticket(new)` with vault-ref'd identity.
2. **Classify**: triage worker; `unknown` at low confidence goes to the Head, not to a guess.
3. **Route** by category (diagram above). Dedupe: same customer + same issue within 7d reopens
   the existing ticket instead of forking a new one.
4. **Resolve or refuse**: resolver drafts inside the uncertainty policy; refusals become
   escalations with the partial answer attached.
5. **Learn**: KB writer and signal filing run on resolution, not on a batch schedule.
6. **Follow up**: +24h CSAT ask (one message, once); +7d reopen check on `awaiting_customer`.
7. **Score**: hourly health recompute; band transitions trigger retention plays.

---

## 7. Integrations

| Capability | Vendor | Use |
|---|---|---|
| Email intake + replies | **Composio Gmail** | The primary channel |
| iMessage/SMS intake + replies | **Linq** | Opted-in customers; founder escalation cards |
| In-app widget | The venture's own product (D07) | POSTs into the kernel |
| Bug evidence recordings | **Replay** | Repro sessions attached to BugReports |
| Repro sandboxes | **Superserve** | `support.repro` executes against the live product |
| Ticket triage at scale | **Pioneer (Fastino)** | Fine-tuned classifier, haiku fallback |
| Billing state, refunds, disputes | **Stripe via D11** | D12 reads state, never writes money |
| Licensed-professional answers | **Terac via D11/HR** | `expert_verification` requisitions |
| Agent collaboration | **Band** | `support↔build` room + policies (§11) |

---

## 8. Ticket operations

### 8.1 Intake across channels **MVP**

| Channel | Transport | Identity resolution |
|---|---|---|
| Email | Composio Gmail webhook on the venture's support address | Match sender → `Customer` via vault; unknown senders get a `customer_ref` created with `tier=unknown` |
| iMessage/SMS | Linq inbound webhook | Phone handle → vault match; only customers who opted in during purchase/onboarding |
| In-app | `POST /support` on the deployed product, forwarded to the kernel with the venture key | Session token → customer id, the strongest identity |
| System | D11 routing (disputes, failed payments), `sales.deal_lost(reason=churn)` | Already joined |

Intake invariants: raw payload persisted before parsing (same webhook discipline as Stripe/Terac);
dedupe on channel-native message ids in `processed_messages`; PII (email bodies, phone numbers)
stored in object storage with vault refs — event bodies carry pointers only, matching the
`no-pii-in-rooms` Band policy.

**POST-MVP:** shared-inbox threading for multi-participant emails; social-channel intake (X/Reddit
mentions) via Apify watchers routed as `complaint` tickets.

### 8.2 Classification **MVP**

Triage emits `{category, confidence, severity, sentiment}` (§5 prompt). Deterministic overrides run
*before* the model: Stripe-originated tickets are `billing`; `sales.deal_lost(reason=churn)` opens
`churn_intent`; known-customer + refund keywords force `refund_request` at minimum severity
`normal`. The model can raise severity, never lower a deterministic floor.

### 8.3 Safe automated responses — the uncertainty policy **MVP**

The policy is stated fully in the resolver prompt (§5) because prompts are the enforcement surface
agents actually see; this table is the spec the Critic audits against:

| Condition | Agent must NOT answer; instead |
|---|---|
| Self-assessed factual confidence < 0.8 | Escalate with partial attached |
| Answer not verifiable in KB or Deployment docs | Escalate; flag KB gap to `support.kb` |
| `legal_medical_tax` | HR requisition for a licensed human (`expert_verification`) — the D12 row in [`../03-integrations/01-terac.md`](../03-integrations/01-terac.md) |
| Money beyond published pricing | Billing handoff to D11 (§8.5) |
| Angry + paid + repeat contact on same issue | Human touch escalation; no third bot reply |
| Any promise required (feature, date, exception, refund above policy) | Route to owning department |
| Security-sensitive (account takeover, data exposure claims) | `severity=urgent`, founder card, no automated reply beyond acknowledgment |

Mechanics: every draft carries `uncertainty` (0–1) in message metadata; the send tool refuses drafts
with `uncertainty > 0.2`; the Critic audits samples post-hoc. Refusal is a *success path*: the
customer gets an honest "a human will follow up within {SLA}" acknowledgment, which is itself a
whitelisted template needing no confidence check.

The acknowledgment template family (auto-ack, human-handoff-ack, dispute-received) is pre-approved
copy — reviewed once through a `public_content`-style gate at venture setup, then sent without
per-message gating. Everything non-template is a drafted reply subject to the policy.

### 8.4 Human escalation **MVP**

```
resolver refuses ─► Head decides:
  ├─ founder can answer (product intent, judgment)   ─► Linq card with draft attached
  ├─ needs licensed professional                     ─► HumanWorkRequisition(expert_verification)
  │                                                     via hr↔all; ROI test applies (D11 §9.2)
  └─ needs another department                        ─► escalated_dept (D07 bug, D11 billing, D10 promise)
```

Escalated tickets keep their SLA clock running; a breach on an escalated ticket is attributed to
D12 in analytics (we own the customer, whoever holds the ball). The human's answer returns through
the ticket thread marked `from: human_expert`, and — like every human deliverable — reingests as
evidence: quotes from a Terac-verified professional enter the KB with `kind='human_expert'` sourcing.

### 8.5 Billing support handoff to D11 **MVP**

D12 cannot call Stripe (`money-out-is-d11-only`). The handoff is a delegation with a proposed
resolution, not a question:

```ts
// filed into the sales↔finance room's sibling path, per 03-stripe.md
type RefundDelegation = {
  ticket_id: string; order_id: string;
  amount_usd: number;                    // ≤ order total, computed from the ledger not the customer
  reason: 'not_as_described'|'accidental_purchase'|'service_failure'|'goodwill';
  proposed_by: 'D12'; evidence: string[];   // ticket message refs
};
```

≤ $50 and first refund for the customer: D12 proposes, D11 executes autonomously (AUTO* per
[`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md)). Above that, the
`refund` gate goes to the founder. Dispute tickets follow the D11 flow: D12 assembles evidence
(order, delivery events, usage logs, support history), D11 submits behind the `dispute_evidence`
gate. Non-refund billing questions (invoice copies, plan changes, payment method) are answered by
D12 from read-only projections — no handoff needed, no Stripe write involved.

### 8.6 Bug reproduction and filing into D07 **MVP**

`support.repro` turns "it's broken" into an actionable `BugReport`:

```ts
export const BugReport = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  ticket_ids: z.array(z.string().uuid()).min(1),
  title: z.string(),
  steps: z.array(z.string()).min(1),
  expected: z.string(),
  actual: z.string(),
  reproducible: z.enum(['always','sometimes','once','unconfirmed']),
  replay_session_id: z.string().optional(),      // the evidence — a judge can watch the bug
  product_version: z.string(),                   // Deployment id
  severity: z.enum(['p0','p1','p2','p3']),       // p0 = data loss/security/payments broken
  attempts_log: z.array(z.string()),             // mandatory when unconfirmed
});
```

Filed as a `WorkOrder` to D07 through the `support↔build` Band room. Severity negotiation happens
in-room (D07 may argue a p1 down to p2 with reasons; p0 is not negotiable). When D07's fix deploys,
the routing rule closes the loop: affected tickets get a verified-fix reply and the KB entry
updates. Three tickets on one bug = one BugReport with three `ticket_ids`, not three reports.

---

## 9. Retention mechanics

### 9.1 Customer-health scoring formula **MVP**

Deterministic, recomputed hourly, components stored for audit:

```
health = 100 × (0.35·usage + 0.20·support + 0.20·billing + 0.15·sentiment + 0.10·tenure)

usage     = min(active_days_last_14 / expected_active_days, 1)
            expected_active_days from the ProductSpec's usage model (daily tool = 10, weekly = 2)
support   = 1 − min(open_tickets×0.25 + unresolved_urgent×0.5 + sla_breaches_90d×0.25, 1)
billing   = 1.0 paid & current · 0.6 past_due · 0.8 trial >3d left · 0.3 trial <3d, no usage
            0.0 dunning attempt ≥3
sentiment = mean of last 5 ticket sentiments mapped {positive 1, neutral 0.7,
            frustrated 0.35, angry 0} · default 0.7 if no tickets (silence isn't happiness,
            but it isn't anger)
tenure    = min(months_active / 6, 1)

bands: healthy ≥ 70 · watch 50–69 · at_risk 30–49 · critical < 30
```

Weights are config (`packages/contracts/src/support-scoring.ts`), not code constants. Every
component carries an `evidence` query ref — a health score whose components don't recompute is a
Critic reject. **POST-MVP:** learned weights once ≥20 churn observations exist to regress against;
until then the weights are labeled as priors in `assumptions[]`.

### 9.2 Churn-risk detection **MVP**

Flags, each mapped to a play:

| Flag | Trigger | Play |
|---|---|---|
| `usage_cliff` | usage component drops >50% cycle-over-cycle | re-engagement (§10) |
| `dunning_active` | payment attempt ≥2 failed | D11 owns messages; D12 adds a service check |
| `churn_intent_ticket` | category `churn_intent` or cancel-keyword match | save play, human-touch tier |
| `subscription_deleted` | Stripe webhook via D11 | exit survey + `ProductSignal(churn_reason)` → D06 (churn is a product signal, per [`../03-integrations/03-stripe.md`](../03-integrations/03-stripe.md)) |
| `downgrade` | subscription updated downward | check-in play + `ProductSignal(downgrade)` |
| `angry_paid` | sentiment angry on a paid account | Head review same-cycle |
| `trial_expiring_unused` | <3d left, usage < 0.2 | onboarding-help play (not a discount) |

### 9.3 Feedback routing **MVP**

Every ticket may yield a `ProductSignal` (schema §2, quote + `source_id` mandatory).
Aggregation: signals about the same issue merge with `occurrences` incremented. Routing:

| Signal kind | Routed to | Threshold |
|---|---|---|
| `bug` | D07 | immediately (via BugReport) |
| `missing_feature`, `confusing_ux` | D06 | 3 occurrences, or 1 from an enterprise customer |
| `pricing_objection` | D08 + D06 | 3 occurrences |
| `churn_reason`, `dispute_reason`, `downgrade` | D06 | immediately — `support.signal_filed(severity>=high) → D06 reassess`, the routing rule in [`../03-integrations/03-stripe.md`](../03-integrations/03-stripe.md) |
| `praise` | D08 (testimonial candidates) | with customer consent only |

### 9.4 SLAs **MVP**

| Tier | First response | Resolution | Notes |
|---|---|---|---|
| enterprise | 1h | 24h | dispute tickets: 4h resolution (D11's SLA) |
| paid | 4h | 48h | |
| trial | 8h | 72h | |
| free/unknown | 24h | best effort | |
| urgent (any tier) | 30m | 24h | security/data/money |

Demo `time_scale` compresses these ×0.001. Breach → `sla.breached` event, Boardroom amber chip,
and a breach entry in analytics. Two breaches in a cycle → Head raises
`Escalation(reason='capacity', severity='degrading')`, which is D13's cue to look at resolver
replica counts.

### 9.5 Support analytics **MVP**

Per cycle, into the `FinanceReport`'s sibling `SupportReport` section of the Boardroom:

| Metric | Definition |
|---|---|
| Volume by category/channel | ticket counts |
| First-response and resolution p50/p90 | from ticket timestamps |
| Auto-resolution rate | resolved with `class=auto_answered|kb_link` ÷ resolved |
| Refusal rate | uncertainty-policy refusals ÷ drafted (a *healthy* number is > 0; 0 means the bar is being ignored) |
| CSAT | mean of follow-up scores (response rate reported alongside) |
| SLA breach rate | breaches ÷ tickets with SLA |
| Signal yield | tickets producing ≥1 signal/KB/health update ÷ resolved |
| Cost per ticket | D12 metered spend ÷ tickets resolved |

### 9.6 Post-resolution follow-up **MVP**

Cron `support.followup` (15m): +24h after resolution, one CSAT ask (1–5, one tap) on the channel
the customer used; no reply = no re-ask. +7d, `awaiting_customer` tickets close with a "reopen
anytime" note; a reply within 30d reopens the same ticket (`status=reopened`), preserving history.
CSAT ≤ 2 → Head review + possible goodwill play (which is a refund delegation if money is involved).

---

## 10. Customer-success plays **MVP**

Plays fire on band transitions and flags, never ad hoc. All outbound is warm (existing customers),
so `outbound_to_real_person` gating follows the warm row of the platform decision table.

| Play | Trigger | Action | Success metric |
|---|---|---|---|
| Onboarding check | 3d after first payment, usage < 0.3 | One help offer citing what they bought it for (their `ClaimLedger` quote if warm-pool) | usage ≥ 0.5 in 7d |
| Re-engagement | `usage_cliff` | Honest note naming the drop + one concrete value tip | any active day in 7d |
| Save | `churn_intent_ticket` | Acknowledge → fix if fixable → offer within authority (pause ≤ 1 cycle, plan change); discounts >15% route to D10 | subscription active +30d |
| Exit survey | `subscription_deleted` | One question: "what was the main reason?" | response → `ProductSignal(churn_reason)` |
| Win-back **POST-MVP** | 60d post-churn, churn reason since fixed | "You left because X; X is fixed" | reactivation |
| Expansion signal | healthy + usage at plan ceiling | Signal to D10 (D12 never sells) | D10 expansion deal |

Play rate limits: max one play message per customer per 7 days, across all plays; a customer in an
active dunning sequence receives no plays (D11's one-message-per-24h rule owns that channel).

---

## 11. Band usage: collaboration, shared context, failure recovery **MVP**

Per [`../03-integrations/02-band.md`](../03-integrations/02-band.md), D12 is a mesh peer with
capabilities generated from this manifest's `io` block (`resolve_ticket`, `file_product_signal`,
`assess_customer_health`).

**Rooms:**

| Room | D12's role | Shared context |
|---|---|---|
| `support↔build` (D12, D07) | Files BugReports, negotiates severity, receives fix notifications | `{open_bugs: [{id, severity, status, replay_ref}], known_issues: [...]}` — the known-issue list resolvers cite |
| `sales↔finance` sibling path | Files refund delegations to D11 | invoice/refund state |
| `hr↔all` | Files `expert_verification` requisitions | HR envelope, open requisitions |
| `cos↔all` | Observed by D13 (read-only for D13) | — |

**Policies that bind D12:** `money-out-is-d11-only` (cannot delegate `stripe.*`; a violation is
rejected and *becomes* the correct escalation to D11 — `on_violation: reject_and_emit`);
`no-pii-in-rooms` (customer handles redacted to vault refs in transit);
`worker-cannot-cross-departments` (only `support.head` speaks in rooms).

**Shared context discipline:** the known-issue list in `support↔build` is a cache; the event store
wins on disagreement, always. Context patches use CAS on the room's version int.

**Failure recovery:**

- Band down → PG driver failover (`bus.degraded`); tickets flow identically because
  `EventStore.append()` precedes publish. No customer-visible impact.
- Room context lost on sandbox resume → rehydrate from Band if available, else rebuild from the
  event store (`restore` lifecycle in the Band spec).
- A resolver replica dies mid-draft → escalation ladder rung 1 (sibling worker with the partial);
  the draft is in the event store, not in the dead sandbox's memory.
- D07 unresponsive in `support↔build` for > 1 cycle on a p0/p1 → Head raises
  `Escalation(needs_capability)` up the ladder; the customer gets an honest status update either way.

---

## 12. Customer data protection **MVP**

| Rule | Enforcement |
|---|---|
| PII (names, emails, phones, message bodies) lives in object storage + vault; events and Band messages carry refs only | `no-pii-in-rooms` policy + reducer validation |
| Handles encrypted at rest | Same as D09's `Lead.handles` treatment ([`D09-leads.md`](D09-leads.md)) |
| Support agents see one customer's data per ticket — no bulk export tool exists in any D12 allowlist | Tool allowlist (no ambient tools) |
| Deletion request → ticket category `account_access`, executes vault purge + tombstone events **POST-MVP** (MVP: founder-gated manual flow) | gate |
| Payment card data: never touches Zeroth — Stripe-hosted surfaces only | architecture |
| Ticket bodies never enter model training or Pioneer fine-tune sets without explicit consent | fine-tune pipeline filter |
| Health scores and sentiment are internal; never shown to the customer or used in public copy | policy + Critic check |
| Human experts (Terac) see the minimum brief, pseudonymized | HR brief construction, D11 §9.3 |

---

## 13. Gates & Escalations

**Gates opened:** `outbound_reply` (first contact per customer; subsequent thread replies inherit),
`kb_publish` (public_content — never auto), `refund_delegation` (proposal; D11 re-gates execution).

**Escalations raised:** `needs_human` (licensed answers), `needs_capability` (D07 unresponsive,
capacity), `needs_approval` (goodwill beyond policy), `anomaly` (intake surge > 5× baseline —
possible incident or abuse).

---

## 14. Failure Modes & Fallbacks

| Failure | Detection | Fallback | Quality |
|---|---|---|---|
| Gmail webhook lapse | Heartbeat poll every 5m | Poll-based intake; SLA clocks start at *receipt*, breach honestly attributed | signed |
| Triage misroutes | Resolver rejects category | Reclassify once, then Head decides | signed |
| KB empty (early venture) | — | Resolvers answer from Deployment docs only, tighter 0.9 confidence bar, higher refusal rate expected | partial |
| Repro sandbox can't reach product | Health check | File `unconfirmed` with attempts log — never guess | partial |
| CSAT silence | — | Report response rate alongside; never impute scores | signed |
| Terac expert times out | Requisition deadline | Founder card with the partial answer; customer gets honest status | partial |
| Intake surge | Volume > 5× baseline | Acknowledge-all templates, triage-only mode, Head pages founder | partial |

---

## 15. Definition of Done & Critic Rubric

**DoD (per cycle):** no ticket in `new` > one wake · every resolved ticket produced KB/signal/health
output or an explicit `no_action` reason · zero uncertainty-policy violations in sent replies ·
all signals quote-backed · SLA breaches reported, not suppressed.

**Rubric** (0–3; pass ≥ 14/18, no zero):

| Dimension | 3 looks like |
|---|---|
| Evidence | Signals and health components trace to ticket refs and queries |
| Specificity | Replies cite KB ids; bugs have steps + recording |
| Falsifiability | Health formula recomputes; play success metrics stated |
| Honesty | Refusal rate > 0; unconfirmed bugs labeled; CSAT response rate shown |
| Customer safety (dept-specific) | Zero policy-violating sends; PII rules hold |
| Learning yield (dept-specific) | Signal yield ≥ 0.5 of resolved tickets |

---

## 16. Demo Notes

| Time | On screen |
|---|---|
| 2:25 (ambient) | `support↔build` arc pulses: a ticket becomes a BugReport with a Replay link; D07 severity negotiation visible |
| 2:40 | A ticket hits the uncertainty policy: the refusal + human escalation renders — "the agent knew what it didn't know" |
| 3:05 | Refund delegation flows D12 → D11; the gate card and ledger entry appear |
| 3:40 | Health dashboard: one customer drops to `watch`, the re-engagement play fires |

---

## 17. Cost Estimate

| Item | Est. |
|---|---|
| Triage (pioneer, ~200 classifications) | $0.02 |
| Resolvers (sonnet ×3) | $0.45 |
| KB + repro + retention | $0.20 |
| Head + Critic | $0.10 |
| Tool calls (Composio, Linq, Replay) | $0.03 |
| **Total per cycle** | **≈ $0.80** (matches `default_envelope_usd` and the platform cost table) |

---

## Assumptions & open questions

1. **ASSUMPTION:** Composio's Gmail integration delivers inbound webhooks (not just send). If
   poll-only, the 5m heartbeat poll becomes the primary path and first-response SLAs get +5m.
2. **ASSUMPTION:** Linq supports inbound customer messages to the venture's number, not only
   founder cards. VERIFY at the booth; fallback is email-only intake for MVP.
3. **Open:** the 0.8 confidence bar and 0.2 send-tool ceiling are priors. D13 should tune them
   against CSAT and correction-rate data once ≥50 answered tickets exist.
4. **Open:** health-score weights are unvalidated priors until ~20 churn observations. Recorded in
   every `CustomerHealth.evidence` as such.
5. **Open:** should `kb_publish` batch (one gate per set of entries) to reduce founder taps?
   Leaning yes with a `multi_approve` card.
6. **Open:** exit-survey response incentives (credit?) are a `money_out` question for D11 — not
   designed here.
7. **ASSUMPTION:** the in-app widget is part of D07's standard scaffold. If a venture ships
   without it, email/Linq carry intake alone.
8. **Open:** multilingual support is POST-MVP; triage detects language and the resolver answers in
   it, but KB stays English-only for MVP.
