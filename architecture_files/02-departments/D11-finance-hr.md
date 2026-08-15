# D11 — Finance, HR & Treasury

**Cluster:** ops · **Head:** `finance.head` · **Critic:** `finance.critic` · **Resident:** yes (wakes on cron `finance.reconcile`, on every `money.*` event, and on `Escalation(needs_budget|needs_human)`)

---

## 1. Mission

> Keep a truthful, double-entry account of every dollar in and out, reallocate the company's budget toward marginal return every cycle, and — through the HR sub-department — hire real humans through Terac only when the math says a human is worth it.

**The single question this department answers:** *"Where should the next dollar go — and can we prove where the last one went?"*

D11 is the only department with write access to money rails (Stripe, Whop, Dodo, Terac payouts),
enforced by the `money-out-is-d11-only` Band policy in
[`../03-integrations/02-band.md`](../03-integrations/02-band.md). Every other department *requests*;
D11 *executes*, records, and reconciles.

---

## 2. Contract — Inputs & Outputs

### Inputs

| Artifact / event | From | Use |
|---|---|---|
| `money.revenue_received`, `money.refunded`, `money.payout` | Stripe/Whop/Dodo gateways | Ledger credit/debit, runway update |
| `money.metered` | Budget Meter ([`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md)) | Per-department cost attribution |
| `Deal[]`, payment-link delegations | D10 | Create Payment Links / Checkout Sessions on Sales' behalf |
| `GTMPlan.pricing` | D08 | Create Stripe `Product` + `Price` on `ProductSpec` sign |
| Refund delegations | D12 | Execute customer-favorable refunds within policy |
| `Escalation(needs_budget)` | any Head | Mid-cycle envelope top-up decision |
| `Escalation(needs_human)` + `HumanWorkRequisition` | any Head | HR ROI test → Terac hire |
| `terac.*` webhooks | Terac gateway | Requisition lifecycle, deliverable, payout |

### Outputs

| Artifact | To | Contents |
|---|---|---|
| `Ledger` (projection, continuously updated) | Boardroom, D13 | Double-entry `ledger_entries`; trial balance always zero |
| `BudgetAllocation[]` (per cycle) | all departments, Boardroom | Envelope per department + rationale string |
| `FinanceReport` (per cycle) | founder (Linq), D13 | P&L, burn, runway, unit economics, anomalies |
| `HumanHire` | filing department, artifact registry | The hired human's QC'd deliverable as an `Artifact` |
| `ProductSignal` (billing-caused) | D06 | Dispute/churn patterns that implicate the product |

### Core schemas

`Ledger` rows are exactly the `ledger_entries` table defined in
[`../03-integrations/03-stripe.md`](../03-integrations/03-stripe.md) — restated here because D11 owns it:

```sql
-- projections, owned by D11 reducers. Append-only. Never UPDATE an amount.
CREATE TABLE ledger_entries (
  id            uuid PRIMARY KEY,
  venture_id    uuid NOT NULL,
  ts            timestamptz NOT NULL,
  account       text NOT NULL,      -- 'revenue' | 'cash' | 'ar' | 'cogs' | 'opex:compute'
                                    -- 'opex:human' | 'opex:tools' | 'refunds' | 'fees'
  direction     text NOT NULL CHECK (direction IN ('debit','credit')),
  amount_usd    numeric(12,4) NOT NULL CHECK (amount_usd >= 0),
  source        text NOT NULL,      -- 'stripe' | 'whop' | 'dodo' | 'terac' | 'meter'
  source_ref    text NOT NULL,      -- vendor event/object id — the audit link
  department_id text,               -- attribution for Treasury
  event_id      uuid NOT NULL,      -- back to the event store. Always.
  UNIQUE (source, source_ref, account, direction)   -- replay-safe: no double-credit
);

CREATE INDEX ledger_by_dept ON ledger_entries (venture_id, department_id, ts);
CREATE INDEX ledger_by_account ON ledger_entries (venture_id, account, ts);
```

```ts
// packages/contracts/src/finance.ts
export const BudgetAllocation = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  cycle_id: z.string(),
  department_id: DepartmentId,
  envelope_usd: z.number().min(0),
  hard_cap_usd: z.number().positive(),
  spent_usd: z.number().min(0).default(0),
  reserved_usd: z.number().min(0).default(0),
  state: z.enum(['active','degraded','frozen']),
  rationale: z.string(),                    // the treasurer's falsifiable sentence
  prediction: z.object({                    // what would prove this allocation wrong
    statement: z.string(),                  // 'Sales converts a 2nd deal by cycle 9'
    check_at_cycle: z.string(),
    outcome: z.enum(['pending','held','falsified']).default('pending'),
  }).optional(),
});

export const FinanceReport = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  cycle_id: z.string(),
  pnl: z.object({
    revenue_usd: z.number(),
    refunds_usd: z.number(),
    fees_usd: z.number(),
    cogs_usd: z.number(),
    opex_compute_usd: z.number(),
    opex_tools_usd: z.number(),
    opex_human_usd: z.number(),
    net_usd: z.number(),
  }),
  burn_rate_usd_per_cycle: z.number(),      // trailing 3-cycle mean of net spend
  runway_usd: z.number(),
  runway_cycles: z.number(),                // runway_usd / burn_rate; Infinity if net positive
  unit_economics: z.object({
    arpu_usd: z.number().optional(),
    cac_usd: z.number().optional(),         // attributed D09+D10 spend / new customers
    payback_cycles: z.number().optional(),
    gross_margin_pct: z.number().optional(),
    evidence: z.array(z.string()),          // source_ids — uncited numbers block signing
  }),
  anomalies: z.array(z.object({
    kind: z.enum(['spend_spike','unpriced_resource','reconciliation_drift',
                  'envelope_breach','duplicate_charge','dunning_surge']),
    department_id: DepartmentId.optional(),
    detail: z.string(),
    severity: z.enum(['informational','degrading','blocking']),
  })).default([]),
});
```

---

## 3. DepartmentManifest

```yaml
# packages/manifests/D11-finance-hr.yaml
id: D11
name: Finance, HR & Treasury
cluster: ops
version: 1
generated_by: human
resident: true

