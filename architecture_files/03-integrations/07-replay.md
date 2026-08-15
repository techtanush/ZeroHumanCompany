# 07 — Replay

> **Tier 1.** QA a non-engineer founder can act on: failures come back as a time-travel recording,
> not a stack trace.

---

## What it is

Replay is **autonomous QA tooling**: it exercises a web application, records execution in a
replayable form, and surfaces failures as recordings a human (or agent) can scrub through —
time-travel debugging rather than log archaeology. For us it is the QA half of D07: the thing that
decides whether the MVP the company just built actually works, and that turns "it's broken" into an
artifact with a root cause.

> **ASSUMPTION:** Replay is listed on the Luma page as "auto QA," and the runtime/recording model
> below is our *design* against that positioning plus Replay's known time-travel-recording heritage
> (record once, deterministically re-execute, inspect any point in time). The exact hackathon
> product surface — hosted API vs CLI vs browser recorder — is (unverified — confirm at hackathon).
> Everything sits behind our `QaDriver` interface, so a surface correction is a one-file change.

---

## The exact product problem it solves

D07 builds the venture's MVP with headless Claude Code
([`15-anthropic-claude.md`](15-anthropic-claude.md)). Two hard problems follow:

1. **The builder cannot be the only judge of its own work.** A code agent that writes its own tests
   grades its own homework. Zeroth's evidence invariant demands an *independent* check before a
   `Deployment` artifact is signed.
2. **The founder can't read stack traces.** When something breaks post-launch, the repair loop must
   run founder-legible: a bug is a *recording of the product failing*, with a root-cause note, not a
   Node backtrace.

Replay solves both: autonomous exploration of the deployed MVP (QA gate), and recordings as the
lingua franca between D12 Support, D07 Build, and the founder (repair loop).

---

## Which departments use it

| Dept | Role |
|---|---|
| **D07 Build** | Owner. Runs the QA suite against every preview deploy; consumes findings; gates promotion to production. |
| **D12 Support** | Files bug tickets *with a recording attached* — reproduces customer-reported issues in a fresh session and attaches the recording to the `Ticket`. |
| **D13 Chief of Staff** | Reads QA pass-rate trends as a capability signal (a flaky product is a `CapabilityGap`). |

---

## Technical integration

### The `QaRun` contract

```ts
// packages/contracts/src/qa.ts
export const QaRun = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  deployment_id: z.string().uuid(),          // the Render preview/prod deploy under test (08-render.md)
  trigger: z.enum(['post_deploy', 'pre_promotion', 'support_repro', 'scheduled_regression']),
  target_url: z.string().url(),

  plan: z.object({
    flows: z.array(z.object({
      id: z.string(),                        // 'signup', 'core-action', 'checkout'
      steps_hint: z.array(z.string()),       // derived from ProductSpec.user_stories — QA tests the SPEC
      assertions: z.array(z.string()),       // 'account exists after signup', 'charge appears in Stripe test mode'
    })),
    explore_budget_minutes: z.number().default(5),   // free exploration beyond scripted flows
  }),

  status: z.enum(['queued','running','passed','failed','error']),
  findings: z.array(QaFinding),
  recording_provider: z.enum(['replay', 'playwright']),   // honesty column, like bus.transport
  cost_usd: z.number(),
});

export const QaFinding = z.object({
  id: z.string().uuid(),
  severity: z.enum(['blocker', 'major', 'minor', 'cosmetic']),
  flow_id: z.string(),
  title: z.string(),                          // 'Signup fails with empty error on valid email'
  recording_ref: z.string(),                  // THE artifact: link to the replayable recording
  recording_timestamp_ms: z.number(),         // where in the recording the failure is visible
  root_cause: z.object({
    hypothesis: z.string(),                   // 'POST /api/signup 500s; unhandled null from missing SMTP env var'
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string()),            // console errors, failed request, source loc if available
    suggested_fix: z.string().optional(),
  }),
  repro_steps: z.array(z.string()),           // human-readable, founder-legible
  regression_of: z.string().uuid().optional(),// links to a previously-passed QaRun — the regression flag
});
```

Two design decisions worth defending:

- **QA tests the `ProductSpec`, not the code.** Flows derive from D06's signed spec
  (`user_stories[]`), so the check is "does the product do what the company decided it should do,"
  independent of what D07's Claude Code session believes it built. That independence is the point.
