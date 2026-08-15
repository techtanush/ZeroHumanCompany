# 05 — MVP Scope

The brutal hackathon-scope definition: what ships live in the demo, what is stubbed, what is
faked-but-honest, what is post-MVP, and the cut list ordered by what we drop first under time
pressure. When two docs disagree about whether something is in scope, this file wins.

> **The scoping principle:** the demo story is *idea → evidence → product → money → the company
> improving itself*. Anything that does not make one of those five beats land is post-MVP, no
> matter how architecturally satisfying it is. The full architecture exists so the MVP has
> somewhere to grow, not so the MVP has to build it.

Read alongside [`01-build-order.md`](01-build-order.md) (when each item is built),
[`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) (the fallback for everything
below the "live" line), and [`03-one-shot-prompt.md`](03-one-shot-prompt.md) §3 (the forbidden
list, which is this file's hard floor).

---

## 1. The four scope classes

Every capability in the architecture lands in exactly one class. The classes are behavioral, not
aspirational: they describe what a judge poking at the system would actually find.

| Class | Definition | Judge pokes it → |
|---|---|---|
| **SHIPS LIVE** | Real code, real LLM calls, runs on stage, can be re-run on judge input | It works again, differently |
| **STUBBED** | The interface and events exist and are exercised; the implementation is a mock driver returning fixture data with realistic latency | It "works" identically every time; the code honestly says `drivers/mock/` |
| **FAKED-BUT-HONEST** | Shown from a `captured`/`staged` recording, labeled with a provenance chip and said out loud, per [`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) §3 | The presenter already told them |
| **POST-MVP** | Not built. Schema exists in `packages/contracts` (schemas are cheap); zero implementation | Nothing to poke |

**The honesty invariant:** STUBBED and FAKED-BUT-HONEST are never presented as SHIPS LIVE. The
provenance chip system makes lying structurally harder than telling the truth.

---

## 2. Scope by capability

### 2.1 Platform kernel

| Capability | Class | Notes |
|---|---|---|
| Event store (append/read/subscribe, PG LISTEN/NOTIFY) | **SHIPS LIVE** | Load-bearing for everything; M0 |
| Kernel REST + SSE API | **SHIPS LIVE** | M0 |
| Projections/reducers (`ventures`, `artifacts`, `gates`, `meters`) | **SHIPS LIVE** | M0–M1 |
| Routing engine + `routing.yaml` | **SHIPS LIVE** | M1 |
| Gate engine (open/surface/decide/timeout) | **SHIPS LIVE** | M1. Gates are the human-in-the-loop story |
| Evidence enforcement at signing | **SHIPS LIVE** | Never cut, ever. The answer to the loudest judge question |
| Budget meter (reserve/record/degrade) | **SHIPS LIVE** | M1. The "company knows its costs" invariant |
| Budget **freeze + Treasury requisition** flow | STUBBED | Meter emits `budget.degraded`; the requisition round-trip is fixture-backed until M4 |
| Identity Vault (encrypted creds, scoped handles) | STUBBED | Env-var-backed lookup wearing the vault interface. Real encryption is post-MVP |
| `AccountCeremony` (company creates its own accounts) | **POST-MVP** | Pre-created accounts in `.env`, narrated as the ceremony. See [`07-source-control-and-github.md`](07-source-control-and-github.md) §3 |
| Idempotency (`processed_messages`) | **SHIPS LIVE** | Cheap, tested, prevents the ugliest live-demo bug class |
| Kill switch + `time_scale` | **SHIPS LIVE** | M7. Demo-operational, not decorative |

### 2.2 Departments

