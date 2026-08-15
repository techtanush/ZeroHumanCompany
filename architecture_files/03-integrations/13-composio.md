# 13 — Composio

> **Tier 1 (infrastructure).** Managed OAuth so the company can act *as the venture* in Gmail,
> LinkedIn, Calendar, GitHub, Slack, and a CRM. Not a sponsor track — load-bearing plumbing.

---

## What it is

Composio is a **managed tool-and-auth layer for agents**: 1000+ app connectors ("toolkits") with the
OAuth dances, token refresh, and API-shape maintenance handled by the vendor. Verified against
`docs.composio.dev` (2026-08): the current model is **sessions** — `composio.sessions.create()`
scopes connections and tool calls to a stable user ID; a session exposes a small set of **meta
tools** (find, connect, execute) so the agent loads app schemas on demand instead of flooding
context with thousands of tool definitions; users authorize apps via **Connect Links**; sessions
persist and are restored with `composio.use(session_id)`. TypeScript SDK is ESM-only, Node ≥22
(matches our stack); native Anthropic/Claude provider support; a Logs API exposes selected tools,
inputs, responses, and timing.

---

## The exact product problem it solves

Zeroth's departments must **act as the venture** in real accounts: send email from the venture's
Gmail, book meetings on its Calendar, post from its LinkedIn, manage its GitHub repos, run its
Slack, track deals in a CRM. Without Composio that means implementing five OAuth flows, refresh
logic, and API clients — days of D07-equivalent work that produces zero demo value and breaks at
2am. With it, every SaaS-with-an-API becomes one uniform, allowlisted tool surface with auth
handled — and [`04-solari.md`](04-solari.md)'s division of labor becomes clean:
**Composio for everything with an OAuth API, Solari for everything without.** Try Composio first,
Solari second — the browser is the fallback, not the default.

---

## Which departments use it

| Dept | Toolkits | For |
|---|---|---|
| **D04 Outreach** | Gmail, Calendar | Warm-network mining (with consent), interview scheduling, discovery-call invites |
| **D09 Leads** | LinkedIn, CRM | Prospect enrichment, pipeline records |
| **D10 Sales** | Gmail, Calendar, CRM | Sequences, meeting booking, deal records; dunning email execution for D11 |
| **D12 Support** | Gmail, Slack | support@ inbox both directions; internal-style alert channel |
| **D07 Build** | GitHub | Repo ops beyond git: issues, PRs, releases, webhooks config (the org itself was created by Solari — [`04-solari.md`](04-solari.md)) |
| **D08 Strategy** | LinkedIn | Venture-brand posts (public-content gate applies) |

---

## Technical integration

### Auth model: three principals, strictly separated

The subtle design decision is **who the connected account belongs to**:

| Principal | Composio user id | Accounts | Created |
|---|---|---|---|
| **Founder** | `founder:{founder_id}` | Founder's own Gmail/LinkedIn/Calendar | Onboarding, via Connect Link, explicit per-scope consent |
| **Venture** | `venture:{venture_id}` | The venture's own Gmail, LinkedIn page, GitHub org, Slack, CRM | After Solari's `AccountCeremony` creates the account, connecting it to Composio is the ceremony's last step |
| **Company (Zeroth)** | `company:zeroth` | Zeroth's own ops accounts | Setup, once |

