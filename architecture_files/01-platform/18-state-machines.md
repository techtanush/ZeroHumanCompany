# 18 — State Machines

Purpose: collect the canonical state transitions so reducers, UI, and departments do not invent different lifecycles.

## Venture lifecycle

```mermaid
stateDiagram-v2
  [*] --> active
  active --> paused: founder_pause or kill_switch
  paused --> active: founder_resume
  active --> killed: approved_kill_decision
  active --> graduated: founder_exports_company
  killed --> [*]
  graduated --> [*]
```

## Liveness ring

```ts
export const VentureLiveness = z.object({
  idea_locked: z.boolean(),
  market_validated: z.boolean(),
  product_live: z.boolean(),
  pipeline_active: z.boolean(),
  revenue_real: z.boolean(),
});
```

| Segment | Flips true when |
|---|---|
| `idea_locked` | D02 `SharpenedIdea` approved or D06 `ProductSpec` signed |
| `market_validated` | D03/D04/D06 evidence reaches validation threshold |
| `product_live` | D07 deployment health is green |
| `pipeline_active` | D09 releases >= 25 qualified consent-clean leads |
| `revenue_real` | D11 reconciles a paid order; demo test-mode is labeled |

## Work order

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> leased: orchestrator_claimed
  leased --> running: sandbox_ready
  running --> waiting_gate: gate_opened
  waiting_gate --> running: gate_approved
  waiting_gate --> blocked: gate_rejected_or_timeout
  running --> signed: artifact_signed
  running --> partial: timeout_return_partial
  running --> failed: unrecoverable_error
  partial --> [*]
  signed --> [*]
  blocked --> [*]
  failed --> [*]
```

## Gate

```mermaid
stateDiagram-v2
  [*] --> opened
  opened --> approved: founder_approve or auto_approve
  opened --> rejected: founder_reject or auto_reject
  opened --> expired: timeout_hold
  opened --> answered: text_or_code_supplied
  answered --> approved: validator_pass
  answered --> rejected: validator_fail
```

Gate decisions are immutable events. A later "changed my mind" creates a new gate and compensating
event, not an update.

## Artifact quality

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> signed: schema_evidence_critic_pass
  draft --> partial: known_gaps_accepted
  draft --> contested: critic_rejects_twice
  signed --> superseded: newer_version_signed
  partial --> superseded: newer_version_signed
  contested --> superseded: newer_version_signed
```

## Deal

```mermaid
stateDiagram-v2
  [*] --> new
  new --> queued: selected_for_sequence
  queued --> contacted: outbound_sent
  contacted --> replied: reply_received
  replied --> qualified: qualification_pass
  replied --> lost: disqualified_or_no_interest
  qualified --> meeting_booked: calendar_event_created
  meeting_booked --> meeting_completed: call_completed
  meeting_completed --> proposal: proposal_sent
  proposal --> verbal_yes: buyer_accepts_terms
  proposal --> lost: buyer_declines
  verbal_yes --> payment_pending: order_requested
  payment_pending --> won: payment_reconciled
  payment_pending --> proposal: payment_failed_retry
  won --> [*]
  lost --> [*]
```

## Ticket

```mermaid
stateDiagram-v2
  [*] --> new
  new --> triaged
  triaged --> waiting_customer
  triaged --> in_progress
  triaged --> escalated_build
  triaged --> escalated_billing
  triaged --> escalated_founder
  in_progress --> resolved
  waiting_customer --> resolved
  escalated_build --> in_progress
  escalated_billing --> in_progress
  escalated_founder --> in_progress
  resolved --> reopened
  reopened --> triaged
  resolved --> [*]
```

## Budget envelope

```mermaid
stateDiagram-v2
  [*] --> active
  active --> degraded: spent >= degrade_at_pct
  degraded --> frozen: spent >= hard_cap
  frozen --> active: treasury_top_up
  degraded --> active: new_cycle_allocation
  active --> retired: department_retired
```

## Human hire

```mermaid
stateDiagram-v2
  [*] --> requested
  requested --> approved: hr_roi_pass_and_gate
  requested --> rejected: hr_roi_fail_or_founder_reject
  approved --> posted: terac_requisition_created
  posted --> assigned: worker_selected
  assigned --> delivered: deliverable_submitted
  delivered --> accepted: qc_pass
  delivered --> revision_requested: qc_fail
  revision_requested --> delivered
  accepted --> paid: payout_confirmed
  paid --> [*]
```

## Capability improvement

```mermaid
stateDiagram-v2
  [*] --> observed_gap
  observed_gap --> proposal
  proposal --> shadow_test: founder_approves_material_change
  proposal --> rejected
  shadow_test --> canary: eval_pass
  shadow_test --> rolled_back: eval_fail
  canary --> promoted: metrics_hold
  canary --> rolled_back: regression_or_budget_fail
  promoted --> [*]
  rolled_back --> [*]
```

## Assumptions & open questions

- **MVP:** Reducers enforce these transitions; UI never mutates state directly.
- **MVP:** Invalid transitions emit `state.transition_rejected` with reason and trace id.
- **POST-MVP:** Add per-integration sub-state machines for OAuth health and connector rotation.