| Dept | Class | What actually runs |
|---|---|---|
| D01 Intake (Mode A parse) | **SHIPS LIVE** | Text box → `IdeaSeed` |
| D01 Mode B origination swarm | **POST-MVP** | Cold open uses the recording |
| D02 Office Hours | **SHIPS LIVE** | The always-live beat. Runs on the judge's idea |
| D03 Market Research | **SHIPS LIVE** (built) / FAKED-BUT-HONEST (on stage) | Real `web_search` workers exist and ran for `demo-1`; the stage shows the capture because 90 s of live searching is dead air |
| D04 Outreach & Discovery | FAKED-BUT-HONEST | The recorded call + staged claim extraction. Live telephony is the designated M2 cut |
| D05 Synthetic Population | **SHIPS LIVE** (cached) | simpop runs live against the pre-baked PUMS + cached poll responses; determinism makes live safe |
| D06 Pivot | **SHIPS LIVE** | Diff synthesis is cheap and impressive; gate approval on stage |
| D07 Build & QA | FAKED-BUT-HONEST on stage; **SHIPS LIVE** as evidence | The build ran for real (real repo, real deploy — judges click the URL). Re-running 10 min of build live doesn't fit 4:00 |
| D08 Strategy & GTM | STUBBED | `GTMPlan` fixture renders as a card; head prompt exists, not rehearsed |
| D09 Leads | STUBBED | Warm-pool fixture; live enrichment post-MVP |
| D10 Sales | FAKED-BUT-HONEST | The outreach email quoting CL-114 is captured; the Stripe charge it leads to is live |
| D11 Finance/Treasury | **SHIPS LIVE** (narrow) | Real Stripe test-mode webhook → revenue ring → one real reallocation event. Everything else in D11: stubbed |
| D11 HR / Terac requisition | STUBBED → **SHIPS LIVE** if M4 lands | Sponsor-track value is high; the mock is ready either way |
| D12 Support | **POST-MVP** | The designated milestone sacrifice per [`01-build-order.md`](01-build-order.md) §7. Shown from replay if M5 happens |
| D13 Chief of Staff | **SHIPS LIVE** | The finale: gap mining from seeded events, live manifest generation, hot registration. Shadow-mode comparison is the first internal cut |

### 2.3 Boardroom

| Capability | Class |
|---|---|
| Live SSE event log | **SHIPS LIVE** |
| Floor plan + room light-up + sprites | **SHIPS LIVE** |
| Artifact cards for the 6 demo-critical types (`SharpenedIdea`, `NicheDossier`, `SyntheticPanelResult`, `IdeaDiff`, `Deployment`, `CapabilityGap`) | **SHIPS LIVE** |
| Cards for every other artifact type | STUBBED — one generic `<ArtifactCard/>` renders any signed artifact as titled JSON sections |
| Evidence drawer | **SHIPS LIVE** |
| Gate cards (swipe/approve UI) | **SHIPS LIVE** |
| Revenue ring + budget bars | **SHIPS LIVE** |
| `?replay=demo-1` + per-beat fallback keys | **SHIPS LIVE** |
| Org-chart re-render, particle polish, sound | **POST-MVP** |

### 2.4 Integrations

Per the tier policy in [`../03-integrations/00-sponsor-strategy.md`](../03-integrations/00-sponsor-strategy.md)
and the 30-minute rule in [`02-speed-playbook.md`](02-speed-playbook.md) §6.4.

| Vendor | Class | The honest line |
|---|---|---|
| Anthropic (models) | **SHIPS LIVE** | The only integration with no mock fallback — without it there is no demo |
| Stripe (test mode) | **SHIPS LIVE** | Test mode, said out loud every time |
| Linq (approval cards) | **SHIPS LIVE**, Boardroom-approve fallback | |
| Terac (human requisition) | **SHIPS LIVE** if the venue key round-trips by `T+20`, else STUBBED | Host's track — try hard, cut honestly |
| Render (deploys) | **SHIPS LIVE** (used during build; the demo shows the resulting URL) | |
| Replay (QA recordings) | **SHIPS LIVE** during build; captured on stage | |
| Superserve (sandboxes) | STUBBED → live if trivially working | Local Docker driver is the equal-interface fallback |
| ElevenLabs (voice) | FAKED-BUT-HONEST | The staged call recording |
| Composio (OAuth tools) | STUBBED | Real driver only if D04 goes live, which it doesn't in MVP |
| Solari, Band, Whop, Dodo, Lovable, Pioneer, Apify | STUBBED or **POST-MVP** | Mock drivers exist (cheap); real drivers only as time allows, per-tool flip |

