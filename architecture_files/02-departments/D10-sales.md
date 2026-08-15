# D10 — Sales & Revenue

**Cluster:** gtm · **Head:** `sales.head` · **Critic:** `sales.critic` · **Resident:** yes (wakes on new `LeadBatch`, replies, meetings, payment status, and cron `sales.cadence_tick`)

| Upstream | This department does | Downstream |
|---|---|---|
| D08 `GTMPlan`, D09 `LeadBatch`, D04 `ClaimLedger`, D07 `Deployment` | Turns consent-clean leads into conversations, demos, proposals, and paid orders | D11 collects/reconciles money, D12 receives customer context, D08/D13 learn from objections and losses |

---

## 1. Mission

> Convert the strongest evidence-backed leads into revenue without violating consent, overpromising shipped scope, or losing the human context that made the lead warm.

**The single question it answers:** *"Who should we contact next, what exactly should we say, and what commercial state is this account in?"*

**MVP:** warm-pool-first email/SMS sequences, one demo-booking path, one Stripe payment-link request through D11, visible pipeline state.  
**POST-MVP:** multi-seat sales, proposals, procurement portals, enterprise security review, call assistance, CRM sync, and expansion motions.

---

## 2. Contract — Inputs & Outputs

### Inputs

| Artifact / event | From | Use |
|---|---|---|
| `LeadBatch` | D09 | Ordered prospects, channel permissions, warm quote refs, suppression state |
| `GTMPlan` | D08 | Positioning, pricing, personas, objections, channel rules, discount policy |
| `ClaimLedger` + `Interview[]` | D04 | Exact customer language to quote back to warm leads |
| `Deployment` | D07 | Shipped-scope boundary. Sales may not promise features absent from this artifact |
| `BudgetAllocation` | D11 | Caps enrichment, voice minutes, CRM sync, and sequence volume |
| `money.order_paid/failed/refunded` | D11 | Keeps deal state aligned with the ledger |
| Replies, bounces, opt-outs | Composio/Linq/webhooks | Drive sequence state transitions |

### Output — `Deal`

```ts
export const DealStage = z.enum([
  'new',
  'queued',
  'contacted',
  'replied',
  'qualified',
  'meeting_booked',
  'meeting_completed',
  'proposal',
  'verbal_yes',
  'payment_pending',
  'won',
  'lost'
]);

export const SalesInteraction = z.object({
  id: z.string().uuid(),
  channel: z.enum(['email','linkedin','sms','imessage','voice','meeting','crm_note']),
  direction: z.enum(['outbound','inbound','internal']),
  occurred_at: z.string().datetime(),
  summary: z.string(),
  content_ref: z.string().optional(),        // artifact/file/snapshot id, never raw PII in logs
  gate_id: z.string().uuid().optional(),     // required for outbound
  source_event_id: z.string().uuid().optional(),
  claim_ids: z.array(z.string()).default([]),
  consent_basis_at_send: z.string().optional(),
});

export const ObjectionRecord = z.object({
  id: z.string().uuid(),
  deal_id: z.string().uuid(),
  kind: z.enum(['price','timing','trust','security','missing_feature','authority','integration',
                'roi_unclear','status_quo','legal','other']),
  raw_quote: z.string(),
  normalized_summary: z.string(),
  severity: z.enum(['minor','material','blocking']),
  gtm_matrix_match: z.string().optional(),
  recommended_response: z.string(),
  feeds: z.array(z.enum(['D08','D06','D07','D12','D13'])),
});

export const Deal = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  account_id: z.string().optional(),
  stage: DealStage,
  value_usd: z.number().min(0),
  currency: z.literal('USD').default('USD'),
  package_id: z.string(),                    // from GTMPlan.pricing
  owner_agent: z.literal('sales.head'),
  next_action: z.object({
    kind: z.enum(['send_step','wait','book_meeting','prep_demo','request_payment_link',
                  'ask_founder','handoff_support','close_lost']),
    due_at: z.string().datetime(),
    reason: z.string(),
  }),
  interactions: z.array(SalesInteraction).default([]),
  objections: z.array(ObjectionRecord).default([]),
  discount: z.object({
    pct: z.number().min(0).max(100).default(0),
    reason: z.string().optional(),
    approved_gate_id: z.string().uuid().optional(),
  }).default({pct: 0}),
  forecast: z.object({
    probability: z.number().min(0).max(1),
    close_by: z.string().date().optional(),
    rationale: z.string(),
  }),
  lost_reason: z.string().optional(),
  lost_reason_cluster: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
```

