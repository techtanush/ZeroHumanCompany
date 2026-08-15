# 11 — Dodo Payments

> **Tier 2.** The merchant-of-record rail: for the founder with no legal entity and the venture with
> global buyers. Treasury evaluates it on every venture, and the decision record is the beat.

---

## What it is

Dodo Payments is a **Merchant of Record (MoR) platform for global payment processing of digital
products**. As MoR, Dodo — not the founder — is the legal seller of record: it handles global sales
tax/VAT/GST registration, calculation, collection, and remittance, currency handling across
markets, and pays the vendor out as a supplier. Developer surface (verified against
`docs.dodopayments.com`, 2026-08): REST API with official TypeScript/Python/Go SDKs, checkout,
subscriptions, usage-based and credit-based billing, and **Standard-Webhooks-spec webhooks** (HMAC
SHA256 `webhook-signature` + `webhook-id` + `webhook-timestamp` headers, SDK `unwrap()` verification
helpers, 8 retries with exponential backoff, per-event-type endpoint subscriptions, event catalog
with schemas — e.g. `payment.succeeded`, `payment.failed`, `subscription.*`, `dispute.*`).

---

## The exact product problem it solves

Stripe answers "how do I charge a card." It does not answer two questions Zeroth hits immediately,
because Zeroth's founders are *anyone*:

1. **"The founder has no company."** A Stripe account ultimately needs a legal entity and tax
   identity behind it. Zeroth's core promise is turning *anyone* into a founder — including a
   19-year-old in Manila or a nurse in Ohio with no LLC. With an MoR, the entity problem dissolves:
   **Dodo is the seller**; the founder is a supplier being paid out.
2. **"The venture sells globally on day one."** The moment the Lovable page gets a visitor from the
   EU, the venture theoretically owes VAT-shaped obligations no autonomous agent should be
   improvising. MoR moves tax registration, collection, and remittance — and the liability — to the
   vendor whose business model is exactly that.

An autonomous company that *knows which legal shape it is allowed to sell in* is a much stronger
claim than one that wires Stripe and hopes. That knowledge is a Treasury decision rule, below.

---

## Which departments use it

| Dept | Usage |
|---|---|
| **D11 Finance** | Owner: runs the rail decision, ingests Dodo webhooks into the ledger, reconciles payouts, models MoR fees. |
| **D10 Sales** | Sends Dodo checkout links for Dodo-railed ventures. |
| **D07 Build** | Wires the venture product's checkout to the chosen rail (rail-agnostic `PaymentRail` config). |
| **D12 Support** | Receives `dispute.*` / refund events as tickets; **customer-facing tax questions route to Dodo's MoR support**, not to our agents (we must not give tax advice). |

---

## The routing decision matrix: Stripe vs Whop vs Dodo

The full three-way rule, owned by D11 Treasury, run at `ProductSpec` sign, recorded as a `Decision`
with the losing rails' reasons attached. ([`10-whop.md`](10-whop.md) holds the Whop/Stripe
boundary detail; this is the master matrix.)

| Question (asked in order) | Answer → rail |
|---|---|
| 1. Does the founder have a US/supported legal entity + tax identity willing to be the seller? | **No → DODO** (MoR is the only honest option) — stop. |
| 2. Is the product consumer/community-shaped with high distribution need? | Yes → **WHOP** (marketplace is the GTM channel) — stop. |
| 3. Is >~30% of expected demand outside the founder's tax jurisdiction (from D03's `NicheDossier` geo evidence)? | Yes → **DODO** (global tax handling outweighs rail-fee delta). |
| 4. Does the product need custom contracts, usage billing on our terms, or checkout embedded under its own brand with maximal control? | Yes → **STRIPE**. |
| 5. Default | **STRIPE** (most tooling, our deepest integration). |

```ts
// packages/contracts/src/payments.ts
export const PaymentRail = z.object({
  venture_id: z.string().uuid(),
  rail: z.enum(['stripe', 'whop', 'dodo']),
  decided_at: z.string().datetime(),
  inputs: z.object({
    founder_entity: z.enum(['us_entity', 'foreign_entity', 'none']),
    product_shape: z.enum(['b2b_saas','saas_simple','membership','community','digital_product','usage_billed']),
    expected_geo_split: z.record(z.string(), z.number()),   // from NicheDossier evidence, source-cited
    distribution_need: z.enum(['low','medium','high']),
  }),
  rejected: z.array(z.object({ rail: z.string(), reason: z.string() })),  // ← the demo artifact
  fee_model: z.object({ pct: z.number(), fixed_usd: z.number() }),        // from config, per rail
});
```