---

## 3. What "stubbed" must still do **MVP**

A stub that behaves differently from the real thing poisons every test against it. Stubs obey:

1. **Same interface, same Zod-validated payloads** as the real driver (tool-plane parity test,
   [`06-repo-layout.md`](06-repo-layout.md) §6).
2. **Realistic latency**: `setTimeout(real_p50)`, so timing bugs surface in dev, not on stage.
3. **Deterministic**: same input → same fixture response. No `Math.random()` in mocks.
4. **Metered**: mock calls still record to the budget meter with the real vendor's price card, so
   the cost numbers on the Boardroom are honest projections rather than zeros.
5. **Failable on demand**: every mock driver honors `ZEROTH_MOCK_FAIL=<tool>` to rehearse the
   failure contingencies in [`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) §6.

```ts
// packages/tool-plane/src/drivers/mock/stripe.ts — the pattern every mock follows
export const stripeMock: StripeDriver = {
  async createPaymentLink(input) {
    await simulateLatency('stripe.createPaymentLink');       // p50 = 420ms
    meter.record({ vendor: 'stripe', op: 'payment_link', usd: 0 });
    maybeFail('stripe');                                     // ZEROTH_MOCK_FAIL hook
    return PaymentLink.parse(fixture('vendors/stripe/payment-link.json', input));
  },
};
```

---

## 4. The cut list — ordered by what we drop first **MVP**

The single ordered list. When the clock forces a cut, cut from the top. Each row names the
trigger, what replaces the cut item, and what the demo loses. Rows below the double rule are
**never cut** — if the clock reaches them, the answer is the degraded 6-hour path in
[`01-build-order.md`](01-build-order.md) §10, not further cutting.

| # | Cut | Trigger | Replacement | Demo cost |
|---|---|---|---|---|
| 1 | Sprite walk animation, all polish below "legibility" | Any lane behind at its milestone gate | Room light-up only | Charm |
| 2 | D01 Mode B origination | Behind at `T+11` | Cold-open recording | 15 s of wow |
| 3 | Live outbound telephony (D04) | Behind at `T+18` — **pre-decided, effectively already cut** | The staged recorded call | None visible; the recording is indistinguishable on stage |
| 4 | D03 `money` + `niche` worker roles | Behind at `T+11` | `demand` + `supply` only, ≥3 dossiers | Fewer cards to swipe |
| 5 | Whop + Dodo rails | Behind at `T+25` | Stripe only | Two sponsor tracks |
| 6 | D09 cold ICP research | Behind at `T+25` | Warm pool from fixtures | None — warm is the better story |
| 7 | D12 Support entirely (all of M5) | `T+27` with M6 unstarted | Replay of the captured ticket flow | One beat becomes a recording |
| 8 | Voice-closer in D10 | Behind at `T+25` | Email sequencer capture | None on stage |
| 9 | Live Terac requisition | Key not round-tripping by `T+20` | Mock with the honest line, blocker handed to the sponsor engineer in person | Host-track points; mitigated by trying visibly |
| 10 | Superserve real driver | Fights for >30 min | Local Docker, same interface | A talking point, not a beat |
| 11 | D13 shadow-mode comparison | Behind at `T+31` | Gap → manifest → deploy chain without before/after replay | Finale loses one flourish, keeps its thesis |
| 12 | D08 GTM beyond positioning + pricing | Behind at `T+22` | Fixture `GTMPlan` card | Nothing — it was never a beat |
| 13 | Lovable marketing site | Behind at `T+22` | App deploy only | One URL in a slide |
| 14 | Live D07 build re-run capability | Behind at `T+22` | The already-captured build + its real repo/URL | Q&A can't trigger a fresh build |
| ═ | ═══════ NEVER CUT BELOW THIS LINE ═══════ | | | |
| — | Evidence enforcement | — | — | It IS the credibility |
| — | The SSE event log + replay harness | — | — | It IS the demo |
| — | Office Hours live on the judge's idea | — | — | Proves judgment |
| — | One Stripe test charge | — | — | Proves money |
| — | D13 gap → manifest → 14th room | — | — | Proves the thesis |
| — | The gate engine + one live approval | — | — | Proves the human stays in charge |

**Who calls the cuts:** one named human owns the clock (the speed checklist,
[`02-speed-playbook.md`](02-speed-playbook.md) §7). Cuts are called out loud, logged in
`BUILD-NOTES.md`, and never un-cut without the clock-owner's say.

---

## 5. Post-MVP backlog (deliberately not built) **POST-MVP**

Deferred with reasons, so nobody re-litigates them at 3am. Sequenced properly in
[`10-roadmap-and-milestones.md`](10-roadmap-and-milestones.md).

| Item | Why deferred | Earliest slot |
|---|---|---|
| Auth, orgs, roles, RLS | One founder, one browser. Anti-pattern §6.2–6.3 of the speed playbook | Month 1 |
| `AccountCeremony` (self-created accounts) | Vendor CAPTCHAs/2FA make it a research project; narration covers the story | Quarter 1 |
| Real Identity Vault (KMS-backed) | Env vars are fine for one venture and zero tenants | Month 1 |
| Multi-venture concurrency | `venture_id` columns make it a config change later, not a rewrite | Week 1 |
| D12 support loop in production | Needs real customers first | Week 1 |
| D01 Mode B origination | Needs trend-mining infra and taste | Month 1 |
| Second/third demo ventures | `demo-1` proves the machine; more seeds prove nothing new | Week 1 (cheap then) |
| Sandbox fleet autoscaling | One venue, one build at a time | Quarter 1 |
| Fine-tuned small models (Pioneer) for scoring | Haiku is good enough and zero setup | Quarter 1 |
| Self-serve founder onboarding | The product has one user until it doesn't | Quarter 1 |
| SOC2-shaped security posture | Ironically D14's job. Post-revenue | Quarter 1 |

---

## 6. Scope-freeze timeline **MVP**

Scope is not one decision; it is a series of narrowing gates synchronized to the milestone clock
in [`01-build-order.md`](01-build-order.md) §12. After each gate, items can move *down* the class
ladder (LIVE → STUBBED → FAKED → POST-MVP) but never up. Upgrading scope mid-build is how demos
break.

| Gate | Clock | What freezes | Decision maker |
|---|---|---|---|
| G0 | `T+0` | This file as written. All POST-MVP rows are final | pre-agreed |
| G1 | `T+11` (M1 gate) | D01–D03 stage classes; cut #2 and #4 decided | clock-owner |
| G2 | `T+18` (M2 gate) | D04/D05 stage classes; telephony cut confirmed (or the one upset: it worked easily, keep it) | clock-owner |
| G3 | `T+20` | Terac live/stubbed fork — the last vendor fork of the build | clock-owner + L4 |
| G4 | `T+25` (M4 gate) | Everything revenue: rails, Linq path, Treasury depth | clock-owner |
| G5 | `T+31` (feature stop) | **Total freeze.** The only permitted commits after G5 are M7 hardening, fixtures, and reverts | everyone |

The demote-only rule has one escape: an item already fully working, rehearsed once, and carrying
a tested fallback key may be *confirmed* live at a later gate than planned. Nothing gets built
new after its gate to earn that confirmation.

### Per-gate demotion checklist

```
At each gate, for every item still marked SHIPS LIVE:
□ Has it run green in the last 2 hours?
□ Does its fallback exist and load? (recording present, mock returns parseable fixture)
□ Is its operator key mapped and tested?
□ Would losing it break a never-cut row?           → if yes, it needs 2× rehearsal priority
Any unchecked box → demote one class now. Boxes do not get "fixed later".
```

---

## 7. What a judge can independently verify **MVP**

The MVP's credibility budget is spent here. Each row is something a skeptical judge can check
without our help, which is the difference between "demo" and "product".

| Verifiable | How they check | Backed by |
|---|---|---|
| The product exists | Click the deploy URL on their own phone | Real Render service, real DNS |
| The code exists | Open the GitHub repo, read commits, see distinct agent authors + work-order trailers | Real repo per [`07-source-control-and-github.md`](07-source-control-and-github.md) |
| The numbers are sourced | Click any number → evidence drawer → source URL | Evidence enforcement, SHIPS LIVE |
| The run happened when we said | Event log timestamps vs. our claims | Append-only event store |
| It works on *their* idea | Beat 2 re-run in Q&A | D02 SHIPS LIVE |
| The QA is real | Watch the Replay recording of the caught bug | Replay share URL |
| The costs are real | Meter panel per department | Budget meter, SHIPS LIVE |
| The new department is real | Read the D14 YAML generated on stage; watch a WorkOrder route to it | D13 SHIPS LIVE + hot registration |

What a judge **cannot** verify and we do not claim: that the recorded call was a stranger (it is
labeled `staged`), that revenue is real money (test mode, said aloud), that D12 support ran live
(replay, labeled).

---

## 8. Effort accounting **MVP**

Where the ~110 usable agent-hours ([`01-build-order.md`](01-build-order.md) §0) actually go under
this scope, so cut decisions have numbers attached.

| Scope class | Share of hours | Where |
|---|---|---|
| SHIPS LIVE | ~65% | Kernel + M1 slice + D05/D06/D11-narrow + D13 + Boardroom + replay harness |
| STUBBED | ~12% | Mock drivers, fixtures, parity tests — cheap by design, §3 rules keep them cheap |
| FAKED-BUT-HONEST | ~8% | Recordings, the staged call, capture tooling |
| Hardening (M7) | ~13% | Rehearsals, fallback keys, offline mode |
| POST-MVP | **0%** | The point of this file |

The tell that scope is drifting: STUBBED hours climbing above ~15%. A mock that takes more than
30 minutes is a real integration wearing a disguise — apply the 30-minute rule to your own mocks
too.

---

## 9. Scope arbitration protocol **MVP**

For the 3am argument this file exists to end.

1. Is it one of the five story beats, or load-bearing for one? If no → **POST-MVP**. Stop.
2. Does a mock driver + fixture make the beat land identically on stage? If yes → **STUBBED**.
3. Does a labeled recording make it land at 90% for 1% of the effort? If yes → **FAKED-BUT-HONEST**.
4. Only what survives all three questions **SHIPS LIVE** — and it must then also appear in the
   never-cut list or carry a numbered row in the §4 cut list. Live-with-no-fallback is not a
   permitted state (per [`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) §1).

