# 10 — Whop

> **Tier 1.** Distribution *and* a second revenue rail — plus Whop mined as a market-signal source:
> what actually sells here, and at what price.

---

## What it is

Whop is a **commerce and distribution platform**: sellers list products (digital products,
memberships, communities, software access), Whop runs the storefront, checkout, billing, and
membership lifecycle, and buyers discover products through Whop's own marketplace surface. For
developers: a documented API (`docs.whop.com`) with **API keys, products/plans, checkout,
memberships** (the active user↔product relationship tracking access, billing status, and renewal —
created by checkout, then readable/pausable/cancelable/compable via API), **payouts, webhooks**, and
SDKs in TypeScript, Python, and Ruby. Verified against `docs.whop.com` (2026-08); exact endpoint
shapes for listing creation are in the verify block.

---

## The exact product problem it solves

Three distinct problems, which is why Whop earns Tier 1 while being "another payment rail":

1. **Distribution.** A venture born 90 seconds ago has zero traffic. Stripe processes money but
   brings no buyers. Whop's marketplace carries discovery: for consumer/community-shaped ventures, a
   Whop listing *is* the GTM channel, not just the checkout.
2. **Billing without building billing.** For a membership/digital product, Whop replaces the
   entire checkout+subscription+access stack D07 would otherwise have to build and QA. Faster
   time-to-revenue, less attack surface.
3. **Market signal.** Before the company builds anything, Whop's public marketplace is evidence:
   what sells in this category, at what price points, with what positioning. D03 mines it the way it
   mines competitor pricing pages via Solari.

---

## Which departments use it

| Dept | Usage | Beat |
|---|---|---|
| **D03 Market Research** | Marketplace signal: category listings, price distributions, positioning language → `NicheDossier` evidence | **1:00** |
| **D11 Finance** | Rail choice (below), ledger ingestion of Whop revenue/fees, payout reconciliation | 2:55 |
| **D07 Build** | Creates the product listing; wires access delivery (license key / membership check via SDK) | 2:25 |
| **D10 Sales** | Sends checkout links for Whop-railed ventures; reads membership status in deal records | 2:55 |
| **D12 Support** | Membership state drives entitlement checks; cancellations arrive as churn signals | ambient |

---

## The rail decision: Whop vs Stripe (vs Dodo)

D11 Treasury picks the venture's `PaymentRail` at `ProductSpec` sign, and records a `Decision` with
rationale. The full three-way matrix lives in [`11-dodo-payments.md`](11-dodo-payments.md); the
Whop/Stripe boundary is:

```
choose WHOP  iff  product_shape ∈ {membership, community, digital_product, saas_simple}
              AND buyer_kind = consumer_or_prosumer
              AND (distribution_need = high  OR  billing_build_cost > $threshold)
              — the venture wants an audience more than it wants control of checkout UX

choose STRIPE iff product_shape ∈ {b2b_saas, usage_billed, custom_contracts}
              OR buyer_kind = business
              OR the product needs checkout embedded in its own domain/brand
              — the venture wants control and its own funnel more than marketplace traffic

(DODO handles the merchant-of-record / no-US-entity axis — see 11-dodo-payments.md)
```

Marketplace fee vs processing fee is part of the rationale arithmetic: Whop's take on a
marketplace-discovered sale buys distribution; the same take on traffic *we* generated is pure cost.
So the rule's tiebreaker is **where the buyer comes from** — ventures whose GTM plan is
"Whop discovery + community" go Whop; ventures whose GTM is "our landing page + outbound"
([`09-lovable.md`](09-lovable.md), D10 sequences) go Stripe even when consumer-shaped.

Dual-rail (Whop for the community tier, Stripe for the pro tier) is POST-MVP and off by default:
one venture, one rail, one ledger story.

---

## Technical integration

### Auth and SDK

- **App API key** from the Whop dashboard (created once for the Zeroth app; per the docs, app keys
  access data on companies that install the app — exact scoping for our sell-side use is in the
  verify block). Key in the Identity Vault; only `packages/integrations/whop` dereferences it.
- TypeScript SDK, pinned, wrapped in our client so the vendor surface stays in one file.