head:
  agent_id: finance.head
  model: sonnet                # deliberate: money math is deterministic tools, not opus prose
  system_prompt_ref: prompts/D11/head.md
  tools: [memory.read, memory.write, bus.emit, artifact.sign, artifact.read, calc]
  max_tokens_per_run: 80000
  timeout_s: 180

critic:
  agent_id: finance.critic
  model: sonnet
  system_prompt_ref: prompts/D11/critic.md
  rubric_ref: prompts/D11/critic-rubric.md
  tools: [memory.read, artifact.read, calc]
  max_tokens_per_run: 25000

workers:
  - agent_id: finance.bookkeeper
    model: haiku
    replicas: 2
    system_prompt_ref: prompts/D11/bookkeeper.md
    tools: [stripe.read_balance, artifact.read, calc]
    max_tokens_per_run: 30000
  - agent_id: finance.treasurer
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D11/treasurer.md
    tools: [memory.read, artifact.read, calc]
    max_tokens_per_run: 60000
  - agent_id: finance.dunning
    model: haiku
    replicas: 1
    system_prompt_ref: prompts/D11/dunning.md
    tools: [composio.gmail.send, linq.send_text, stripe.checkout, calc]
    max_tokens_per_run: 20000
  - agent_id: finance.billing
    model: haiku
    replicas: 1
    system_prompt_ref: prompts/D11/billing.md
    tools: [stripe.payment_link, stripe.checkout, stripe.refund, calc]
    max_tokens_per_run: 30000
  - agent_id: hr.recruiter
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D11/hr-recruiter.md
    tools: [terac.post_requisition, terac.screen, terac.hire, terac.pay,
            terac.deliverable, artifact.read, calc, bus.emit]
    max_tokens_per_run: 60000
  - agent_id: hr.qc
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D11/hr-qc.md
    tools: [artifact.read, calc]
    max_tokens_per_run: 40000

concurrency: 6

budget:
  default_envelope_usd: 0.60      # matches the cost table in 08-money-and-metering.md
  hard_cap_usd: 2.00              # D11's own agent spend; Terac spend is the HR envelope, separate
  degrade_at_pct: 0.8
  on_exhausted: escalate          # Finance never silently halts; see FLOORS rule

io:
  input: [Deal, GTMPlan, HumanWorkRequisition, Escalation]
  output: [Ledger, BudgetAllocation, FinanceReport, HumanHire, ProductSignal]
  min_outputs: 1
  emits_work_orders_to: []        # D11 executes delegations; it does not commission work

gates:
  - id: money_out_terac
    trigger: event(terac.hire_requested)
    question: "Hire {count} × {role} via Terac for ≤ ${max_usd_total}?"
    surface: both
    card: approve_reject
    auto_approve_at: autonomous   # AUTO* — conditions in 06-human-in-the-loop.md apply
    timeout_s: 3600
    on_timeout: auto_reject
  - id: money_out_purchase
    trigger: event(money.spend_requested)
    question: "Spend ${amount} on {what}? Expected value: ${ev}."
    surface: both
    card: approve_reject
    auto_approve_at: autonomous   # AUTO* per amount tier
    timeout_s: 3600
    on_timeout: auto_reject
  - id: refund_large
    trigger: event(money.refund_requested)     # only fires > $50; below is AUTO
    question: "Refund ${amount} to {customer}? Reason: {reason}."
    surface: both
    card: approve_reject
    auto_approve_at: never
    timeout_s: 3600
    on_timeout: auto_approve      # customer-favorable default, per 06-human-in-the-loop.md
  - id: dispute_evidence
    trigger: event(money.dispute_evidence_ready)
    question: "Submit this dispute evidence to Stripe?"
    surface: linq
    card: approve_reject
    auto_approve_at: supervised
    timeout_s: 21600
    on_timeout: auto_approve      # not responding loses the dispute by default

sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 2048
  egress_allowlist: [api.stripe.com, api.terac.com, api.whop.com, api.dodopayments.com]
  pause_between_cycles: true
  forkable: false

sla:
  soft_deadline_s: 120
  hard_deadline_s: 300
  on_timeout: escalate            # a stuck ledger is worse than a slow one

memory:
  reads: [venture, department]
  writes: [department]

triggers:
  - kind: cron
    expr: "0 * * * *"             # finance.reconcile, hourly (≈5s at demo time_scale)
  - kind: webhook
    expr: stripe.* | terac.* | whop.* | dodo.*
  - kind: event
    expr: escalation.raised(reason=needs_budget|needs_human)
  - kind: event
    expr: artifact.signed(type=GTMPlan)
