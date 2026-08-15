# 08 — Money & Metering: The Economic Engine

Every other agent demo spends someone's budget invisibly. Zeroth knows what it costs, per
department, per decision, in real time — and it **reallocates its own budget** based on marginal
return. This is the file that makes the Boardroom's money panel real instead of decorative.

```
   FOUNDER FLOAT ─┐
                  ├──► RUNWAY ──► CYCLE BUDGET ──► DEPARTMENT ENVELOPES
   STRIPE/WHOP ───┘       ▲              │              │
   /DODO REVENUE          │              │              ▼
                          │              │      reserve → commit → release
                          │              │              │
                          │              ▼              ▼
                          └────── METERS ◄────── every token, second, call, hire
                                    │
                                    ▼
                          TREASURY (D11) reallocates next cycle
```

---

## Unit cost table

Single source of truth: `packages/contracts/src/pricing.ts`. Loaded into every
`ContextPacket.budget.unit_costs` so agents can reason about their own spend. Prices are USD and
are configuration, not constants in code — they change without a redeploy.

### LLM tokens (per 1M tokens)

| Tier | Model | In | Cached write | Cached read | Out |
|---|---|---|---|---|---|
| `opus` | Claude Opus | 15.00 | 18.75 | 1.50 | 75.00 |
| `sonnet` | Claude Sonnet | 3.00 | 3.75 | 0.30 | 15.00 |
| `haiku` | Claude Haiku | 0.80 | 1.00 | 0.08 | 4.00 |
| `pioneer:*` | Fastino Pioneer fine-tune | 0.10 | — | — | 0.40 |
| `embed` | voyage-3-lite | 0.02 | — | — | — |

The cached-read column is why the prompt-cache ordering rule in
[`05-memory-and-context.md`](05-memory-and-context.md) is load-bearing: a Head's fixed 15k-token
preamble costs $0.225 uncached and $0.0225 cached. Across 200 runs that is $40 vs $4.

### Compute & storage

| Unit | Rate | Notes |
|---|---|---|
| `sandbox_seconds` (Superserve, 2 vCPU / 2 GB) | $0.000045 /s (~$0.16/hr) | **Paused sandboxes bill at 10%** — the reason resident departments are affordable |
| `sandbox_seconds` (4 vCPU / 8 GB, D07 Build) | $0.00015 /s (~$0.54/hr) | |
| `storage_gb_hour` | $0.00003 | recordings, transcripts, PUMS extracts |
| `egress_gb` | $0.09 | scraping-heavy departments notice this |

### Tool calls

| Tool | Unit cost | Notes |
|---|---|---|
| `web_search` | $0.008 /query | |
| `web_fetch` | $0.001 /page | |
| `apify.run_actor` | $0.02–$0.50 /run | actor-specific; the driver reports actual |
| `solari.session` | $0.03 /min | computer-use; the expensive hands |
| `composio.*` (Gmail, LinkedIn, Calendar, GitHub) | $0.0005 /call | |
| `stripe.*` | $0.00 + 2.9% + $0.30 on **revenue** | cost of revenue, not of operation |
| `elevenlabs.tts` | $0.06 /min synthesized | |
| `voice_minute` (telephony + STT + TTS, all-in) | $0.14 /min | a 20-min discovery interview ≈ $2.80 |
| `elevenlabs.voice_clone` | $0.00 (one-time, plan) | |
| `render.deploy` | $0.00 (plan) + service hours | the venture's own services bill to the venture |
| `replay.recording` | $0.01 /session | |
| `lovable.generate` | $0.15 /site | |
| `pioneer.finetune_job` | $2.00 /job | amortized across ventures |
| `terac_hire` | **actual, from the Terac API** — typically $6–$60 per task/interview | the single largest line item; always gated |
| `linq.message` | $0.002 /message | founder cards are nearly free; batching is for attention, not cost |

### What a demo venture actually costs

