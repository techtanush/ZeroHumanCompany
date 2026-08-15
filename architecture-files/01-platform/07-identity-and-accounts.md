# 07 — Identity & Accounts: How the Company Gets Its Own Hands

A company that borrows the founder's GitHub is a script. A company that **creates its own GitHub
org, its own mailbox, its own domain, and its own Stripe account** is a company. This file is the
protocol for that, and the vault that holds what it earns.

Three routes to any account, tried in this order:

```
    ┌─────────────────────────────────────────────────────────────────┐
    │ 1. API            provider has a programmatic signup/create API │
    │                   (GitHub org, Render service, Stripe Connect)  │
    ├─────────────────────────────────────────────────────────────────┤
    │ 2. COMPOSIO       provider is OAuth-able and Composio has a     │
    │                   connector (Gmail, LinkedIn, Calendar, Slack)  │
    ├─────────────────────────────────────────────────────────────────┤
    │ 3. SOLARI         no API. Drive the browser as a human would.   │
    │                   ← this is where the interesting failure modes │
    │                     live, and where AccountCeremony earns its   │
    │                     keep                                        │
    └─────────────────────────────────────────────────────────────────┘
                                    │ human-required step detected
                                    ▼
                          LINQ card → founder taps → resume
```

---

## The account inventory a venture needs

| Account | Route | When | Gate | Notes |
|---|---|---|---|---|
| **Company mailbox** (Gmail/Workspace or a forwarding alias) | Solari, or founder-provided | first, always | `account_creation` | **Root of trust**: every other signup's verification email lands here |
| **GitHub org** | API (`POST /orgs` under the company account) | before D07 | `account_creation` | Repos for the venture's product |
| **Domain** | API (registrar) | after niche selection | `money_out` + `account_creation` | ~$12 — the first real money the company spends on itself |
| **Render account + services** | API | before first deploy | `account_creation` | Company's own account, not ours |
| **Stripe account** | API (Connect) or Solari | before first sale | `account_creation` (+ founder KYC) | Payouts require the founder's identity — hard stop, see below |
| **X / LinkedIn page** | Solari | D08 GTM | `account_creation` + `public_content` | Public presence |
| **Whop seller / Dodo merchant** | API | for consumer ventures | `money_out` if paid | Alternate revenue rails |
| **Lovable project** | API | marketing site | `account_creation` | |
| **Mid-run tool signups** (Apify, an enrichment API, a scheduling tool) | Composio → Solari | whenever a department is blocked | `account_creation`, `money_out` if paid | This is the "company hires its own tools" beat |

**Root-of-trust ordering matters.** The mailbox is created (or delegated) first, because everything
else sends a verification link to it. If the mailbox ceremony fails, the identity service refuses
to start any downstream ceremony rather than scattering half-built accounts.

---

## The `AccountCeremony` protocol

```
                    ┌──────────────────┐
    requestAccount  │  PLAN            │  pick strategy: api | composio | solari
        ───────────►│                  │  resolve prerequisites (mailbox exists?)
                    └────────┬─────────┘
                             ▼
                    ┌──────────────────┐   success   ┌───────────────┐
                    │  ATTEMPT (api)   │────────────►│  PERSIST      │
                    └────────┬─────────┘             │  vault write  │
                        fail │                       │  account.active│
                             ▼                       └───────────────┘
                    ┌──────────────────┐   success            ▲
                    │ ATTEMPT(composio)│──────────────────────┤
                    └────────┬─────────┘                      │
                        fail │                                │
                             ▼                                │
                    ┌──────────────────┐   success            │
                ┌──►│ ATTEMPT (solari) │──────────────────────┘
                │   └────────┬─────────┘
                │            │ human-required step detected
                │            ▼
                │   ┌──────────────────┐
                │   │ PAUSE            │  session frozen, screenshot captured (redacted),
                │   │ gate: account_   │  Linq card sent, ceremony.status='paused_for_human'
                │   │ creation         │  ← may sit here for hours; Superserve keeps the VM
                │   └────────┬─────────┘
                │            │ founder responds (OTP / tap / "I did it")
                └────────────┘  RESUME — the secret is injected by the identity service,
                                never returned to the agent
```

### Human-required step detection

The Solari driver classifies every page it lands on. Detection is **conservative**: if it is not
confidently a form it can fill, it pauses rather than clicking.