```

---

## 4. Agent Roster

| Role | Agent | Model | Replicas | Tools (key) | Token budget/run | Job |
|---|---|---|---|---|---|---|
| Head | `finance.head` | sonnet | 1 | `bus.emit`, `artifact.sign`, `calc` | 80k | Routes delegations, signs reports, owns escalations |
| Bookkeeper | `finance.bookkeeper` | haiku | 2 | `stripe.read_balance`, `calc` | 30k | Reducer babysitting, reconciliation diffs |
| Treasurer | `finance.treasurer` | sonnet | 1 | `calc`, `memory.read` | 60k | Cycle allocation + rationale; the only "judgment" seat |
| Dunning | `finance.dunning` | haiku | 1 | `composio.gmail.send`, `linq.send_text` | 20k | Failed-payment sequences |
| Billing | `finance.billing` | haiku | 1 | `stripe.payment_link`, `stripe.refund` | 30k | Executes Stripe object creation, refunds |
| HR Recruiter | `hr.recruiter` | sonnet | 1 | `terac.*` | 60k | ROI test, sourcing, hiring, paying |
| HR QC | `hr.qc` | sonnet | 1 | `artifact.read`, `calc` | 40k | Mechanical QC of human deliverables |
| Critic | `finance.critic` | sonnet | 1 | `calc` | 25k | Audits reports and allocations before sign |

**No LLM does arithmetic on money.** Every number in a `FinanceReport` or allocation flows through
the `calc` tool; the model composes and explains, the tool computes. This is the same rule the
platform states for `calc` in [`D00-department-template.md`](D00-department-template.md) §4.

---

## 5. System Prompts

### `prompts/D11/head.md`

```
You are the Head of Finance, HR & Treasury at Zeroth, an AI-run agency building a company for a
human founder. You do not do the work yourself. You decompose, dispatch, merge, and sign.
You may not fabricate. A gap is an acceptable output; an invented number is a P0 defect.
You report cost honestly, including your own.

You are the only department that touches money rails. Other departments file delegations;
you decide whether policy permits execution, then dispatch to billing/dunning/hr workers.
Rules you enforce without exception:
1. Every ledger write derives from an event with a vendor source_ref. Never book from memory.
2. Never mark revenue received without a confirmed vendor object (re-fetch, don't trust webhooks).
3. Every money_out above the auto-approve tier opens a gate BEFORE the tool call, never after.
4. All arithmetic goes through the calc tool. If calc and your intuition disagree, calc wins.
5. When budget requests exceed the pool, you do not split the difference. You rank by the
   Treasury score and say no to the losers, with the score attached.
Sign a FinanceReport only when the trial balance is zero and every anomaly has a severity.
```

### `prompts/D11/treasurer.md`

```
You are the Treasurer. Once per cycle you run the allocation algorithm defined in
01-platform/08-money-and-metering.md. The arithmetic is deterministic and computed by the calc
tool; your job is exactly three things:
1. Set strategic_multiplier per department (0.5–1.5) with a one-sentence reason each.
2. Confirm or dispute the blocked(d) flags by reading the open escalations.
3. Write the rationale string: which departments gained, which lost, why, and ONE falsifiable
   prediction with a check-at cycle ("If X doesn't happen by cycle N, this reverses").
You never invent value_delivered numbers — they come from the scorer's event query. If an input
is missing, allocate conservatively (previous envelope × 0.8) and record the gap.
```

### `prompts/D11/hr-recruiter.md`

```
You are HR. You are the only actor in the company allowed to convert a HumanWorkRequisition
into a Terac hire. Procedure, in order, no skipping:
1. Validate the requisition against the schema. Reject with reasons if justification is thin.
2. Verify alternatives_tried lists the three cheaper rungs (synthetic panel, warm network,
   public expert content) with event ids. If absent, bounce it back — do not fill it in yourself.
3. Run the ROI rule with calc: EV_gain = Δconfidence × decision_value_usd; approve iff
   EV_gain ≥ 3.0 × cost AND cost fits the HR envelope AND the founder human-spend cap.
4. Compare against the lowest funded department's MV — a hire must beat giving Build the money.
5. On approval: open the money_out gate, then post to Terac with the idempotency key.
6. Negotiate scope in the hr↔all Band room when the ROI fails narrowly: propose reduce_count
   or narrower screening before rejecting outright.
You never talk to the hired human directly about anything outside the brief. You never pay
before QC passes. Rejection with numbers is a success state, not a failure.
```

### `prompts/D11/hr-qc.md`

```
You are HR Quality Control. A human deliverable arrives; you check it against the requisition's
deliverable_schema_ref mechanically:
- Schema-parse the payload. Failure = qc fail, no judgment involved.
- Check each must_have screening criterion is reflected in the deliverable metadata.
- Check completeness: every required field non-empty, durations within 0.5×–3× estimate.
- Check internal consistency: contradictions between answers are flagged, not fixed.
You do NOT judge whether the expert's opinion is correct — that is the filing department's job.
You judge whether the deliverable is what was ordered. Output: {result: pass|fail|partial,
checks: [{name, passed, note}]}. On fail, recommend re-source or dispute with evidence.
```

### `prompts/D11/critic.md`

```
You are the Finance Critic. Score FinanceReports and BudgetAllocations against the rubric.
Reject if: trial balance nonzero; any unit-economics number lacks a source_id; the treasurer's
rationale contains no falsifiable prediction; an anomaly is listed without severity; or any
arithmetic in the artifact differs from a calc re-computation you run yourself.
Return the standard verdict JSON with defects[].path pointing at exact fields.
```

---

## 6. Execution Flow

```
                      ┌────────────────────────────────────────────────────┐
   webhooks ─────────►│  reducers: ledger_entries, orders, subscriptions   │
   (stripe/terac/…)   └───────────────┬────────────────────────────────────┘
                                      │
   cron finance.reconcile ────────────┤
                                      ▼
        ┌──────────── finance.head ────────────┐
        │  1 bookkeeper: reconcile & diff      │
        │  2 treasurer: allocate envelopes     │──► BudgetAllocation[] ──► all depts
        │  3 billing/dunning: execute queue    │──► Stripe objects, dunning emails
        │  4 hr.recruiter: requisition queue   │──► Terac lifecycle
        │  5 assemble FinanceReport            │
        └────────────────┬─────────────────────┘
                         ▼
                  finance.critic ──accept──► sign ──► ArtifactReady(FinanceReport)
                         │ revise (≤1 loop)
                         └──► re-run only defect paths
```

Numbered steps per residency wake:

1. **Ingest.** Drain the webhook/event queue; reducers write `ledger_entries` idempotently.
2. **Reconcile.** Bookkeeper diffs vendor truth (`stripe.balance_transactions`, Terac payout list)
   against the ledger for the window. Drift → `anomalies[]` + `money.metered(kind='reconciliation_drift')`.
3. **Allocate** (cycle boundary only). Treasurer runs the algorithm (§8 below), emits
   `money.budget_allocated` per department with rationale.
4. **Execute delegations.** Payment links for D10, refunds for D12, dunning steps due, Terac
   requisition transitions for HR.
5. **Report.** Head assembles `FinanceReport`; Critic audits; sign; SSE to Boardroom.

---

## 7. Integrations

| Capability | Vendor | How D11 uses it |
|---|---|---|
| Payments, subscriptions, refunds, disputes | **Stripe** | Owner of all objects; see [`../03-integrations/03-stripe.md`](../03-integrations/03-stripe.md) |
| Merchant-of-record fallback | **Dodo Payments** | Selected as `PaymentRail` when the founder has no US entity |
| Community/product sales rail | **Whop** | Same webhook → ledger path as Stripe |
| Human labor sourcing/screening/payment | **Terac** | HR sub-department, exclusively; see [`../03-integrations/01-terac.md`](../03-integrations/01-terac.md) |
| Dunning email | **Composio Gmail** | Attempts 1, 2, 4 of the dunning ladder |
| Dunning + founder cards | **Linq** | Attempt 3 iMessage; all founder gate cards |
| Inter-department negotiation | **Band** | `sales↔finance` and `hr↔all` rooms; `money-out-is-d11-only` policy |
| Deterministic math | `calc` | Every monetary computation |

---

## 8. Money mechanics (the heart of the file)

### 8.1 Stripe integration design **MVP**

D11 implements the ownership model from [`../03-integrations/03-stripe.md`](../03-integrations/03-stripe.md):
D11 is the sole Stripe writer; D10 and D12 file delegations. Restating the load-bearing rules and
adding the D11-side state machines.

**Object creation is delegation-driven:**

```ts
// apps/orchestrator/src/departments/d11/delegations.ts
type MoneyDelegation =
  | { kind: 'payment_link';  from: 'D10'; deal_id: string; price_ref: string }
  | { kind: 'checkout';      from: 'D10'; deal_id: string; amount_usd: number; term?: string }
  | { kind: 'refund';        from: 'D12'; order_id: string; amount_usd: number; reason: string }
  | { kind: 'product_price'; from: 'D08'; gtm_plan_id: string };  // fired on GTMPlan sign

// Every executed delegation carries the requester's trace_id into Stripe metadata —
// metadata.{venture_id, deal_id|customer_ref, trace_id} is mandatory, per the Stripe spec.
```

### 8.2 Payment lifecycle state machine **MVP**

```
                 ┌──────────┐  delegation from D10   ┌──────────────┐
                 │ requested │──────────────────────►│ link_created │
                 └──────────┘   (idempotent create)  └──────┬───────┘
                                                            │ checkout.session.completed
        payment_intent.payment_failed                       ▼
      ┌──────────────┐◄────────────────────────────┌──────────────┐
      │   failed     │                             │  confirming  │  ← re-fetch PaymentIntent
      └──────┬───────┘                             └──────┬───────┘    from API (never trust
             │ dunning ladder                             │ amounts match      webhook alone)
             ▼                                            ▼
      ┌──────────────┐                             ┌──────────────┐   charge.refunded
      │ dunning(1-4) │                             │     paid     │──────────────► refunded
      └──────┬───────┘                             └──────┬───────┘
             │ 14d exhausted                              │ charge.dispute.created
             ▼                                            ▼
      ┌──────────────┐                             ┌──────────────┐  dispute.closed
      │  written_off │                             │   disputed   │─────► settled | reversed
      └──────────────┘                             └──────────────┘
```

State lives in an `orders` projection; every transition is an event
(`money.revenue_received`, `money.refunded`, …) per
[`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md).