> **VERIFY AT HACKATHON (Whop booth):**
> 1. Programmatic **product + plan creation** for a brand-new seller account — API-complete, or does
>    first-listing setup require dashboard steps? (If dashboard-only: Solari drives it behind the
>    same intent, [`04-solari.md`](04-solari.md).) (unverified — confirm at hackathon)
> 2. Seller onboarding: KYC/payout setup steps, and whether a **test/sandbox mode** exists for a
>    live-on-stage checkout without real money. (unverified — confirm at hackathon)
> 3. Webhook event catalog + signature scheme (we assume `membership.*` / payment events; exact
>    names (unverified — confirm at hackathon)).
> 4. Marketplace read surface for D03: is there a public/API way to list category products + prices,
>    or is that a Solari read of the storefront? Terms for it either way.
> 5. Fee structure by product type, payout cadence.

### D03's signal mining (the 1:00 beat)

```
WorkOrder(niche_scan) → D03 worker
   ├─ IF marketplace API read exists: query category listings {title, price, member_count?}
   ├─ ELSE: Solari BrowserTask{class:'read', goal:'extract listings+prices for category X',
   │         domain_allowlist:['whop.com'], forbid:[everything], stop_on:[...]}     (04-solari.md)
   ├─ normalize → PricePoint[] {source_id: whop_listing_url, screenshot_ref, observed_at}
   └─ NicheDossier gets: price distribution (p25/p50/p75), positioning phrases that recur,
      saturation estimate. evidence_class: 'real'. Every number carries its listing URL.
```

This is the same evidence discipline as competitor-pricing pulls: numbers with screenshots, no
invented "market sizes." When D08 later prices the venture at $29/mo, the rationale cites the Whop
p50 for the category — **the company read the market it is about to enter, on the platform it will
sell on.**

### Listing creation and access delivery (D07)

```ts
// packages/integrations/whop/listing.ts — kernel-executed on D07's intent, D11-gated
const product = await whop.products.create({          // exact call shape: verify at booth
  title: spec.name, description: gtm.positioning.subhead,
  visibility: 'hidden',                               // hidden until the public-content gate opens
}, idem(venture_id, 'whop.product'));

const plan = await whop.plans.create({
  product_id: product.id, price_usd: gtm.pricing.monthly, interval: 'month',
  trial_days: gtm.pricing.trial_days,
}, idem(venture_id, 'whop.plan'));

// access check inside the venture's product (built by Claude Code):
//   whop.memberships.retrieve / hasAccess(user) — membership IS the entitlement record.
```

Going public flips `visibility` **after** the same public-content gate as the landing page — a
marketplace listing is public content under invariant #2, so the founder sees the listing screenshot
on a Linq card first.

### Webhooks and the ledger

Endpoint `POST kernel.zeroth.app/webhooks/whop`, standard discipline (verify sig → raw persist →
200 <2s → queue → dedupe on event id). Mapping (event names to be confirmed at booth):

| Whop event (assumed name) | → Zeroth event | Effect |
|---|---|---|
| payment succeeded / membership created | `money.revenue_received`, `sales.deal_won` | Ledger credit `source:'whop'`; revenue ring; D12 sets tier |
| membership renewed | `money.revenue_received` | MRR update |
| membership canceled | `sales.deal_lost(reason=churn)` | `ProductSignal` → D06, same routing as Stripe churn |
| payment failed | dunning trigger | **Whop runs its own retry/dunning; ours stays off for Whop rails** to avoid double-messaging the customer |
| dispute/refund | `money.refunded` | Ledger debit; D12 ticket |

Ledger rows carry `source: 'whop'`, `source_ref: whop_event_or_membership_id`. **Whop fees post as
their own ledger line** (`account: 'fees'`), so the Boardroom can show rail economics side by side —
which is exactly what the 2:55 rail-decision beat displays. Treasury reallocation
([`03-stripe.md`](03-stripe.md)) is rail-agnostic: revenue is revenue.

Payout reconciliation: `finance.reconcile` treats Whop payouts like Stripe payouts — cash-account
transfer on `money.payout`, diffed against summed net revenue; drift emits the standard
reconciliation escalation.

---

## User-facing experience