| Signal | Classified as | Action |
|---|---|---|
| Input labeled `code`/`otp`/`verification`, 4–8 digits, after a "we sent you" screen | `2fa_code` | Pause → Linq OTP card |
| Phone number field on a signup flow, or "verify your phone" | `phone_verification` | Pause → Linq card asking founder to supply/confirm number |
| Checkbox near "Terms", "Agreement", "I agree" | `tos_acceptance` | Pause → Linq card with the ToS URL and a summary |
| Card number / billing form / Stripe Elements iframe | `payment_method` | Pause → **founder enters it themselves**, in their own browser session |
| reCAPTCHA / hCaptcha / Turnstile / "prove you're human" | `captcha` | Pause → **founder solves it**. Never bypassed, never outsourced. |
| Document upload for identity, selfie liveness, SSN/EIN | `id_check` | Pause → founder only |
| Anything the classifier scores < 0.8 confidence | `unknown` → treated as human-required | Pause with a screenshot |

```ts
// packages/identity/src/ceremony.ts
export async function runCeremony(req: AccountRequest, ctx: Ctx): Promise<AccountResult> {
  const ceremony = await db.ceremonies.open(req);
  for (const strategy of planStrategies(req)) {            // ['api','composio','solari']
    try {
      const r = await STRATEGIES[strategy](req, ctx, {
        onHumanRequired: async (step: HumanStep, evidence: StepEvidence) => {
          await ctx.events.emit('identity.ceremony_paused', { ceremony_id: ceremony.id, step: step.kind });
          const gate = await ctx.gates.open({
            gate_type: 'account_creation',
            department_id: req.requested_by_dept,
            action: { tool: 'identity.resume_ceremony', args: { ceremony_id: ceremony.id } },
            preview: linqCardFor(step, evidence),           // screenshot is REDACTED before send
            risk: step.kind === 'payment_method' ? 'high' : 'medium',
            timeout_s: 1800, on_timeout: 'hold',
          });
          const decision = await ctx.gates.await(gate.id);  // may take hours; sandbox is paused
          if (decision.option_id === 'abort') throw new CeremonyAbandoned();
          return { secret: decision.secret };               // OTP goes straight back into Solari
        },
      });
      await vault.store(r.credentials, { account_id: ceremony.account_id });
      return await db.accounts.activate(ceremony.account_id, r);
    } catch (e) {
      if (e instanceof CeremonyAbandoned) throw e;
      await ctx.events.emit('identity.strategy_failed', { strategy, error: brief(e) });
      continue;                                             // fall through to the next strategy
    }
  }
  throw new Escalation('needs_credential', `Could not acquire ${req.provider}`);
}
```

**The OTP path is the one to get right.** The founder's 6-digit code arrives at the Linq gateway,
is parsed by the OTP branch in [`06-human-in-the-loop.md`](06-human-in-the-loop.md), and is handed
to `identity.resume_ceremony` — which types it into the live Solari session. It is never placed in
an agent's context window, never written to `events.payload`, and never logged. The event records
`{step: '2fa_code', supplied: true}` and nothing else.

---

## Prohibited actions — hard, enforced, not advisory

These are checked in the tool plane and asserted in tests. An agent that attempts one gets a tool
error and an `agent.tool_failed` event; repeated attempts freeze the department.

| Prohibited | Instead |
|---|---|
| An agent handling a **raw password** — reading it, typing it, putting it in a prompt, logging it | The vault types credentials into Solari sessions through a sealed channel; agents hold opaque `handle`s only |
| An agent entering **payment card data, bank details, SSN/EIN, government ID** | Pause the ceremony; the founder enters it in their own browser. The company never sees the number. |
| **Solving or bypassing a CAPTCHA** — including third-party solver services | Pause → founder solves it. This is a stated product boundary, not a limitation we hide. |
| Creating an account **impersonating the founder** or any real person | Accounts are created as the company, with the company's mailbox, and say so |
| Accepting **ToS on the founder's behalf** without a gate | `account_creation` gate with the ToS link and a plain-language summary |
| Reusing the **founder's personal credentials** for company actions | Composio OAuth grants scoped to the venture; the founder's own tokens are read-scoped and never used for outbound |
| **Sharing a credential across ventures** | Vault keys are venture-scoped; a grant carries `venture_id` and the tool plane rejects mismatches |
| Storing a secret in `events`, `artifacts`, `memory_chunks`, or logs | Redaction filter runs on every write path (below) |