| Department | Typical cycle spend | Dominant cost |
|---|---|---|
| D01 Intake | $0.30 | web_search |
| D02 Office Hours | $0.45 | opus tokens |
| D03 Market Research | $3.80 | search + fetch + sonnet ×10 workers |
| D04 Outreach | $9.20 | **voice_minutes** + Terac panel |
| D05 SimPop | $1.10 | one batched call per archetype (12) |
| D06 Pivot | $2.40 | opus, k=24 context |
| D07 Build | $11.50 | sandbox_seconds + sonnet implementers |
| D08 Strategy | $2.60 | opus + full-history context |
| D09 Leads | $3.40 | enrichment + search |
| D10 Sales | $4.10 | writing + voice |
| D11 Finance/HR | $0.60 | cheap by design |
| D12 Support | $0.80 | haiku triage |
| D13 Chief of Staff | $2.20 | opus, k=32 |
| **Total** | **≈ $42** | idea → deployed product → first charge |

That number is the pitch: **a company for the price of a dinner.** It is also the number the
Boardroom money panel counts up to live.

---

## Metering pipeline

```
agent/tool emits usage
        │
        ▼
  meter.record({unit, resource, quantity})        in-process, non-blocking
        │
        ├──► Redis HINCRBYFLOAT  meter:{cycle}:{dept}   ← real-time, drives the UI + admission
        │
        └──► BullMQ 'meter.flush' (batched, 1s)
                    │
                    ▼
             INSERT INTO meters (…)                append-only fact
                    │
                    ├──► emit('money.metered', {...})   → SSE → Boardroom
                    └──► reducer: budget_allocations.spent_usd
```

```ts
// packages/agent-kit/src/meter.ts
export class Meter {
  constructor(private scope: { venture_id: string; department_id: string;
                               agent_run_id?: string; work_order_id?: string; cycle_id: string }) {}

  record(unit: MeterUnit, resource: string, quantity: number) {
    const unit_cost = PRICING[unit]?.[resource] ?? PRICING[unit]?.default;
    if (unit_cost === undefined) throw new Error(`unpriced: ${unit}/${resource}`);  // fail loud
    const cost = quantity * unit_cost;
    redis.hincrbyfloat(`meter:${this.scope.cycle_id}:${this.scope.department_id}`, 'usd', cost);
    queue.add('meter.flush', { ...this.scope, unit, resource, quantity, unit_cost, cost });
    return cost;
  }

  recordTokens(u: Usage) {                            // from the Claude Agent SDK onUsage hook
    this.record('tokens_in',           u.model, u.input_tokens);
    this.record('tokens_cached_write', u.model, u.cache_creation_input_tokens ?? 0);
    this.record('tokens_cached_read',  u.model, u.cache_read_input_tokens ?? 0);
    this.record('tokens_out',          u.model, u.output_tokens);
  }
}
```

**Unpriced resources throw.** A tool with no price is a hole in the P&L, and a company that can't
price its own actions can't allocate. Adding a tool means adding a price.

**Sandbox seconds** are metered by the orchestrator on `pause()`/`resume()`/`release()` boundaries,
not by a ticker — pauses are exact, and the 10% paused rate applies to the paused interval.

---

## Budget envelopes, reservations, and the cycle

**Cycle** = the allocation period. Demo: 5 minutes (`time_scale=0.001`). Production: 24 hours.
Each cycle opens a `budgets` row and one `budget_allocations` row per department.

### Three-phase spend

```
 reserve(dept, amount)     ── Head admits a plan. Fails ⇒ Escalation(needs_budget).
      │                       reservations.state='held', expires in 2× soft_deadline
      ├─ commit(res_id, actual)   ── work finished; actual ≤ held; delta released
      └─ release(res_id)          ── work failed/cancelled; full amount returned
```

```ts
// apps/kernel/src/budget/admit.ts
export async function reserve(dept: string, cycle: string, amount: number, wo: string) {
  return db.tx(async t => {
    const a = await t.one(`SELECT envelope_usd, reserved_usd, spent_usd, state
                             FROM budget_allocations WHERE cycle_id=$1 AND department_id=$2
                             FOR UPDATE`, [cycle, dept]);
    if (a.state === 'frozen') throw new Frozen(dept);
    const available = a.envelope_usd - a.reserved_usd - a.spent_usd;
    if (amount > available) throw new InsufficientBudget({ dept, need: amount, available });
    await t.none(`UPDATE budget_allocations SET reserved_usd = reserved_usd + $3
                    WHERE cycle_id=$1 AND department_id=$2`, [cycle, dept, amount]);
    return t.one(`INSERT INTO reservations (...) VALUES (...) RETURNING id`);
  });
}
```

