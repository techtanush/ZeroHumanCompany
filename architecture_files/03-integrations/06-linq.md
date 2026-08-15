# 06 — Linq

> **Tier 1.** The founder never opens a laptop. Every human-in-the-loop surface in Zeroth is one
> thumb, in iMessage.

---

## What it is

Linq is a **communications API for iMessage, RCS, and SMS** — a REST API
(`https://api.linqapp.com/api/partner/v3`) to send and receive messages with the full native
surface: group chats, threaded replies, reactions/tapbacks, typing indicators, read receipts, rich
media up to 100MB, polls, message effects, and real-time webhooks for delivery, read, reaction, and
inbound-message events. Official TypeScript and Python SDKs. Auth is a bearer token provisioned by a
Linq representative, with one or more phone numbers assigned to the account.

Verified against `docs.linqapp.com` (2026-08). The one open item: interactive card UX — see the
verify block below.

---

## The exact product problem it solves

Zeroth's second invariant: **every irreversible action needs a gate**, and gates need a human. The
founder we serve is a non-technical person with a phone, not an operator watching a dashboard. If
approving a pivot requires opening a laptop, finding a tab, and reading a console, the founder
becomes the company's bottleneck and the "autonomous" claim dies in practice.

Linq makes the gate surface **the founder's existing texting app**. The company texts like a
competent chief of staff: rarely, richly, and only when a decision is genuinely theirs to make.

---

## Which departments use it

Linq is owned by one service — `services/founder-channel` — and no department calls it directly.
Departments open gates; the gate engine renders them into messages.

| Dept | Reaches the founder for | Beat |
|---|---|---|
| **D06 Pivot** | The pivot decision card (two forked futures, [`05-superserve.md`](05-superserve.md)) | **2:10** |
| **D11 Finance/HR** | Spend above cap, Terac hire preview, refund > $50, budget-cap raise | 1:50 |
| **Identity service** | `AccountCeremony` — 2FA codes, CAPTCHA handoff ([`04-solari.md`](04-solari.md)) | 2:25 |
| **D04 / D08 / D10** | First-touch outbound approval, public-content gate, deal-closed notification | 1:25, 2:55 |
| **D07** | Production-deploy gate ([`08-render.md`](08-render.md)) | 2:25 |
| **D13** | Daily digest, new-department announcement, blocked-action prompts | 3:30 |

---

## Technical integration

### Auth, numbers, endpoints

- **Auth:** `Authorization: Bearer $LINQ_TOKEN`, held in the Identity Vault, dereferenced only by
  `services/founder-channel`. Departments never see it.
- **Number:** one Linq-assigned number per Zeroth instance is the **company's phone number**. The
  founder saves it as a contact ("Zeroth HQ") during onboarding. Per-venture numbers are POST-MVP.
- **Send:** `POST /api/partner/v3/messages` with `{from, to: [founder E.164], message: {parts}}`.
- **Receive:** webhook endpoint `POST https://kernel.zeroth.app/webhooks/linq` for inbound messages,
  reactions, delivery/read receipts. Signature verification per Linq's webhook docs; same webhook
  discipline as every other endpoint (verify → persist raw → 200 in <2s → queue).

> **VERIFY AT HACKATHON (Linq booth):**
> 1. Interactive elements: are tappable buttons/quick-replies available (RCS suggested replies,
>    iMessage app cards), or is our "card" a rich media block + parsed text reply? We design for the
>    latter and upgrade if the former exists. (unverified — confirm at hackathon)
> 2. Webhook signature scheme and retry policy.
> 3. Polls API shape — the pivot card wants to be a native poll if tap-to-vote exists.
> 4. Sandbox/test numbers, per-number throughput limits, and iMessage vs SMS fallback behavior when
>    the recipient is on Android.
> 5. Media: can we attach the Solari ceremony screenshot inline (yes per docs, ≤100MB)?

### The `FounderPrompt` contract

Everything sent to the founder is one of four shapes, rendered from one schema:

```ts
// packages/contracts/src/founder-channel.ts
export const FounderPrompt = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  gate_id: z.string().uuid().optional(),        // present iff this blocks an action
  kind: z.enum(['approval_card', 'ceremony', 'digest', 'notification']),
  urgency: z.enum(['blocking', 'timeboxed', 'fyi']),

  body: z.object({
    headline: z.string().max(80),               // 'Pivot decision needed'
    summary_md: z.string().max(600),            // texting-length, always
    media: z.array(z.object({ kind: z.enum(['image','video','file']), ref: z.string() })).default([]),
    options: z.array(z.object({
      key: z.string(),                          // '1' | '2' | 'A' — what the founder types
      label: z.string(),                        // 'Pivot to discharge coordinators'
      consequence: z.string(),                  // 'D03 re-runs; ~$1.20, ~4 min'
    })).min(0).max(4),
  }),

  reply_grammar: z.enum(['choice', 'yes_no', 'free_text', 'numeric_code', 'none']),
  timeout_minutes: z.number(),
  on_timeout: z.enum(['hold', 'auto_approve', 'auto_reject']),   // from the gate policy
  thread_ref: z.string().optional(),            // Linq message id to thread replies under
});
```