```ts
export const OrderState = z.enum(['requested','link_created','confirming','paid','failed',
                                  'dunning','written_off','refunded','disputed','settled','reversed']);
export const LEGAL_ORDER_TRANSITIONS: Record<string, string[]> = {
  requested:    ['link_created'],
  link_created: ['confirming','failed'],
  confirming:   ['paid','failed'],          // amount mismatch ⇒ failed + anomaly, never paid
  paid:         ['refunded','disputed'],
  failed:       ['dunning','written_off'],
  dunning:      ['confirming','written_off'],
  disputed:     ['settled','reversed'],
  refunded: [], written_off: [], settled: [], reversed: [],
};
// Reducers throw on illegal transitions. A thrown reducer is a blocking anomaly, not a skip.
```

### 8.3 Subscription lifecycle **MVP**

```
 trialing ──trial ends──► active ──invoice.paid──► active (renewed)
    │                        │  invoice.payment_failed
    │ trial abandoned        ▼
    ▼                     past_due ──dunning success──► active
 expired                     │ dunning exhausted (14d)
                             ▼
                          canceled ──► sales.deal_lost(reason=churn) ──► ProductSignal → D06
```

| Transition | Ledger effect | Side effects |
|---|---|---|
| → `active` (first) | credit `revenue`, debit `cash`; MRR += price | D12 sets support tier; onboarding routed |
| renewal `invoice.paid` | same | MRR projection unchanged |
| → `past_due` | none yet (cash never booked) | dunning ladder starts |
| → `canceled` | MRR −= price | churn `ProductSignal` to D06; D12 exit survey play |
| upgrade | MRR delta credit | D10 expansion signal |
| downgrade | MRR delta | `ProductSignal(kind=downgrade)` → D06 |