`FOR UPDATE` on the allocation row is the whole concurrency story: two Heads admitting
simultaneously serialize, and the second gets `InsufficientBudget` rather than an overdraft.

### The 80% / 100% policy

| Utilization | State | Behavior |
|---|---|---|
| < 80% | `active` | Normal. |
| ≥ 80% | `degraded` | **Automatic model downgrade**: `opus→sonnet`, `sonnet→haiku` for workers (Heads keep one tier of headroom); `retrieval_k` × 0.6; `replicas` capped at 2; `solari` and `voice` calls require a Head-level justification. Emits `budget.degraded` → the Boardroom shows a "thrift mode" chip on the room. |
| ≥ 100% | `frozen` | No new reservations. Running work finishes to its last artifact boundary and stops. `Escalation(needs_budget)` → Treasury. Room turns amber. |
| Venture-wide ≥ `founders.spend_cap_usd` | hard stop | Every `money_out` gate → ASK regardless of autonomy; all departments freeze; founder card. |

Degradation is visible, reversible, and demoable: "Research just got throttled and switched to a
cheaper model because Build is shipping" is a better beat than a progress bar.

---

## The Treasury allocation algorithm

Runs at the start of every cycle inside D11 (`finance.treasurer`). It is a **scored heuristic with
an LLM-written rationale**, not an LLM guessing numbers — the arithmetic is deterministic and
auditable; the model only writes the explanation and sets the two judgment inputs
(`strategic_multiplier`, `blocked_reason`).

```
For each department d:

  value_delivered(d)   = Σ over last cycle of:
        signed artifact ×  weight[artifact_type]
      + advanced liveness signal × 5.0
      + revenue attributable to d × 10.0        (Sales/Support get credit for closed & retained)
      + escalations resolved × 0.5
      - contested artifacts × 1.0
      - work orders failed × 1.5

  spend(d)             = mv_department_spend.spent_usd for last cycle
  MV(d)                = value_delivered(d) / max(spend(d), 0.25)      ← marginal value per dollar
  demand(d)            = Σ budget_usd of queued work orders targeting d
  blocked(d)           = 1 if d has an open blocking escalation resolvable by money, else 0
  stage_weight(d)      = STAGE_WEIGHTS[venture.stage][d]               ← a validating company
                                                                          funds D04, not D10
  score(d)             = MV(d)^0.7 × stage_weight(d) × (1 + 0.5·blocked(d)) × strategic_multiplier(d)

  envelope(d)          = clamp(
                            total_cycle_budget × score(d)/Σscore,
                            floor(d),                      ← every dept keeps $0.25 to stay alive
                            min(demand(d) × 1.25, hard_cap(d))
                         )
  redistribute the clamp remainder proportionally, one pass.
```

`STAGE_WEIGHTS` encodes company sense: during `validating`, D04/D05 get 2.0 and D10 gets 0.3;
during `selling`, that inverts. Without it, a naive MV optimizer starves the department whose value
shows up two stages later.

### Worked example — moving $30 across departments

**Setup.** Cycle 7 of the demo venture. Total cycle budget: **$30.00**. Stage: `selling` (product is
live, first deal in pipeline). Last cycle's actuals:

| Dept | Last envelope | Spent | Value delivered | MV | Demand (queued) | Blocked? |
|---|---|---|---|---|---|---|
| D03 Market | $4.00 | $3.80 | 1 NicheDossier set (already used) → 1.0 | 0.26 | $0.50 | no |
| D04 Outreach | $9.00 | $9.20 | 7 interviews + ClaimLedger → 9.0 | 0.98 | $1.00 | no |
| D07 Build | $12.00 | $11.50 | Deployment + 12 green QA → 8.0 | 0.70 | $4.00 | no |
| D09 Leads | $3.00 | $3.40 | 63 leads, 41 qualified → 4.0 | 1.18 | $6.00 | no |
| D10 Sales | $2.00 | $2.10 | 1 booked call, **$149 revenue** → 3.0 + 14.9 = 17.9 | 8.52 | $9.00 | **yes** (needs $2 for a paid enrichment credit) |
| D12 Support | $0.50 | $0.30 | 2 tickets resolved → 1.0 | 3.33 | $0.50 | no |

