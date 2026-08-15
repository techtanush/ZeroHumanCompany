# 03 — Event Bus & Message Contracts

## Two layers, deliberately

1. **The Event Store (Postgres, append-only)** — the truth. Never bypassed. Everything that
   happened, in order, forever. State is a projection.
2. **The Bus** — how departments *talk*. Primary transport is the **Band** agentic mesh; fallback
   is Postgres `LISTEN/NOTIFY` + BullMQ. The bus is a delivery mechanism; the event store is the
   record. Every bus message is also an event.

```
agent.emit(msg) ──► EventStore.append(event)  ── always
                        │
                        └──► Bus.publish(msg) ──► Band room  ──(if healthy)
                                              └─► PG NOTIFY  ──(fallback / mirror)
```

If Band is down, nothing is lost and nothing changes semantically — `bus.transport` on the event
just records which path it took, and the Boardroom shows a "degraded mesh" chip.

---

## The three inter-department messages

All in `packages/contracts/src/messages.ts`, Zod-validated on both send and receive.

```ts
export const WorkOrder = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  from: DepartmentId,                 // 'D02'
  to: DepartmentId,                   // 'D03'
  intent: z.string(),                 // 'research_niches'
  input_artifacts: z.array(ArtifactRef),
  params: z.record(z.unknown()).default({}),
  budget_usd: z.number(),
  soft_deadline_at: z.string().datetime(),
  success_criteria: z.array(z.string()),   // human-readable, checked by the Critic
  trace_id: z.string(),                    // spans the whole venture flow
  attempt: z.number().int().default(0),
});

export const ArtifactReady = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  from: DepartmentId,
  work_order_id: z.string().uuid(),
  artifact: ArtifactRef,              // {type, id, version, hash}
  quality: z.enum(['signed','partial','contested']),
  gaps: z.array(z.string()).default([]),
  cost_usd: z.number(),
  trace_id: z.string(),
});

export const Escalation = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  from: DepartmentId,
  reason: z.enum(['needs_human','needs_budget','needs_capability','needs_credential','needs_approval']),
  severity: z.enum(['blocking','degrading','informational']),
  summary: z.string(),                // one sentence, founder-readable
  detail: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string(), consequence: z.string() })),
  suggested_option_id: z.string().optional(),
  blocks_work_order_id: z.string().uuid().optional(),
  trace_id: z.string(),
});
```

**Design note:** `Escalation.options` is why the founder experience is one tap. The company never
asks an open question; it asks a multiple-choice question with consequences spelled out and its own
recommendation pre-selected.

---

## Event taxonomy

Namespaced `<domain>.<verb_past_tense>`. Append-only, immutable, `{id, venture_id, ts, actor, type, payload, trace_id, causation_id, correlation_id}`.

| Namespace | Events |
|---|---|
| `venture.*` | `created`, `mode_set`, `autonomy_changed`, `killed`, `resumed`, `milestone_reached` |
| `dept.*` | `work_order_issued`, `work_started`, `work_completed`, `work_failed`, `frozen`, `unfrozen` |
| `agent.*` | `started`, `tool_used`, `tool_failed`, `finished`, `retried`, `budget_exceeded` |
| `artifact.*` | `created`, `signed`, `superseded`, `contested` |
| `gate.*` | `opened`, `approved`, `rejected`, `redirected`, `timed_out`, `auto_approved` |
| `human.*` | `notified`, `replied`, `call_placed`, `call_completed`, `consent_recorded`, `dnc_added` |
| `terac.*` | `requisition_filed`, `hire_posted`, `worker_matched`, `work_delivered`, `paid` |
| `money.*` | `metered`, `budget_allocated`, `budget_exceeded`, `revenue_received`, `refunded`, `payout` |
| `build.*` | `repo_created`, `commit_pushed`, `qa_started`, `qa_failed`, `qa_passed`, `deployed`, `rolled_back` |
| `sales.*` | `lead_created`, `sequence_started`, `reply_received`, `meeting_booked`, `deal_stage_changed`, `deal_won`, `deal_lost` |
| `support.*` | `ticket_opened`, `ticket_resolved`, `signal_filed` |
| `cos.*` | `gap_detected`, `department_designed`, `shadow_test_run`, `department_deployed` |
| `bus.*` | `degraded`, `recovered` |

Everything the Boardroom renders is one of these. If a UI element has no event behind it, it is
fake and must be deleted.

---

## Routing rules (declarative)

```yaml
# packages/manifests/routing.yaml
- when: artifact.signed(type=SharpenedIdea)
  emit:
    - work_order: {to: D03, intent: research_niches, budget_usd: 4.00}
    - work_order: {to: D04, intent: mine_network, budget_usd: 3.00}
    - work_order: {to: D05, intent: build_panel,    budget_usd: 1.50}

- when: artifact.signed(type=NicheDossier[]) AND gate.approved(id=niche_selection)
  emit:
    - work_order: {to: D04, intent: run_discovery_interviews, budget_usd: 6.00}

- when: all_signed([ClaimLedger, SyntheticPanelResult])
  emit:
    - work_order: {to: D06, intent: propose_pivots, budget_usd: 3.00}

- when: artifact.signed(type=ProductSpec, version>=2)
  emit:
    - work_order: {to: D07, intent: build_product, budget_usd: 12.00}
    - work_order: {to: D08, intent: draft_gtm,     budget_usd: 3.00}

- when: build.deployed
  emit:
    - work_order: {to: D09, intent: build_lead_lists, budget_usd: 4.00}

- when: sales.deal_won
  emit:
    - work_order: {to: D11, intent: collect_and_reconcile, budget_usd: 0.50}
    - work_order: {to: D12, intent: onboard_customer,      budget_usd: 0.50}

- when: support.signal_filed(severity>=high) OR sales.deal_lost(count>=3, reason_cluster=*)
  emit:
    - work_order: {to: D06, intent: reassess_product, budget_usd: 2.00}

- when: cron(cos.daily) OR cos.gap_detected
  emit:
    - work_order: {to: D13, intent: review_company, budget_usd: 2.00}
```

Routing lives in one file so a reader can see the whole company's nervous system at once, and so
D13 can *append rules* when it deploys a new department.

---

## Band mesh mapping

| Zeroth concept | Band concept |
|---|---|
| Department | A registered agent identity on the mesh |
| Cross-department negotiation (Sales ↔ Finance) | A persistent Band **room** with shared context |
| `WorkOrder` | Band delegation message |
| Tool allowlist + spend authority | Band **governance policy** enforced at the control plane |
| Discovery ("who can do X?") | Band agent discovery — this is how D13's new department becomes reachable **without a redeploy** |

The last row matters: when Chief of Staff spawns a new department, it registers on the Band mesh
and other departments discover it dynamically. That is the difference between "we hardcoded 13
departments" and "the company can grow."

**Persistent rooms we create at venture start:**
`sales↔finance` (collections), `support↔build` (bug triage), `market↔pivot` (evidence),
`hr↔all` (requisitions), `cos↔all` (observation, read-only).

---

## Idempotency and ordering

- Every message carries `id`; consumers keep a `processed_messages` table. At-least-once delivery,
  exactly-once effect.
- Ordering is per-`trace_id` only. Cross-venture ordering is not guaranteed and never assumed.
- Side-effecting tools (send email, charge card, hire human) additionally take an
  `idempotency_key = hash(work_order_id, action, target)` passed through to Stripe/Terac/Composio.
