# 06 — Decision Log

Purpose: record architecture decisions already baked into the docs so future builders do not reopen them accidentally.

| ID | Decision | Status | Consequence |
|---|---|---|---|
| ADR-001 | Use an event-sourced `CompanyOS` kernel | Accepted | All state changes are events; projections are rebuildable |
| ADR-002 | Keep departments replaceable through typed artifacts | Accepted | No department reaches into another department's internals |
| ADR-003 | Treat autonomy as a level, not a boolean | Accepted | Gates can auto-approve only under explicit policy |
| ADR-004 | Use Terac through D11 HR, not as an ad hoc tool | Accepted | Human labor has budget, QC, and payment tracking |
| ADR-005 | Use Band as the primary mesh with Postgres fallback | Accepted | Collaboration is visible but not vendor-locked |
| ADR-006 | Use Superserve primary and sandbox0 fallback | Accepted | Long-lived pause/resume is primary; open fallback remains possible |
| ADR-007 | D10 cannot write money rails | Accepted | Sales requests orders; D11 creates/reconciles them |
| ADR-008 | simit is advisory, never proof of demand | Accepted | Synthetic panels are labeled and cannot replace interviews |
| ADR-009 | Claude Code works in branches and PRs | Accepted | No direct production mutation; source control is the audit boundary |
| ADR-010 | Stripe is the MVP payment rail | Accepted | Whop/Dodo remain alternative rails by business model/geography |
| ADR-011 | Linq is the founder-control surface | Accepted | Approval requests fit the user's existing messaging behavior |
| ADR-012 | D13 may generate departments only through shadow/eval/canary | Accepted | Self-improvement is demoable without unsafe self-modification |

## ADR template

```md
## ADR-NNN — Title

Status: Proposed | Accepted | Superseded

Context:

Decision:

Consequences:

Supersedes:
```

## Open decisions for implementation

| ID | Question | Owner | Needed by |
|---|---|---|---|
| ODR-001 | Which CRM, if any, is connected first through Composio? | founder/D10 | live sales |
| ODR-002 | Which deployment target wins if Render credentials are unavailable? | D07 | hackathon build |
| ODR-003 | What default spend cap should a new founder see? | D11/product | onboarding |
| ODR-004 | Which jurisdictions are allowed for real cold outbound at launch? | legal/D09 | production |
| ODR-005 | Which Anthropic model names/prices are current at implementation time? | D07/D11 | model routing |

## Assumptions & open questions

- **MVP:** Accepted ADRs are binding for hackathon implementation.
- **POST-MVP:** Superseded ADRs must remain in this file with links to replacements.
