# 14 — ElevenLabs + telephony

> **Tier 1 (infrastructure).** The founder's cloned voice places real discovery and sales calls,
> with AI disclosure at call open. The demo's emotional peak at 1:25.
>
> ⚠️ **NOT AN OFFICIAL SPONSOR.** ElevenLabs is not on the Luma sponsor list. We use it anyway
> because voice is load-bearing for D04/D10 and nothing on the sponsor list covers speech. No track
> is entered; no sponsor-track claims are made. If asked, we say exactly that.

---

## What it is

ElevenLabs provides **speech AI as an API**: high-quality text-to-speech, **voice cloning** from
consented samples, speech-to-text, and a **Conversational AI / agents platform** (real-time,
interruptible voice agents with turn-taking, tool calls, and **telephony integration** for placing
and receiving phone calls, including SIP/Twilio-style connectivity). We use: instant voice cloning
(founder's voice, with consent), the conversational agent runtime for live two-way calls, telephony
for real phone numbers, and transcription for the claim-extraction pipeline.

Product surface is public and mature; exact plan gates for cloning + agents + telephony minutes are
in the verify block. (unverified — confirm current plan tiers before the event)

---

## The exact product problem it solves

Customer discovery and early sales are **synchronous, spoken activities**. Busy ER nurses do not
answer cold emails with 400-word essays; they *will* take a 15-minute call. An autonomous company
without a voice cannot do D04's core job (real interviews → `ClaimLedger`, invariant #7: synthetic
never replaces real) or D10's (a closing conversation). Voice is the difference between a company
that emails and a company that **talks to its customers** — and the founder's cloned voice, used
with consent and disclosed as AI, is what makes the calls warm instead of robocall-cold: the
recipient hears the person who asked for the intro.

---

## Which departments use it

| Dept | Use | Beat |
|---|---|---|
| **D04 Outreach & Discovery** | The **voice interviewer**: 15–20 min structured discovery calls with warm-network contacts and Terac-hired panelists ([`01-terac.md`](01-terac.md)) | **1:25** |
| **D10 Sales** | Demo-scheduling and closing calls for deals where email stalls | 2:55 (referenced) |
| **D12 Support** | POST-MVP: voice support line | — |

All voice work runs in `services/voice` — departments file `CallOrder` intents; no department
touches the ElevenLabs API directly (same key-custody pattern as every vendor in this folder).

---

## Technical integration

### Consent capture and voice cloning — the order of operations is the point

```
Founder onboarding (Boardroom, once)
   │
   ├─ 1. CONSENT SCREEN (before any audio is captured):
   │      plain-language grant: what is cloned, where it may be used (discovery +
   │      sales calls for THIS founder's ventures), disclosure promise, revocation
   │      (one tap → voice_id deleted at vendor + locally)
   ├─ 2. emit consent.granted {founder_id, scope:'voice_clone', text_hash, ts}   ← the artifact
   ├─ 3. capture ~2 min of scripted reading (also the identity-binding step for Linq)
   ├─ 4. ElevenLabs instant-clone → voice_id stored in the Identity Vault
   └─ 5. verification playback → founder approves their own clone (consent.confirmed)
Without steps 1–2, step 4 is unreachable in code, not in policy: the clone call
requires a consent event id as an argument, and the kernel validates it.
```

### Backend status

Implemented in the current backend through the tool plane:

- `elevenlabs.clone_voice` creates a voice from founder-provided audio and requires
  `voice_clone_consent`.
- `elevenlabs.tts` uses `ELEVENLABS_VOICE_ID` or a provided `voice_id`.
- `elevenlabs.create_agent` creates the conversation agent shell.
- `elevenlabs.place_call` is gated as `outbound_to_real_person` and requires
  `disclosure:true`.
- `elevenlabs.transcribe` captures transcript output for D04/D10 claim extraction.
- `elevenlabs.delete_voice` supports revocation and is gated as `voice_clone_consent`.

Needed from ElevenLabs: `ELEVENLABS_API_KEY`. After cloning, store `ELEVENLABS_VOICE_ID`. For phone
calls, also configure `ELEVENLABS_AGENT_ID` and `ELEVENLABS_PHONE_NUMBER_ID` or the equivalent
Twilio/SIP connection if the account uses bring-your-own telephony.

`consent.revoked` triggers: vendor voice deletion, vault purge, all pending `CallOrder`s re-routed
to the generic neutral voice, and a digest confirmation. Recordings of *other people* (call
counterparties) are governed separately below — **we never clone anyone but the founder.**