### Output — `OrderRequest`

D10 never writes to Stripe/Whop/Dodo directly. It files a signed request to D11.

```ts
export const OrderRequest = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  deal_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  requested_by: z.literal('sales.head'),
  rail_preference: z.enum(['stripe','whop','dodo','auto']),
  package_id: z.string(),
  amount_usd: z.number().positive(),
  payment_terms: z.enum(['pay_now','net_7','net_15','net_30','founder_custom']),
  customer: z.object({
    name: z.string(),
    email_handle_ref: z.string(),
    company: z.string().optional(),
  }),
  line_items: z.array(z.object({
    name: z.string(),
    quantity: z.number().positive(),
    unit_amount_usd: z.number().positive(),
  })),
  metadata: z.object({
    quote_source_claim_ids: z.array(z.string()),
    approved_discount_gate_id: z.string().uuid().optional(),
    trace_id: z.string(),
  }),
});
```

### Events

| Event | Required payload |
|---|---|
| `sales.sequence_started` | `deal_id`, `lead_id`, `sequence_id`, `channel_policy_hash` |
| `sales.outbound_drafted` | `deal_id`, `draft_artifact_id`, `claim_ids`, `scope_check` |
| `sales.outbound_sent` | `deal_id`, `gate_id`, `channel`, `vendor_message_id` |
| `sales.reply_received` | `deal_id`, `channel`, `reply_snapshot_source_id` |
| `sales.meeting_booked` | `deal_id`, `calendar_event_ref`, `disclosure_plan` |
| `sales.deal_stage_changed` | `deal_id`, `from`, `to`, `reason` |
| `sales.order_requested` | `OrderRequest` |
| `sales.deal_won` / `sales.deal_lost` | signed `Deal` ref |

---

## 3. DepartmentManifest

```yaml
# packages/manifests/D10-sales.yaml
id: D10
name: Sales & Revenue
cluster: gtm
version: 1
generated_by: human
resident: true

head:
  agent_id: sales.head
  model: opus
  system_prompt_ref: prompts/D10/head.md
  tools: [memory.read, memory.write, bus.emit, artifact.read, artifact.sign, linq.send_card, calc]
  max_tokens_per_run: 110000
  timeout_s: 240

critic:
  agent_id: sales.critic
  model: sonnet
  system_prompt_ref: prompts/D10/critic.md
  rubric_ref: prompts/D10/critic-rubric.md
  tools: [artifact.read, memory.read, calc]
  max_tokens_per_run: 35000

workers:
  - agent_id: sales.sequencer
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D10/sequencer.md
    tools: [artifact.read, memory.read, calc]
    max_tokens_per_run: 45000
  - agent_id: sales.writer
    model: sonnet
    replicas: 2
    system_prompt_ref: prompts/D10/writer.md
    tools: [artifact.read, memory.read]
    max_tokens_per_run: 60000
  - agent_id: sales.voice-closer
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D10/voice-closer.md
    tools: [artifact.read, memory.read, elevenlabs.tts, voice.transcribe, composio.calendar.read]
    max_tokens_per_run: 50000
  - agent_id: sales.objection-analyst
    model: haiku
    replicas: 1
    system_prompt_ref: prompts/D10/objection-analyst.md
    tools: [artifact.read, memory.read, calc]
    max_tokens_per_run: 30000

concurrency: 5

budget:
  default_envelope_usd: 2.00
  hard_cap_usd: 6.00
  degrade_at_pct: 0.8
  on_exhausted: partial

io:
  input: [LeadBatch, GTMPlan, ClaimLedger, Deployment, BudgetAllocation]
  output: [Deal, OrderRequest, ObjectionRecord]
  min_outputs: 1
  emits_work_orders_to: [D11, D08, D13]

gates:
  - id: outbound_real_person
    trigger: event(sales.outbound_drafted)
    question: "Send this message to {lead.identity.full_name} via {channel}?"
    surface: both
    card: approve_reject
    auto_approve_at: autonomous
    timeout_s: 900
    on_timeout: hold
  - id: discount_outside_policy
    trigger: event(sales.discount_requested where pct > gtm.discount_policy.max_auto_pct)
    question: "Approve {pct}% discount for {company}? Reason: {reason}."
    surface: both
    card: approve_reject
    auto_approve_at: never
    timeout_s: 3600
    on_timeout: auto_reject
  - id: founder_sensitive_deal
    trigger: event(sales.high_value_or_sensitive)
    question: "This deal has legal, reputational, or enterprise terms. Review before proceeding?"
    surface: both
    card: approve_reject
    auto_approve_at: never
    timeout_s: 86400
    on_timeout: hold

sandbox:
  image: zeroth/dept-sales:latest
  cpu: 2
  mem_mb: 2048
  disk_mb: 4096
  egress_allowlist: [api.composio.dev, api.linqapp.com, api.elevenlabs.io]
  pause_between_cycles: true
  forkable: true

sla:
  soft_deadline_s: 180
  hard_deadline_s: 600
  on_timeout: return_partial

memory:
  reads: [venture, department]
  writes: [department]

triggers:
  - kind: event
    expr: artifact.signed(type=LeadBatch)
  - kind: event
    expr: artifact.signed(type=GTMPlan)
  - kind: webhook
    expr: composio.gmail.reply_received OR linq.reply_received OR calendar.meeting_completed
  - kind: cron
    expr: "*/15 * * * *"
```

