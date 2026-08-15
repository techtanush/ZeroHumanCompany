# 09 — Lovable

> **Tier 2.** The marketing site ships the same hour as the app, generated from the same `GTMPlan`
> artifact — product and go-to-market in one cycle.

---

## What it is

Lovable is an **AI app builder**: prompt-to-app generation of full-stack web applications and
websites (React/Tailwind frontends, hosted, with custom-domain publishing and follow-up prompt
editing). Its sweet spot is exactly the class of artifact a new venture needs on day one: landing
pages, waitlists, marketing sites, and simple CRUD-shaped MVPs — produced in minutes from a
well-written brief.

> **ASSUMPTION:** Lovable's programmatic surface (API vs prompt-driven UI only) is
> (unverified — confirm at hackathon). Both integration paths are specced below; the choice of path
> changes one driver file, not the architecture.

---

## The exact product problem it solves

When D06 signs a `ProductSpec` and D08 signs a `GTMPlan`, the venture needs **two distinct web
artifacts** with different quality bars:

| Artifact | Bar | Wrong tool cost |
|---|---|---|
| The **product** (real logic, auth, payments, data) | Correctness — it must survive QA and take money | Lovable: opaque codebase our QA/fix loop can't iterate well |
| The **marketing surface** (landing page, waitlist, launch page) | Speed and polish — it must exist *today* and look intentional | Claude Code: burns expensive build-sandbox cycles on a page whose content is already fully determined by the `GTMPlan` |

Zeroth uses each tool for what it is: **Claude Code builds the product**
([`15-anthropic-claude.md`](15-anthropic-claude.md)); **Lovable ships the story about the product.**
Same hour, same source artifact.

---

## The routing decision: Lovable vs Claude Code build

Encoded in D07's planner, visible in the Boardroom as a `Decision` with rationale:

```
BuildTarget classification (D07 planner, on ProductSpec + GTMPlan):

  → LOVABLE  iff  artifact ∈ {landing_page, waitlist, link_in_bio, launch_page}
              OR (product_mvp AND all of:
                    no custom backend logic beyond forms/email capture,
                    no payment flow beyond a hosted checkout link,
                    no data model beyond one table,
                    time_to_live_matters > correctness_risk)

  → CLAUDE CODE  otherwise (anything with real logic, auth, webhooks,
                  Stripe integration, or that must enter the Replay QA loop)

  → BOTH, in parallel, is the DEFAULT for a normal venture:
      Lovable: marketing site, live in ~10 min, iterated by prompt
      Claude Code: the product, in the build sandbox, QA-gated
```

Two corollaries. First, **anything that takes money or holds user data goes through the Claude Code
path**, because only that path has the Replay regression gate and our security review — a Lovable
MVP that starts succeeding gets *rebuilt* by D07 as a normal venture-maturation step
(`ProductSignal: 'outgrown_lovable'`). Second, the Lovable page always links to the real product;
the two artifacts share copy by construction, never by coincidence.

---

## Which departments use it

| Dept | Usage |
|---|---|
| **D08 Strategy & GTM** | Author of the brief: positioning, ICP language, offer, proof points, CTA — all fields of the `GTMPlan`. |
| **D07 Build** | Owner of execution: runs the Lovable session, wires the domain, embeds analytics + the checkout/waitlist link, publishes (behind the public-content gate). |
| **D03 Market** | POST-MVP: message-testing variants (two Lovable pages, one traffic split, D05 panel pre-test). |

---

## Technical integration

### The brief is generated, not written

The interesting part is upstream of Lovable: **the prompt is a rendered artifact.**