### The disclosure script — non-negotiable, first utterance

Every outbound call opens, before anything else:

> *"Hi — this is the AI assistant for {founder_name}'s new project, {venture_name}, calling in
> {founder_name}'s voice with their permission. This call may be recorded to help us understand
> what you need — is that okay, and do you have about ten minutes?"*

Encoded in the agent config as the mandatory first turn; the conversation cannot proceed until the
recipient affirms (consent to record + consent to continue → `consent.call_recording {callee, ts}`
event). A "no" to recording continues un-recorded with notes-only transcription disabled; a "no" to
the call ends it politely and marks the contact `do_not_call`. Two-party-consent states make
recording consent mandatory everywhere — we don't geo-differentiate; we just always ask.

### Call flow

```ts
// packages/contracts/src/voice.ts
export const CallOrder = z.object({
  id: z.string().uuid(), venture_id: z.string().uuid(),
  requested_by: DepartmentId,                       // D04 | D10
  kind: z.enum(['discovery_interview', 'sales_call', 'scheduling']),
  callee: z.object({ e164_handle: z.string(),      // vault handle — number not in agent context
                     display: z.string(), consent_basis: z.enum(['warm_intro','terac_panel','inbound']) }),
  script: z.object({ disclosure: z.literal(true),   // structurally unremovable
                     objectives: z.array(z.string()),          // from the InterviewGuide artifact
                     forbidden: z.array(z.string()),           // no pricing promises, no medical advice…
                     max_minutes: z.number().default(20) }),
  voice: z.enum(['founder_clone', 'neutral']),
  gate_id: z.string().uuid(),                       // outbound call to a real person = gated, always
});
```

```
gate.approved (Linq: "About to call 5 people… ok?" — one card for the batch, 06-linq.md)
   │
   ├─ services/voice creates an ElevenLabs conversational agent session:
   │    system prompt = disclosure + objectives + forbidden list + persona guardrails
   │    voice = founder voice_id (vault-dereferenced at session create, never logged)
   │    telephony = outbound dial via the platform's phone integration
   │         (exact provisioning path: native vs Twilio-bridged — verify block)
   ├─ live call: interruptible, turn-taking; agent follows the InterviewGuide
   │    (open questions first, no leading — D04's interview discipline, not the vendor's)
   ├─ emit call.started / call.ended {duration, disposition}
   ├─ transcript (+ recording iff consented) → object storage under the venture prefix
   ▼
post-call pipeline (D04 worker):
   ├─ claim extraction: transcript → Claim[] {quote, speaker, confidence, source_id: call_id}
   ├─ ClaimLedger merge — provenance 'voice_call'; evidence_class 'real'
   ├─ consent flags: testimonial permission asked at call end when relevant →
   │    consent.testimonial event → unlocks the quote for Lovable pages (09-lovable.md)
   └─ interview honoraria for Terac panelists settle through the Terac flow, not ad hoc
```

> **VERIFY (ElevenLabs docs/support — no booth exists, they are not a sponsor):**
> 1. Current plan tier gating: instant clone quality, agents platform, telephony minutes, concurrent
>    calls (we need 2–3 concurrent for the 1:25 batch). (unverified — confirm before event)
> 2. Outbound telephony path: native number provisioning vs bring-your-own Twilio SIP trunk —
>    changes `services/voice` plumbing, nothing upstream.
> 3. Latency budget end-to-end (dial → first response turn) for the on-stage call.
> 4. Their voice-clone consent/verification requirements (we exceed them, but comply with the
>    letter too — e.g. any required voice-verification captcha at clone time).
> 5. Transcript webhook vs poll for call completion.

---

## User-facing experience

**The founder** records 2 minutes once, approves call batches from their phone, and reads interview
insights in the digest with links to the exact transcript quotes. **The callee** gets a call from a
warm voice that says what it is in the first sentence, asks good questions, doesn't interrupt, and
ends on time. **On stage at 1:25:** a live (or consented-recorded) call plays — the founder's voice
interviewing a real nurse about shift handoffs — while the `ClaimLedger` fills with quoted claims in
real time. It is the moment the room decides the company is real.

---

## Why the use case is novel