- **`recording_provider` is a column, not a secret.** If the fallback recorded a run, the row says
  so — the same visible-degradation posture as `bus.transport` in [`02-band.md`](02-band.md).

### Assumed vendor surface

```http
POST /v1/sessions            { target_url, flow_script | goal, record: true } → { session_id }
GET  /v1/sessions/{id}       → { status, recording_url, events[] }
GET  /v1/recordings/{id}     → replayable recording ref + shareable viewer link
```

(unverified — confirm at hackathon)

> **VERIFY AT HACKATHON (Replay booth, day one):**
> 1. Is the driver a hosted "point it at a URL" API, a CLI we run in our sandbox, or a browser
>    recorder we drive ourselves (e.g. their runtime + our Playwright)?
> 2. Can an **agent** consume the recording programmatically — DOM/console/network state at time T —
>    or is the viewer human-only? This decides how much of `root_cause` is automated vs Claude-inferred
>    from captured console/network logs.
> 3. Shareable viewer links (needed for Linq cards and `Ticket` attachments) and their auth model.
> 4. Concurrency, per-recording cost, retention.
> 5. Do they support scripted assertions natively, or do we assert in our harness around recordings?

### The QA pipeline

```
Render deploy succeeds (preview)                                (08-render.md)
   │  deploy hook → kernel → WorkOrder(qa_run) → D07 qa worker (own sandbox)
   ▼
1. PLAN     flows from ProductSpec.user_stories (sonnet, ~$0.02)
2. EXECUTE  each flow via QaDriver against the preview URL, recording on
   │        + explore_budget: free-roam clicking nav/forms/empty states
3. JUDGE    per flow: assertions checked mechanically where possible
   │        (HTTP status, DOM presence, Stripe test-mode object exists);
   │        else a sonnet pass over the captured console+network+screenshot evidence
4. ROOT-CAUSE  for each failure: Claude session gets console errors, failed
   │        requests, and (if repo access) the diff since last green run →
   │        writes root_cause{hypothesis, confidence, evidence, suggested_fix}
5. EMIT     qa.run_completed {passed|failed, findings[]}
   ▼
   passed → Deployment artifact eligible for promotion gate
   failed → findings become WorkOrders back to the BUILD session (below)
```

### How D07 consumes findings — the repair loop

```
qa.run_completed(failed, findings)
   │
   ├─ blocker/major findings → WorkOrder(fix_bug) to the build sandbox.
   │    The Claude Code session RESUMES (05-superserve.md) with:
   │      finding.title, root_cause.hypothesis, repro_steps,
   │      the recording link, and console/network excerpts inline.
   │    It fixes, commits, pushes → new preview deploy → NEW QaRun.
   │    Loop cap: 3 fix cycles per finding, then Escalation(needs_approval)
   │    to the founder: 'ship with known issue X / keep trying / hold'.
   ├─ minor/cosmetic → backlog artifacts; do not block promotion; D13 sees the trend.
   └─ every finding is an event; the Boardroom build card shows the loop count.
```

**Regression gating in CI.** Every `QaRun` with `trigger: 'pre_promotion'` re-runs all flows that
have *ever* passed for this venture (the regression set grows monotonically). A previously-passing
flow that fails sets `regression_of` and is an automatic **blocker** regardless of severity
heuristics — the production-deploy gate ([`08-render.md`](08-render.md)) will not open with a
regression present. `scheduled_regression` runs nightly against production at prod `time_scale`.

### D12's repro path

Customer ticket arrives ("checkout doesn't work") → D12's repro worker runs a `QaRun` with
`trigger: 'support_repro'` scripted from the customer's described steps → the resulting recording
attaches to the `Ticket`, and if it fails, the finding flows into the same repair loop with the
ticket linked. The `support↔build` Band room carries the negotiation about severity; the recording
is the shared object they argue over. Dispute evidence for Stripe ([`03-stripe.md`](03-stripe.md))
can cite the recording of the product *working*, too.

---

## User-facing experience

The founder sees QA in exactly two places:

1. **The build card (Boardroom, 2:25):** "QA: 6/7 flows passed. 1 blocker: signup fails on valid
   email. Fixing (attempt 1 of 3)…" then the loop closes and the deploy gate card arrives on Linq.
2. **A Linq card only if the loop fails 3×:** *"Built your MVP but signup still fails after 3 fix
   attempts. Watch the 20-second failure: [link]. Ship anyway / keep trying / hold?"* The link is
   the recording. A non-engineer watches their product break, and understands.