### Reply parsing → gate decisions

Inbound webhook → `services/founder-channel/parse.ts`. Parsing is **grammar-first, LLM-second**:

```
inbound message (webhook)
   │
   ├─ 1. sender verification (below). Fail → drop + security event. No parsing of unverified senders.
   ├─ 2. thread/gate resolution: threaded reply → that gate; else most recent open prompt;
   │     else if 2+ open prompts and no thread → disambiguation message, never a guess.
   ├─ 3. deterministic grammar pass (regex, cheap, covers ~90%):
   │       'yes','y','approve','👍 tapback'      → approve
   │       'no','n','reject','stop','👎'         → reject
   │       '1'/'2'/option key or label prefix    → that option
   │       6-digit number when reply_grammar=numeric_code → ceremony value (straight to vault)
   ├─ 4. haiku intent pass for everything else, WITH the open gate's options as context:
   │       'do the nurse one but cap it at $40'  → {option: '1', modifiers: {budget_cap: 40}}
   │       modifiers are applied only if the gate schema declares them modifiable; else we confirm.
   ├─ 5. confidence < 0.8 → echo back: 'Reading that as: approve option 1 with $40 cap. 👍 to confirm.'
   │       One round max; then hold the gate and mark needs_clarification.
   └─ 6. emit human.replied {gate_id, decision, raw_text, parse_confidence}
          → gate engine resolves → department resumes. Every step is an event.
```

**A tapback is a first-class approval.** 👍 on an approval card approves it (Linq webhooks carry
reactions). This is the single most iMessage-native thing in the product and we demo it.

### Backend status

Implemented in the current backend:

- `linq.send_card` for agent-authored founder/customer cards.
- `linq.await_reply` for polling/checking reply state when webhooks are unavailable.
- Kernel-side gate notification: any `GateRequest` with `channel:"linq"` is rendered to the founder
  phone via `LINQ_API_KEY` + `FOUNDER_PHONE`; if the key is missing, a `human.notified` degraded
  event is still recorded and the Boardroom can show the pending gate.
- Linq webhook gate decisions: inbound payloads with `gate_id` parse `yes/approve/ok/👍`, `no/reject/stop/👎`,
  option ids, and option-label prefixes into `gate.approved` or `gate.rejected`.

### Digests, batching, quiet hours

| Mechanism | Rule |
|---|---|
| **Batching** | Non-blocking prompts queue; the scheduler flushes at most one bundle per 30 min per venture ("3 updates: ..."). Blocking prompts always send immediately — but the *ceremony batching* rule from [`04-solari.md`](04-solari.md) applies: one card with 3 steps, not 3 cards. |
| **Daily digest** | D13 composes at a founder-set hour: revenue, spend by department, decisions made autonomously (with links), decisions waiting. `reply_grammar: free_text` — replying to the digest is how the founder steers ("stop spending on ads", parsed to a `BudgetDirective` with a confirm echo). |
| **Quiet hours** | Founder-set window (default 22:00–08:00 local). `fyi`/`timeboxed` prompts hold until morning. `blocking` prompts during quiet hours escalate only if `gate.severity='critical'` (money already moving, production down); otherwise the gate's `on_timeout` policy runs — which is why every gate has one. |
| **Rate floor** | Hard cap: ≤10 founder messages/day at `autonomy_level=autonomous` outside ceremonies. If the company wants to talk more than that, D13 gets a `ProductSignal` that gates are tuned wrong. |

### Verification of sender identity

The founder channel *moves money and credentials*, so inbound trust is explicit:

1. **Binding.** At onboarding, the founder's E.164 number is bound to the venture with a one-time
   code sent through Linq and confirmed in the Boardroom (out-of-band, once).
2. **Allowlist.** Inbound from any other number: logged, dropped, `security.unknown_sender` event.
   The company never converses with strangers on this channel.
3. **Spoof posture.** iMessage sender spoofing is not a practical channel risk, but SMS fallback
   can be spoofed, so: any `blocking` gate on money > `$sms_high_value_threshold` (default $100) or
   credential ceremonies over SMS require a **challenge echo** — we text a 4-digit nonce and the
   approval must include it. On iMessage (delivery receipts confirm the Apple ID route) this is waived.
4. **No secrets inbound except ceremony codes**, which go webhook → vault directly; the parse step
   sees `[redacted:6-digit]` and the raw body row is crypto-shredded after the ceremony completes.

---

## User-facing experience

What the founder's thread actually looks like across the demo:

```
[1:25] Zeroth: 📞 About to call 5 people from your network about the ER
       handoff idea, using your cloned voice (disclosed as AI). Ok?
       Reply: yes / no / list
Founder: 👍
[1:50] Zeroth: HR wants to hire 3 ER nurses for interviews — $75 total,
       your cap is $50. Raise cap to $100 for this venture?  yes / no
Founder: yes
[2:10] Zeroth: 🔀 Pivot decision. Ran both futures:
       1. Stay: ER nurses. WTP $29/mo, panel 61% positive. [chart.png]
       2. Pivot: discharge coordinators. WTP $79/mo, panel 74%. [chart.png]
       Recommend 2. Reply 1 or 2.
Founder: 2
[2:25] Zeroth: [screenshot] GitHub wants a 6-digit code to finish creating
       your company's org. Tap the screenshot to check, then reply with the code.
Founder: 418293
[2:55] Zeroth: 💸 First sale — $29/mo from J. (the nurse you talked to at 1:25).
       No action needed.
```

Five interactions, ~40 characters typed, a company built. That is the product.

---

## Why the use case is novel

Most hackathon Linq usage will be "our agent texts you updates." Ours inverts control: **the message
thread is the company's approval queue, and the reply parser is a gate-decision compiler.** The
founder's thumb resolves typed gates in a state machine — with modifiers ("yes but cap at $40")
parsed into structured gate amendments. Plus the ceremony flow: Linq is the human half of Solari's
2FA handoff, which no dashboard-based team can replicate on a phone in 4 seconds.

---

## Sponsor-track criteria

| Criterion | Our answer |
|---|---|
| Uses iMessage/SMS natively | Tapback approvals, threaded replies, media cards, polls (if available) — not SMS-shaped text blasted over iMessage |
| Real API on stage | Every gate in the live demo routes through Linq; the phone is mirrored on the projector |
| Depth | Reply grammar → typed gate decisions with modifiers; quiet hours; sender verification; ceremony channel |
| The sentence | "The entire human-in-the-loop surface is one thumb, in iMessage." |

---

## Risks, costs, permissions, rate limits

| Item | Detail |
|---|---|
| Token provisioning | Bearer token comes from a Linq rep — **get it at the booth, hour one** (their docs say so explicitly). |
| Cost | Per-message pricing (unverified — confirm at hackathon). Demo volume is ~20 messages; negligible. |
| Rate limits | Per-number throughput unknown (unverified — confirm at hackathon). Our ≤10/day product cap is far below any plausible limit. |
| iMessage availability | If the founder's device is Android: RCS covers most of the surface, tapbacks degrade to emoji replies. The parse grammar already accepts both. |
| A2P/compliance | Founder-only channel at MVP = consented single recipient, minimal exposure. Customer-facing dunning over Linq ([`03-stripe.md`](03-stripe.md)) requires opt-in, stored as an event. |
| Privacy | Thread content includes business financials; no customer PII goes to the founder channel (the `no-pii-in-rooms` posture extends here — vault handles, not values). |

---

## Fallback behavior when it is down

| Failure | Behavior |
|---|---|
| Linq API unreachable | `founder-channel` swaps to the fallback chain: **Boardroom in-app approval card + email** (same `FounderPrompt` rendered to both). Gates behave identically — `on_timeout` policies were designed for exactly this. Boardroom shows `founder-channel: email` chip. |
| Webhook delivery stalls | Poll `GET /chats/{id}/messages` every 10s for open gates (unverified endpoint shape — confirm at hackathon). Dedupe on message id. |
| Founder unreachable entirely | Gates resolve by policy: `on_timeout: hold` for ceremonies and money, `auto_approve` for reversible low-value actions, `auto_reject` for public content. The company degrades to its declared autonomy, never to silence. |
| Demo-day plan | Phone mirror is shown either way; if live messaging fails on stage, the Boardroom card is the same card, and we say the word "fallback" out loud. |

---

## Contribution to the general prize

The judging criterion is "little to no human input." Linq is how we make the *remaining* human input
visible, countable, and tiny: the Boardroom ends the demo with "**5 founder interactions, 41
characters, $104 spent, 1 product shipped, $29 MRR**." Making human input measurable is stronger
evidence of autonomy than claiming zero — and every one of those interactions was a gate the company
correctly refused to cross alone.

---

## Assumptions & open questions

- (unverified — confirm at hackathon) Interactive buttons/quick replies vs text-grammar replies;
  poll API shape; webhook signature scheme; per-message cost; message-fetch endpoint for the poller.
- Open: per-venture phone numbers (POST-MVP) so a founder running 3 ventures gets 3 threads.
- Open: whether the 2:10 pivot card should be a native Linq poll — decide after the booth demo.

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`04-solari.md`](04-solari.md) (ceremony protocol) ·
[`03-stripe.md`](03-stripe.md) (dunning via Linq, refund gates) ·
[`05-superserve.md`](05-superserve.md) (the forked futures on the pivot card) ·
[`08-render.md`](08-render.md) (production-deploy gate)