### 8.4 Invoice lifecycle **MVP**

```
draft ──finalize──► open ──invoice.paid──► paid
                      │ invoice.payment_failed
                      ▼
                  past_due ──(dunning, N=4)──► paid | uncollectible
```

Invoices exist only for subscription renewals and D10-negotiated custom terms. One-off sales use
Payment Links. `uncollectible` books a debit to `refunds`-adjacent account `bad_debt` **POST-MVP**
(MVP: written off in the order projection only, flagged in the report).

### 8.5 Refunds **MVP**

| Path | Policy | Gate |
|---|---|---|
| D12-resolved, ≤ $50, first refund for customer | D11 executes autonomously | `refund` AUTO* per [`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md) |
| > $50 or repeat customer | Founder card | `refund` ASK, `on_timeout: auto_approve` |
| Duplicate charge detected by reconciler | Auto-refund + founder notification | logged, no gate (correcting our own error) |

Every refund books `refunds` debit / `cash` credit and closes the linked D12 ticket via
`money.refunded` → routing rule.

### 8.6 Chargebacks / disputes **MVP**

Per the Stripe spec's dispute flow: provisional ledger hold, D12 ticket at `severity=high` (SLA 4h),
evidence assembly (receipt, delivery events, usage logs, policy), `dispute_evidence` gate
(auto-approve on timeout — silence loses disputes). D11 adds:

- **Dispute rate watch**: disputes ÷ charges over trailing 30 cycles > 0.75% → `blocking` anomaly +
  founder card (Stripe monitoring thresholds are an account-level existential risk).
- Dispute reason ∈ {`product_unacceptable`, `not_received`} → `ProductSignal` to D06, always.

### 8.7 Dunning **MVP**

The 4-attempt ladder (+1h email, +24h email with decline reason, +72h Linq+email, +7d final) is
specified in [`../03-integrations/03-stripe.md`](../03-integrations/03-stripe.md) and owned by
`finance.dunning`. Invariants: max one dunning message per customer per 24h across all channels
(enforced in `packages/outbound/ratelimit.ts`); access degrades, never deletes; day 14 →
`sales.deal_lost(reason=payment)` and 90-day re-sequencing exclusion.

### 8.8 Expense tracking & per-department API cost attribution **MVP**

Everything the company spends is already metered
([`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md)). D11's job is
the projection that turns meters into books:

```sql
-- materialized view refreshed by finance.reconcile
CREATE MATERIALIZED VIEW mv_department_spend AS
SELECT venture_id, cycle_id, department_id,
       sum(cost) FILTER (WHERE unit LIKE 'tokens%')        AS llm_usd,
       sum(cost) FILTER (WHERE unit = 'sandbox_seconds')   AS compute_usd,
       sum(cost) FILTER (WHERE unit = 'tool_call')         AS tools_usd,
       sum(cost) FILTER (WHERE resource = 'terac_hire')    AS human_usd,
       sum(cost)                                           AS spent_usd
FROM meters GROUP BY 1,2,3;
```

Attribution rules:

| Spend | Attributed to |
|---|---|
| Agent tokens/sandbox/tools | The department whose `Meter` scope recorded it — automatic |
| Terac hire | The **filing** department's cost center, paid from the **HR envelope** (so requisitions show up in the requester's unit economics but HR controls the spend) |
| Stripe fees | `fees`, attributed to D10 (cost of revenue) |
| Kernel/Boardroom overhead | Split pro-rata by department spend **POST-MVP**; MVP: unattributed `opex:compute` line |

### 8.9 Budget envelopes **MVP**

Envelopes, the reserve→commit→release protocol, `FOR UPDATE` admission, and the 80%/100%
degrade/freeze policy are defined in
[`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md) and are D11's
to operate. D11-specific additions:

- **FLOORS**: D11, D12, D13 never drop below $0.50/cycle — the company must keep the departments
  that let it recover from being broke.
- **Mid-cycle top-up**: `Escalation(needs_budget)` → treasurer grants from the unallocated pool if
  `score(d)` of the requester exceeds the median funded score, else denies with the score attached.
  Denial ships the requester's work `quality: partial`.

### 8.10 The Treasury allocation algorithm — with the worked $30 example **MVP**

The algorithm is normative in
[`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md) §"The Treasury
allocation algorithm". D11 implements it. Summary of the math, then the worked example verbatim in
compressed form (the platform file holds the full tables):

```
value_delivered(d) = Σ signed_artifacts × weight[type] + liveness × 5.0
                   + attributed_revenue × 10.0 + escalations_resolved × 0.5
                   − contested × 1.0 − failed_work_orders × 1.5
MV(d)       = value_delivered(d) / max(spend(d), 0.25)
score(d)    = MV(d)^0.7 × stage_weight(d) × (1 + 0.5·blocked(d)) × strategic_multiplier(d)
envelope(d) = clamp(pool × score/Σscore, floor(d), min(demand(d)×1.25, hard_cap(d)))
+ one proportional redistribution pass of the clamp remainder.
```