Disputes: the clock-owner decides in under two minutes, records one line in `BUILD-NOTES.md`,
and the build moves. A scope argument that outlives two minutes has already cost more than
either answer.

### Worked examples (real arguments this protocol has already settled)

| Proposal | Q1 story beat? | Q2 mock lands it? | Q3 recording at 90%? | Verdict |
|---|---|---|---|---|
| "Let's do live telephony, it's so cool" | Yes (evidence beat) | No — the *call* is the point | **Yes** — a recorded call is indistinguishable on stage | FAKED-BUT-HONEST. Pre-decided; see cut #3 |
| "Boardroom needs dark/light theme toggle" | No | — | — | POST-MVP. Ten seconds, next |
| "D13 should shadow-test D14 live" | Load-bearing for beat 7? No — the chain lands without it | Partially | Yes | SHIPS LIVE while ahead of clock, first internal cut (#11) when behind |
| "Real Superserve fork for the shadow test" | No (see previous row) | Yes — local Docker, same interface | — | STUBBED |
| "Multi-currency pricing in the venture product" | No | — | — | POST-MVP. D07's stack matrix already picked the rail |
| "A second seeded venture for variety" | No — `demo-1` carries all five beats | — | — | POST-MVP (Week 1 backlog) |

The pattern to notice: almost everything fails at Q1. That is the question doing the work, and it
is why the five beats are written at the top of this file.

---

## 10. MVP definition-of-done, per capability **MVP**

The scope class only says *how* something ships; this table says *when it counts as shipped*.
One line per SHIPS-LIVE item, checkable by anyone, no interpretation allowed. These duplicate the
milestone acceptance tests in [`01-build-order.md`](01-build-order.md) on purpose — this is the
flat view for the scope-gate reviews in §6.

| Item | Done when |
|---|---|
| Event store | Duplicate delivery test green; kill-and-restart resumes from last event |
| Kernel API | Posted event visible on SSE stream without refresh |
| Routing engine | `artifact.signed(SharpenedIdea)` enqueues a D03 `WorkOrder` with no code change, only `routing.yaml` |
| Gate engine | `niche_selection` blocks, decision emits `gate.approved`, timeout path tested once |
| Evidence enforcement | Deleting a `source_id` from a fixture artifact makes signing fail loudly, in a committed test |
| Budget meter | The M1 acceptance run reports total spend within $0.10 of the Anthropic console figure |
| D01 Mode A | Any one-sentence idea produces a parseable `IdeaSeed` in <20 s |
| D02 Office Hours | Three consecutive novel ideas each produce a `SharpenedIdea` with non-generic `kill_criteria`, judged by a human read |
| D05 simpop | Same seed twice → byte-identical JSON, diffed in CI |
| D06 Pivot | Approving 2 of 3 diffs yields `ProductSpec v2` containing exactly those 2 |
| D11 revenue slice | Test-mode charge → webhook → `money.revenue_received` → ring animates, end to end in <15 s |
| D13 finale | From seeded losses to a Zod-valid `D14` manifest with ≤1 repair loop, three runs out of three on demo day's prompt |
| Hot registration | 14th room renders and routes a real `WorkOrder` with zero process restarts |
| Boardroom cards | The 6 demo-critical types render from fixtures with no console errors at 16:9 and 16:10 |
| Replay harness | Wifi off, full `demo-1` story plays, every beat marker jump lands |
| Reset script | Two consecutive runs both print the go/no-go line in <30 s |
| Fallback keys | Each of F1–F8 forced once in R1 and the recording appeared in-place |

A SHIPS-LIVE item that cannot state a one-line done condition of this kind is not actually
scoped — it is a wish, and wishes get demoted at the next gate.

---

## Assumptions & open questions

- **Assumed:** D03 runs live during the *build* (its output is `demo-1`'s captured research) even
  though the stage shows the capture. If M1 slips, D03 falls back to a smaller worker set per cut
  #4 before its stage class changes.
- **Assumed:** Terac's live/stubbed fork resolves by `T+20`; both branches are fully prepared and
  the demo script is identical except for one provenance chip.
- **Open:** whether D05 stays SHIPS-LIVE with *live* LLM polling or ships with the SQLite response
  cache warm (byte-identical either way by design). Current answer: cached — determinism on stage
  beats purity, and the cache **is** the simit feature being demonstrated.
- **Open:** if the hackathon format grants more than 4:00, beat 5 upgrades to a live incremental
  build (one small feature, one commit, one deploy). Pre-scripted but unscheduled; decide at R1.
- **Open:** exact judge-interaction rules (beat 2 depends on being allowed to take an idea from
  the room). Fallback is the backup idea; see
  [`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) §6.