```ts
// packages/identity/src/prohibited.ts — enforced at the tool boundary
export const HARD_PROHIBITED = [
  'captcha.solve', 'captcha.outsource',
  'credential.read_plaintext',
  'payment.enter_card_details',
  'identity.upload_government_id',
  'account.create_as_person',
] as const;

export function assertAllowed(tool: string, args: unknown) {
  if (HARD_PROHIBITED.includes(tool as never))
    throw new ProhibitedAction(tool);
  if (looksLikeSecret(args))                     // PAN/Luhn, SSN, private key headers, JWT-ish
    throw new ProhibitedAction('secret_in_tool_args');
}
```

---

## Credential vault design

```
                    ┌──────────────────────────────────────────────┐
   KMS master key   │  (Render env / cloud KMS; rotated quarterly)  │
        │           └───────────────────┬──────────────────────────┘
        │ wraps                         │ unwraps (kernel only)
        ▼                               ▼
  credentials.dek_wrapped ──────► DEK (per credential, AES-256)
                                        │
                                        ▼ AES-256-GCM
                                  credentials.ciphertext
```

**Envelope encryption.** One Data Encryption Key per credential, wrapped by the master key. Rotating
the master rewraps DEKs without touching ciphertext. Compromising one DEK exposes one credential.

### Scoped, short-lived handles

Agents never receive secrets. They receive a `handle` — an opaque string that only the **tool plane**
(inside the kernel, not inside the sandbox) can resolve.

```ts
// packages/identity/src/grant.ts
export async function grant(run: AgentRun, need: CredentialNeed): Promise<Handle> {
  const cred = await resolve(run.venture_id, need.provider);
  assertLeastPrivilege(run.agent_id, need.scopes);        // manifest tools[] ∩ credential scopes
  return db.grants.create({
    credential_id: cred.id,
    agent_run_id: run.id,
    scopes: intersect(cred.scopes, need.scopes),
    handle: `cred_${nanoid(24)}`,
    expires_at: new Date(Date.now() + 15 * 60_000),        // 15 minutes, hard
  });
}

// Resolution happens ONLY here, on the kernel side of the sandbox boundary:
toolPlane.invoke = async (tool, args, ctx) => {
  const secret = args.credential_handle
    ? await vault.resolve(args.credential_handle, { tool, agent_run_id: ctx.run.id })
    : undefined;                                            // throws if expired/revoked/mismatched
  emit('identity.credential_used', { handle: args.credential_handle, tool, agent: ctx.run.agent_id });
  return driver(tool)({ ...args, secret });                 // secret exists only in this closure
};
```

| Property | Value |
|---|---|
| Handle TTL | 15 min (5 min for `money_out`-capable credentials: Stripe, registrar) |
| Handle reuse | Unlimited within TTL, but every use emits `identity.credential_used` |
| Revocation | Kill switch, department freeze, credential rotation, or run end — all set `revoked_at` |
| Scope check | `AgentSpec.tools` ∩ credential scopes; a `market.demand` worker can never get a Stripe handle |
| Cross-venture | Impossible: `venture_id` is checked at resolve time |
| Rotation | `credentials.rotates_at`; a nightly job re-runs the ceremony's refresh path (OAuth refresh, API-key regenerate) and marks the old one revoked after a 10-min overlap |

### Least privilege by department (illustrative slice)

| Credential | D04 | D07 | D08/D10 | D11 | D13 |
|---|---|---|---|---|---|
| Company Gmail — send | ✅ (interview invites) | — | ✅ (sales) | ✅ (invoices) | — |
| Company Gmail — read | ✅ (replies) | — | ✅ | ✅ | — |
| GitHub — repo write | — | ✅ | — | — | ✅ |
| Render — deploy | — | ✅ | — | — | ✅ |
| Stripe — create payment link | — | — | ✅ | ✅ | — |
| Stripe — refund | — | — | — | ✅ | — |
| Terac — post job / pay | — | — | — | ✅ | — |
| X/LinkedIn — post | — | — | ✅ (gated) | — | — |
| Registrar — purchase | — | — | — | ✅ | — |