Rules: **founder accounts are read-mostly** (network mining, calendar free/busy — outbound *as the
founder* only at `autonomy_level=copilot` with per-message approval); **venture accounts are the
default actor** (email from `hello@{venture}.com`, honest and brand-consistent); **cross-principal
access is impossible** because each session is created under exactly one user id — the scoping is
structural (per Composio's session model), not a prompt-level promise.

```ts
// packages/integrations/composio/session.ts
const session = await composio.sessions.create({ userId: `venture:${venture_id}` });
await store.save('composio_session', venture_id, session.sessionId);   // restore via composio.use()
// Connect Link flow for a new toolkit → the link lands on the FOUNDER's Linq thread
// for founder accounts, or completes inside the AccountCeremony for venture accounts.
```

### Tool allowlists: three enforcement layers

Composio sessions expose meta-tools that can discover *anything*, so the allowlist is ours, and it
is enforced where the org chart says, not where the vendor defaults:

```yaml
# packages/manifests/tool-allowlists.yaml (excerpt — same file the agent runtime enforces)
D10.sales:
  composio:
    toolkits: [GMAIL, GOOGLECALENDAR, CRM]
    actions:
      GMAIL: [SEND_EMAIL, CREATE_DRAFT, GET_THREAD, REPLY_TO_THREAD]   # no delete, no settings
      GOOGLECALENDAR: [CREATE_EVENT, FIND_FREE_SLOTS, LIST_EVENTS]
    principals: ['venture']                    # D10 may never act as the founder
    constraints:
      SEND_EMAIL: { requires_gate: outbound_to_real_person, max_per_day: 25 }
D09.leads:
  composio:
    toolkits: [LINKEDIN, CRM]
    actions: { LINKEDIN: [GET_PROFILE, SEARCH] }   # read-only; posting is D08's, gated
```

1. **Runtime:** the agent-kit only registers allowlisted actions as callable tools — an
   un-allowlisted action does not exist in the agent's world.
2. **Kernel:** every `composio.execute` intent passes the gate engine — `SEND_EMAIL` to a real
   person is an **irreversible action under invariant #2** and requires an approved gate id
   (first-touch templates founder-approved; sequence follow-ups auto-approved at
   `autonomous`; each send still logged + rate-capped).
3. **Band policy:** `composio.linkedin.post` and friends appear in the `public-content-gated`
   control-plane policy ([`02-band.md`](02-band.md)) — belt, braces, and a third thing.

Rate caps live in `packages/outbound/ratelimit.ts` across all channels: ≤25 outbound emails per
venture per day at MVP, one dunning message per customer per 24h ([`03-stripe.md`](03-stripe.md)),
zero cold outreach to scraped emails — warm/consented/inbound only. The company's email reputation
is an asset on the balance sheet; we treat it that way.

### Data flow: everything is an event

```
D10 head → WorkOrder(send_sequence_step) → sales worker
   │  tool call: gmail.SEND_EMAIL {thread, body, gate_id}
   ├─ kernel checks gate + rate cap → executes via session → Composio → Gmail API
   ├─ emit outbound.message_sent {channel:'gmail', lead_id, variant_id, gate_id}
   ▼
inbound: Gmail poll per venture (60s cadence) via GET_THREAD deltas
   ├─ new reply → emit inbound.message_received → routed: D10 (deal thread),
   │   D12 (support@), D04 (interview scheduling)
   └─ reply/no-reply/bounce outcomes accumulate per variant_id
        → the training labels for message-variant ranking (12-pioneer-fastino.md)
```

Composio's Logs API is the audit mirror: `finance.reconcile` samples it weekly against our
`outbound.*` events — the same drift-detection posture as the Stripe reconciler.

> **VERIFY AT HACKATHON (Composio — booth or Discord):**
> 1. Toolkit coverage/health for LinkedIn specifically (the most ToS-fragile connector; if degraded,
>    LinkedIn work shifts to Solari read-only). (unverified — confirm at hackathon)
> 2. Which CRM toolkit to use (HubSpot free tier is the default candidate) and its action coverage.
> 3. Trigger/webhook support for inbound Gmail (push instead of our 60s poll)?
> 4. Pricing tier for hackathon volume; per-session/per-execution limits. (unverified — confirm at hackathon)
> 5. Connect Link expiry + re-auth UX (it lands on a founder's phone; it must not expire in minutes).

---

## User-facing experience

**Founder:** during onboarding, two Connect Links on their Linq thread ("connect your Gmail so I can
find people you already know who fit the customer profile — read-only"); later, approval cards for
first-touch templates; in the digest, "12 emails sent, 4 replies, 2 calls booked." **The venture's
counterparties:** normal email from a normal address that replies within minutes, calendar invites
that respect their timezone — the company is indistinguishable from a competent human operator on
these channels, *except* it discloses AI involvement in voice calls ([`14-elevenlabs-voice.md`](14-elevenlabs-voice.md))
and never cold-blasts.

---

## Why the use case is novel

Per-venture **principal isolation** is the story: every venture the company spawns gets its own
sessions, its own connected accounts, its own allowlists — venture #2's Gmail cannot leak into
venture #1's CRM even by prompt injection, because the session id is the boundary. Add the
three-layer allowlist enforcement (runtime, gate engine, Band policy) and the outbound-reputation
rate discipline, and this is the difference between "our agent has Gmail access" and **"our company
has an IT department with access control."** Composio's session/meta-tool model is what makes that
cheap to build.

---

## Sponsor-track criteria

Composio is not on the Luma sponsor list — it is infrastructure we choose because building five
OAuth flows during a hackathon is malpractice. No track is entered; the row in
[`00-sponsor-strategy.md`](00-sponsor-strategy.md) is marked `1 (infra)`. If asked at a booth why we
used it: the honest answer is the paragraph above.

---

## Risks, costs, permissions, rate limits

| Item | Detail |
|---|---|
| Pricing | Free/dev tier expected to cover demo volume (unverified — confirm at hackathon); metered as `opex:tools` regardless. |
| OAuth scopes | Minimum-scope per toolkit (Gmail modify not full, Calendar events not settings). Scope list shown to the founder on the Connect Link card in plain language. |
| Token custody | Tokens live with Composio (that's the product). Our vault stores session ids + connected-account refs, never raw tokens. Disconnect = revoke at provider + delete session — in the venture-teardown runbook. |
| LinkedIn ToS | The fragile one: automated LinkedIn action risks account restriction. Posture: low-volume, venture-page-first, no scraping-shaped reads, and the allowlist keeps D09 read-only. If it breaks, that account is the casualty, not the venture's Gmail. |
| Email deliverability | New venture domains have zero reputation: SPF/DKIM configured at domain claim (Solari task), volumes ramped, warm-intro-first sequencing. The 25/day cap is deliverability protection as much as ethics. |
| Rate limits | Provider-side (Gmail per-day sends, LinkedIn API quotas) are the binding ones; our caps sit far below them by design. |

---

## Fallback behavior when it is down

| Failure | Behavior |
|---|---|
| Composio API down | Per the master table: **direct per-vendor OAuth for Gmail + GitHub only** — thin `googleapis`/`octokit` clients behind the same tool names, pre-built and pre-authed for the demo principals (they are the two on the critical path). LinkedIn degrades to Solari read-only; CRM degrades to our Postgres `deals` table (which is the source of truth anyway); Slack drops (Band rooms carry internal comms). |
| One toolkit degraded | Only that channel's work orders hold; `channel: degraded` chip; sequences pause rather than misfire. |
| Connect Link fails during onboarding | Retry once, then the founder path continues without that account — D04's warm-network rung is skipped and the Terac rung ([`01-terac.md`](01-terac.md)) arrives earlier. The escalation ladder absorbs it. |
| Session lost/corrupted | Recreate under the same user id; connected accounts persist server-side per the session model; re-auth only if the provider revoked. |
| On stage | 1:25 and 2:55 both touch Composio ambiently (calendar invite, dunning email). Both have the direct-OAuth fallback warm; neither beat's narration depends on naming Composio. |

---

## Contribution to the general prize

Composio is why the company's *actions* land in the real world during the demo — real email threads,
real calendar events, a real repo, a real CRM trail — rather than in a mocked "integrations" panel.
Judges poking any artifact find a real provider object behind it. And the per-venture principal
isolation is a direct answer to the hardest general-prize question ("what stops this thing from
doing damage at scale?"): the same allowlist-and-gate architecture that runs one venture runs fifty,
because access control is structural, not prompted.

---

## Assumptions & open questions

- (unverified — confirm at hackathon) LinkedIn toolkit health; CRM toolkit choice; inbound triggers
  vs polling; pricing/limits; Connect Link expiry.
- Open: does the founder's warm-network mining need Contacts scope in addition to Gmail metadata?
  Decide during onboarding-flow build; default to the smaller scope.
- Open: Slack as a customer-facing community surface (vs Whop's native community —
  [`10-whop.md`](10-whop.md)) — POST-MVP; at MVP Slack is ops-alerts only.

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`04-solari.md`](04-solari.md) (the no-API complement; account creation ceremonies) ·
[`06-linq.md`](06-linq.md) (Connect Links + template approvals on the founder thread) ·
[`12-pioneer-fastino.md`](12-pioneer-fastino.md) (outcome labels from send/reply events) ·
[`01-terac.md`](01-terac.md) (warm network as the rung before paid humans)
