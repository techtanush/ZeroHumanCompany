# 12 — Risk Register

Purpose: name the main product, technical, legal, and demo risks with owners and mitigations.

| ID | Risk | Severity | Owner | Mitigation | Trigger |
|---|---|---:|---|---|---|
| R1 | Agents fabricate market evidence | Critical | D03/D06 | Evidence validator blocks uncited claims; source snapshots required | artifact signing fails |
| R2 | Synthetic personas treated as proof | High | D05/D06 | `evidence_class` label and UI warning; cannot be load-bearing alone | synthetic-only recommendation |
| R3 | Non-consented outreach | Critical | D09/D10 | Consent schema, suppression list, outbound gate | missing consent basis |
| R4 | Overpromising unshipped features | High | D10/D08 | Deployment scope check in writer and critic | risky claim in draft |
| R5 | Paid spend without approval | Critical | D11/platform | D11-only money writes, founder caps, gate engine | money_out event |
| R6 | Secrets leak into repo/logs | Critical | D07/platform | Vault refs only, pre-push secret scan, no raw env in artifacts | secret scanner hit |
| R7 | Demo integration outage | Medium | D07/demo lead | Seeded fallback trace with honest label | vendor timeout |
| R8 | Claude Code breaks repo late | High | D07 | Branch isolation, checks, rollback deployment, Replay gate | CI/Replays fail |
| R9 | Voice agent disclosure failure | High | D04/D10 | Script begins with disclosure; no disclosure means no call | voice preflight fail |
| R10 | Financial ledger drift | High | D11 | Idempotent webhooks, double-entry trial balance, reconciliation alert | drift > $0.01 |
| R11 | D13 self-modification unsafe | High | D13/platform | Shadow test, eval, canary, rollback, founder gate | material change |
| R12 | Sponsor integrations feel shallow | Medium | product | Tie each sponsor to a visible department problem | demo review |
| R13 | Computer-use violates platform terms | High | Solari/platform | Account ceremony and forbidden-action gates | CAPTCHA/legal/payment screen |
| R14 | PII over-retention | High | platform | Alias handles, retention classes, encrypted columns | privacy audit |
| R15 | Budget starvation halts demo | Medium | D11 | Demo envelope floors and seeded meter events | frozen dept on critical path |

## Demo fallback matrix

| Failing part | Fallback |
|---|---|
| Stripe unavailable | Use recorded test-mode webhook snapshot and label "replayed vendor event" |
| Composio unavailable | Show approved draft + manual-send Linq card |
| Replay unavailable | Use stored Replay report plus local Playwright smoke |
| Render unavailable | Local deployment card with health probe |
| Superserve unavailable | sandbox0/Docker driver with no long-pause claim |
| Terac unavailable | Show requisition object and human-hire lifecycle with mocked webhook |

## Risk review cadence

- **Per PR:** R6, R8.
- **Per demo rehearsal:** R7, R12, R15.
- **Per outbound batch:** R2, R3, R4, R9, R13, R14.
- **Per finance cycle:** R5, R10.
- **Per D13 proposal:** R11.

## Assumptions & open questions

- **MVP:** Some sponsor interactions may be replayed from snapshots, but must be labeled.
- **POST-MVP:** Legal review is required before real cold outbound or AI voice at scale.