---

## 4. Agent Roster

| Agent | Role | Model | Tools | Budget | Success metric |
|---|---|---|---|---:|---|
| `sales.head` | Owns pipeline, state transitions, gates, and D11 handoff | opus | memory, bus, artifact, Linq cards | $0.80 | Deal states are current; no send without policy proof |
| `sales.sequencer` | Builds channel cadences from consent and GTM plan | sonnet | artifact, memory, calc | $0.25 | Reply rate and opt-out rate tracked per sequence |
| `sales.writer` | Writes context-rich outbound and proposals | sonnet x2 | artifact, memory | $0.55 | Warm sends cite claim ids; no unshipped claims |
| `sales.voice-closer` | Prepares or assists calls with disclosure | sonnet | ElevenLabs, transcript, calendar | $0.25 | Call outcomes structured within 10 min |
| `sales.objection-analyst` | Clusters objections/losses for D08/D13 | haiku | artifact, memory | $0.10 | Every lost deal has a cluster |
| `sales.critic` | Blocks non-consented, non-evidenced, or off-policy sales actions | sonnet | artifact, memory | $0.05 | Zero forbidden sends |

---

## 5. System Prompts

### `sales.head`

```text
You are sales.head for ZEROTH. Your job is to create revenue while protecting trust.

Inputs: LeadBatch, GTMPlan, ClaimLedger, Deployment, BudgetAllocation, and recent sales events.
Do not contact anyone directly. Draft events and gates first. Every outbound action to a real person
must cite: lead consent basis, channel allowed, GTM message row, shipped-scope check, and if warm,
the claim_ids being quoted back.

Warm leads are first-class: never treat an interviewee as anonymous. If their quote shaped the
product, the opener must say so plainly and accurately. If the product did not ship the feature
they asked for, do not imply it did.

Move deals through the DealStage state machine only by emitting sales.deal_stage_changed. If a
deal is won, create an OrderRequest for D11. If the prospect asks for a discount, contract term,
legal promise, public logo right, procurement portal, or feature commitment outside policy, open
the right gate. Missing evidence becomes gaps[], never confident sales copy.
```

### `sales.sequencer`

```text
Design a cadence, not a blast. For each lead, choose at most one primary channel and one backup
channel from consent.channels_allowed. Respect quiet hours, jurisdiction, prior touches, opt-outs,
and sequence fatigue. Warm leads get a human, short, context-rich first touch. Cold leads get a
permission-based opener and no fake familiarity.

Output a sequence plan with step ids, timing, channel, objective, stop conditions, and compliance
reason. Do not write the message body.
```

### `sales.writer`