### Redaction

Every write path (`events.append`, `artifacts.sign`, `memory.write`, structured logs) passes through
one redactor. It is not a nice-to-have — it is why an event log can be shown to a judge on stage.

```ts
// packages/identity/src/redact.ts
const PATTERNS = [
  /sk_(live|test)_[A-Za-z0-9]{16,}/g,          // Stripe
  /gh[pousr]_[A-Za-z0-9]{20,}/g,               // GitHub
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:\d[ -]*?){13,19}\b/g,                  // PAN, Luhn-checked before redacting
  /\b\d{3}-\d{2}-\d{4}\b/g,                    // SSN
  /\b\d{6}\b(?=[^\d]*(code|otp|verification))/gi,
];
export const redact = (s: string) => PATTERNS.reduce((a, re) => a.replace(re, '[REDACTED]'), s);
```

Solari screenshots are redacted before they reach a Linq card or the Boardroom: the driver returns
bounding boxes for every input of type `password`, `tel`, or `cc-number`, and the identity service
blacks them out server-side.

### Audit

```sql
-- "Show me everything this credential has ever done."
SELECT e.ts, e.actor_id, e.department_id, e.payload->>'tool' AS tool, e.payload->>'handle' AS handle
FROM events e
WHERE e.venture_id = $1 AND e.type IN ('identity.credential_used','identity.ceremony_paused','gate.executed')
  AND e.payload->>'credential_id' = $2
ORDER BY e.ts;
```

Every credential use is an event. Every ceremony step is an event. The Boardroom's Identity panel is
a projection of these, showing per-account: how it was acquired, which departments hold grants right
now, when each grant expires, and the last 20 uses.

---

## Composio's role

Composio owns the OAuth surface for everything OAuth-able. We do not build OAuth flows.

| What Composio gives us | How we use it |
|---|---|
| Hosted OAuth for Gmail, Calendar, LinkedIn, Slack, GitHub, HubSpot, Notion | The founder taps one link during onboarding; the company gets scoped access without us storing a token |
| Connection handles instead of tokens | `credentials.composio_connection_id` is stored; `ciphertext` stays NULL. We hold a pointer, not a secret. |
| Token refresh | Composio refreshes; our rotation job just verifies liveness |
| Per-action scopes | Mapped 1:1 onto our `credential_grants.scopes`, so the least-privilege table above is enforceable |
| Tool schemas | Fed into the tool plane so `AgentSpec.tools` entries like `composio.gmail.send` are typed |

**Boundary:** Composio handles *the founder's* accounts and any OAuth-able account the company owns.
Solari handles everything with no OAuth and no API — which, in practice, is most consumer signups.
Two connections to the same provider are kept distinct (`account.handle` differs): the founder's
LinkedIn is read-scoped for network mining in D04; the company's own LinkedIn page is write-scoped
for D08, and posting from the founder's personal identity is prohibited.

---

## Failure modes

| Failure | Behavior |
|---|---|
| Provider blocks automated signup entirely (bot detection at the door) | Ceremony fails all three strategies → `Escalation(needs_credential)` → rung 4 founder card: "Create this account and connect it, or approve a $X alternative" |
| Founder never answers the ceremony gate | `on_timeout='hold'` — the account stays `awaiting_human`, the requesting department ships `partial` with `gaps: ['no_<provider>_account']` |
| Verification email lands in the company mailbox but the ceremony already timed out | The mailbox watcher re-opens the ceremony from `step='await_verification'`; nothing restarts from zero |
| Solari session dies mid-ceremony | Ceremony resumes from the last recorded `step` with a fresh session; forms are re-filled from `ceremony.transcript` (secrets re-pulled from the vault, never from the transcript) |
| Credential revoked externally (founder revokes OAuth) | First failing tool call emits `identity.credential_invalid` → department blocked (amber) → founder card to reconnect |
| Stripe payouts require founder KYC | Hard stop by design. The company can *charge* in test mode and can create the account, but moving real money to a bank account requires the founder's verified identity — we surface this as a one-time founder task, not an agent action. |

The last row is the honest answer to the judge's sharpest question about account autonomy: the
company can do everything up to and including taking a real payment; the step where money reaches a
human's bank account is, correctly, a human's step.
