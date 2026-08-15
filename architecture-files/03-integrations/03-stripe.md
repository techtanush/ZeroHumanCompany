# 03 — Stripe

> **Tier 1.** Money on stage at 2:55, and the company refinancing itself at 3:15.

---

## What it is

Payments infrastructure. We use a deliberately small slice: **Payment Links**, **Checkout Sessions**,
**Customers**, **Products/Prices**, **Subscriptions**, **Invoices**, **Refunds**, **Disputes**, and
**webhooks**. No Connect, no Issuing, no Terminal — every one of those is a rabbit hole that costs a
demo beat and buys nothing.

---

## Our creative angle

**An autonomous P&L, not a checkout button.**

Anyone can generate a payment link. What's hard — and what the hackathon is actually about — is a
company that *knows its own financial position and acts on it without being told*. So Stripe is
wired into Zeroth at both ends:

- **Revenue in.** D10 closes a deal → a Payment Link or Checkout Session is created → the customer
  pays → webhooks land → the D11 ledger records it → the Boardroom revenue ring completes.
- **Costs out.** Every token, sandbox-second, API call, and **Terac human hire**
  ([`01-terac.md`](01-terac.md)) is already metered against a department budget.
- **The loop that closes it.** **Treasury reads realized Stripe revenue and reallocates department
  budget envelopes from it.** Sales converted, so Sales gets more envelope; Build is done shipping,
  so Build gets throttled; HR's human-hiring envelope grows because there is now revenue to fund it.

The company funds its own R&D out of its own MRR, live, in four minutes. That is the beat at 3:15,
and it only exists because the *cost* side was metered from minute zero.

---

## Which departments use it