```text
Write outbound drafts and proposal snippets. You may only use facts from GTMPlan, Deployment,
Lead.provenance, ClaimLedger, and prior interactions. For warm leads, include the exact claim_ids
used and quote only what the ClaimLedger supports. For cold leads, personalize using public trigger
events and avoid creepy detail.

Every draft must include a scope_check: shipped_claims[], risky_claims[], forbidden_claims[].
If forbidden_claims is non-empty, return blocked instead of copy.
```

### `sales.voice-closer`

```text
Prepare sales calls and voice-agent assists. Begin every voice interaction with disclosure that an
AI agent is participating or speaking. If the prospect asks for a human, stop automation and raise
needs_human. After the call, summarize problem, budget, authority, timing, objections, agreed next
step, and exact quotes that may be reused.
```

### `sales.objection-analyst`

```text
Cluster objections from replies, call notes, and lost reasons. Use GTMPlan.objection_matrix as
the starting taxonomy, but create a new cluster when the observed language does not fit. Mark the
cluster's downstream owner: D08 for positioning, D06 for scope/pivot, D07 for build, D12 for
customer experience, D13 for missing capability.
```

### `sales.critic`

```text
Reject the sales batch if any outbound item violates consent, channel policy, jurisdiction,
founder gate rules, shipped scope, discount policy, or evidence rules. Reject if warm outreach
lacks claim_ids. Reject if cold outreach invents a personal connection. Reject if a won deal lacks
an OrderRequest or if a lost deal lacks lost_reason_cluster. One revision loop only; if still
unsafe, return quality='contested' and list the exact blockers.
```

---

## 6. Execution Flow

```
LeadBatch + GTMPlan
        |
        v
sales.head -> sequencer -> writer -> critic -> gate(outbound)
        |                                  |
        | approved                         | rejected
        v                                  v
send via Composio/Linq              revise once / hold
        |
reply/meeting/payment events
        |
        v
stage reducer -> objection analyst -> D08/D13 signals
        |
won?
        v
OrderRequest -> D11 -> payment link -> order status
```

1. **Hydrate context.** Load latest signed `LeadBatch`, `GTMPlan`, `Deployment`, and relevant memory.
2. **Select leads.** Rank warm T1/T2 leads first, then cold T1 leads with strong trigger events.
3. **Sequence.** Build cadence steps with consent and stop conditions.
4. **Draft.** Generate copy with shipped-scope and evidence checks.
5. **Critic pass.** Block copy that violates consent, scope, or price policy.
6. **Gate.** Open `outbound_real_person` before the first send unless a narrow autonomous rule applies.
7. **Send and listen.** Composio/Linq webhooks update interactions and deal stage.
8. **Qualify.** Score need, authority, urgency, fit, and payment readiness.
9. **Close.** Request a payment link from D11; stage becomes `payment_pending`.
10. **Reconcile.** D11 payment events move deal to `won`, `failed`, or back to `proposal`.
11. **Learn.** Objections/loss clusters update D08 and D13.

---

## 7. Integrations

| Capability | Sponsor/vendor | How D10 uses it |
|---|---|---|
| Email, calendar, CRM | Composio | Gmail sends/replies, calendar booking, CRM note sync |
| Founder and prospect messaging | Linq | Approval cards, suggested replies, SMS/iMessage where allowed |
| Agent-to-agent context | Band | Persistent Sales-Finance room for deal/payment state |
| Payment collection | Stripe/Whop/Dodo via D11 | D10 requests; D11 creates/reconciles |
| Voice calls | ElevenLabs | Disclosed voice assistant for demos and discovery-to-sales follow-up |
| Browser/procurement portals | Solari | Fill vendor onboarding only after founder/legal gate |
| QA for demo purchase path | Replay | Confirms checkout flow and post-payment access before high-volume selling |
| Human escalation | Terac via D11 HR | Procurement paperwork, manual verification, human closer |

---

## 8. Gates & Escalations