```ts
// packages/integrations/lovable/brief.ts
export function renderLovableBrief(gtm: GTMPlan, spec: ProductSpec, brand: BrandKit): string {
  return [
    `Build a single-page marketing site for "${brand.name}".`,
    `Audience: ${gtm.icp.description}. Tone: ${gtm.positioning.tone}.`,
    `Hero: "${gtm.positioning.headline}" / "${gtm.positioning.subhead}"`,
    `Problem section: ${gtm.positioning.pain_points.map(p => p.claim).join('; ')}`,
    // Every claim on the page traces to ClaimLedger — invariant #3 applies to MARKETING COPY.
    // No invented testimonials, no fake logos, no "trusted by 10,000 teams".
    `Social proof: ONLY the following, verbatim: ${gtm.proof.quotes_with_consent}`,
    `Pricing: ${gtm.pricing.display}. CTA: "${gtm.cta.label}" → ${gtm.cta.url}`,
    `Constraints: no fabricated statistics, no stock-photo faces, mobile-first,`,
    `dark-on-light, system fonts, one accent color: ${brand.accent}.`,
  ].join('\n');
}
```

**Marketing copy obeys the evidence invariant.** Every claim on the page cites the `ClaimLedger`;
testimonials require a `consent_captured` event (the 1:25 interviewees can grant it on-call —
[`14-elevenlabs-voice.md`](14-elevenlabs-voice.md)). An autonomous company that fabricates social
proof is a liability generator. This constraint is *in the brief*, and D08's review checks it.

### Execution paths

**Path A — API, if one exists** (unverified — confirm at hackathon): create project from brief,
poll build status, set custom domain, publish. Trivial to wrap in
`packages/integrations/lovable/client.ts`.

**Path B — Solari-driven session (**MVP** default, works regardless):** Lovable is a web app, and
Zeroth has hands ([`04-solari.md`](04-solari.md)).

```
D07 lovable worker
   │
   ├─ BrowserTask{class:'act', goal:'Create project from brief', start_url:'lovable.dev',
   │    identity:{persona:'company', vault_handle: lovable_account},   // created once via AccountCeremony
   │    guards:{domain_allowlist:['lovable.dev'], forbid:['purchase'],
   │            stop_on:['payment_wall','captcha','tos_accept']}}
   ├─ paste brief → generation runs (~2–5 min) → screenshot themed states
   ├─ iterate ≤3 prompt rounds against D08's checklist (below)
   ├─ publish to {venture}.lovable.app  (custom domain POST-MVP)
   └─ result URL + screenshots → PublicSurface artifact → GATE (public_content) → Linq card
```

### Review before the gate

D08's reviewer (a `sonnet` pass + screenshot look) checks, mechanically where possible:
headline matches `GTMPlan` verbatim; **zero unlisted claims** (extract every factual sentence, join
against the allowed set — any orphan fails the review); CTA resolves to the live product URL
(([`08-render.md`](08-render.md)) preview until promotion, swapped on production go-live); no
placeholder text; Lighthouse-basic sanity via a Solari read of the published page. Fail → one more
prompt round; still failing → ship the fallback template instead (below). The founder's
public-content gate card carries a full-page screenshot, not a link — they judge what a visitor sees.

### Events and analytics

`lovable.project_created`, `lovable.published {url}`, `gate.approved` → `gtm.surface_live`. The page
embeds the venture's analytics snippet + UTM-tagged CTA, so D08's funnel (`visit → cta_click →
checkout`) reads from the same event pipeline as everything else, and Whop/Stripe conversion
attributes back to the page variant ([`10-whop.md`](10-whop.md), [`03-stripe.md`](03-stripe.md)).

---

## User-facing experience

Founder-side: one Linq card — *"Your landing page is ready [full-page screenshot]. Publish at
handoff.lovable.app? yes/no"* — and later, funnel numbers in the digest. Customer-side: a real
landing page whose every sentence traces to something a real interviewee said, with a CTA into a
real checkout. The demo's split-screen at 2:25 (product deploying beside its own marketing site,
both from the same signed artifacts) is the visual proof of "product and GTM in one cycle."

---

## Why the use case is novel