Voice agents are common; **a consent-chained cloned-voice interviewer feeding an evidence ledger**
is not. The chain — founder consent event → clone; callee disclosure + recording consent →
transcript; transcript → cited claims; claims → the pivot decision the founder approves at 2:10 —
means every emotional beat is also an auditable data pipeline. And the Terac composition
([`01-terac.md`](01-terac.md)) is genuinely new: **the company hires real humans and interviews
them with the founder's cloned voice**, disclosure first, honoraria paid on completion. Two vendors,
one escalation ladder rung, zero hand-waving.

---

## Sponsor-track criteria

None — **not a sponsor** (see the banner). The honest framing for judges: *"ElevenLabs isn't a
sponsor; we used it because discovery calls are load-bearing and no sponsor covers speech. The
disclosure-and-consent machinery around it is ours, and it's the part we'd defend."* The row in
[`00-sponsor-strategy.md`](00-sponsor-strategy.md) is marked `1 (infra)` accordingly.

---

## Risks, costs, permissions, rate limits

| Item | Detail |
|---|---|
| Legal: recording consent | Always-ask policy (strictest-state behavior everywhere); consent events stored; un-consented calls proceed notes-free or end. |
| Legal: AI-call disclosure | First-utterance disclosure, structurally mandatory. We also honor immediate opt-out ("take me off your list" → `do_not_call`, event-logged). |
| Deepfake risk of the clone | Voice usable only through `services/voice`, only with a `CallOrder` + approved gate + consent event chain. The voice_id never leaves the vault; no department can synthesize arbitrary speech in the founder's voice. Revocation is one tap. |
| Cost | TTS/agent minutes + telephony: demo spend est. $10–30 across rehearsals (unverified — confirm plan pricing). Metered to D04/D10 envelopes as `opex:tools`. |
| Concurrency/rate limits | Concurrent-call caps by plan (unverified — confirm); the 1:25 batch is 3 calls max at demo scale. |
| Call quality tail | A confused or hostile callee: the agent's forbidden-list + a hard "wrap politely at any sign of distress" rule; disposition logged; no retry-calling the same person. |
| PII | Numbers held as vault handles; transcripts under venture retention policy; callee PII never crosses into rooms (Band `no-pii-in-rooms` policy) or other vendors. |

---

## Fallback behavior when it is down

| Failure | Behavior |
|---|---|
| Cloning unavailable / consent revoked | **Generic neutral voice** — the disclosure script already names the founder, so warmth degrades but honesty doesn't. Every `CallOrder` carries the `voice` field; the swap is one enum value. |
| Telephony fails (no dial, mid-call drop) | Retry once; then the contact falls back to the email path (Composio, [`13-composio.md`](13-composio.md)) with a "sorry we missed you — 3 questions" form. Mid-call drops emit `call.ended(disposition:'dropped')`; partial transcript still mines claims. |
| Agents platform down entirely | D04 degrades to written interviews (email/form); interview count still accrues, `modality` honestly recorded. The escalation ladder is unchanged — Terac panels can run `async_written`. |
| On stage | Per the master table: if live telephony fails, **play the pre-recorded consented call and say so out loud**. The `ClaimLedger` ingestion still runs live off the recording's transcript — the pipeline is the claim, the dial tone is theater. |

---

## Contribution to the general prize

The 1:25 call is the demo's emotional peak: the moment judges *hear* the company working — a real
conversation, disclosed, consented, producing cited evidence that visibly drives the 2:10 pivot.
It also anchors the ethics story for the entire product: the team that built disclosure-first,
consent-chained, revocable voice cloning is the team judges trust with the rest of the autonomy
claims. No sponsor track rides on it; the general prize does.

---

## Assumptions & open questions

- (unverified — confirm before event) Plan-tier gating for clone + agents + telephony; concurrency;
  latency; transcript delivery mechanism; clone-time verification requirements.
- Open: live call on stage vs consented recording — decide at rehearsal on latency evidence;
  the recording must itself carry a `consent.call_recording` event to be shown at all.
- Open: whether D10's closing call is demo scope or referenced-only at 2:55. Default: referenced.
- Open: STT provider for transcripts — ElevenLabs STT vs the telephony leg's — pick in build week.

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`01-terac.md`](01-terac.md) (hired humans interviewed by this voice) ·
[`06-linq.md`](06-linq.md) (call-batch approval; founder identity binding) ·
[`13-composio.md`](13-composio.md) (the email fallback channel) ·
[`09-lovable.md`](09-lovable.md) (consented quotes → landing-page proof)