The `rejected[]` array is what shows on stage at 2:55: *"Stripe rejected: founder has no entity.
Whop rejected: B2B shape, low marketplace fit. → Dodo."* A company that shows its rejected options
is a company that decided, not defaulted.

**Founder-facing framing (one Linq line, [`06-linq.md`](06-linq.md)):** *"You don't have a company
registered, so we'll sell through Dodo — they're the legal seller, they handle all sales tax
worldwide, and they pay you out. You can switch rails later if you incorporate."*

---

## Technical integration

### Auth, SDK, environments

- `DODO_PAYMENTS_API_KEY` (bearer) + `DODO_PAYMENTS_WEBHOOK_KEY` in the Identity Vault; TypeScript
  SDK pinned in `packages/integrations/dodo`. Dodo has explicit test/live environments
  (`environment` field in the SDK client) — the demo runs test mode, same posture as Stripe.
- Products/prices created via API on rail selection; checkout links (hosted checkout) generated per
  deal; subscriptions for recurring plans. Exact endpoint paths per the current API reference at
  integration time — the SDK abstracts them.

### Webhooks

Endpoint `POST kernel.zeroth.app/webhooks/dodo`. Dodo follows the **Standard Webhooks spec**, which
makes this our cleanest webhook integration:

```ts
// apps/kernel/src/webhooks/dodo.ts — raw body preserved, no parser in front
const event = dodo.webhooks.unwrap(rawBody, {
  headers: pick(req.headers, ['webhook-id', 'webhook-signature', 'webhook-timestamp']),
});          // throws on bad signature → 401, logged, never processed
await store.webhookDeliveries.insert(rawBody, event);   // raw first
await queue.enqueue('dodo-webhook', { id: req.headers['webhook-id'] });  // 200 in <2s
// dedupe on webhook-id in processed_messages — Dodo retries up to 8× by design
```

| Dodo event | → Zeroth event | Effect |
|---|---|---|
| `payment.succeeded` | `money.revenue_received`, `sales.deal_won` | Ledger credit `source:'dodo'`; revenue ring; **amount recorded is our payout-side net** (see ledger note) |
| `payment.failed` | dunning trigger | Our dunning sequence ([`03-stripe.md`](03-stripe.md)) with Dodo checkout re-links |
| `subscription.active` / renewed | `money.revenue_received` | MRR update |
| `subscription.cancelled` | `sales.deal_lost(reason=churn)` | `ProductSignal` → D06, standard churn routing |
| `dispute.*` | `money.refunded` (provisional) | D12 ticket `severity=high`; evidence assembly; **Dodo as MoR fronts the dispute process** — our job is evidence, not representment mechanics |
| `refund.succeeded` | `money.refunded` | Ledger debit; D12 ticket resolution |

Event ordering is explicitly not guaranteed (their docs say so; payload is latest-state at
delivery) — which our re-fetch-on-revenue ledger rule already tolerates.

### The MoR ledger distinction

This is the accounting subtlety the demo can actually show. On a Stripe rail, gross revenue is ours
and fees are a cost line. On a Dodo rail, **Dodo is the seller**: the customer's $29 is Dodo's
gross; what we recognize is our **payout-side receivable** (sale minus MoR fee minus the taxes Dodo
collected and remits on its own account).

| Dodo fact | Debit | Credit |
|---|---|---|
| Sale $29 (MoR gross) | `ar:dodo` net amount | `revenue` net amount |
| Tax collected by Dodo | — not our ledger line — | (memo field only: `tax_handled_by_mor`) |
| MoR fee | `fees` | `ar:dodo` |
| Payout received | `cash` | `ar:dodo` |

Treasury reallocation reads `revenue` regardless of rail — but the Boardroom's rail panel shows the
difference: *"Stripe: you are the merchant. Dodo: the merchant is Dodo; taxes handled; net flows to
you."* One sentence of accounting literacy that no other team will have.

> **VERIFY AT HACKATHON (Dodo booth):**
> 1. Fee schedule (MoR % + fixed) for the `fee_model` config. (unverified — confirm at hackathon)
> 2. Vendor onboarding: what identity/KYC does the *founder* need as payout recipient, and how fast
>    is approval? This gates "no-entity founder" being demoable live vs pre-onboarded.
> 3. Test-mode checkout: full webhook fidelity in test environment?
> 4. Payout cadence and minimums (affects the `ar:dodo` aging line).
> 5. Product-type restrictions (MoRs restrict certain digital goods; our demo venture must be in
>    the allowed set). (unverified — confirm at hackathon)

---

## User-facing experience

