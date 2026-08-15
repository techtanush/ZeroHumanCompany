# 04 — KPI Dictionary

Every KPI the company tracks, defined once. Each entry: definition, exact formula, source of truth
(table / event / materialized view), owning department, demo target, real-venture target, and
refresh cadence. All KPI reads are projections of the event log
([`../01-platform/04-data-model.md`](../01-platform/04-data-model.md)); if a metric cannot be
computed from events + content stores, it does not exist.

Conventions:

- Formulas are SQL-ish over the tables in the data model; `cycle` = 5 min in demo, 24 h real
  (`ventures.time_scale` compresses crons, not the definitions).
- "Demo target" = what the `demo-1` venture should show on stage in the 4-minute run + its
  pre-run history. "Real target" = a defensible early-stage target for an actual venture (labeled
  estimate, `method: 'estimated'` — priors, not sources).
- Cadence: `live` = SSE on each event; `cycle` = recomputed at cycle close; `daily/weekly` = D13
  review cadence (compressed in demo).
- KPI IDs are stable and namespaced; dashboards and D13 telemetry queries refer to them by ID.

Index: [Idea quality](#idea-quality-d01d02) · [Research accuracy](#research-accuracy-d03) ·
[Validation & interviews](#validation--interview-conversion-d04d05) ·
[Outreach performance](#outreach-performance-d04-d10) · [Lead quality](#lead-quality-d09) ·
[Sales conversion](#sales-conversion-d10) · [Product & engagement](#product--engagement-d07d12) ·
[Retention](#retention-d12) · [Support load](#support-load-d12) · [Revenue](#revenue-d11) ·
[Cost](#cost-d11) · [Agent performance](#agent-performance-d13--platform) ·
[North star](#north-star-composite)

---

## Idea quality (D01/D02)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| IQ-1 | Candidate evidence density | Cited pain quotes per Mode-B candidate | `avg(jsonb_array_length(body->'pain_evidence'))` over signed `OpportunityCandidate` | `artifacts` | D01 | ≥ 3.0 (schema floor) | ≥ 4.0 | per run |
| IQ-2 | Sharpening delta | How much Office Hours shrank the idea: WMBT items testable this week / total | `count(wmbt WHERE test != '' AND blocking)` ÷ `count(wmbt)` from `SharpenedIdea` | `artifacts` | D02 | 1.0 (all testable) | 1.0 | per run |
| IQ-3 | Assumption honesty | Share of founder-absent answers flagged as invented | `count(open_assumptions WHERE invented_by_agent)` ÷ `count(open_assumptions)` when `mode='founder_absent'` | `artifacts` | D02 | 100% flagged | 100% | per run |
| IQ-4 | Kill-criteria coverage | Kill criteria with a named measuring department and deadline | `count(kill_criteria WHERE measured_by IS NOT NULL AND deadline != '')` ÷ total; floor 3 | `artifacts` | D02 | 3/3 | ≥ 3, all covered | per run |
| IQ-5 | Idea survival rate | Ventures whose `SharpenedIdea` survives validation without `PIVOT`-op diff | `1 − count(IdeaDiff WHERE op='PIVOT' AND approved)` ÷ ventures | `artifacts`, `gates` | D06 (reports on D02) | n/a (n=1) | 40–60% (too high = grilling too soft, too low = intake too weak) | weekly |

## Research accuracy (D03)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| RA-1 | Citation completeness | Load-bearing numbers (tam/sam/som/mrr/price) with ≥1 source | `count(artifact_sources WHERE json_pointer IN load_bearing)` ÷ expected pointers per signed dossier | `artifact_sources` | D03 | 100% (signing blocks below this) | 100% | per run |
| RA-2 | Source reliability mix | Weighted mean of `sources.reliability` behind signed dossiers | `avg(s.reliability)` weighted by `asrc.confidence` | `sources`, `artifact_sources` | D03 | ≥ 0.6 | ≥ 0.7 | per run |
| RA-3 | Estimate honesty ratio | Fields labeled `measured`/`derived` vs `estimated`/`asserted` | `count(method IN ('measured','derived'))` ÷ total | `artifact_sources` | D03 | ≥ 50% | ≥ 70% | per run |
| RA-4 | Dossier completeness | Signed (non-partial) dossiers per run vs `min_outputs` | `count(quality='signed')` ÷ 5 | `artifacts` | D03 | ≥ 5/5, ≤1 partial tolerated | 6–10 | per run |
| RA-5 | Research hit rate | Selected niche not contradicted by later real evidence (ClaimLedger verdict on its WMBTs) | contradicted WMBT themes on selected niche ÷ tested | `artifacts` (ClaimLedger) | D03 (graded by D06) | ≤ 1 contradiction, surfaced not hidden | ≤ 25% | post-validation |
| RA-6 | Research cost per signed dossier | Envelope efficiency | `sum(meters.cost_usd WHERE dept='D03', cycle)` ÷ signed dossiers | `meters` | D03/D11 | ≤ $0.80 | ≤ $2 | cycle |

## Validation & interview conversion (D04/D05)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| VC-1 | Real conversations | Completed interviews with consent records | `count(interviews WHERE outcome='completed')` | `interviews` | D04 | ≥ 5 (liveness threshold; pre-run history counts, labeled) | ≥ 15 before build commit | live |
| VC-2 | Outreach→booked rate | Booked calls ÷ humans contacted | `count(scheduled_at IS NOT NULL)` ÷ `count(distinct contacted)` from `human.notified` events | events, `interviews` | D04 | ≥ 25% (warm network) | 10–20% network, 3–8% beyond | cycle |
| VC-3 | Booked→completed (show) rate | Completed ÷ booked | `count(outcome='completed')` ÷ `count(scheduled_at IS NOT NULL)` | `interviews` | D04 | ≥ 70% | ≥ 60% | cycle |
| VC-4 | Evidence-class quality | Claims grounded in past behavior / current practice vs stated intent / opinion | `count(evidence_class IN ('past_behavior','current_practice'))` ÷ all claims | `claims` | D04 | ≥ 50% | ≥ 60% (Mom-Test discipline) | per ledger |
| VC-5 | WMBT test coverage | `what_must_be_true` items with ≥3 claims touching them | covered WMBT ÷ total from `ClaimLedger.what_must_be_true_status` | `artifacts` | D04 | 100% of blocking items | 100% blocking, ≥70% all | per ledger |
| VC-6 | Panel calibration delta | Mean abs difference, synthetic estimate vs real-interview theme rate | `avg(abs(delta))` over `contradictions_with_synthetic` + `calibration.delta` | `artifacts` (panel, ledger) | D05 | ≤ 0.15, displayed on stage | ≤ 0.10 after calibration | per panel |
| VC-7 | Panel reproducibility | Same seed+model+prompts ⇒ identical estimates | byte-diff of clean re-run (simit cache) | simpop sqlite | D05 | exact | exact | per release |
| VC-8 | Terac panel fill rate | Hired ÷ requisitioned when network exhausted | `count(terac_hires.status IN ('delivered','accepted','paid'))` ÷ `sum(requisition.who.count)` | `terac_hires` | D11/HR for D04 | 100% of the 1 demo requisition | ≥ 80% by deadline | per requisition |
| VC-9 | Cost per validated claim | Validation efficiency | `sum(meters D04+D05)` ÷ `count(claims)` | `meters`, `claims` | D04 | ≤ $0.40 | ≤ $1.00 | cycle |

## Outreach performance (D04, D10)

Sending metrics shared by discovery outreach and sales sequences; consent metrics are hard gates,
not targets to trade off.

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| OP-1 | Delivery rate | Delivered ÷ sent (email) | provider webhook events ÷ `human.notified` count | events | D04/D10 | ≥ 95% | ≥ 97% | live |
| OP-2 | Reply rate — warm | Replies ÷ warm sends | `sales.reply_received` ÷ sends where `provenance.pool='warm'` | events, `leads` | D10 | ≥ 40% (observed 55–70% prior per D09) | ≥ 40% | cycle |
| OP-3 | Reply rate — cold | Replies ÷ cold sends | same, `pool='cold'` | events | D10 | ≥ 5% | 3–8% | cycle |
| OP-4 | Positive-reply share | Non-opt-out, non-hostile replies ÷ replies | classified reply sentiment (haiku/pioneer) | events | D10 | ≥ 60% | ≥ 70% | cycle |
| OP-5 | Opt-out rate | Opt-outs ÷ sends | `human.dnc_added` ÷ sends | events | D09 compliance | ≤ 2% | ≤ 1% (higher ⇒ pause sequences, review lists) | live |
| OP-6 | Consent violations | Sends to `dnc`/`opted_out`/`unknown` consent | count — **this is an incident, not a KPI to optimize** | events audit | D09 | 0 | 0 | live |
| OP-7 | Voice disclosure compliance | Calls with disclosure at open | calls with `consent.ai_disclosed` ÷ all calls | `interviews`, call logs | D04/D10 | 100% | 100% | live |
| OP-8 | Send→meeting rate | Meetings booked ÷ sends | `sales.meeting_booked` ÷ sends | events | D10 | ≥ 8% warm | 2–5% blended | cycle |

## Lead quality (D09)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| LQ-1 | Pipeline volume | Qualified (T1–T3, consent-clean) leads | `count(leads WHERE tier != 'disqualified' AND consent_state NOT IN ('unknown','opted_out','dnc') AND NOT suppressed)` | `leads` | D09 | ≥ 25 (`pipeline_active` threshold) | ≥ 200 by day 30 | live |
| LQ-2 | Warm-pool completeness | Interviewed humans present as warm leads | warm leads with `interviewed_id` ÷ completed interviews | `leads`, `interviews` | D09 | 100% | 100% | cycle |
| LQ-3 | Verified-handle rate | Leads with ≥1 `verified` handle | `count(EXISTS verified handle)` ÷ leads | `leads` | D09 | ≥ 80% | ≥ 90% | per batch |
| LQ-4 | Dup rate | Duplicate identities across batches | fuzzy-dedup matches ÷ batch size (`pg_trgm`) | `leads` | D09 | < 1% (critic gate) | < 1% | per batch |
| LQ-5 | Score calibration | Does `icp_fit` predict replies? Corr(score decile, reply rate) | Spearman over deciles once n ≥ 100 sends | `leads`, events | D09 | n/a (n too small — report "insufficient data", never fake) | ρ ≥ 0.5 | weekly |
| LQ-6 | Trigger freshness | Cold leads with a trigger event < 30 days old | `count(triggers.recency_days < 30)` ÷ cold leads | `leads` | D09 | ≥ 50% | ≥ 60% | per batch |
| LQ-7 | Cost per qualified lead | Acquisition efficiency | `sum(meters D09)` ÷ LQ-1 new | `meters`, `leads` | D09/D11 | ≤ $0.15 | ≤ $0.50 | cycle |

## Sales conversion (D10)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| SC-1 | Stage conversion — contacted→replied | | stage-transition counts from `sales.deal_stage_changed` | events | D10 | ≥ 30% (warm-heavy mix) | ≥ 15% | cycle |
| SC-2 | Stage conversion — replied→meeting | | same | events | D10 | ≥ 50% | ≥ 40% | cycle |
| SC-3 | Stage conversion — meeting→won | | same | events | D10 | ≥ 1 won on stage | 20–30% | cycle |
| SC-4 | Time to first revenue | Venture created → first `paid` order | `min(orders.paid_at) − ventures.created_at` | `orders`, `ventures` | D10/D11 | < 4 min live (test-mode, labeled) + pre-run history | < 14 days | once |
| SC-5 | Average deal value | | `avg(deals.value_usd WHERE stage='won')` | `deals` | D10 | = demo price point | ≥ GTM anchor tier | cycle |
| SC-6 | Loss-reason concentration | Largest `lost_reason_cluster` share — D13's raw material | `max(cluster count)` ÷ losses (n≥3) | `deals` | D10→D13 | the seeded 3-loss security cluster (finale) | no cluster > 40% unaddressed | weekly |
| SC-7 | Objection coverage | Observed objections already in the GTM matrix | matched ÷ observed | `deals.objections`, `GTMPlan` | D10/D08 | ≥ 70% | ≥ 80% (else D08 re-run) | weekly |
| SC-8 | Quote-back rate | Warm outreach citing the lead's own interview claim | sends with `claim_ids` ÷ warm sends | events, drafts | D10 | 100% of warm | 100% | live |

## Product & engagement (D07/D12)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| PE-1 | Deploy health | Product URL healthy | latest `deployments.health` | `deployments` | D07 | `green` on stage | ≥ 99% green (probe cron) | live |
| PE-2 | QA pass rate | Passed ÷ total scenarios, latest deployment | `qa.passed / qa.scenarios_total` | `deployments`, `qa_runs` | D07 | 100% after the one on-stage fix | 100% p0, ≥ 90% all | per deploy |
| PE-3 | Spec→ship fidelity | p0 features shipped ÷ p0 specced | shipped feature ids ÷ `ProductSpec` p0 set | `artifacts`, `deployments` | D07 | 100% p0 | 100% p0, ≥ 70% p1 | per deploy |
| PE-4 | Activation rate | New customers completing the core action ("aha") within 24 h | activated ÷ new sign-ups, from the product's own analytics events forwarded to the kernel | product events | D12 | ≥ 1 activated customer (the buyer) | ≥ 40% | daily |
| PE-5 | Time to first value | Sign-up → first core action | median delta | product events | D12/D07 | < 5 min | < 1 day | daily |
| PE-6 | Feature evidence linkage | Shipped features traceable to claims/diffs | features with non-empty `justified_by` ÷ shipped | `artifacts` | D06/D07 | 100% p0 | ≥ 80% | per deploy |

## Retention (D12)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| RT-1 | Logo churn (monthly) | Customers lost ÷ customers at period start | `count(subscription canceled in period)` ÷ start count | `orders`, Stripe webhooks | D12 | n/a (period too short) — show the definition wired | ≤ 5%/mo early | monthly |
| RT-2 | Net revenue retention | (start MRR + expansion − contraction − churn) ÷ start MRR | ledger MRR movements | ledger | D11/D12 | n/a — wired, labeled "insufficient period" | ≥ 100% | monthly |
| RT-3 | Dunning recovery rate | Failed payments recovered ÷ failed | `invoice.paid after failure` ÷ `invoice.payment_failed` | Stripe events | D11 | n/a or seeded example | ≥ 40% | weekly |
| RT-4 | Repeat-usage rate (week 1) | Customers active on ≥3 days of first week | product events | product events | D12 | n/a | ≥ 30% | weekly |
| RT-5 | Churn-signal lead time | ProductSignal filed before the churn it predicted | signals linked to later-churned customers ÷ churns | `product_signals`, `orders` | D12→D13 | definition wired | ≥ 50% of churns pre-signaled | monthly |

Honesty rule: retention KPIs on a 4-minute-old venture are **not faked** — the Boardroom renders
"insufficient period" with the wired definition. Same P4/P6 posture as everywhere else.

## Support load (D12)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| SL-1 | First-response time | Ticket open → first substantive reply | median `ts(first outbound) − ts(ticket_opened)` | events | D12 | < 2 min | < 1 h business | live |
| SL-2 | Autonomous resolution rate | Resolved without human/founder/Terac rung | `count(resolved AND no escalation past rung 2)` ÷ resolved | `tickets`, `escalations` | D12 | ≥ 80% | ≥ 70% | cycle |
| SL-3 | Diagnosis quality | Resolutions with `code_refs` when code-caused | `count(diagnosis.code_refs != [])` ÷ code-caused resolutions | `tickets` | D12 | 100% | ≥ 90% | cycle |
| SL-4 | Tickets per customer per week | Support load normalizer | tickets ÷ active customers | `tickets`, `orders` | D12 | n/a (n=1) | ≤ 0.5 | weekly |
| SL-5 | Signal conversion | Recurring complaints (≥2) that became ProductSignals | signals ÷ recurring complaint clusters | `tickets`, `product_signals` | D12 | 100% | 100% | cycle |
| SL-6 | Escalation-to-human rate | Tickets needing rung ≥4 (founder/Terac) | count ÷ tickets | `escalations` | D12 | ≤ 10% | ≤ 5% | cycle |

## Revenue (D11)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| RV-1 | Realized revenue | Sum of paid orders (test-mode labeled separately, always) | `sum(amount_usd WHERE status='paid')` split by `is_test_mode` | `orders` | D11 | ≥ 1 live test-mode charge on stage | first real $ by day 14 | live |
| RV-2 | MRR | Normalized recurring revenue | Σ active subscription amounts normalized to monthly | Stripe objects, ledger | D11 | the one subscription, labeled | ≥ $1k by day 90 (venture-dependent estimate) | daily |
| RV-3 | Rail reconciliation | Ledger vs provider objects | `abs(ledger − Σ provider)` | ledger, rail APIs | D11 | $0.00 | ≤ $0.01 | cycle |
| RV-4 | Runway | Founder float + realized revenue − committed spend | `budgets.runway_usd` | `budgets` | D11 | positive and visibly recomputed at 3:15 | ≥ 4 weeks at current burn | cycle |
| RV-5 | Revenue per department dollar | Realized revenue ÷ total metered cost — D13's value-per-dollar signal | RV-1 ÷ `sum(meters.cost_usd)` | `orders`, `meters` | D11→D13 | ≥ 0.5 with the $29 demo charge vs ≈$42 cost, trending shown | > 3 by month 3 | cycle |

## Cost (D11)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| CT-1 | Venture cost to date | All-in metered spend | `sum(meters.cost_usd)` per venture | `meters` | D11 | ≈ $42 idea→charge (the pitch number) | < $500/mo early | live |
| CT-2 | Cost per department cycle | Envelope utilization | `mv_department_spend.spent_usd` ÷ `envelope_usd` | MV, `budget_allocations` | D11 | 60–90% healthy; >100% = freeze event shown | 60–90% | cycle |
| CT-3 | Cost per artifact | Spend ÷ signed artifacts, by type | `sum(meters per work_order)` ÷ signed | `meters`, `artifacts` | D11/D13 | dossier ≤ $0.80, interview ≤ $3.50, deploy ≤ $12 | tracked, trending down | cycle |
| CT-4 | Token-tier mix | Spend share by tier — downgrade discipline | Σ cost by `model_tier` ÷ total | `agent_runs` | D11 | opus ≤ 40% | opus ≤ 25% as pioneer ramps | cycle |
| CT-5 | Cache hit economics | Cached-read tokens ÷ total input tokens | `tokens_cached` ÷ `tokens_in` | `agent_runs` | platform | ≥ 50% for resident heads | ≥ 70% | cycle |
| CT-6 | Human-hire spend | Terac spend vs cap | `sum(terac_hires.paid_usd)` vs `founders.terac_cap_usd` | `terac_hires` | D11/HR | the one panel, ≈$60, under cap | ≤ cap, ROI-positive per requisition | live |
| CT-7 | Budget breach incidents | Reserve failures / hard-cap hits | `money.budget_exceeded` count | events | D11 | ≥ 1 shown handled gracefully (it's a beat) | rare, always graceful | cycle |

## Agent performance (D13 + platform)

| ID | KPI | Definition | Formula | Source | Owner | Demo | Real | Cadence |
|---|---|---|---|---|---|---|---|---|
| AP-1 | First-pass critic acceptance | Artifacts accepted without revision | `1 − count(revision loops)` ÷ signed artifacts | `agent_runs`, events | D13 | ≥ 60% | ≥ 75% | cycle |
| AP-2 | Contested-ship rate | Artifacts shipped `quality='contested'` (critic rejected twice) | count ÷ signed | `artifacts` | D13 | ≤ 10% | ≤ 5% | cycle |
| AP-3 | Partial-ship rate | `quality='partial'` share — honesty in action, watch the trend not the level | count ÷ signed | `artifacts` | D13 | ≤ 20%, every gap enumerated | ≤ 10% | cycle |
| AP-4 | Fabrication incidents | Signed artifacts later found with uncited/invented load-bearing content | postmortem count — **P0, target is zero, ever** | audits | D13 | 0 | 0 | continuous |
| AP-5 | Escalation resolution time | Raise → resolve, by rung | median per rung from `escalation.*` events | `escalations` | D13 | rung ≤2 in seconds; rung 4 < gate timeout | rung-specific SLOs | cycle |
| AP-6 | Retry burn | Spend on retries ÷ total spend | retry-flagged run cost ÷ total | `agent_runs`, `meters` | D13 | ≤ 15% | ≤ 8% | cycle |
| AP-7 | Gate friction | Founder ASK gates per venture-day, and median decision time | `count(gates.status='pending' at open)` ÷ day; `decided_at − opened_at` | `gates` | D13 | 2 taps in 4 min (by design) | ≤ 10/day, < 15 min median | daily |
| AP-8 | Auto-approve share | Gates auto-approved under policy ÷ all gates | `count(auto_approved)` ÷ total | `gates` | D13 | ≥ 80% at `autonomous` | level-appropriate | cycle |
| AP-9 | Pioneer lift | Fine-tuned classifier accuracy − haiku baseline, on held-out labels | eval-set delta | eval runs | D13 | shown for lead-scorer if ≥500 labels | ≥ +5 pts before switch | per fine-tune |
| AP-10 | Shadow-test win rate | D13 shadow runs where the new capability beats history | `would_have_changed_outcome` ÷ `cases` | `capability_gaps` | D13 | the finale department's shadow report on screen | ≥ 30% before deploy recommendation | per gap |
| AP-11 | Replay determinism | `replay(work_order_id)` reproduces the signed artifact hash | reproduced ÷ attempted | replay harness | platform | 100% on demo fixtures | ≥ 95% | per release |

## North star (composite)

| ID | KPI | Definition | Source | Cadence |
|---|---|---|---|---|
| NS-1 | Venture liveness | The five-segment ring: `idea_locked ∧ market_validated ∧ product_live ∧ pipeline_active ∧ revenue_real` | `ventures.liveness` projection | live |
| NS-2 | Time to liveness | Venture created → all five segments true | events | once |
| NS-3 | Founder tap count | Founder decisions required to reach liveness (lower = more autonomous, subject to the NEVER-auto gate list) | `gates` where decided_by = founder | once |
| NS-4 | Cost to liveness | CT-1 at the moment NS-1 completes | `meters` | once |

Demo: NS-1 completes on stage; NS-2 < 4 minutes (with labeled pre-run assist); NS-3 = 2 taps;
NS-4 ≈ $42. Real venture: NS-2 < 14 days, NS-3 < 25 taps, NS-4 < $500. These four numbers are the
company's own scoreboard and the first thing D13's weekly review reads.

## Implementation: the KPI read model

KPIs are served from one materialized view per cadence class, refreshed on the same tick as
`mv_department_spend` ([`../01-platform/04-data-model.md`](../01-platform/04-data-model.md)).
Live KPIs are client-side reductions over the SSE stream; cycle/daily KPIs are SQL.

```sql
-- kpi definitions registry: the Boardroom and D13 read targets from here, not from code.
CREATE TABLE kpi_definitions (
  id            text PRIMARY KEY,          -- 'SC-4'
  name          text NOT NULL,
  owner_dept    text NOT NULL,
  cadence       text NOT NULL CHECK (cadence IN ('live','cycle','daily','weekly','monthly','once')),
  formula_ref   text NOT NULL,             -- named query in apps/kernel/src/kpi/queries.ts
  demo_target   jsonb,                     -- {op:'>=', value:1, unit:'count'}
  real_target   jsonb,
  higher_is_better boolean NOT NULL DEFAULT true,
  hard_floor    boolean NOT NULL DEFAULT false   -- true ⇒ breach is an incident (OP-6, AP-4)
);

CREATE MATERIALIZED VIEW mv_kpi_cycle AS
SELECT v.id AS venture_id, b.cycle_id, k.id AS kpi_id,
       kpi_eval(k.formula_ref, v.id, b.cycle_id) AS value,   -- SQL function dispatch
       now() AS computed_at
FROM ventures v CROSS JOIN kpi_definitions k
JOIN budgets b ON b.venture_id = v.id
WHERE k.cadence = 'cycle';
CREATE UNIQUE INDEX ON mv_kpi_cycle (venture_id, cycle_id, kpi_id);
```

Worked formulas for the four KPIs judges will actually interrogate:

```sql
-- SC-4  Time to first revenue
SELECT min(o.paid_at) - v.created_at AS ttfr, bool_or(o.is_test_mode) AS includes_test_mode
FROM orders o JOIN ventures v ON v.id = o.venture_id
WHERE o.venture_id = $1 AND o.status = 'paid'
GROUP BY v.created_at;

-- VC-6  Panel calibration delta (latest panel vs latest ledger)
SELECT avg(abs((c->>'delta')::numeric)) AS mean_abs_delta, count(*) AS themes_compared
FROM artifacts a, jsonb_array_elements(a.body->'contradictions_with_synthetic') c
WHERE a.venture_id = $1 AND a.type = 'ClaimLedger' AND a.quality = 'signed'
  AND a.version = (SELECT max(version) FROM artifacts
                   WHERE venture_id = $1 AND type = 'ClaimLedger');

-- RV-5  Revenue per department dollar
SELECT coalesce(sum(o.amount_usd) FILTER (WHERE o.status='paid'), 0)
     / nullif(sum(m.cost_usd), 0) AS revenue_per_dollar
FROM meters m
LEFT JOIN orders o ON o.venture_id = m.venture_id
WHERE m.venture_id = $1;

-- AP-7  Gate friction (founder taps + median decision latency, last 24h scaled)
SELECT count(*) FILTER (WHERE decided_by IS NOT NULL AND status IN ('approved','rejected','redirected'))
         AS founder_decisions,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY decided_at - opened_at) AS median_latency
FROM gates
WHERE venture_id = $1 AND opened_at > now() - interval '24 hours' * $2;  -- $2 = time_scale
```

## KPI → event mapping

Which events feed which KPI families — the checklist for reducer authors. If an event type below
is not emitted, its KPIs silently read zero, so this table is also the observability test plan.

| Event namespace | KPI families fed |
|---|---|
| `artifact.signed / superseded / contested` | IQ-*, RA-1..4, VC-5, PE-3, PE-6, AP-1..3 |
| `human.notified / replied / call_* / consent_recorded / dnc_added` | VC-2..3, OP-1..8 |
| `sales.lead_created / sequence_started / reply_received / meeting_booked / deal_*` | LQ-1, SC-1..8, OP-2..4 |
| `money.metered / budget_* / revenue_received / refunded` | RV-*, CT-*, RA-6, VC-9, LQ-7 |
| `terac.requisition_filed / hire_posted / work_delivered / paid` | VC-8, CT-6 |
| `build.deployed / qa_* / rolled_back` | PE-1..3, AP-11 (via replay harness) |
| `support.ticket_opened / ticket_resolved / signal_filed` | SL-*, RT-5 |
| `gate.opened / approved / rejected / auto_approved / timed_out` | AP-7, AP-8, NS-3 |
| `escalation.raised / climbed / resolved` | AP-5, SL-6 |
| `cos.gap_detected / shadow_test_run / department_deployed` | AP-10, SC-6 (consumption) |
| product analytics webhook (`product.events`) | PE-4, PE-5, RT-4 |

## Review cadences (who looks at what, when)

| Cadence | Reviewer | KPI set | Action on breach |
|---|---|---|---|
| live | Boardroom (render only) + hard-floor monitors | OP-6, AP-4, PE-1, NS-1 | Hard floors page: kill sequences (OP-6), freeze signing + postmortem (AP-4), D07 wake (PE-1) |
| cycle | `finance.treasurer` | CT-*, RV-4, all dept efficiency KPIs | Reallocation with written rationale; freeze at policy threshold |
| daily (compressed in demo) | `cos.analyst` | AP-*, SC-6, SL-2, OP-2..5 | Findings → gap-detector; tier/prompt tuning work orders |
| weekly | `cos.head` → founder digest | IQ-5, RA-5, LQ-5, SC-7, RT-*, NS-* | `CapabilityGap` filings; GTM re-run triggers; founder Linq digest card |
| per release | platform CI | VC-7, AP-11 | Block release on determinism regression |

## Assumptions & open questions

- All "Real" targets are priors (`method: 'estimated'`), set from early-stage SaaS norms; they are
  starting envelopes for Treasury and D13, not commitments. Recalibrate after the first real
  venture and store the revision in institutional memory.
- PE-4/PE-5/RT-4 require the built product to forward analytics events to the kernel — that
  contract (`product.events` webhook) should be confirmed in D07's build template. **(confirm)**
- LQ-5 and AP-9 are deliberately gated on sample size; the Boardroom must render "insufficient
  data" rather than a number below threshold (P6).
- Whether OP metrics split by channel (email vs Linq vs voice) at the KPI level or only in
  drill-down is a Boardroom design call — the events carry `channel` either way.
