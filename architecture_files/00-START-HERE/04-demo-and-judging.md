# 04 — Demo Script & Judging Strategy

Two goals, in priority order: **(1) the general prize**, **(2) as many sponsor tracks as we can
win without diluting the story.** The rule for sponsor usage: *every integration must be load-bearing
in the demo narrative.* A logo on a slide wins nothing.

---

## The 4-minute demo

Rehearse to the second. Everything slow is pre-warmed; everything live is chosen because it
*cannot* be faked and that's the point.

| t | Beat | What's on screen | Why it lands |
|---|---|---|---|
| 0:00 | **Cold open — Mode B.** "We didn't give it an idea." | Boardroom, origination swarm streaming, 5 candidates appear with scores | Establishes autonomy in 15 seconds |
| 0:20 | **Judge's idea.** Take a real idea from the audience/judge, drop it in. | Office Hours starts grilling it live | Un-fakeable |
| 0:45 | **The grill.** Show 3 real questions and the sharpened output. | `SharpenedIdea` card, kill-criteria visible | Shows judgment, not generation |
| 1:00 | **Market research swarm.** | Floor plan lights up, 10 agents, sources streaming in, then 6 `NicheDossier` cards with real cited MRR ranges | Density + citations = credibility |
| 1:25 | **Validation, both blades.** Play 12 seconds of an actual recorded discovery call in the founder's cloned voice. Then flip to the Census panel. | Waveform + transcript claims; then pixel-art population grid, archetype bars, "68% of Segment 3 would pay $29" with PUMS weights | The emotional peak. A real call, and a simulated city. |
| 1:50 | **Terac moment.** Company hits a wall it can't cross ("we need 5 verified ER nurses by tomorrow"). HR files a requisition and **hires real humans through Terac, with the company's own money.** | Requisition card → Terac API response → hired panel | This is the host's thesis, executed literally |
| 2:10 | **Pivot review.** Three diffs with quotes attached. Founder taps approve on their phone (Linq). | Phone mirrored on screen, rich iMessage card | Human-in-the-loop is *one tap*, not a dashboard crawl |
| 2:25 | **Build.** Claude Code in a Superserve sandbox, real repo the company made itself, Render deploy, Replay-recorded QA catching one real bug and fixing it. | Live logs → deployed URL opens | Proves it ships |
| 2:55 | **Sales → Stripe.** Reaches back to a person from the *interviews* with their own quote in the email. Deal → payment link → **live Stripe charge**. Revenue counter ticks from $0. | Boardroom revenue ring completes | Money on stage |
| 3:15 | **Finance/HR reallocates.** Treasury moves budget to Sales because pipeline converted; Build gets throttled. | Budget bars re-animate | It manages itself |
| 3:30 | **The finale — self-improvement.** Chief of Staff: "We lost 3 deals at security review. We have no capability for that." It writes a new department, tests it in shadow mode, deploys it. A **new room appears on the floor plan.** | New sprite walks into a new room | The company grew an organ, live |
| 3:55 | Land it: "No human was on the critical path. When it needed one, it hired one." | | |

**Fallback plan:** every live step has a recorded artifact from a pre-run venture, loadable via
`?replay=demo-1`. Never let a network hiccup eat the story. See `04-execution/04-demo-seed.md`.

---

## Sponsor strategy — which we use, and the creative angle

### Tier 1 — load-bearing, pursue the track hard

**Terac (host).** *Angle: the company's HR department has a hiring API.*
Not "we used Terac to get survey responses." Instead: **Terac is the last rung of the escalation
ladder for the entire company.** Any department, when blocked by a genuinely
human-only task, files a `HumanWorkRequisition`; HR evaluates ROI against budget, then sources,
screens, hires, and pays a verified human via Terac — and the human's output flows back into the
same artifact pipeline as any agent's. We show three distinct use cases live: (1) ICP interview
panel where the founder's network runs dry, (2) expert verification of a domain claim the company
isn't confident about, (3) a task no agent can do at all. **The pitch: we didn't integrate Terac,
we built the company that needs Terac.** → [`../03-integrations/01-terac.md`](../03-integrations/01-terac.md)