Lovable's normal user is a person typing prompts. Ours is **a company compiling artifacts into
briefs**: the `GTMPlan` (positioning derived from real interviews) renders deterministically into
the Lovable prompt, marketing copy is evidence-gated by the same `ClaimLedger` rules as a
`NicheDossier`, review is mechanical, publishing is founder-gated, and the funnel feeds back into
the same event log that trained the copy. Lovable becomes the last compiler stage of a GTM
pipeline — and the honest split between "Lovable ships the story, Claude Code ships the product" is
itself a judgment most teams won't make.

---

## Sponsor-track criteria

| Criterion | Our answer |
|---|---|
| Real Lovable artifact | A published page, live during the demo, generated same-cycle as the app |
| Depth beyond prompting | Brief compiled from typed artifacts; evidence-gated copy; mechanical review; gated publish; funnel attribution |
| Judgment | An explicit, defensible routing rule for when Lovable is and isn't the right tool |
| The sentence | "Product and go-to-market shipped in the same cycle, from the same artifact." |

---

## Risks, costs, permissions, rate limits

| Item | Detail |
|---|---|
| Cost | Subscription/credit-based (unverified — confirm at hackathon). One project + ≤4 iterations per venture; account created once via `AccountCeremony`. Metered to D08's envelope as `opex:tools`. |
| No API | Fully mitigated: Path B is the default plan. Path A is an upgrade, not a dependency. |
| Generation variance | The ≤3-round iteration cap + template fallback bound the tail. A mediocre page that ships beats a perfect page that doesn't. |
| ToS / automation | A Solari-driven session on our own account doing what a user does. Confirm automated-use posture at the booth (unverified — confirm at hackathon); if disallowed, Path B is demoted to human-triggered and the template fallback becomes primary. |
| Claims risk | The evidence-gated-copy rule is the mitigation, and it is enforced by review, not by hope. |

---

## Fallback behavior when it is down

| Failure | Behavior |
|---|---|
| Lovable unavailable / generation stalls > 10 min | **Template fallback:** `packages/templates/landing` — a Next.js page rendered from the *same* `GTMPlan` fields, deployed to the venture's Render service in ~60s ([`08-render.md`](08-render.md)). Less pretty, same copy, same CTA, same analytics. `surface_provider: 'template'` on the artifact, chip in the Boardroom. |
| Publish succeeds, page broken | Solari post-publish read fails review → unpublish intent + template fallback. The public-content gate never opens on an unreviewed page. |
| Demo-day | The 2:25 split-screen uses the pre-generated page from rehearsal if live generation is slow; the *publish gate* fires live either way, because the gate is the beat. |

---

## Contribution to the general prize

Speed-to-market is half of what makes an autonomous company credible: judges see a company that
didn't just build a product, but **launched** it — positioning, page, funnel, checkout — inside one
demo, with the founder's total contribution being one "yes" on a gate card. And the discipline
(evidence-gated copy, tool-routing judgment, template fallback) reads as operational maturity, which
is what the general prize actually scores.

---

## Assumptions & open questions

- (unverified — confirm at hackathon) API existence and shape; pricing/credits; automated-use
  posture; custom-domain flow; generation latency distribution.
- Open: message-variant A/B via two Lovable projects + D05 panel pre-test — POST-MVP, only if Tier 1
  is rock-solid by T-6h (per the tier-discipline rule in [`00-sponsor-strategy.md`](00-sponsor-strategy.md)).
- Open: does the Lovable account live under the company persona or per-venture? Default: company
  persona, one account, projects per venture.

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`15-anthropic-claude.md`](15-anthropic-claude.md) (the other half of the build split) ·
[`04-solari.md`](04-solari.md) (the hands that drive Path B) ·
[`08-render.md`](08-render.md) (template fallback hosting) ·
[`10-whop.md`](10-whop.md) / [`03-stripe.md`](03-stripe.md) (where the CTA goes)
