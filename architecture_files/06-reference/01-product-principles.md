# 01 — Product Principles

The design principles that resolve arguments. When two specs, two agents, or two humans disagree,
this file is the tiebreak. Each principle has: the statement, the rationale, what it forbids, how
to test compliance mechanically, and a worked example of a violation caught and corrected.

Precedence: the invariants in [`../00-START-HERE/00-README-INDEX.md`](../00-START-HERE/00-README-INDEX.md)
win over this file; this file wins over any department or integration spec.

| # | Principle | One-line test |
|---|---|---|
| P1 | Evidence over eloquence | Can you click every number and see its source? |
| P2 | Gates over guardrails-by-prompt | Is the rule enforced by the kernel, or by asking nicely? |
| P3 | Event-sourced truth | Can you delete every projection and rebuild the company? |
| P4 | Synthetic never counts as proof | Is `evidence_class` labeled, and does no gate accept synthetic-only? |
| P5 | Cost consciousness | Does every action have a meter row and a department to bill? |
| P6 | Honest partials over confident fabrication | Does a failed sub-task appear in `gaps[]` instead of the artifact body? |
| P7 | Replaceable departments | Could you rewrite a department in another language without touching its neighbors? |
| P8 | Founder sovereignty | Can the founder stop, redirect, or take over everything with one tap? |

---

## P1 — Evidence over eloquence

**MVP**

### Statement

Any claim the company makes — a market size, a persona, a pivot rationale, a price point —
must be traceable to a `source_id` with an excerpt, a confidence, and a method. A well-written
uncited claim is worth less than an ugly cited one.

### Rationale

LLMs are fluent, and fluency is exactly the failure mode: a hallucinated TAM reads identically to
a researched one. The only defense that scales across 13 departments is structural — make citation
a schema requirement, so the artifact registry physically cannot store an uncited number. This is
also the answer to the judge question "are those market numbers hallucinated?"
([`../00-START-HERE/04-demo-and-judging.md`](../00-START-HERE/04-demo-and-judging.md)).

### What it forbids

- Raw `z.number()` for any externally-stated quantity. Public numbers use the `Cited<T>` wrapper
  (`packages/contracts/src/primitives.ts`) with `sources: z.array(SourceRef).min(1)`.
- Paraphrase-only quotes. `claims.verbatim` stores the exact words; the paraphrase lives next to
  it in `normalized`, never instead of it.
- "Industry standard" or "typically" as a source. `method ∈ {measured, derived, estimated, asserted}`
  and `asserted` claims cannot back a load-bearing field.
- Artifact signing without the evidence validator. `registry.sign()` runs it; there is no other
  write path to `artifacts.body`.

### Compliance test

```sql
-- Zero rows means compliant: every signed artifact's quantitative fields have sources.
SELECT a.id, a.type
FROM artifacts a
WHERE a.quality = 'signed'
  AND NOT EXISTS (SELECT 1 FROM artifact_sources s WHERE s.artifact_id = a.id);
```

Plus the unit test that `registry.sign()` rejects a `NicheDossier` whose `tam.sources` is empty,
and a Boardroom check: click any number in the evidence drawer → the source snapshot renders.

### Worked violation

D03's `market.money` worker returns `"som_usd": 4200000` for dental groups with a rationale
paragraph but an empty `sources` array — it "derived" the number from its own training data.
The Head merges it anyway. `registry.sign()` rejects the dossier at step 7 of the work lifecycle
with `evidence_violation: /som/value has 0 sources`. The Head re-dispatches the money worker with
the defect note; the worker finds an IBISWorld summary page and two competitor pricing pages, files
them as `sources` rows with snapshots, and resubmits with `method: 'derived'` and the arithmetic in
`excerpt`. Cost of the loop: one worker re-run (~$0.14). Cost of shipping the fabrication: the demo.

---

## P2 — Gates over guardrails-by-prompt

**MVP**

### Statement

Irreversible actions are blocked by the kernel's Gate Engine, not by system-prompt instructions.
A prompt line saying "never send email without approval" is documentation; the tool plane refusing
`composio.gmail.send` without a matching approved gate is a guarantee.

### Rationale

