# 00 — Sponsor Strategy

The master table. One rule, restated from [`../00-vision/04-demo-and-judging.md`](../00-vision/04-demo-and-judging.md):
**every integration must be load-bearing in the demo narrative.** If we could delete a vendor and the
story still works, we are not entering that track.

This file is the index for `03-integrations/`. Each row links to its spec.

---

## Tiers, defined

| Tier | Meaning | Consequence |
|---|---|---|
| **1** | The demo *breaks* without it. Pursue the track hard. | Real API call on stage, plus a recorded fallback. |
| **2** | Real, working, but the story survives its absence. | Built if time allows; shown in ≤1 demo beat. |
| **not-used** | Honest no. | We say why, out loud, if asked. |

---

## The master table

| Vendor | Tier | Creative angle (one line) | Departments | Demo second | Track-winning sentence | Fallback if API is down |
|---|---|---|---|---|---|---|
| **[Terac](01-terac.md)** (host) | **1** | The last rung of the company's escalation ladder — HR converts any department's block into a *real, paid human hire*. | D11/HR (owner), D04, D03, D07, D12 file requisitions | **1:50** | "We didn't integrate Terac — we built the company that *needs* Terac." | Pre-run requisition + matched panel replayed from `?replay=demo-1`; requisition card still renders live. |
| **[Band](02-band.md)** | **1** | Departments are mesh peers in persistent rooms, and **agent discovery is how D13's new department becomes reachable without a redeploy.** | All 13; rooms owned by D10↔D11, D12↔D07, D03↔D06, D11/HR↔all, D13↔all | **3:30** (and ambient from 1:00) | "The org chart is a running mesh — when the company grew an organ at 3:30, nothing was redeployed." | Postgres `LISTEN/NOTIFY` + BullMQ driver behind the same `Bus` interface; `bus.degraded` chip shows in the Boardroom. |
| **[Stripe](03-stripe.md)** | **1** | An autonomous P&L: **Treasury reads real revenue and reallocates department budgets from it.** | D10 (collect), D11 (ledger + treasury), D12 (dunning/disputes) | **2:55 → 3:15** | "The company funded its own R&D out of its own MRR, on stage, in four minutes." | Test-mode is already the demo path; if the API is unreachable, replay the webhook payloads from seed into the same reducer. |
| **[Solari](04-solari.md)** (Pinetree) | **1** | The company's **hands** — everything with no API: it creates its own GitHub org, signs up for tools mid-run, scrapes JS-heavy pricing pages. | D07, D03, D09, Identity service (all departments via it) | **2:25** (repo/account creation), **1:00** (pricing pull) | "It opened its own accounts. We never typed a password for it — and when a CAPTCHA appeared, it texted the founder." | Playwright driver behind the same `BrowserTask` interface + cached page snapshots for the pricing pull. |
| **[Superserve](05-superserve.md)** | **1** | Departments are **pausable microVMs** — and we *fork* them for D06 counterfactual pivots and D13 shadow tests. | All 13; fork used by D06, D13 | **2:10** (fork/pivot), **2:25** (build sandbox), **3:30** (shadow test) | "A company that runs for months needs resume-with-state. Ours pauses between cycles and forks to ask 'what if we'd done the other thing?'" | Local Docker driver implementing the same `packages/sandbox` interface; `fork` degrades to snapshot-copy of the volume. |
| **[Linq](06-linq.md)** | **1** | **The founder never opens a laptop** — every approval gate is a rich interactive iMessage card. | D13 (gate owner), D04, D06, D08, D10, D11 | **2:10** (pivot approve), **1:50**/**2:25** (ceremony), **2:55** (deal closed) | "The entire human-in-the-loop surface is one thumb, in iMessage." | Boardroom in-app approval card + email; `gate.on_timeout` policy still applies. Demo shows the phone mirror either way. |
| **[Replay](07-replay.md)** | **1** | QA a non-engineer founder can act on — failures come back as a **time-travel recording**, not a stack trace. | D07 (qa), D12 (bug repro) | **2:25** | "The build agent debugged its own product by replaying it — and the founder got a link showing the bug happen." | Playwright trace + video recording, same `qa_runs` row shape, `recording_provider: 'playwright'`. |
| **[Render](08-render.md)** | **1** | The company's **own infrastructure account** — Zeroth runs here, and D07 creates services for each venture via the Render API under that same account. | D07, D13, D11 (cost accounting) | **2:25** (deploy URL opens live) | "The company has an infra account and provisions production for the products it invents." | Pre-provisioned service + `render deploy` from a warm branch; worst case, the venture runs on the demo box behind a tunnel. |
| **[Lovable](09-lovable.md)** | 2 | The marketing site ships **the same hour** as the app, generated from the `GTMPlan` positioning. | D07, D08 | **2:25** (split-screen with the app) | "Product and go-to-market shipped in the same cycle, from the same artifact." | Next.js landing template rendered from the same `GTMPlan` fields. |
| **[Whop](10-whop.md)** | **1** | Distribution *and* a second revenue rail — plus Whop mined as a **market-signal source** for D03 (what actually sells here, at what price). | D03 (signal), D07 (listing), D10, D11 (rail choice + ledger) | **1:00** (signal in a `NicheDossier`), **2:55** (rail choice shown) | "For consumer ventures the company doesn't build billing — it lists on Whop, and it read Whop to price itself in the first place." | Cached category listing snapshot for the D03 signal; Stripe rail for the sale. |
| **[Dodo Payments](11-dodo-payments.md)** | 2 | Merchant-of-record rail for international ventures / founders with no US entity — **Treasury picks the rail**. | D11 (rail choice), D10, D07 | **2:55** (rail decision visible, one line) | "The company picks its own payment rail based on where the founder and buyers actually are, and knows what MoR means for its ledger." | Stripe rail; the `PaymentRail` decision record still shows Dodo as the evaluated option. |
| **[Pioneer (Fastino)](12-pioneer-fastino.md)** | 2 | **The company's classifiers get better every venture** — three fine-tunes trained on our own event log, adaptive inference on live traffic. | D09 (ICP fit), D04 (claim strength), D12 (triage) | **3:15** (cost panel shows `pioneer:*` cheaper than `haiku`) | "The high-volume, low-judgment calls got 20× cheaper and *more* accurate the longer the company ran." | `haiku` fallback is already in the model tier table (`../01-platform/02-agent-runtime.md`); zero behavioral change. |
| **[Composio](13-composio.md)** | 1 (infra) | Managed OAuth so the company can act *as the venture* in Gmail/LinkedIn/Calendar/GitHub — not a sponsor track, but load-bearing. | D04, D09, D10, D12, D07 | ambient (1:25, 2:55) | n/a — infrastructure. | Direct per-vendor OAuth for Gmail + GitHub only; LinkedIn degrades to Solari. |
| **[ElevenLabs + telephony](14-elevenlabs-voice.md)** | 1 (infra) | The founder's **cloned voice** places real discovery and sales calls, with disclosure at open. | D04, D10 | **1:25** (the emotional peak) | n/a — infrastructure, but it *is* the demo's emotional peak. | Generic neutral voice; if telephony fails, play the pre-recorded call and say so. |
| **[Anthropic Claude](15-anthropic-claude.md)** | 1 (infra) | Every department agent is a Claude Agent SDK session; D07 runs **headless Claude Code** on a real git repo inside a Superserve sandbox. | All 13 | **2:25** (Claude Code logs streaming) | n/a — infrastructure. | Model tier downgrade + `replay(work_order_id)` with cached tool responses. |
| **Interview Cake** | **not-used** | — | — | — | — | — |
| **Nucleate** | **not-used** | — | — | — | — | — |
| **sandbox0** | **not-used** | — | — | — | — | — |

---

## The honest "no" list

We would rather win four tracks convincingly than gesture at fifteen. Three sponsors get a clean no:

| Vendor | Why not |
|---|---|
| **Interview Cake** | Technical-interview practice for *humans learning to code*. Zeroth's hiring path is Terac, and what it hires for is domain expertise and human-only labor, not engineering candidates it would interview. There is no non-contrived seam. Forcing it would mean inventing a fake "the company interviews engineers" beat that contradicts the entire thesis — the company writes its own engineers (D13). |
| **Nucleate** | Biotech/life-sciences founder community and ecosystem programming, not an API surface. Our demo venture is not a bio venture, and a bio venture inside a 4-minute autonomous demo would raise regulatory questions we cannot answer honestly on stage. If a judge asks: *"we'd use Nucleate as a D09 lead source for a bio venture, but we don't have one, and we're not going to pretend."* |
| **sandbox0** | Genuinely overlapping with **Superserve**, and Superserve wins on the one axis our architecture depends on: **indefinite pause + instant resume + fork**. A company that runs for months is defined by resume-with-state; forking is what makes D06 counterfactuals and D13 shadow-testing possible at all. Running both would mean two sandbox drivers and a split story for zero narrative gain. Our `packages/sandbox` interface is driver-shaped precisely so this is a swap, not a rewrite — see [`05-superserve.md`](05-superserve.md). |

> If a sponsor rep asks at the booth, the answer is the table above, said plainly. "We didn't use it, here's
> the seam we looked for, here's why it wasn't there" beats a logo on a slide every time.

---

## Demo timeline, by vendor

Cross-reference for the rehearsal. Read alongside the beat table in [`../00-vision/04-demo-and-judging.md`](../00-vision/04-demo-and-judging.md).

```
0:00 ──────────────────────────────────────────────────────────── 4:00
 │Claude────────────────────────────────────────────────────────────│  (continuous)
 │Band ─────────────────────────────────────────────────────────────│  (continuous, chip visible)
 │Superserve ───────────────────────────────────────────────────────│  (continuous, fork @2:10, @3:30)
      1:00 Solari (pricing) + Whop (signal)
           1:25 ElevenLabs + Composio (calls, calendar)
                1:50 ████ TERAC ████
                     2:10 Linq (pivot card) + Superserve fork
                          2:25 Solari (accounts) · Claude Code · Render · Replay · Lovable
                                    2:55 Stripe ██ + Whop/Dodo rail decision
                                         3:15 Pioneer (cost panel) + Stripe→Treasury
                                              3:30 Band discovery (new department)
```

---

## Risk register

| Risk | Blast radius | Mitigation |
|---|---|---|
| A Tier-1 vendor's sandbox/API is rate-limited or down on the day | One demo beat | Every Tier-1 has a named fallback driver *behind the same interface* (see each spec's "Failure modes and fallback"). Nothing in the kernel knows which driver it got. |
| A vendor requires a sales call to get API access | Whole track | **Get keys at the booth on day one.** Each spec ends with a `> VERIFY AT HACKATHON:` block naming exactly what to ask for. |
| Doc drift — we specced an endpoint that doesn't exist | Credibility | Anything unverified is marked `> ASSUMPTION:` inline. We never present an assumed endpoint as fact, on stage or in code comments. |
| Too many integrations, none deep | The general prize | Tier discipline. Tier 2 gets cut *first* and without ceremony if Tier 1 isn't rock solid at T-6h. |

---

## Reading order for a builder agent

1. [`01-terac.md`](01-terac.md) — the thesis. Build this first; it is the host's track and the demo's spine.
2. [`02-band.md`](02-band.md) + [`05-superserve.md`](05-superserve.md) — the substrate everything else sits on.
3. [`15-anthropic-claude.md`](15-anthropic-claude.md) — how any agent runs at all.
4. [`03-stripe.md`](03-stripe.md) + [`06-linq.md`](06-linq.md) — money out and human in.
5. Everything else, in file order.