| Dept | Uses Stripe for |
|---|---|
| **D11 Finance & HR** | **Owner.** Ledger, reconciliation, Treasury reallocation, dunning, refunds. The only department with write access to Stripe (enforced by the `money-out-is-d11-only` Band policy in [`02-band.md`](02-band.md)). |
| **D10 Sales** | *Requests* a payment link for a won deal. Cannot call Stripe directly — it files a delegation that D11 executes. |
| **D12 Support** | Consumes subscription state (an enterprise-tier customer's ticket outranks a free-trial one) and receives refund/dispute events as tickets. |
| **D07 Build** | Reads the venture's chosen `PaymentRail` to wire the product's own checkout. |
| **D13 Chief of Staff** | Reads revenue-per-department-dollar as a capability-gap signal. |

---

## Integration spec

Stripe's API is stable and well-documented, so this section is mostly *our* shapes, not discovery.

> **VERIFY AT HACKATHON (Stripe booth):** whether the track rewards a specific product (Payment Links
> vs Checkout vs Billing) — if so, lean into it in the narration. Also grab guidance on the cleanest
> test-mode path for showing a live charge on a projector without exposing keys.

### Objects we create

| Stripe object | When | Owner |
|---|---|---|
| `Product` + `Price` | On `ProductSpec` sign, from D08's `GTMPlan.pricing` | D11 |
| `PaymentLink` | Deal reaches `stage=verbal_yes`, self-serve motion | D11 (on D10's request) |
| `Checkout Session` | Deal needs a custom amount, term, or discount | D11 |
| `Customer` | First payment, or first time a `Lead` gives a billing email | D11 |
| `Subscription` | Recurring plans; `trial_period_days` from GTM | D11 |
| `Refund` | D12 support resolution or founder-approved | D11, gated |

```ts
// packages/integrations/stripe/links.ts
const link = await stripe.paymentLinks.create({
  line_items: [{ price: price.id, quantity: 1 }],
  after_completion: {
    type: 'redirect',
    redirect: { url: `${venture.domain}/welcome?d=${deal.id}` },
  },
  metadata: {                       // metadata IS our join key. Never omit these.
    venture_id, deal_id, department: 'D10', trace_id,
  },
  allow_promotion_codes: false,
}, {
  idempotencyKey: hash(work_order_id, 'stripe.payment_link', deal.id),
});
```

**Rule: every Stripe object we create carries `metadata.{venture_id, deal_id|customer_ref, trace_id}`.**
Reconciliation without it is guesswork, and guesswork in a ledger is a P0.

### Webhooks we consume

Endpoint: `POST https://kernel.zeroth.app/webhooks/stripe`, verified with
`stripe.webhooks.constructEvent(rawBody, sig, endpointSecret)`. Raw body preserved — no body parser
in front of it.

| Stripe event | → Zeroth event | Effect |
|---|---|---|
| `checkout.session.completed` | `sales.deal_won`, `money.revenue_received` | Deal → `won`; ledger credit; revenue ring animates; routing fires D11 collect + D12 onboard |
| `payment_intent.succeeded` | `money.revenue_received` | Ledger credit (dedup against the session event by `payment_intent` id) |
| `payment_intent.payment_failed` | `money.metered` (failure) | Dunning sequence starts |
| `invoice.paid` | `money.revenue_received` | Recurring revenue; MRR projection updates |
| `invoice.payment_failed` | — | Dunning; after N failures → `sales.deal_lost(reason=payment)` |
| `customer.subscription.created` | `money.revenue_received` (MRR delta) | D12 sets support tier |
| `customer.subscription.updated` | — | Tier change; upgrade → D10 signal, downgrade → D06 `ProductSignal` |
| `customer.subscription.deleted` | `sales.deal_lost(reason=churn)` | **Churn is a `ProductSignal` → D06 reassess**, per the routing rule on `support.signal_filed` |
| `charge.refunded` | `money.refunded` | Ledger debit; D12 ticket auto-resolved |
| `charge.dispute.created` | `money.refunded` (provisional) | **D12 ticket at `severity=high`**, funds held, evidence assembled |
| `charge.dispute.closed` | `money.refunded` / reversal | Ledger settles either way |
| `payout.paid` | `money.payout` | Runway update |

**Webhook discipline** (same as every webhook in the system, stated once here and referenced elsewhere):

1. Verify signature **before** parsing. Bad signature → 400, logged, never processed.
2. Persist the raw event to `webhook_deliveries` immediately.
3. Return `200` in <2s; enqueue a BullMQ job for the reducer.
4. Dedupe on Stripe's `event.id` in `processed_messages`. Stripe retries; we're idempotent.
5. **Never trust webhook amounts alone for the ledger** — on `revenue_received`, re-fetch the
   `PaymentIntent`/`Invoice` from the API and reconcile. Webhooks can arrive out of order; the API is
   the current truth. This is the difference between a demo ledger and a real one.

---

## The Finance ledger mapping

Double-entry, in Postgres, projected from events. Stripe is a *source* for the ledger, never the
ledger itself — because the ledger also contains Whop, Dodo, Terac, token spend, and sandbox time,
and no payment processor can hold all of that.

```sql
-- projections
CREATE TABLE ledger_entries (
  id            uuid PRIMARY KEY,
  venture_id    uuid NOT NULL,
  ts            timestamptz NOT NULL,
  account       text NOT NULL,      -- 'revenue' | 'cash' | 'ar' | 'cogs' | 'opex:compute'
                                    -- 'opex:human' | 'opex:tools' | 'refunds' | 'fees'
  direction     text NOT NULL,      -- 'debit' | 'credit'
  amount_usd    numeric(12,4) NOT NULL,
  source        text NOT NULL,      -- 'stripe' | 'whop' | 'dodo' | 'terac' | 'meter'
  source_ref    text NOT NULL,      -- stripe event/object id — the audit link
  department_id text,               -- attribution for Treasury
  event_id      uuid NOT NULL       -- back to the event store. Always.
);
```

| Stripe fact | Debit | Credit |
|---|---|---|
| Checkout completed, $29 | `cash` $29 | `revenue` $29 |
| Stripe fee $1.14 | `fees` $1.14 | `cash` $1.14 |
| Refund $29 | `refunds` $29 | `cash` $29 |
| Dispute opened $29 | `ar` −$29 (provisional hold) | `cash` $29 |
| Terac hire $75 ([`01-terac.md`](01-terac.md)) | `opex:human` $75 | `cash` $75 |
| Claude tokens $0.42 | `opex:compute` $0.42 | `cash` $0.42 |

**Runway**, as defined in the glossary, is computed off this table:
`founder_funded_balance + realized_revenue − committed_spend`. It is the number Treasury allocates
against, and it is on screen the entire demo.

---

## Treasury: revenue → budget reallocation

This is the integration's whole reason for existing. `finance.treasurer` runs on the
`finance.reconcile` cron (hourly in prod, every ~5s at demo `time_scale`).

```ts
// The rule, in full. It fits on a screen on purpose — a judge can audit it live.
function reallocate(ctx: TreasuryContext): BudgetAllocation[] {
  const realized   = ledger.sum('revenue', ctx.cycle) - ledger.sum('refunds', ctx.cycle);
  const runway     = ctx.founder_funded + ledger.sum('cash') - ctx.committed;
  const reinvest   = realized * ctx.reinvest_rate;          // demo: 0.70
  const pool       = ctx.base_envelope_pool + reinvest;

  // Each department's claim = its marginal revenue per dollar, smoothed, floored.
  const scores = DEPARTMENTS.map(d => ({
    id: d,
    roi: (attributedRevenue(d, ctx.window) + 0.01) / (spend(d, ctx.window) + 0.01),
    floor: FLOORS[d],                                        // nothing starves to zero
    cap:   CAPS[d],
  }));

  const weighted = softmax(scores.map(s => Math.log(s.roi)), ctx.temperature); // demo: 0.6
  return scores.map((s, i) => ({
    department_id: s.id,
    envelope_usd: clamp(pool * weighted[i], s.floor, s.cap),
    rationale: `ROI ${s.roi.toFixed(2)}× over ${ctx.window}; pool $${pool.toFixed(2)} ` +
               `(incl. $${reinvest.toFixed(2)} reinvested from realized revenue)`,
  }));
}
```

| Knob | Demo value | Why |
|---|---|---|
| `reinvest_rate` | `0.70` | 70% of realized revenue re-enters the budget pool; 30% accrues to runway. Founder-configurable. |
| `temperature` | `0.6` | Softmax smoothing. At 0 the company would dump everything on the single best-performing department and starve; at 1 it ignores signal. |
| `FLOORS` | D11, D12, D13 never below $0.50/cycle | Finance, Support, and Chief of Staff must keep running even when broke — they're how the company recovers. |
| `CAPS` | 40% of pool per department | No department can own the company. |

**Every reallocation emits `money.budget_allocated` with the `rationale` string**, and the Boardroom
animates the budget bars. A department whose envelope shrinks below its in-flight commitment gets
`dept.frozen` at the next artifact boundary — it suspends cleanly, files a requisition with Treasury,
and resumes on grant. That path is already specified in
[`../01-platform/01-system-architecture.md`](../01-platform/01-system-architecture.md); Stripe revenue
is simply what makes the grant possible.

**The 3:15 beat is literally this function running.** Sales converted a deal at 2:55; one Treasury
tick later, Sales' bar grows, Build's shrinks, HR's grows enough to fund another Terac hire. Nothing
is scripted — the input is a real webhook from a real (test-mode) charge.

---

## Dunning

Owned by `finance.dunning`, triggered on `invoice.payment_failed` / `payment_intent.payment_failed`.

| Attempt | Delay | Channel | Content |
|---|---|---|---|
| 1 | +1h | Email (Composio Gmail) | Soft: "card declined, here's a fresh link" |
| 2 | +24h | Email | Adds the specific decline reason from Stripe |
| 3 | +72h | **Linq iMessage** *(if the customer opted in)* + email | Short, direct, one tap to a new Checkout Session |
| 4 | +7d | Email | Final notice; subscription pauses, access degrades not deletes |
| — | +14d | — | `sales.deal_lost(reason=payment)`; the lead returns to D09 with a `payment_failed` tag, excluded from re-sequencing for 90 days |

Dunning messages to real people pass the same approval gate as any outbound
([`06-linq.md`](06-linq.md)); at `autonomy_level=autonomous` they auto-approve because they're
transactional, not promotional. **We never send more than one dunning message per customer per 24h,
across all channels** — enforced in `packages/outbound/ratelimit.ts`, not per-department.

---

## Refunds and disputes → D12

```
charge.dispute.created
   │
   ├─► ledger: provisional hold                    (cash −, ar −)
   ├─► D12 ticket, severity=high, SLA 4h
   │      └─ resolver pulls: order, delivery events, support history, product usage
   │      └─ assembles Stripe dispute evidence (receipt, service date, usage log, policy)
   ├─► D06 ProductSignal if the dispute reason ∈ {product_unacceptable, not_received}
   │      └─ routing rule: support.signal_filed(severity>=high) → D06 reassess_product
   └─► GATE: submitting dispute evidence is a founder-visible action (Linq card, 6h timeout,
             on_timeout: auto_approve — because not responding loses the dispute by default)
```

Refunds requested through Support follow the same shape but with a tighter gate: any refund over
`$refund_auto_threshold` (demo: $50) requires founder approval; under it, D12 resolves autonomously
and D11 executes. **Support cannot call Stripe** — it files a delegation into the `support↔build`
room's sibling path to D11.

---

## Idempotency strategy

Money is the one place where at-least-once delivery with sloppy keys becomes a real charge twice.

| Layer | Key | Scope |
|---|---|---|
| **Outbound Stripe calls** | `hash(work_order_id, action, target_id)` — the same formula as every side-effecting tool in [`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md) | Passed as `Idempotency-Key`. Stripe holds keys 24h; our retries are all well inside that. |
| **Inbound webhooks** | Stripe `event.id` | `processed_messages` unique index. Second delivery is a no-op returning 200. |
| **Ledger writes** | `(source, source_ref, account, direction)` unique index | A reducer replay cannot double-credit. |
| **Retry policy** | Exponential backoff, 5 attempts, **same key every time** | A new key on retry is how demos charge people twice. Keys are computed once and stored on the work order. |
| **Reconciler** | Hourly `finance.reconcile` | Fetches Stripe `balance_transactions` for the window and diffs against `ledger_entries`. Any drift emits `money.metered(kind='reconciliation_drift')` and a D11 escalation. **We detect our own accounting errors.** |

---

## Test-mode demo plan

The charge on stage is **real Stripe test mode** — a real API call, real webhook, real ledger write,
real Treasury reallocation. Only the money is fake, and we say so.

| Setup step | Detail |
|---|---|
| Keys | `STRIPE_SECRET_KEY=sk_test_…` in the Identity Vault, injected per-run as a scoped handle. Never in a repo, never on screen. |
| Webhooks | Real endpoint on the Render-hosted kernel with a `whsec_…` signing secret. **Not** the Stripe CLI listener — a laptop tunnel is one more thing to fail on stage. |
| The buyer | A second browser window (or a phone on the projector) using card `4242 4242 4242 4242`. The "customer" is one of the humans from the D04 interview panel, contacted with their own quote — that continuity is the beat. |
| Timing | Checkout completes in ~6s; webhook lands in ~1s; ledger + revenue ring animate immediately; Treasury tick at demo `time_scale` fires within ~5s. **2:55 → 3:15 is one continuous causal chain**, not two scenes. |
| Fallback | If the network dies: `?replay=demo-1` replays the *stored raw webhook payloads* through the same reducer. The ledger, the ring, and the reallocation all still run — because they're reducers over events, not live API reads. Nothing is faked; it's replayed, and we say that word. |
| What we never do | Live-mode keys on a projector. Real card numbers. Screen-sharing the Stripe dashboard while logged into anything real. |

---

## Failure modes and fallback

| Failure | Detection | Behavior |
|---|---|---|
| Stripe API 5xx / timeout | Circuit breaker per tool | Deal stays at `verbal_yes` with `gap: 'payment_link_pending'`; retried on the next Sales cadence tick. **The deal is never marked won without a confirmed payment object.** |
| Webhook endpoint down | Stripe retries for 3 days | On boot, `finance.reconcile` back-fills from `stripe.events.list({created: {gte: last_seen}})`. No revenue is ever lost, only delayed. |
| Out-of-order webhooks | Ledger unique index + API re-fetch | The re-fetch-on-revenue rule means order doesn't matter. |
| Duplicate charge | Idempotency key | Impossible via our path; if it happens via the customer double-submitting, the reconciler flags it and D11 auto-refunds the duplicate with a founder notification. |
| Rate limits (429) | Stripe headers | Backoff + jitter; Stripe's limits are far above anything a hackathon demo produces. |
| Venture is international / founder has no US entity | `PaymentRail` decision at venture setup | Treasury selects **Dodo** ([`11-dodo-payments.md`](11-dodo-payments.md)) or **Whop** ([`10-whop.md`](10-whop.md)). The ledger mapping is rail-agnostic by design — `source` is just a column. |
| Track judge asks "is any of this real?" | — | Open the event log. Every ledger row has an `event_id` and a `source_ref` that resolves to a real Stripe object id in test mode. Click it. |

---

## Demo beat — 2:55 and 3:15

**2:55 — money in.** D10 has been sequencing a lead who is *a person from the 1:25 interview panel*,
and the email quotes them back to themselves. They reply yes. D10 files a delegation into
`sales↔finance`; D11 creates the Payment Link; the link opens on the second screen; card `4242`;
`checkout.session.completed` lands; **the Boardroom revenue ring completes and ticks from $0.**

**3:15 — money reallocated.** Treasury's next tick reads the realized revenue, recomputes envelopes,
and the budget bars re-animate: Sales up (it converted), Build down (it shipped), HR up (there's now
revenue to hire humans with). The `rationale` string is on screen — *"ROI 4.1× over last cycle; pool
$18.40 incl. $12.60 reinvested from realized revenue."*

**Narration:** *"That's not a dashboard. Sales earned twenty-nine dollars, Finance recognized it, and
the company just moved its own budget — including the budget it uses to hire humans."*

---

## Track-winning pitch sentence

> **"We didn't add a checkout button — we gave the company a P&L. Every token, sandbox-second, and
> human hire is metered as a cost, real Stripe revenue is recognized in a double-entry ledger, and the
> Treasury reallocates every department's budget from that revenue on a timer. On stage, a $29 charge
> visibly refinanced the company's own R&D twenty seconds later."**

---

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`01-terac.md`](01-terac.md) (what the reallocated budget buys) ·
[`10-whop.md`](10-whop.md) / [`11-dodo-payments.md`](11-dodo-payments.md) (the other rails and the
Treasury rule that picks between them) ·
[`06-linq.md`](06-linq.md) (deal-closed card, dunning card)