| Trigger | Gate/escalation | Reason | Default |
|---|---|---|---|
| First outbound to real person | `outbound_real_person` | Contacting people is reputationally sensitive | ASK unless autonomous safe rule applies |
| Cold list with uncertain lawful basis | `needs_approval` to founder/compliance | Anti-spam and consent risk | Hold cold; continue warm |
| Discount beyond GTM policy | `discount_outside_policy` | Revenue/pricing decision | Founder approval |
| Prospect requests legal/security terms | `founder_sensitive_deal` + possibly `needs_human` | Legal commitment | Human/founder |
| Phone/SMS channel where consent is unclear | `needs_approval` | TCPA/reputation risk | No send |
| 3+ losses same cluster | `needs_capability` to D13 | Company is missing a capability | Continue other deals |
| Payment link creation | WorkOrder to D11 | Only D11 has money write access | Required |
| Prospect asks for human | `needs_human` to D11 HR/Terac or founder | Respect request | Stop automation |

---

## 9. Failure Modes & Fallbacks

| Failure | Detection | Fallback | Artifact quality |
|---|---|---|---|
| Warm claim missing | `claim_ids` absent or source not found | Send generic "following up on our conversation" only if consent is explicit; otherwise hold | partial |
| Deployment scope unclear | `Deployment.features` absent/stale | Ask D07 for scope summary; block product claims | partial |
| Composio send fails | Provider error/webhook timeout | Draft Linq founder card with manual-send text; retry next cadence | partial |
| Deliverability collapse | Bounce rate > policy threshold | Freeze cold sequence; D09 refreshes handles | signed for warm only |
| Prospect replies with opt-out | Reply classifier | Emit suppression event; stop all sequences | signed |
| Stripe/Dodo/Whop down | D11 returns rail unavailable | Keep `verbal_yes`; send "payment link pending" only if prospect expects it | partial |
| Voice disclosure not possible | Voice stack lacks opening disclosure | Do not call; use email or human | signed |
| Founder silent on high-value gate | Gate timeout | Hold deal; no auto-close | partial |

---

## 10. Definition of Done & Critic Rubric

### DoD

- `Deal[]` exists for every lead handed to Sales.
- Every outbound send has `gate_id`, consent basis, channel, and scope check.
- Warm sends have non-empty `claim_ids`.
- Every reply updates the deal stage within one cadence tick.
- Every lost deal has `lost_reason_cluster`.
- Every won/verbal-yes deal has an `OrderRequest` to D11.
- Objection clusters are emitted to D08/D13.

### Rubric (100 pts, pass >= 90)

| Area | Points |
|---|---:|
| Consent/channel compliance | 25 |
| Warm-context accuracy | 20 |
| Shipped-scope honesty | 15 |
| Pipeline state correctness | 15 |
| Finance handoff correctness | 10 |
| Objection/loss learning loop | 10 |
| Cost discipline | 5 |

Automatic fail: any non-consented real-person send, invented quote, promised unshipped feature, or direct money-rail write by D10.

---

## 11. Demo Notes

| Time | Screen beat |
|---|---|
| 2:50 | D09 hands D10 a warm lead whose quote changed feature F-03 |
| 2:55 | Sales email preview opens: "You told us..." with `claim_id CL-114` and shipped feature badge |
| 3:00 | Founder approval card via Linq; approval sends message |
| 3:05 | Reply simulation: "Can I buy this for my team?" Deal stage moves to `verbal_yes` |
| 3:10 | D10 files `OrderRequest`; D11 creates Stripe link; test-mode payment lands |
| 3:15 | Sales-Finance Band room shows revenue event; Treasury reallocates toward Sales |
| 3:25 | Three seeded security-review losses form a cluster; D13 proposes a Security Review desk |

---

## 12. Cost Estimate

| Item | MVP run estimate |
|---|---:|
| Head context + merge | $0.80 |
| Sequencer | $0.25 |
| Writer replicas | $0.55 |
| Voice/call prep | $0.25 |
| Objection analyst | $0.10 |
| Critic | $0.05 |
| Provider/API cushion | $0.00-$2.00 from D11-approved spend |
| **Total default envelope** | **$2.00** |

## Assumptions & open questions

- **MVP:** Only D11 creates payment objects; D10 can request but not mutate money rails.
- **MVP:** Sales starts warm-pool-first; cold outbound is allowed only after D09 signs compliance.
- **POST-MVP:** Enterprise proposal generation needs a legal-review gate and likely Terac human support.
- **Open:** Choose canonical CRM destination after the founder connects tools through Composio.
