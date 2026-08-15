# 02 — The End-to-End Journey

The canonical flow. Every department spec in `02-departments/` implements one scene here.
Scene numbers map 1:1 to department numbers (`D01`…`D12`).

---

## Scene 0 — Arrival

Founder lands on the Zeroth entry page. Two doors:

- **"I have an idea"** → free-text box, voice recorder, file dropzone (pdf/docx/md/png/figma link).
- **"Find me one"** → autonomous origination.

Output: `Venture` row created, `venture.mode`, `venture.autonomy_level` set. Founder identity
captured (phone for Linq, email, optional LinkedIn/Gmail OAuth via Composio).

→ **D01 Intake** ([`../02-departments/D01-intake.md`](../02-departments/D01-intake.md))

---

## Scene 1 — Origination (Mode B only)

A swarm reads the live internet for pain: Reddit complaint clusters, G2 1-star reviews, job
postings that reveal broken internal process, App Store review sentiment, regulatory diffs.
It produces 5 `OpportunityCandidate`s with a scored thesis, then picks one — or asks the founder
to pick, if `autonomy_level != autonomous`.

→ **D01 Intake / Origination Swarm**

---

## Scene 2 — Office Hours (the grilling)

The idea meets a hostile, competent partner. Ported from the local **gstack `office-hours`** skill
(`~/.claude/skills/gstack/office-hours/`), which is a YC-partner-style interrogation. It asks the
questions founders dodge: who exactly is the user, what do they do today instead, what would have
to be true, what's the smallest version, why now, why you.

Ends with a **`SharpenedIdea`** artifact: one-sentence description, ICP, the specific pain, the
wedge, the "what would have to be true" list, and a *kill criteria* list.

The founder can be in the room (typed answers) or absent (agent answers from intake material and
flags every assumption it had to invent as `assumption: unverified`).

→ **D02 Office Hours** ([`../02-departments/D02-office-hours.md`](../02-departments/D02-office-hours.md))

---

## Scene 3 — Market Research

Parallel swarms — each with a different lens — go find where the money actually is:

- **Demand swarm**: search volume, forum velocity, "how do I" queries, Apify scrapes.
- **Supply swarm**: incumbents, pricing pages, funding, feature gaps, G2/Capterra positioning.
- **Money swarm**: comparable public/private ARR, ACV benchmarks, CAC/LTV priors by category.
- **Niche swarm**: slices the market into 6–10 concrete niches (industry × company size × geography
  × trigger event) and scores each.

Output: a ranked list of **`NicheDossier`s**, each with cited TAM/SAM/SOM, realistic MRR@12mo,
pricing hypothesis, top 3 competitors, wedge, pros/cons, confidence, and a full source list.
Founder (or the company, if autonomous) selects one.

→ **D03 Market Research** ([`../02-departments/D03-market-research.md`](../02-departments/D03-market-research.md))

---

## Scene 4 — Validation: talk to humans, simulate the rest

Two blades running in parallel.

### Blade A — Real humans
Connects LinkedIn + Gmail + calendar via Composio. Mines the founder's *own* first- and
second-degree network for people who match the ICP. Writes outreach that references a real shared
context. Books calls. **Joins those calls with the founder's ElevenLabs-cloned voice** and runs a
structured discovery interview (Mom-Test-compliant: past behavior, not future intent). Transcribes,
extracts claims, tags each claim with strength and who said it.

Where the network runs out: **Terac** panels. Requisition N verified experts matching the ICP,
AI-moderated screening, run the same interview, pay them. Real humans, on tap, hired by the agent.