**Founder:** the rail decision explained in one text message (above); payouts appear in the digest
as "Dodo payout $54.20 (2 sales, taxes handled)." They never see a tax form — that is the entire
point. **Customer:** hosted Dodo checkout with local currency and correct tax at the point of sale;
receipts from the merchant of record. **Judges:** the 2:55 decision record with `rejected[]`
reasons, and the ledger's `ar:dodo` line demonstrating the company understands what MoR means for
its own books.

---

## Why the use case is novel

Every other Dodo integration at this hackathon will be a checkout link. Ours is a **legal-shape
decision engine**: the company examines the founder's entity status and the venture's geographic
demand evidence, picks the rail that is *lawful and economical*, records why the others lost, and
books the revenue with MoR-correct accounting. It makes "anyone can be a founder" literally true —
the no-entity founder in the demo narrative could not sell at all on Stripe, and the company knows
that *before* it tries.

---

## Sponsor-track criteria

| Criterion | Our answer |
|---|---|
| Real Dodo integration | Test-mode checkout + full Standard-Webhooks ingestion into a double-entry ledger |
| MoR understood, not just used | Payout-side accounting, tax-memo handling, dispute posture, entity-based routing |
| Decision depth | The three-rail matrix with evidence-cited inputs and recorded rejections |
| The sentence | "The company picks its own payment rail based on where the founder and buyers actually are, and knows what MoR means for its ledger." |

---

## Risks, costs, permissions, rate limits

| Item | Detail |
|---|---|
| Fees | MoR fees exceed raw processing fees — that is the price of tax handling and it is in the decision arithmetic, not hidden. Exact % (unverified — confirm at hackathon). |
| Onboarding latency | If vendor approval takes days, the demo uses a pre-onboarded account and says so; the *decision* logic still runs live. |
| Product restrictions | MoR platforms restrict some digital-goods categories; the demo venture must clear Dodo's allowed list. Checked at the booth before locking the demo narrative. |
| Payout trust | Funds flow through Dodo; `ar:dodo` aging is monitored by `finance.reconcile`, escalation if payout is overdue vs stated cadence. |
| Rate limits | Our volume is trivial; standard backoff on 429 regardless. Webhook retries (8×) are handled by dedupe. |
| Tax advice boundary | Our agents never answer tax questions — D12 routes them to Dodo's MoR support. Hard rule, in D12's prompt and its tool allowlist. |

---

## Fallback behavior when it is down

| Failure | Behavior |
|---|---|
| Dodo API down at rail-selection time | Matrix runs with Dodo marked unavailable: entity-holding founders → Stripe; no-entity founders → **the venture holds at `pre_revenue`** with a founder notification, because selling without a lawful rail is not a fallback we take. The gate fails closed on legality. |
| Dodo down mid-venture (checkout) | Checkout links temporarily unavailable → deals hold at `verbal_yes` with `gap: 'rail_down'` (same posture as Stripe outage); no silent rail-switching, because switching seller-of-record mid-customer is a legal change, not a retry. |
| Webhooks stall | Poll payments/subscriptions for open deals; dedupe on object id; Dodo's own 8-retry schedule covers most gaps. |
| On stage | The 2:55 beat needs only the decision record (always available — it's our code) plus one test-mode sale on *some* rail. If Dodo test mode fails live, the decision record still shows Dodo winning with Stripe as executed fallback, explicitly labeled. |

---

## Contribution to the general prize

The general prize is "a company that runs itself" — and real companies are constrained by law,
entity status, and tax, not just by API availability. Dodo is how Zeroth demonstrates constraint-
awareness: the escalation ladder knows when *no agent and no US processor* is the right answer and a
merchant of record is. It also widens the addressable founder base of the whole product from
"people with LLCs" to "anyone," which is the most Zeroth-thesis-aligned thing any single vendor in
this folder does.

---

## Assumptions & open questions

- (unverified — confirm at hackathon) Fee schedule; vendor-onboarding KYC + latency; test-mode
  webhook fidelity; payout cadence/minimums; restricted-category list; exact event-name set beyond
  the documented catalog pattern.
- Open: geo-split threshold (30%) in rule 3 is a placeholder constant — sanity-check against Dodo's
  own guidance on when MoR pays for itself.
- Open: can a venture migrate rails post-incorporation (Dodo → Stripe) with subscription continuity?
  POST-MVP; record the question at the booth.

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`03-stripe.md`](03-stripe.md) (the default rail; shared ledger + dunning machinery) ·
[`10-whop.md`](10-whop.md) (the distribution rail; Whop/Stripe boundary) ·
[`06-linq.md`](06-linq.md) (how the rail choice is explained to the founder) ·
[`../00-vision/04-demo-and-judging.md`](../00-vision/04-demo-and-judging.md) (the 2:55 beat)