---

## Why the use case is novel

Standard agent-QA is "the agent ran its own tests." Ours has three uncommon properties: QA is
**adversarial to the builder** (separate worker, separate sandbox, flows derived from the spec, not
the code); failures are **founder-legible artifacts** (recordings on a phone, not CI logs); and the
**regression set is an asset that grows for the life of the venture** — the company's definition of
"working" ratchets and never silently loosens. Also the meta-story writes itself: an autonomous
company whose build agent's work is checked by an autonomous QA agent, with disagreements settled by
a recording.

---

## Sponsor-track criteria

| Criterion | Our answer |
|---|---|
| Auto QA, actually autonomous | Zero human writes tests; flows derive from the signed spec; runs on every deploy |
| Recordings load-bearing | The recording is the bug report, the repair-loop input, the Linq escalation, and the D12 ticket attachment |
| Real run on stage | 2:25 shows a live QA pass and (seeded) one caught bug with its fix loop |
| The sentence | "The build agent debugged its own product by replaying it — and the founder got a link showing the bug happen." |

---

## Risks, costs, permissions, rate limits

| Item | Detail |
|---|---|
| Product-surface uncertainty | Highest of any Tier-1 vendor (see verify block). Mitigated by the `QaDriver` interface + a fully-working Playwright fallback we build *first*. |
| Cost | Per-recording/per-minute pricing (unverified — confirm at hackathon). Demo: ~10 runs × ~7 flows; assume single-digit dollars. Metered to D07's envelope like everything else. |
| Permissions | QA hits only venture-owned preview URLs — no third-party sites, so no scraping/ToS exposure. Test-mode Stripe keys only ([`03-stripe.md`](03-stripe.md)). |
| Data | Recordings of our own app with synthetic test data; no customer PII in preview environments by policy. Support-repro recordings of production sessions must use a synthetic account, never replay a real customer's session. |
| Flaky-test hell | Assertions favor mechanical checks (HTTP, DOM, Stripe objects) over pixel diffs; explore-mode findings are advisory (minor) by default so nondeterminism can't block promotion. |

---

## Fallback behavior when it is down

| Failure | Behavior |
|---|---|
| Replay unavailable / no usable API | **Playwright driver**: same `QaRun`/`QaFinding` shapes, `recording_provider: 'playwright'`, recording = Playwright trace + video (trace viewer link is shareable and scrubbable — the founder-legibility story survives). Root-cause quality drops from time-travel inspection to console/network log inference; the contract does not change. |
| Recording viewer link needs auth a founder can't do | Attach the video artifact directly to the Linq card (≤100MB is fine, [`06-linq.md`](06-linq.md)). |
| QA runner times out mid-suite | Partial results are still emitted; unexecuted flows are `error`, promotion gate stays closed. **A QA outage fails closed, never open** — an unverified deploy cannot promote. |
| On stage | The 2:25 QA beat runs against the preview deploy live; the seeded bug + fix loop is in `?replay=demo-1` if the live run is too green (a QA suite finding nothing is a bad demo beat). |

---

## Contribution to the general prize

"Executes with little to no human input" fails at exactly one place for every other team: the built
product breaks and a human debugs it. Replay closes Zeroth's *last* open loop — build → verify →
fail → root-cause → fix → re-verify — without a human in it, and with a ratcheting regression set
it gets stricter the longer the company runs. The founder's only role is watching a 20-second
recording when the company has already tried three times. That is the difference between "an agent
that ships code" and "a company that ships working products."

---

## Assumptions & open questions

- (unverified — confirm at hackathon) Entire vendor API surface; programmatic recording access;
  viewer-link auth; pricing; concurrency.
- Open: can the root-cause step consume Replay's captured state programmatically (much stronger
  hypotheses) or only console/network excerpts? Decides how much of step 4 is vendor-differentiated.
- Open: nightly `scheduled_regression` cadence at demo `time_scale` — every N minutes? Tune in rehearsal.

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`08-render.md`](08-render.md) (deploy hooks trigger QA; promotion gate consumes it) ·
[`15-anthropic-claude.md`](15-anthropic-claude.md) (the build session that consumes findings) ·
[`05-superserve.md`](05-superserve.md) (QA + repro run in forks/sandboxes) ·
[`06-linq.md`](06-linq.md) (the escalation card with the recording)