**Founder:** one line in the rail `Decision` card ("Selling on Whop: your buyers browse there, and
it handles checkout + community access — you keep ~X% after fees"), then the listing-approval card
with a screenshot, then revenue lines in the digest. **Customer:** native Whop checkout and
membership management — better than anything a 90-second-old company could build, which is the
point. **Judges (2:55):** the Boardroom shows the rail decision record — Whop chosen, Stripe and
Dodo evaluated with reasons — beside the first sale landing in the ledger.

---

## Why the use case is novel

Three uses, one vendor, all load-bearing: **Whop as market evidence** (D03 reads price distributions
off the marketplace before the company decides what to build — nobody else will treat a commerce
platform as a research corpus with screenshot-cited evidence), **Whop as a reasoned rail choice**
(an explicit, auditable Treasury decision against Stripe and Dodo, not a default), and **Whop as
distribution** (the venture's GTM channel for consumer shapes). The company doesn't *use* Whop; it
*decides* Whop, and shows its work.

---

## Sponsor-track criteria

| Criterion | Our answer |
|---|---|
| Real listing + checkout | Live (or sandbox) listing created by the company during the run; first sale flows through it |
| API depth | Product/plan creation, membership-based entitlements in the built product, webhook-driven ledger |
| Beyond checkout | Marketplace mined as pricing evidence at 1:00; rail-decision record at 2:55 |
| The sentence | "For consumer ventures the company doesn't build billing — it lists on Whop, and it read Whop to price itself in the first place." |

---

## Risks, costs, permissions, rate limits

| Item | Detail |
|---|---|
| Fees | Marketplace/processing take varies by product type (unverified — confirm at hackathon). Modeled as `whop_fee_pct` in config; the rail-decision arithmetic reads it from there. |
| Seller onboarding friction | KYC/payout setup may need founder identity — if so, it is an `AccountCeremony` ([`04-solari.md`](04-solari.md)) done at venture setup, not mid-demo. |
| Test mode | If none exists, the stage sale is a real $1 listing bought by us and refunded — real money as the demo point, same posture as the Terac no-sandbox row. (unverified — confirm at hackathon) |
| Marketplace ToS on scraping | If no API read: Solari reads public listing pages only, no login, `anonymous` persona, rate-limited; confirm posture at the booth. |
| Rate limits | SDK limits undocumented at our depth (unverified — confirm at hackathon); our call volume is trivial (~10 calls/venture). |
| Entitlement coupling | The venture's product checks Whop for access; a Whop outage degrades customer login → cached entitlement with 24h grace, below. |

---

## Fallback behavior when it is down

| Failure | Behavior |
|---|---|
| Whop API down at listing time | Rail decision re-runs with Whop marked unavailable → Stripe Payment Link path ([`03-stripe.md`](03-stripe.md)) so revenue is never blocked. The `Decision` records the forced fallback; the venture can re-list on Whop later. |
| Whop down at 1:00 (signal) | Cached category snapshot from rehearsal, clearly stamped `observed_at`; `NicheDossier` confidence unchanged (evidence is dated, not fabricated). |
| Webhooks stall | Poll memberships for open deals every 30s; dedupe as usual. |
| Entitlement check fails in-product | Venture app caches last-known membership state with a 24h grace window — customers are never locked out by our vendor's outage. |
| On stage | The 2:55 beat's primary is the rail *decision* + a sale; if the Whop sale can't run live, the sale runs on Stripe and the decision record still shows Whop as the evaluated (unavailable) option — honest and narratively intact. |

---

## Contribution to the general prize

The general-prize story needs the company to not just take money but **choose how to sell** — and
distribution is the part of "running a business" that agent demos always skip. Whop gives Zeroth a
priced, evidenced answer to "who will buy this and where," a checkout it didn't have to build, and a
second revenue rail that proves the ledger and Treasury are rail-agnostic by design rather than
Stripe-shaped by accident.

---

## Assumptions & open questions

- (unverified — confirm at hackathon) Product/plan creation API completeness; sandbox mode; webhook
  event names + signature scheme; fee schedule; marketplace read API; app-key scoping for sell-side.
- Open: dual-rail ventures (community tier on Whop + pro tier on Stripe) — POST-MVP.
- Open: whether the demo venture (B2B-ish ER-nurse tool) rails on Stripe with Whop shown as signal
  only, or we pick a consumer-shaped demo venture so the Whop sale is the live one. Decide in
  rehearsal week; the architecture supports both.

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`03-stripe.md`](03-stripe.md) (the other rail; shared ledger discipline) ·
[`11-dodo-payments.md`](11-dodo-payments.md) (the three-way rail matrix) ·
[`04-solari.md`](04-solari.md) (marketplace reads, onboarding ceremony) ·
[`09-lovable.md`](09-lovable.md) (where the CTA points when the rail is Whop)