Prompts are advisory under distribution shift: a long context, an injected instruction, or an
over-eager revision loop can defeat any natural-language rule. The eight gate types in
[`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md) form a closed
list checked in code, and the tool allowlist per agent means the runtime never even constructs the
dangerous tool for an agent whose manifest doesn't grant it.

### What it forbids

- Any side-effecting tool call (money out, public content, outbound to a real person, account
  creation, deploy, refund, data deletion, new department) executing without a `gates` row in
  `approved`/`auto_approved` state.
- "The agent knows not to" as a review answer. If the enforcement point is the prompt, the review
  fails.
- Departments opening gate types they did not declare in `DepartmentManifest.gates[]`.
- Widening a tool allowlist at runtime. Allowlists change only via a manifest change (or a
  founder-approved D13 `new_department` gate).

### Compliance test

- Policy test: `gates/policy.test.ts` asserts `public_content` and `new_department` never
  auto-approve at any autonomy level.
- Negative integration test: an agent whose manifest lacks `stripe.*` calls
  `stripe.paymentLinks.create` → tool plane throws `ToolNotGranted`, and an `agent.tool_failed`
  event is emitted. The email/DM path has the same test with `outbound_to_real_person`.
- Audit query: every `money.metered` row with `unit='terac_hire'` joins to an approved
  `money_out` gate. Zero orphans.

### Worked violation

During a revision loop, D10's `sales.sequencer` decides the fastest fix for a bounced email is to
retry it to the lead's personal Gmail found on a public page. The system prompt says warm leads
only — but the enforcement that actually fires is the tool plane: the send call carries
`lead_id`, the gate lookup finds no approved `outbound_to_real_person` gate for that handle
(consent state `unknown`), and the call is refused. The agent receives the structured refusal,
files the handle into `Lead.handles` with `deliverability: 'unknown'` for D09's compliance worker,
and moves on. Nothing was sent; the event log shows the attempt; nobody had to trust a prompt.

---

## P3 — Event-sourced truth

**MVP**

### Statement

`events` is the only authoritative table. Every state change is an appended event; every readable
state is a projection rebuildable by replay. If a UI element has no event behind it, it is fake.

### Rationale

Three properties fall out of this for free, and all three are demo-critical: **auditability**
(every decision has an actor, a rationale, a cost, and a causal chain — the "explain this" drawer
is a recursive CTE over `causation_id`), **recoverability** (a crashed department resumes from the
last event, not from scratch), and **replayability** (`?replay=demo-1` is the fallback for every
live demo beat). None of them can be retrofitted onto a mutable-state design.

### What it forbids

- `UPDATE`/`DELETE` on `events` (enforced by rules in
  [`../01-platform/04-data-model.md`](../01-platform/04-data-model.md)).
- Agents mutating projections directly. Writes go through `emit()`; reducers own projection tables.
- Data migrations that rewrite history. A projection bug fix = change the reducer, bump the
  projection version, replay.
- Boardroom features backed by ad-hoc tables instead of events.

### Compliance test

`pnpm kernel rebuild --venture <id>` from `seq 0`, then diff every projection table against its
pre-truncate snapshot. Byte-equal = compliant. This runs in CI against the `demo-1` fixture
(~20k events, ~4s) so a reducer that silently depends on out-of-band state fails the build.

### Worked violation

A Boardroom feature branch adds a `deals.notes` text column and writes to it from a REST endpoint
so a founder note survives. Replay test fails: rebuilt `deals` lacks the note. Fix: the endpoint
becomes `emit('sales.note_added', {deal_id, text})`, the pipeline reducer projects it, the note
survives rebuild — and, as a bonus, the note now shows in the deal's timeline with its author and
timestamp, which the mutable column never had.

---

## P4 — Synthetic never counts as proof

**MVP**

### Statement

simit-derived panels, generated personas, and any model-based estimate are *instruments*, not
*evidence of real demand*. Every artifact that mixes real and synthetic inputs labels
`evidence_class ∈ {real, synthetic, mixed}` at claim level, and no liveness signal, kill-criterion,
or pivot decision may be satisfied by synthetic data alone.

### Rationale

D05 is powerful precisely because it is cheap and always available — which is exactly why it would
silently displace real interviews if allowed to. The simit lineage keeps us honest: sim francisco's
credibility came from *backtesting against certified election results*, i.e., from calibration
against ground truth, never from the simulation asserting itself. We inherit that stance: real
interviews calibrate the panel, disagreement between blades is a reported finding
(`ClaimLedger.contradictions_with_synthetic`), and the panel artifact carries a literal
`honesty_note` field that the schema forces to say it is a model-based estimate.

### What it forbids

- `market_validated` turning true without ≥5 *real* human conversations
  ([`../00-START-HERE/01-north-star.md`](../00-START-HERE/01-north-star.md)).
- Presenting a `SyntheticPanelResult` estimate without its `ci` and archetype weights.
- Silently applying a calibration delta. `calibration.delta` is reported, never hidden.
- Blending synthetic quotes into the `ClaimLedger` as if spoken. Synthetic personas never produce
  `Claim` rows; claims come only from `interviews`.
- A persona with `derived_from: 'synthetic'` being cited as `evidence_class: 'real'` anywhere.

### Compliance test

- Schema: `SyntheticPanelResult.honesty_note` is a `z.literal` — it cannot be omitted or reworded.
- Reducer test: feed the liveness reducer 100 synthetic-only validation events → 
  `market_validated` stays false; add 5 `interviews` with `outcome='completed'` → flips true.
- Grep-level check on prompts: D06's synthesizer prompt must include the rule "an IdeaDiff whose
  only evidence is `kind='panel'` cannot be `recommended: true`."

### Worked violation

The founder's network yields only 2 interviews by hour 20. D06's synthesizer drafts
`NARROW ICP` with evidence: 12 panel data points, 0 claims, and marks it `recommended: true`.
The Critic rejects on the rubric line "recommended diffs require ≥1 real-evidence item." The Head
has two legal moves: file a Terac requisition for a 5-person ICP panel (real humans, ~$60, needs a
`money_out` gate), or ship the diff as `recommended: false` with a note that it is synthetic-only
and let the founder decide. It does the first; the requisition is the demo's 1:50 beat. The wrong
move — relabeling panel output as strong evidence — is structurally unavailable.

---

## P5 — Cost consciousness

**MVP**

### Statement

The company knows what everything costs, in USD, attributed to `(venture, department, agent_run,
work_order)`, in real time. Budgets are envelopes with hard caps; running out is a normal,
handled state — the department stops and requisitions Treasury, it does not degrade into secretly
cheaper behavior or silently continue.

### Rationale

"Agent swarm" without metering is a money fire with a dashboard. Cost discipline is also a
*feature we demo*: Treasury reallocating envelopes from real Stripe revenue at 3:15 only means
something if the cost side has been metered from minute zero. And it is a *quality* mechanism:
the tier policy (opus for judgment, sonnet default, haiku/pioneer for volume) plus automatic
downgrade at 80% envelope makes cost-quality tradeoffs explicit and observable
(`budget.degraded` is a UI beat, not a bug).

### What it forbids

- Tool or LLM calls outside the metering path. Every driver in `packages/tool-plane` records to
  `meters`; a driver without a meter scope does not merge.
- Unbounded loops. One critic revision max; retries capped in the manifest; `reservations` expire.
- Workers requesting budget. Only Heads may; only Treasury grants.
- Free-floating spend. Every meter row has a `cycle_id` and a department to bill; "platform
  overhead" is itself a budgeted pseudo-department, not a leak.

### Compliance test

```sql
-- Attribution completeness: no meter without a department; no run without cost.
SELECT count(*) FROM meters WHERE department_id IS NULL;                     -- must be 0
SELECT count(*) FROM agent_runs WHERE status='ok' AND cost_usd = 0
  AND model_tier <> 'pioneer';                                              -- must be ~0
```

Plus the load test: drive a department to 100% envelope → it emits
`Escalation(needs_budget)` and suspends at an artifact boundary; it does not throw, fabricate,
or keep spending. Reconciliation: `sum(meters.cost_usd)` per cycle within 2% of provider invoices.

### Worked violation

D03's demand worker discovers a scraping actor that returns beautiful data and costs $0.48/run,
and calls it 11 times in one fan-out — $5.28 against a $4.00 envelope. The meter's reserve step
catches it at call 8: the reservation fails, the worker gets `BudgetExceeded`, returns a partial
with `gaps: ['funding data for 3 of 6 niches']`, and the Head's merge notes the gap. Treasury sees
the pattern in the cycle report and either raises D03's envelope next cycle or flags the actor as
mispriced. What did *not* happen: the worker switching to inventing funding data, or the run
silently costing $12.

---

## P6 — Honest partials over confident fabrication

**MVP**

### Statement

When a sub-task fails, the artifact ships with `quality: 'partial'` and a specific entry in
`gaps[]`. A partial artifact is a legal, routable, downstream-consumable output. Fabricating the
missing piece is a P0 bug; so is stalling the whole pipeline waiting for perfection.

### Rationale

In a 13-department DAG, any single-department perfectionism becomes a global deadlock, and any
single-department fabrication becomes a global poisoning — the downstream department cannot tell
the invented field from the measured one. `gaps[]` is the third way: downstream sees exactly what
is missing, can decide whether it matters, and the Boardroom renders the honesty ("5 niches, 1
incomplete") which is itself a credibility beat with judges. The escalation ladder terminates in
`{status: 'unresolved'}` → partial, deliberately: an unresolved escalation degrades an artifact,
it never fabricates one.

### What it forbids

- A Head filling a missing worker result from its own general knowledge during merge.
- Empty `gaps[]` on `quality: 'partial'` artifacts (a partial must say what's missing).
- Blocking `on_timeout: fail` as a default SLA — `return_partial` is the house default.
- Downstream departments treating `partial` as an error and refusing input; they must handle it
  (and may escalate `needs_budget`/`needs_human` to fill the gap if it is load-bearing).

### Compliance test

- Schema: `AnyArtifact` validation plus a registry rule: `quality='partial' ⇒ gaps.length ≥ 1`.
- Chaos test in CI: kill one worker mid-fan-out in the `demo-1` replay → the run completes,
  output artifact is `partial`, gap names the dead worker's slice, downstream still routes.
- Prompt audit: every Head prompt contains the merge rule "missing ⇒ gaps[], never inference."

### Worked violation

The `market.supply` worker times out on Capterra (Cloudflare wall). The Head's merge sees 2 of 3
competitor sets. The tempting merge is "Competitor pricing: ~$99–$299/mo (typical for category)."
The critic rubric line "every competitor row has ≥1 source" catches it, but the deeper fix is the
Head prompt's standing rule: the dossier ships as
`quality: 'partial', gaps: ['Capterra competitor set — anti-bot wall, retry via Solari next cycle']`.
D06 later sees the gap, judges it non-load-bearing for the pivot decision, and proceeds; the gap
is retried by a Solari-driven fetch in the next cycle and the dossier is superseded by v2, signed.

---

## P7 — Replaceable departments

**MVP**

### Statement

A department is its contract: input artifact types, output artifact types, gates, and budget.
Anything behind the contract — models, prompts, workers, even the implementation language — can be
swapped without any other department noticing. Departments never import each other's internals and
never talk except via `WorkOrder` / `ArtifactReady` / `Escalation` on the bus.

### Rationale

This is what makes D13 possible at all: the Chief of Staff can only *generate* a new department
because a department is a known, mechanical shape (`DepartmentManifest` + prompts + contract).
It is also what makes the hackathon build parallelizable (four lanes, near-zero file overlap) and
what makes `services/simpop` — a Rust service in a TypeScript company — a first-class department
rather than a special case. The org-chart metaphor is load-bearing: real companies survive
re-orgs because departments interface through deliverables, not shared memory.

### What it forbids

- Cross-department imports in code (`packages/contracts` and platform packages are the only
  shared surface; lint rule enforces it).
- One department reading another's T2 department memory (memory tiers are policy-gated;
  cross-department context flows through artifacts or venture-tier memory only).
- Schema knowledge leaking: D10 parsing fields of `NicheDossier` that aren't in the contract
  version it declares.
- "Just this once" direct calls: a department invoking another's sandbox, queue, or DB tables.

### Compliance test

- Lint: `import` graph check — `apps/*` and department code may depend on `packages/*`, never on
  another department's directory.
- The swap test: replace D05's Rust simpop with a mock driver returning fixture
  `SyntheticPanelResult`s → full `demo-1` replay still passes. Repeat for D03 with the mock tool
  plane. If any other department's behavior changes beyond the data, the seam leaked.
- D13's shadow test *is* this principle exercised at runtime: a generated department slots into
  the same shape and is compared on contract outputs alone.

### Worked violation

To save a cycle, a D10 PR reads `interviews.transcript` directly from Postgres to personalize an
email, bypassing the `Lead.warm_context.claim_ids` contract field. It works in the demo branch and
breaks the moment D04 moves transcripts to object storage — and it also skips the consent check
that D09's compliance worker bakes into `warm_context`. The lint rule flags the import of the
platform DB client with a raw table query from department code; the fix is one line in D09's
output (include `strongest_quote` in `warm_context`, where it already belongs), and D10 goes back
to reading only its declared inputs. The general lesson gets written to institutional memory:
if a department needs data it isn't receiving, the fix is a contract change, not a reach-around.

---

## P8 — Founder sovereignty

**MVP**

### Statement

The founder is not a user of the company; the founder *owns* it. Every autonomy level, cap,
gate decision, and the kill switch belong to the founder. The company may recommend, batch, and
pre-select, but on the closed list of founder-reserved decisions it may never decide: public
speech under the founder's brand, new departments, spend above caps, and anything touching the
founder's identity or credentials. And everything the company builds — accounts, repos, revenue —
is transferable to the founder on demand.

### Rationale

"Zero-human" means no human on the critical path, not no human in charge — that distinction is
the honest version of the pitch, and the reason the judging answer to "is this actually
autonomous?" is *show the dial and the kill switch*, not *deny the human exists*. Sovereignty is
also a safety property: an autonomous company that cannot be stopped, redirected, or owned is not
a product anyone should want. The Linq surface exists so that sovereignty is *cheap to exercise*:
one tap, quiet hours respected, recommendation pre-selected.

### What it forbids

- Auto-approving `public_content` or `new_department` at any autonomy level (asserted in tests).
- Spending past `founders.spend_cap_usd` or `terac_cap_usd` under any escalation path.
- Password resets, identity ceremonies, or KYC steps performed by agents on the founder's behalf.
  These skip straight to the founder (`needs_credential` skips to rung 4).
- A kill switch with exceptions. Kill = all agents halt within one tick, spend freezes, all
  escalations park. No "just finishing this send."
- Dark-pattern defaults: `on_timeout: auto_approve` is only legal for reversible, low-risk gates;
  money and outbound default to `hold`.

### Compliance test

- Kill-switch integration test: activate mid-fan-out → no new `agent.started`, no meter rows, no
  outbound tool calls after the kill event's `seq`; venture resumable afterward with state intact.
- Cap test: queue a $30 Terac hire against a $25 remaining cap → gate opens as ASK even in
  `autonomous`; approve → still refused (cap wins over approval).
- Ownership test: run the transfer flow — GitHub org, Render services, Stripe account, domain —
  and verify the venture runs under founder-owned credentials with the vault's copies revoked.

### Worked violation

At 2 a.m., a dunning email thread with an angry customer tempts D12 to post a public status-page
note apologizing for a billing bug — clearly helpful, clearly public content. Autonomy is
`autonomous`, so most gates self-approve, but `public_content` is a NEVER row: the gate opens as
ASK, quiet hours defer the Linq card to 7 a.m., and the ticket is answered privately in the
meantime (private replies to an existing customer thread are in-policy). In the morning the
founder rewrites one sentence and approves. The counterfactual — the company speaking publicly in
the founder's name while they slept, wrongly admitting a "bug" that was actually the customer's
card expiring — is the exact class of harm this principle exists to make impossible.

---

## How to use this file in a dispute

1. Identify which principle(s) the disagreement touches. Most disputes are P1 vs velocity,
   P6 vs completeness, or P5 vs quality.
2. Run the principle's compliance test if it exists. Mechanical answers beat opinions.
3. If two principles conflict (e.g., P6 says ship partial, P4 says this gap is load-bearing and
   synthetic can't fill it), the resolution is almost always an **escalation with options**, not a
   local judgment call — that is what the ladder is for.
4. If the dispute survives all of that, it is a real architectural decision: write an ADR in
   [`06-decision-log.md`](06-decision-log.md) and update this file if the decision changes a
   principle's scope.

## Assumptions & open questions

- **POST-MVP:** P5 reconciliation against real provider invoices is specced but the 2% tolerance
  is a guess; tighten after one real billing cycle.
- **POST-MVP:** P8 ownership-transfer flow for Stripe (Connect account transfer vs re-KYC) needs
  verification against Stripe's actual policy at the booth.
- Open: does P4 need a fourth `evidence_class` value for Terac-hired *expert opinion* (real human,
  but stated opinion rather than observed behavior)? Current answer: no — `claims.evidence_class`
  already distinguishes `opinion` from `past_behavior` at the claim level. Revisit if D06 finds it
  ambiguous in practice.