### Blade B — Synthetic population (the `simit` blade)
For anything you can't reach in 24 hours, simulate it. Adapted from
[`Mahin2076/simit`](https://github.com/Mahin2076/simit) (sim-francisco): ACS PUMS Census microdata →
~12 demographic archetypes per region via clustering → one batched LLM call per archetype →
post-stratify with Census person-weights (`PWGTP`). Gives a *population-representative* read on
"would this segment pay for this," reproducible via deterministic seeding, and honest about being
a model.

The two blades cross-check: real interviews **calibrate** the synthetic panel, and disagreement
between them is itself a finding the company reports.

→ **D04 Outreach & Validation** ([`../02-departments/D04-outreach-validation.md`](../02-departments/D04-outreach-validation.md))
→ **D05 Synthetic Population** ([`../02-departments/D05-synthetic-population.md`](../02-departments/D05-synthetic-population.md))

---

## Scene 5 — The Pivot Review

The company comes back to the founder with what it heard. Not a summary — a **decision packet**:

- what was confirmed, what was contradicted, what surprised us,
- the verbatim quotes that moved the needle (with speaker + timestamp),
- proposed **diffs to the idea**: `ADD feature`, `CUT feature`, `NARROW ICP`, `REPRICE`, `PIVOT`,
- each diff carries: evidence, cost, reversibility, and what would have to be true to reject it.

Founder approves per-diff. Approved diffs rewrite the `SharpenedIdea` into `ProductSpec v2`.

→ **D06 Pivot & Decision** ([`../02-departments/D06-pivot-decision.md`](../02-departments/D06-pivot-decision.md))

---

## Scene 6 — Build

`ProductSpec v2` → a real, deployed product.

Claude Code runs headless via the Anthropic API inside a **Superserve** sandbox with a real git
repo, pushes to a GitHub org **the company created for itself**, and deploys to **Render**.
Agents: Architect → 2–4 parallel Implementers (own separate worktrees) → Integrator → QA.
QA is **Replay**-recorded so every failure is a time-travel debuggable recording, not a log line.
Marketing site can be shot out of **Lovable** in parallel.

→ **D07 Build** ([`../02-departments/D07-build.md`](../02-departments/D07-build.md))

---

## Scene 7 — Strategy

Now that the product is real, a strategy swarm reads the *entire* venture history — office hours
transcript, niche dossier, every call, the actual shipped feature set — and produces the GTM:
positioning, ICP tiers, channel bets ranked by expected CAC, pricing & packaging, objection
handling, the 90-day plan, and the messaging matrix that Sales will actually use.

→ **D08 Strategy** ([`../02-departments/D08-strategy.md`](../02-departments/D08-strategy.md))

---

## Scene 8 — Leads

Two pools:
- **Warm**: everyone from Scene 4 who was interviewed. They already know the product — and it was
  partly *their* feedback. That's the highest-converting list on earth.
- **Cold**: deep-research agents build ICP-matched lists — B2B via firmographic + trigger-event
  search, B2C via community/social surface mining — enriched, deduped, scored, and consented.

→ **D09 Leads** ([`../02-departments/D09-leads.md`](../02-departments/D09-leads.md))

---

## Scene 9 — Sales

Multi-channel, context-rich, and *never cold to a warm lead*: "You told me on March 3rd that
approvals were your worst hour of the week. We built that. Here's a 90-second demo."
Email + Linq iMessage rich cards + booked calls (voice agent again). Objections logged back to
Strategy. Deals move on a real pipeline.

→ **D10 Sales** ([`../02-departments/D10-sales.md`](../02-departments/D10-sales.md))

---

## Scene 10 — Money: Finance + HR

**Stripe** issues the payment link / checkout, handles subscriptions, and webhooks back.
**Finance** reconciles: expected vs received, dunning, refunds, revenue recognition, runway.
Finance and Sales talk continuously — Sales tells Finance a deal closed; Finance tells Sales an
invoice is 6 days late and drafts the nudge.

**HR (a sub-department of Finance)** is the resource allocator: it reads spend per department,
marginal value per dollar, and reallocates the budget every cycle — "Build gets $20 of the $30
because it's shipping; Research gets throttled to $4; Sales gets $6 because pipeline is thin."
And when a department files a `HumanWorkRequisition` because no agent can do the thing —
**HR calls Terac** and hires a person.

→ **D11 Finance & HR** ([`../02-departments/D11-finance-hr.md`](../02-departments/D11-finance-hr.md))

---

## Scene 11 — Customer Support

Monitors the support inbox, in-app reports, and Stripe dispute events. Resolves what it can from
the product's own source code and docs (it has repo access — it can read the bug). Escalates the
rest, and files every recurring complaint as a `ProductSignal` back to D06/D07. Cross-department
coordination runs over **Band** rooms.

→ **D12 Customer Support** ([`../02-departments/D12-support.md`](../02-departments/D12-support.md))

---

## Scene 12 — The Chief of Staff (self-improvement)

Daily / weekly / monthly / quarterly, an agent reads the company's own telemetry and asks:
**where are we underperforming because of a missing capability?**

Not "we need to try harder" — "Sales loses 40% of deals at the security-review step and we have no
agent that can fill out a SOC 2 questionnaire." It then writes a **CapabilityGap**, designs a new
agent or department, has D07 build and test it, runs it shadow-mode against historical cases, and
— on founder approval — **deploys a new department into the running company.**

This is the finale of the demo.

→ **D13 Chief of Staff** ([`../02-departments/D13-chief-of-staff.md`](../02-departments/D13-chief-of-staff.md))

---

## Cross-cutting: how the company gets its own hands

Three capabilities run underneath every scene:

- **Accounts**: the company needs its own GitHub org, Gmail, domain, X account, Stripe account.
  It creates what it can via API, uses **Solari** computer-use for what needs a browser, and texts
  the founder over **Linq** for anything requiring a human (phone verification, 2FA, ToS
  acceptance, payment method). See [`../01-platform/07-identity-and-accounts.md`](../01-platform/07-identity-and-accounts.md).
- **Escalation ladder**: agent retry → sibling agent → department head → Chief of Staff → founder
  (Linq) → **Terac human**. See [`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md).
- **Budget**: every step above burns metered money against a department envelope.
  See [`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md).