**Band.** *Angle: departments as rooms, not function calls.*
Band's Agentic Mesh is our inter-department nervous system — Sales and Finance share a persistent
Band room and negotiate ("this invoice is 6 days late" / "I'll nudge them, they asked about
annual"). Cross-framework matters: our Claude Agent SDK swarms, the Claude Code build agent, and
the Rust sim-pop service all appear as peers on one mesh. Fallback bus exists and is documented,
per the brief. → [`../03-integrations/02-band.md`](../03-integrations/02-band.md)

**Stripe.** *Angle: an autonomous P&L, not a checkout button.*
Stripe is where the company's *revenue* and *costs* meet. Payment Links + Checkout for deals,
webhooks into the Finance ledger, subscription state driving Support priority, and — the good part
— **Treasury reads real Stripe revenue and reallocates department budgets from it.** The company
funds its own R&D out of MRR. → [`../03-integrations/03-stripe.md`](../03-integrations/03-stripe.md)

**Solari (Pinetree Research).** *Angle: the hands.*
Everything without an API. The company creates its own GitHub org, Gmail, and social accounts,
signs up for tools mid-run when a department needs one, pulls competitor pricing from
JS-heavy pages, and files things in portals — via Solari's agentic browser. Paired with our
`AccountCeremony` protocol which texts the founder over Linq exactly at the 2FA/ToS moment and
resumes. → [`../03-integrations/04-solari.md`](../03-integrations/04-solari.md)

**Superserve.** *Angle: departments are pausable microVMs.*
Every department runs in a durable Firecracker sandbox that can pause between cycles and resume
with state intact — which is *exactly* what a company that runs for months needs. We fork sandboxes
to run the pivot A/B ("what if we'd narrowed the ICP instead?") and to run D13's shadow tests
against a snapshot of the live company. → [`../03-integrations/05-superserve.md`](../03-integrations/05-superserve.md)

**Linq.** *Angle: the founder's entire interface is iMessage.*
Rich, interactive iMessage cards for every approval gate: swipeable niche cards, a pivot diff with
Approve/Reject/Ask, budget reallocation confirmations, and the account-creation ceremony ("tap to
enter the 2FA code"). Plus Linq for outbound in Sales. The demo line: *"the founder never opens a
laptop."* → [`../03-integrations/06-linq.md`](../03-integrations/06-linq.md)

**Replay.** *Angle: QA that a non-engineer founder can act on.*
Every QA run is a Replay recording. When QA fails, the build agent gets a time-travel recording
instead of a stack trace, and the *founder* gets a shareable link showing the bug happening.
→ [`../03-integrations/07-replay.md`](../03-integrations/07-replay.md)

**Render.** *Angle: the company's own infrastructure account.*
The built product deploys to Render; so does Zeroth itself. Preview environments per pivot branch.
→ [`../03-integrations/08-render.md`](../03-integrations/08-render.md)

### Tier 2 — use if time allows, real but secondary

- **Lovable** — D07 spins the *marketing site* while the app is being built, so launch is same-day.
  → [`../03-integrations/09-lovable.md`](../03-integrations/09-lovable.md)
- **Whop** — distribution: for consumer/community ventures, the company lists and sells the product
  on Whop instead of building billing. A second revenue rail.
  → [`../03-integrations/10-whop.md`](../03-integrations/10-whop.md)
- **Dodo Payments** — merchant-of-record fallback for international/no-entity founders. The
  Treasury picks a rail based on the venture's geography. → [`../03-integrations/11-dodo-payments.md`](../03-integrations/11-dodo-payments.md)
- **Pioneer (Fastino)** — fine-tune a small model on our own accumulated labels (lead scoring,
  claim-strength classification, ticket triage) so the *high-volume, low-judgment* calls get cheap
  and fast, and improve as the company runs. Adaptive inference = the company's classifiers get
  better with every venture. → [`../03-integrations/12-pioneer-fastino.md`](../03-integrations/12-pioneer-fastino.md)

### Not used
Interview Cake, Nucleate, sandbox0 (superseded by Superserve for our use case). Don't force them.

---

## Judging rubric — how we answer the obvious attacks

| Likely judge question | Our answer, and where it's built |
|---|---|
| "Is this actually autonomous or a demo script?" | Kill switch + autonomy dial. Show the event log: every decision has an agent id, a rationale, and a cost. `01-platform/10-observability.md` |
| "Are those market numbers hallucinated?" | Every number has a `source_id` and a confidence. Click it, see the source. Uncited numbers are blocked at artifact-signing. `01-platform/11-evidence-and-truth.md` |
| "Isn't the voice calling sketchy?" | Consent-first: disclosure at call open, opt-out honored, recording consent captured, DNC list enforced. `01-platform/12-safety-and-compliance.md` |
| "What happens when it fails?" | The escalation ladder — and the last rung is hiring a human. That *is* the product. |
| "Why not just one big agent?" | Budgets, tool isolation, parallelism, and the ability to grow a new department at runtime. |