**Worked example (cycle 7, $30 pool, stage `selling`):** D10 Sales returned $149 on $2.10
(MV 8.52, the company's best by 7×) and is blocked on a $2 enrichment credit; D07 Build's product is
live with one P1 left. Scores: D03 0.156, D04 0.594, D07 0.936, D09 1.792, D10 13.05, D12 2.748.
Raw shares put D10 at $20.31, but the demand clamp (`min(demand×1.25, cap)`) cuts it to **$11.25** —
a department cannot spend what it has no queued work for. The $12.68 clamp remainder redistributes
to D04/D07/D09 (still under their demand ceilings). **Final: D03 $0.25 (floor) · D04 $2.09 ·
D07 $6.18 · D09 $9.60 · D10 $11.25 · D12 $0.63 = $30.00.** Net motion: $9.25 out of Build, Sales
5.6×'d, Leads $6.60 up to feed the pipeline Sales just proved converts. The treasurer's rationale
ends with the falsifiable prediction: *"If Sales doesn't convert a second deal by cycle 9, this
reverses"* — and D13 checks that prediction in its daily review
([`D13-chief-of-staff.md`](D13-chief-of-staff.md) §6.1).

**Revenue reinvestment** (the 3:15 demo beat): realized revenue × `reinvest_rate` (0.70) enters the
next cycle's pool via the `reallocate()` function in the Stripe spec; 30% accrues to runway.

### 8.11 Forecasting, burn, runway **MVP**

```
burn_rate      = mean over trailing 3 cycles of (total_spend − realized_revenue), floored at 0
runway_usd     = founder_funded_balance + realized_revenue − committed_spend      (glossary def)
runway_cycles  = runway_usd / burn_rate          (∞ if burn_rate = 0, i.e. net positive)
mrr_projection = Σ active subscription prices, adjusted by trailing churn rate
forecast(c+n)  = runway_usd − n × burn_rate + n × mrr_projection × (1 − churn_rate)^n
```

All computed by `calc` from ledger queries; the forecast carries `evidence: [ledger query hashes]`
and an explicit assumption entry (`churn rate estimated from N observations`) — small-N forecasts
are labeled `unverified`, never presented as fact. **POST-MVP:** scenario bands (p10/p50/p90) via
bootstrap over per-cycle spend history.

### 8.12 Unit economics **MVP**

| Metric | Formula | Evidence requirement |
|---|---|---|
| ARPU | realized revenue ÷ paying customers | ledger query hash |
| CAC | attributed D09+D10 spend ÷ new customers in window | mv_department_spend rows |
| Payback | CAC ÷ (ARPU × gross margin) in cycles | derived; labeled estimate |
| Gross margin | (revenue − fees − COGS[venture infra]) ÷ revenue | ledger accounts |
| LTV | ARPU ÷ churn rate | **only when churn has ≥5 observations**; else `gaps[]` |

### 8.13 Approval thresholds **MVP**

D11 enforces exactly the `money_out` decision table from
[`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md): ≤$5 AUTO* with
envelope room and cycle spend < 60% of cap; $5–$25 AUTO* only at `autonomous` with recorded
`expected_value_usd ≥ 2× amount`; >$25 always ASK; Terac hires AUTO* within `terac_cap_usd` with a
non-empty `why_agent_cannot` and ≤2 hires/cycle. The venture-wide `founders.spend_cap_usd` hard stop
freezes every department and forces all gates to ASK.

### 8.14 Spend-anomaly alerts **MVP**

Detectors run in `finance.reconcile`, emit `anomalies[]` + Boardroom chips:

| Detector | Rule | Severity |
|---|---|---|
| Spend spike | dept cycle spend > 3× trailing-5-cycle median AND > $1 | degrading |
| Unpriced resource | `meter.record` threw `unpriced` (from the dead-letter queue) | blocking |
| Reconciliation drift | vendor totals ≠ ledger totals for window | blocking |
| Envelope breach | `spent_usd > envelope_usd` (should be impossible; means a meter bypass) | blocking |
| Duplicate charge | two ledger credits, same `source_ref` payment intent | blocking (auto-refund path) |
| Dunning surge | >30% of active subs in `past_due` | degrading (→ ProductSignal: pricing/UX?) |
| Terac overrun | actual hire cost > 1.25 × `max_usd_total` | degrading (dispute path) |

`blocking` anomalies freeze the affected flow at the next artifact boundary and page the founder.

### 8.15 Finance↔Sales and Finance↔HR workflows **MVP**

**`sales↔finance` Band room** ([`../03-integrations/02-band.md`](../03-integrations/02-band.md)):
running conversation over invoice aging, discount authority (D10 may offer ≤15% without asking;
15–30% requires a finance sign-off message in the room; >30% is a founder gate), payment-rail
choice per deal, and collections handoffs. Shared context: aging invoice list.

**`hr↔all` Band room:** requisition filing, ROI negotiation (the 1:50 demo beat: D04 asks, HR
refuses with numbers, D04 narrows the ICP, HR approves), hire announcements. Shared context:
`{hr_envelope_usd, founder_human_spend_cap_usd, open_requisitions[]}`.

### 8.16 Dashboards **MVP**

The Boardroom money panel renders projections, never ad-hoc queries:

| Widget | Source |
|---|---|
| Revenue ring (counts to first charge) | `money.revenue_received` SSE |
| Live burn counter + runway bar | `FinanceReport.burn/runway` |
| Per-department envelope bars (animate on reallocation) | `money.budget_allocated` |
| P&L mini-table | `FinanceReport.pnl` |
| Anomaly chips | `anomalies[]` |
| Open requisitions + ROI verdicts | HR projection |
| Treasurer rationale, verbatim | `BudgetAllocation.rationale` |

### 8.17 Audit logs **MVP**

Money's audit trail is structural, not a bolt-on: every ledger row carries `event_id` (event store)
and `source_ref` (vendor object). The full chain for any dollar:
`founder question → ledger_entries row → event → webhook_deliveries raw payload → vendor object id`.
Gates add `gate.executed` events with frozen `ActionSpec` bytes — the founder approved *bytes*, and
those bytes are retained. Reducer replays cannot double-book (unique index). **POST-MVP:** signed
monthly close snapshot (hash chain over `ledger_entries`) for external accountants.

---

## 9. HR sub-department

HR lives inside D11 because hiring humans is a Treasury decision with a people-shaped interface.
Terac mechanics, schema, and API mapping are normative in
[`../03-integrations/01-terac.md`](../03-integrations/01-terac.md); this section is the D11-side
operating procedure.

### 9.1 `HumanWorkRequisition` lifecycle **MVP**

The schema (`packages/contracts/src/terac.ts`) has states:
`filed → rejected | approved → sourcing → screening → hired → in_progress → delivered →
qc_failed | accepted → paid | cancelled`.

```
 filed ──ROI fail──► rejected ──► Escalation back to filer with options[]:
   │                              [proceed_with_lower_confidence, reduce_count,
   │ ROI pass                      downgrade_to_synthetic_panel]
   ▼
 approved ──money_out gate──► sourcing ──terac candidates──► screening
   │  gate rejected/timeout                                     │ hr.recruiter picks
   ▼                                                            ▼
 cancelled                                                    hired ──► in_progress
                                                                          │ work.delivered
                                            ┌─────────────────────────────┘
                                            ▼
                                        delivered ──hr.qc──► accepted ──terac.pay──► paid
                                            │ qc fail                       │
                                            ▼                               ▼
                                        qc_failed ──► re-source (once) │ dispute   Artifact
                                                                               reingested
```

Only Heads file requisitions (never Workers). Only `hr.recruiter` transitions them past `filed`.

### 9.2 The ROI test before hiring **MVP**

Normative rule from [`../03-integrations/01-terac.md`](../03-integrations/01-terac.md):

```
Δconfidence = confidence_with_estimate − confidence_without
EV_gain     = Δconfidence × decision_value_usd
cost        = count × max_usd_per_human × (1 + rush_premium 0.4) + hr_overhead (≈$0.15)
APPROVE iff EV_gain ≥ 3.0 × cost
        AND cost ≤ hr_envelope_remaining
        AND cost ≤ founder_human_spend_cap ($50 default)
        AND deadline reachable at requested urgency
```

Plus the Treasury comparison from
[`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md): the hire's
`EV_gain / cost` must beat the lowest funded department's MV — an $18 panel must beat giving Build
$18. The three cheaper rungs (D05 synthetic panel ~$0.05, D04 warm network, D03 public expert
content) must appear in `alternatives_tried` with event ids, or HR bounces the requisition
unexamined. **Rejection is a first-class outcome**: the filer proceeds `quality: partial` with a
recorded gap, and the Boardroom shows the ROI arithmetic that said no.

### 9.3 Terac sourcing / screening / payment **MVP**

`hr.recruiter` drives the `TeracClient` interface (vendor shapes live only in the driver):

1. `createRequisition()` with idempotency key `sha256(work_order_id|'terac.requisition'|req_id)`.
2. Candidates arrive by webhook (poll fallback every 15s — stage silence is worse than a redundant
   GET). Recruiter ranks by `performance_score`, verified-credential match against `must_have`,
   and rate ≤ `max_usd_per_human`.
3. `hire()` for the top `count`; funds reserved against the HR envelope via `meter.record`.
4. On `work.delivered` → QC (§9.4). On `worker.dropped` → auto re-source once, then escalate.
5. On QC pass → `acceptAndPay()`; ledger: `opex:human` debit / `cash` credit, attributed to the
   filing department's cost center; `terac.paid` event finalizes the meter.
6. On QC fail after re-source → `dispute()` with the QC checks as evidence.

Worker identity stays pseudonymous (`'ER Nurse · OH · 7 yrs'`); PII never transits Band rooms
(`no-pii-in-rooms` policy) and handles live only in the Identity Vault.

### 9.4 QC of human deliverables **MVP**

`hr.qc` runs a mechanical checklist — possible because every requisition declares a
`deliverable_schema_ref`:

| Check | Method | On fail |
|---|---|---|
| Schema parse | Zod parse of payload | hard fail |
| Screening reflection | must_have criteria present in metadata | hard fail |
| Completeness | required fields non-empty; duration 0.5×–3× estimate | partial |
| Consistency | contradiction scan (flag, never fix) | partial |
| Plagiarism/LLM-slop heuristic **POST-MVP** | embedding similarity vs public corpus | partial |

`pass` → accept & pay. `partial` → filer decides accept-with-gaps vs re-source. `fail` → re-source
once, then dispute. QC results are stored on `HumanHire.qc` and shown on the requisition card.

### 9.5 Reingestion as a first-class Artifact **MVP**

The whole point of the design: on acceptance, the deliverable is wrapped in the standard `Artifact`
envelope ([`D00-department-template.md`](D00-department-template.md) §5) and signed by the *filing*
department's Head:

```ts
const artifact = Artifact.parse({
  type: requisition.task.deliverable_schema_ref,      // e.g. 'InterviewResponse'
  created_by: requisition.filed_by,                   // D04, not D11 — the filer owns the output
  body: deliverable.payload,
  sources: [{
    source_id: `terac:${hire.terac_hire_id}`,
    kind: 'human_expert',                             // the evidence class that outranks synthetic
    excerpt: hire.worker.display_name + ' — ' +
             hire.worker.verified_credentials.map(c => c.claim).join('; '),
    retrieved_at: hire.paid_at, confidence: hire.worker.performance_score ?? 0.8,
  }],
  quality: qc.result === 'pass' ? 'signed' : 'partial',
  cost_usd: hire.agreed_rate_usd,
  // hash, version, work_order_id per the envelope schema
});
```

Downstream departments cannot tell whether a `ClaimLedger` entry came from a Claude worker or a
verified ER nurse — same envelope, same routing, same rubric. The only trace is
`sources[].kind='human_expert'`, which *raises* evidence weight in D06's pivot scoring.

---

## 10. Gates & Escalations

**Gates D11 opens:** `money_out` (Terac hires, purchases), `refund` (> $50), `dispute_evidence`
(a `public_content`-adjacent founder-visible action). Full decision table in
[`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md).

**Escalations D11 raises:**

| `reason` | When | Severity |
|---|---|---|
| `needs_approval` | Money action above auto tier | blocking |
| `needs_budget` (to founder) | Treasury pool exhausted and runway < request | blocking |
| `anomaly` | Any `blocking` detector fires | blocking |
| `needs_human` (bounce-back) | Requisition fails ROI; filer gets `options[]` | degrading |

**Escalations D11 receives and resolves:** every `needs_budget` (rung-2 skip target) and every
`needs_human` in the company.

---

## 11. Failure Modes & Fallbacks

| Failure | Detection | Fallback | Artifact quality |
|---|---|---|---|
| Stripe 5xx/timeout | Circuit breaker | Deal holds at `verbal_yes`, `gap: payment_link_pending`, retry next tick | unaffected; delayed |
| Webhook endpoint down | Stripe retries 3d; boot back-fill via `events.list` | Reconciler back-fills; revenue delayed, never lost | signed |
| Out-of-order webhooks | Ledger unique index + API re-fetch | Order-independent by design | signed |
| Terac no match by deadline | `estimated_match_at × 2` passed | Narrow criteria once → else options[] back to filer | partial |
| Terac deliverable QC fail ×2 | `hr.qc` | Dispute + refund path; filer ships with gap | partial |
| Treasurer input missing (scorer query fails) | Empty value_delivered set | Previous envelope × 0.8 for all, gap recorded | partial |
| `calc` unavailable | Tool error | **Halt money math** — no LLM arithmetic fallback exists, by design | blocked |
| Reconciliation drift | Detector | Freeze affected flow, founder card, manual diff view | blocked until resolved |
| Duplicate charge | Detector | Auto-refund duplicate + notify | signed |

---

## 12. Definition of Done & Critic Rubric

**DoD checklist (per cycle):**

- [ ] Trial balance = 0 (Σ debits = Σ credits per account pair)
- [ ] Every ledger row has `event_id` + `source_ref`
- [ ] `BudgetAllocation` sums exactly to the pool; every dept ≥ its floor
- [ ] Rationale contains ≥1 falsifiable prediction with a check-at cycle
- [ ] All anomalies carry severity; blocking ones have an open escalation
- [ ] Every requisition decision shows the ROI arithmetic
- [ ] No unpriced meter records in the dead-letter queue

**Critic rubric** (0–3 each; pass ≥ 14/18, no dimension at 0):

| Dimension | 3 looks like |
|---|---|
| Evidence | Every number traces to a ledger query hash or vendor ref |
| Specificity | Anomalies name department, window, and magnitude |
| Falsifiability | Allocation prediction is checkable at a named cycle |
| Honesty | Small-N forecasts labeled `unverified`; gaps recorded |
| Balance integrity (dept-specific) | Trial balance zero; replay-tested |
| Allocation discipline (dept-specific) | Clamps, floors, redistribution all shown in working |

---

## 13. Demo Notes

| Time | On screen |
|---|---|
| 1:50 | `hr↔all` room: D04 requisition, HR's numeric refusal, narrowed ICP, approval — three messages, real money |
| 2:55 | Test-mode Stripe charge completes; revenue ring closes; ledger rows appear live |
| 3:15 | Treasury tick: envelope bars animate ($9.25 out of Build, Sales up); treasurer rationale renders verbatim |
| 3:40 | Runway bar updates from realized revenue; anomaly chips all green |

---

## 14. Cost Estimate

| Item | Est. |
|---|---|
| Head + treasurer (sonnet) | $0.22 |
| Bookkeeper + billing + dunning (haiku) | $0.08 |
| HR recruiter + QC (sonnet) | $0.18 |
| Critic | $0.06 |
| Tool calls (Stripe reads, Composio sends) | $0.06 |
| **Total per cycle** | **≈ $0.60** (matches `default_envelope_usd` and the platform cost table) |

Terac hire dollars are *not* in this table — they are the HR envelope, sized by Treasury per cycle
(demo: $40 shared-context initial), and always gated.

---

## Assumptions & open questions

1. **ASSUMPTION:** Stripe test mode supports every webhook type we consume, including dispute
   lifecycle events, without a live account. VERIFY at the Stripe booth.
2. **ASSUMPTION:** Terac charges on acceptance rather than requiring a pre-funded balance. If
   pre-funded, the HR envelope becomes a real transfer at venture start and the ledger needs a
   `terac_balance` asset account. VERIFY (Terac booth, question 5 in the integration file).
3. **Open:** does the dispute-rate watch threshold (0.75%) match Stripe's current monitoring
   program? Treat as config, not constant.
4. **Open:** MVP leaves kernel/Boardroom overhead unattributed. Pro-rata attribution is POST-MVP;
   acceptable for a demo, wrong for a real P&L.
5. **Open:** `bad_debt` accounting for uncollectible invoices is POST-MVP; MVP flags in the report
   only. An accountant would object.
6. **Open:** multi-currency is out of scope everywhere (USD only). Dodo as merchant-of-record may
   force this earlier than we'd like.
7. **ASSUMPTION:** discount authority tiers (≤15% / ≤30% / founder) are our invention; D10's spec
   should restate them when written, and if it disagrees, this file loses.
8. **Open:** whether refund auto-threshold ($50) and `ROI_FLOOR` (3.0) should be founder-tunable at
   venture creation. Leaning yes; both are config reads already.