**Step 1 — MV^0.7:**
D03 0.39 · D04 0.99 · D07 0.78 · D09 1.12 · D10 4.35 · D12 2.29

**Step 2 — stage weights (`selling`):**
D03 0.4 · D04 0.6 · D07 1.0 · D09 1.6 · D10 2.0 · D12 1.2

**Step 3 — blocked bonus:** D10 × 1.5. Strategic multipliers all 1.0 except D07 = 1.2
(`finance.treasurer` rationale: "one P1 bug from the QA run is unshipped and it blocks the second
demo account").

| Dept | score | share | raw envelope |
|---|---|---|---|
| D03 | 0.39 × 0.4 = 0.156 | 1.0% | $0.30 |
| D04 | 0.99 × 0.6 = 0.594 | 3.9% | $1.16 |
| D07 | 0.78 × 1.0 × 1.2 = 0.936 | 6.1% | $1.83 |
| D09 | 1.12 × 1.6 = 1.792 | 11.7% | $3.51 |
| D10 | 4.35 × 2.0 × 1.5 = 13.05 | 85.3%→ | $25.60 |
| D12 | 2.29 × 1.2 = 2.748 | — | — |
| Σ | 19.276 | | |

(Recomputed properly over all six: shares are 0.8%, 3.1%, 4.9%, 9.3%, 67.7%, 14.3%.)

**Step 4 — clamp to `min(demand × 1.25, hard_cap)` and floor at $0.25:**

| Dept | Raw | Demand×1.25 | Clamped | Note |
|---|---|---|---|---|
| D03 | $0.24 | $0.63 | **$0.25** | floor; research is done for now |
| D04 | $0.93 | $1.25 | **$0.93** | |
| D07 | $1.47 | $5.00 | **$1.47** | |
| D09 | $2.79 | $7.50 | **$2.79** | |
| D10 | $20.31 | $11.25 | **$11.25** | ← clamped hard: it cannot spend what it has no queued work for |
| D12 | $4.29 | $0.63 | **$0.63** | clamped |
| | | | **$17.32** | **$12.68 unallocated** |

**Step 5 — redistribute the $12.68 remainder** proportionally among departments still below their
demand ceiling (D07, D09, D04):

| Dept | +share | Final |
|---|---|---|
| D04 | +$1.16 | **$2.09** |
| D07 | +$4.71 | **$6.18** |
| D09 | +$6.81 | **$9.60** |

**Final allocation (cycle 7): D03 $0.25 · D04 $2.09 · D07 $6.18 · D09 $9.60 · D10 $11.25 · D12 $0.63 = $30.00**

**The $30 that moved:** last cycle D07 Build held $12.00 and D10 Sales held $2.00. This cycle Build
drops to $6.18 and Sales rises to $11.25 — **a $9.25 swing out of Build, plus $6.60 into Leads** to
feed the pipeline Sales just proved converts. Market Research goes from $4.00 to $0.25: it isn't
punished, it's *done*.

**The rationale string** (written by `finance.treasurer`, stored on `budget_allocations.rationale`,
rendered verbatim in the Boardroom money panel):

> "Sales returned $149 on $2.10 last cycle — the highest marginal value in the company by 7×, and
> it's blocked on a $2 enrichment credit. Moving $9.25 out of Build: the product is live and QA is
> green, so Build's remaining work is one P1 fix, not a feature push. Leads goes to $9.60 because
> Sales converts what Leads produces and Sales has more capacity than pipeline. Market Research is
> throttled to the $0.25 floor — the dossier is selected and re-running it buys nothing this cycle.
> If Sales doesn't convert a second deal by cycle 9, this reverses."

That last sentence — a falsifiable prediction attached to a budget decision — is what separates a
treasury from a random number generator, and it is what D13 checks against in its daily review
([`10-observability.md`](10-observability.md)).

### Human labor competes for the same dollars

A `HumanWorkRequisition` enters the same scoring as a department: HR computes
`expected_value_usd / max_cost_usd` and compares it to the *lowest* funded department's MV. Hiring
an $18 Terac panel must beat giving that $18 to Build. This is stated in the requisition card
([`06-human-in-the-loop.md`](06-human-in-the-loop.md)) as "Expected value", and it means the
company's answer to "should we hire a human?" is an actual number, not a vibe.

---

## Revenue in

```
Stripe webhook ─┐
Whop webhook ───┼─► services/gateway-* ─► verify signature ─► emit money.revenue_received
Dodo webhook ───┘                                      │
                                                       ▼
                                    orders / invoices projections
                                                       │
                                                       ▼
                                   budgets.runway_usd += net_amount
                                                       │
                                                       ▼
                                    next cycle's total_cycle_budget grows
```

| Rail | Used when | Reaches runway |
|---|---|---|
| **Stripe** | B2B SaaS ventures, US entity | `charge.succeeded` / `invoice.paid` minus fees |
| **Whop** | consumer/community ventures | `membership.went_valid`, minus Whop's take |
| **Dodo Payments** | international founder / no entity (merchant of record) | `payment.succeeded`, minus MoR fee |

`runway_usd = founder_float + Σ realized_revenue − Σ committed_spend − Σ open_reservations`.

**Test mode is labeled, never hidden.** `orders.is_test_mode` propagates to the Boardroom revenue
ring as a visible "TEST" badge. Claiming test-mode dollars as revenue on stage is the kind of thing
a judge catches, and the honest version is a better story anyway: *the plumbing is real, the money
is sandboxed.*

**Reinvestment rule:** realized revenue increases the *next* cycle's budget by
`min(revenue × 0.5, remaining founder cap)`. The other half accrues to runway. So a converting
venture literally funds its own next cycle — which is the "the company pays for itself" beat at
3:15 in the demo ([`../00-vision/04-demo-and-judging.md`](../00-vision/04-demo-and-judging.md)).

---

## Freeze / thaw

| Trigger | Effect | Thaw condition |
|---|---|---|
| Department hits 100% envelope | `state='frozen'`, no new reservations, running work finishes to boundary | Treasury grants budget, or next cycle opens |
| Treasury freezes a department (MV < 0.1 for 2 cycles) | Same, plus sandbox paused | Founder or D13 override |
| Venture hits `founders.spend_cap_usd` | All departments frozen, all `money_out` → ASK | Founder raises cap |
| Runway < $2.00 | All departments except D11 and D12 frozen; D11 files a founder card | Revenue arrives or founder adds float |
| Kill switch | Everything ([`06-human-in-the-loop.md`](06-human-in-the-loop.md)) | Explicit resume |

Thawing re-issues credential grants, resumes the sandbox, and re-queues from the last artifact
boundary. **Nothing restarts from zero** — that's the Superserve pause/resume property doing
economic work, not just operational work.

---

## Founder-set caps

Set at venture creation, editable any time from the Boardroom or by replying to a Linq card.

| Cap | Default | Enforcement point |
|---|---|---|
| `spend_cap_usd` | $50.00 | Venture-wide hard stop; checked on every `reserve()` |
| `terac_cap_usd` | $200.00 | HR requisition approval; a single hire over this always ASKs |
| `per_cycle_usd` | $30.00 | `budgets.total_usd` |
| `max_voice_minutes_per_cycle` | 60 | D04/D10 tool plane counter |
| `max_outbound_per_day` | 50 | D09/D10, also a compliance limit ([`12-safety-and-compliance.md`](12-safety-and-compliance.md)) |
| `auto_approve_ceiling_usd` | $5.00 | The `money_out` AUTO* threshold in the autonomy decision table |

All six are shown together on one Boardroom panel with a single "the company can spend at most
$X before it must ask you" sentence computed from them. A founder who cannot state their maximum
downside will not leave the thing running, and a company nobody leaves running is not autonomous.
