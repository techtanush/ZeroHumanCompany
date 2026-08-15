# 14 — Secrets & Vault: The Company's Keys, Held Away From Its Hands

One sentence: agents operate the company's accounts **without ever touching a secret** — the vault
holds envelope-encrypted credentials, the tool plane resolves opaque handles on the kernel side of
the sandbox boundary, and everything else in this file exists to keep that one boundary absolute.

```
                         KMS MASTER KEY (env / cloud KMS, rotated quarterly)
                                        │ wraps
                    ┌───────────────────┼────────────────────┐
                    ▼                   ▼                    ▼
             venture KEK A        venture KEK B        subject keys (PII,
                    │ wraps             │ wraps         see 12-safety…)
                    ▼                   ▼
          per-credential DEKs   per-credential DEKs
                    │ AES-256-GCM
                    ▼
          credentials.ciphertext          ← agents can never read this table
                    │
                    ▼ resolve(handle) — kernel-side only
          ┌─────────────────────┐
          │  TOOL PLANE          │──── scoped proxy calls ───► providers
          └─────────────────────┘
                    ▲ opaque handle (cred_xxx, 15-min TTL)
          ┌─────────┴───────────┐
          │  SANDBOX (agent)     │  holds handles, never bytes
          └─────────────────────┘
```

Upstream: [`07-identity-and-accounts.md`](07-identity-and-accounts.md) (ceremonies, grants,
redaction — this file deepens its vault section), [`13-permissions-and-policy.md`](13-permissions-and-policy.md)
(scope checks at resolve time). Downstream: [`12-safety-and-compliance.md`](12-safety-and-compliance.md)
(breach handling), [`10-observability.md`](10-observability.md) (`identity.*` events).

---

## Envelope encryption

**MVP** — three-level hierarchy, one level deeper than
[`07-identity-and-accounts.md`](07-identity-and-accounts.md) sketched, because per-venture
isolation deserves its own key level:

| Level | Key | Scope | Stored | Rotation |
|---|---|---|---|---|
| L0 | **Master key** | deployment | Render env var (MVP) / cloud KMS (POST-MVP) | quarterly, rewraps KEKs |
| L1 | **Venture KEK** | one per venture | `venture_keys.kek_wrapped` (wrapped by L0) | on demand (compromise), rewraps DEKs |
| L2 | **Credential DEK** | one per credential | `credentials.dek_wrapped` (wrapped by L1) | with the credential itself |

```sql
CREATE TABLE venture_keys (
  venture_id      uuid PRIMARY KEY REFERENCES ventures(id),
  kek_wrapped     bytea NOT NULL,          -- AES-256 KEK wrapped by the master key
  master_key_ver  int  NOT NULL,           -- which master version wrapped it
  created_at      timestamptz NOT NULL DEFAULT now(),
  rotated_at      timestamptz
);
```

Properties this buys:

- **Blast radius = one credential** for a leaked DEK; **one venture** for a leaked KEK.
- **Master rotation is O(ventures)**, not O(credentials): rewrap KEKs, ciphertext untouched.
- **Venture deletion is crypto-shredding**: destroy the KEK, every credential dies with it —
  the same mechanism as PII subject keys ([`12-safety-and-compliance.md`](12-safety-and-compliance.md)).
- The unwrap chain (`master → KEK → DEK → plaintext`) executes only inside
  `apps/kernel/src/vault/`; plaintext exists in one function scope
  ([`07-identity-and-accounts.md`](07-identity-and-accounts.md): "secret exists only in this
  closure") and is zeroed after the driver call returns.

```ts
// apps/kernel/src/vault/crypto.ts
export async function seal(ventureId: string, plaintext: Buffer): Promise<Sealed> {
  const kek = await unwrapKek(ventureId);                    // master unwraps KEK
  const dek = crypto.randomBytes(32);
  const iv  = crypto.randomBytes(12);
  const c   = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const ciphertext = Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
  const dek_wrapped = wrap(kek, dek);
  dek.fill(0); plaintext.fill(0);                            // zero what we can
  return { ciphertext, iv, dek_wrapped };
}
```

**MVP note:** the master key as a Render env var is the honest hackathon trade-off. The design
seam (`KmsDriver` interface with `env` and `cloud` implementations) means moving to AWS KMS /
GCP KMS is a config change.

---

## Per-venture credential isolation

**MVP** — isolation is enforced at four independent layers; any one alone would suffice, all four
together make cross-venture leakage a multi-bug event:

| Layer | Check |
|---|---|
| Cryptographic | credential ciphertext is under venture A's KEK; kernel code paths never unwrap with the wrong KEK because the KEK is looked up by the credential's own `venture_id` |
| Policy | step 3 venture-scope check ([`13-permissions-and-policy.md`](13-permissions-and-policy.md)) rejects the request before the vault is consulted |
| Grant | `credential_grants` join `agent_runs` → run's `venture_id` must equal credential's; asserted at grant time *and* resolve time |
| Audit | `identity.credential_used` events carry both venture ids when a mismatch is attempted — which fires `policy.scope_violation`, a P0 alert |

Founder-level sharing (the same founder running two ventures wanting to reuse a mailbox) is
**deliberately unsupported**: the second venture runs its own ceremony and gets its own account.
Accounts are cheap; entangled ventures are not.

---

## OAuth token storage and refresh

**MVP** — two storage modes per [`07-identity-and-accounts.md`](07-identity-and-accounts.md):

| Mode | What we store | Refresh |
|---|---|---|
| **Composio-held** (Gmail, LinkedIn, Calendar, Slack, GitHub via OAuth) | `credentials.composio_connection_id` only; `ciphertext` NULL | Composio refreshes; our nightly job calls `connections.verify` and marks `credential_invalid` on failure |
| **Vault-held** (providers we OAuth directly, API keys, cookie jars, TOTP seeds) | full envelope-encrypted token set | our refresh worker, below |

```ts
// apps/kernel/src/vault/refresh.ts — BullMQ repeatable, every 10 min
export async function refreshDue() {
  const due = await db.credentials.dueForRefresh();          // expires_at < now()+30min, kind='oauth_token'
  for (const cred of due) {
    try {
      const { access, refresh, expires_at } = await providerRefresh(cred);  // uses the refresh token
      await db.tx(async t => {
        await vault.reseal(cred.id, { access, refresh }, t); // new DEK, new ciphertext
        await t.credentials.update(cred.id, { expires_at });
      });
      emit('identity.credential_rotated', { credential_id: cred.id, kind: 'oauth_refresh' });
    } catch (e) {
      if (isInvalidGrant(e)) {                               // refresh token revoked upstream
        await db.credentials.markRevoked(cred.id, 'upstream_invalid_grant');
        emit('identity.credential_invalid', { credential_id: cred.id });
        // → department blocked (amber) → founder reconnect card (07-identity-and-accounts.md)
      } else scheduleRetry(cred, backoff(e));                // 15-error-handling policy
    }
  }
}
```

Rules:

- **Refresh tokens never leave the vault process.** Not to Composio, not to drivers, nowhere.
- Access tokens are re-derived on demand; a grant's handle survives a refresh transparently
  (resolution always reads the current ciphertext).
- Single-flight per credential: a Redis lock prevents two refreshes racing and burning a
  rotate-on-use refresh token (Google-style token rotation makes double-refresh destructive).
- `expires_at` unknown ⇒ refresh on first 401, then learn the TTL from the response.

---

## Credential brokering to sandboxes

**MVP** — the heart of the file. Agents in sandboxes get a **scoped proxy, never raw secrets** —
two mechanisms depending on the tool shape:

### Mechanism A: handle + kernel-side injection (API tools)

The default, restated precisely from [`07-identity-and-accounts.md`](07-identity-and-accounts.md):
the agent's tool call carries `credential_handle: 'cred_x…'`; the tool plane (kernel process)
resolves it, injects the secret into the provider request, and returns the response. The secret
never crosses the sandbox boundary in either direction.

### Mechanism B: the egress proxy (in-sandbox processes that need auth)

D07's build sandbox runs `git push` and `npm publish` — processes that need credentials *inside*
the sandbox. They get a per-run **authenticating forward proxy** instead:

```
sandbox process ── plain request, no auth ──► egress proxy (kernel-side)
                                                │ 1. match (host, path, verb) against grant scopes
                                                │ 2. attach Authorization from the vault
                                                │ 3. enforce the manifest egress allowlist
                                                └──► provider
```

```ts
// apps/orchestrator/src/egress-proxy.ts (shape)
proxy.on('request', async (req, ctx) => {
  const rule = matchScope(ctx.grant, req.host, req.path, req.method);
  if (!rule) return deny(req, 'egress_scope');               // emits agent.tool_failed
  if (containsSecretLike(req.body)) return deny(req, 'secret_in_egress');  // exfil guard
  req.headers.authorization = await vault.headerFor(rule.credential_id);
  meter.record('tool_call', `egress:${req.host}`, 1);
  emit('identity.credential_used', { handle: ctx.grant.handle, tool: `egress:${req.host}` });
});
```

Git specifically: the sandbox's git remote is `http://proxy.internal/github/<org>/<repo>.git` —
credentials attach at the proxy; `.git/config` on the sandbox FS contains nothing sensitive, so a
sandbox snapshot/fork ([`02-agent-runtime.md`](02-agent-runtime.md)) can never leak a token.

### Mechanism C: sealed typing (Solari ceremonies)

Browser ceremonies need passwords typed into real pages. The vault types them via the Solari
driver's sealed-input channel ([`07-identity-and-accounts.md`](07-identity-and-accounts.md)):
the agent scripts *which field*, the vault supplies *what bytes*, the screenshot redactor blacks
out the field. The agent's transcript records `{field: 'password', supplied: true}`.

| Property | A (handle) | B (proxy) | C (sealed typing) |
|---|---|---|---|
| Secret enters sandbox | never | never | never (typed by driver) |
| Scope enforcement | grant scopes at resolve | (host, path, verb) rules | ceremony step allowlist |
| Used by | most tools | D07 build, scrapers with auth | identity ceremonies |
| Audit event | `credential_used` | `credential_used` per request | `ceremony_*` steps |

---

## Rotation

**MVP**

| What | Cadence | Mechanism |
|---|---|---|
| OAuth access tokens | provider TTL | refresh worker, above |
| API keys (regenerable: Render, Apify, registrar) | 30 days (`credentials.rotates_at`) | nightly job regenerates via provider API, 10-min overlap window, old key revoked after |
| API keys (non-regenerable without ceremony) | on compromise only | re-run the acquisition ceremony |
| Cookie jars (Solari sessions) | on expiry signal (401/redirect-to-login) | re-run ceremony from `step='login'` |
| Venture KEK | on compromise, venture pause | rewrap all DEKs (fast; DEKs are small) |
| Master key | quarterly | rewrap KEKs; `master_key_ver` tracks which version wrapped what, so rotation is resumable |
| Kernel signing key (run tokens, artifact HMACs) | quarterly | dual-validity window: verify {n, n-1}, sign with n |

Rotation **never invalidates in-flight grants silently**: rotating a credential keeps the old
ciphertext resolvable for the 10-minute overlap, then `resolve()` fails loudly with
`credential_rotated` and the agent's retry acquires a fresh grant.

---

## Revocation

**MVP** — revocation is layered by scope of the problem:

| Trigger | What gets revoked | Latency |
|---|---|---|
| Agent run ends | its grants (`revoked_at`) | immediate, orchestrator hook |
| Department frozen | all grants for the department's active runs | immediate |
| Kill switch | **every grant in the venture** + refresh worker paused | immediate |
| Credential compromised | credential ciphertext marked revoked; upstream key regenerated/revoked at the provider (best effort, per-provider driver) | minutes |
| Venture killed | venture KEK destroyed after a 7-day grace hold (crypto-shred) | 7 days |
| Founder revokes OAuth upstream | detected on next use/verify → `credential_invalid` → reconnect card | ≤ nightly |

`resolve()` checks `revoked_at` on **both** the grant and the credential on every call — there is
no revocation cache to go stale ([`13-permissions-and-policy.md`](13-permissions-and-policy.md):
"a cached ALLOW that outlives a revocation is a security bug").

---

## Leak detection

**MVP** — assume the redactor will one day miss; detect fast.

| Detector | Where it runs | On hit |
|---|---|---|
| **Write-path redactor** (patterns in [`07-identity-and-accounts.md`](07-identity-and-accounts.md)) | every event/artifact/memory/log write | redact + `identity.leak_suspected` (the write succeeded, redacted) |
| **Canary secrets** | one fake credential per venture (`cred_canary_*`, a real-looking Stripe test key stored alongside real ones, never granted) | any resolve attempt or any appearance of its bytes anywhere = confirmed exfil path, P0 page |
| **Egress scanner** | egress proxy + outbound compliance checker ([`12-safety-and-compliance.md`](12-safety-and-compliance.md)) | block + `policy.prohibited_attempted` |
| **Log scanner** | nightly sweep of the last 24h of logs/events with the full pattern set + entropy heuristic (base64/hex runs > 24 chars near auth-ish keys) | `identity.leak_suspected` + operator review queue |
| **Grant anomaly** | resolve-rate per handle vs baseline (a handle resolved 100×/min is exfil or a loop) | throttle + alert D13 |

Response runbook (kernel-automated first steps):

```
leak_suspected(credential X)
  1. revoke X's grants; mark X revoked
  2. rotate/regenerate upstream via driver (or open a founder card if ceremony needed)
  3. scan event/log window for X's bytes → scope the exposure
  4. if founder/customer data implicated → breach path (12-safety-and-compliance.md)
  5. write the incident as events; D13 gets a cos.gap_detected with the timeline
```

---

## Forbidden in logs

**MVP** — the explicit negative list. "Logs" means: structured logs, `events.payload`,
`artifacts.body`, `memory_chunks.content`, span attrs, ceremony transcripts, gate previews,
Linq cards, and SSE frames. One redactor guards all of them
([`07-identity-and-accounts.md`](07-identity-and-accounts.md)); this is its contract:

| Never in logs | Includes | What appears instead |
|---|---|---|
| Secret material | API keys, OAuth/refresh tokens, passwords, cookies, TOTP seeds/codes, signing keys, DEKs/KEKs | `[REDACTED]` or the credential's `handle` |
| OTPs & verification codes | the founder's 6-digit codes, magic links | `{step:'2fa_code', supplied:true}` |
| Payment instruments | PAN, CVV, bank/routing, crypto private keys | never collected by agents at all ([`07`](07-identity-and-accounts.md)) |
| Government identifiers | SSN/EIN, passport/ID numbers | never collected |
| P1 PII in non-designated stores | names, emails, phones outside `leads`/`interviews` | aliases (`P3 — ops lead…`) |
| Raw `Authorization`/`Cookie` headers | in span attrs, proxy logs, error dumps | header name + `[REDACTED]` |
| Full provider error bodies | often echo the request incl. auth | status + provider error code + our correlation id |
| Prompts containing any of the above | error paths that dump context | prompt hash + packet_id ([`10-observability.md`](10-observability.md)) |

Enforcement beyond the redactor: error serializers whitelist fields (never `JSON.stringify(err)`
raw), proxy logs record metadata only, and CI runs the leak scanner against the demo seed's full
event log — a hit fails the build.

---

## Vault API surface (internal)

**MVP** — the only functions anything outside `apps/kernel/src/vault/` may call. No read API
exists. This is the "Read raw credentials row is all-blank" from
[`13-permissions-and-policy.md`](13-permissions-and-policy.md), made concrete:

```ts
// apps/kernel/src/vault/index.ts — the entire public surface
export interface Vault {
  store(input: NewCredential): Promise<{ credential_id: string }>;       // ceremonies write
  grant(run: AgentRun, need: CredentialNeed): Promise<Handle>;           // 07-identity grant()
  resolve(handle: string, ctx: ResolveCtx): Promise<never>;             // ← NOT public: tool plane only,
                                                                        //   and it returns into a closure
  headerFor(credential_id: string): Promise<string>;                    // egress proxy only
  rotate(credential_id: string): Promise<void>;
  revoke(sel: { credential_id?: string; venture_id?: string; department_id?: string }): Promise<number>;
  shred(venture_id: string): Promise<void>;                             // destroys the KEK
  verifyLiveness(credential_id: string): Promise<'ok'|'invalid'>;
}
```

The founder's Boardroom identity panel shows credential *metadata* (provider, scopes, last used,
expiry) from events and the credentials table's non-secret columns — never a "reveal" button.

---

## Assumptions & open questions

- **Assumption:** the kernel process is trusted. If the kernel is compromised, the vault is
  compromised — the design isolates sandboxes (where injected/untrusted content runs) from
  secrets, not the kernel from itself. POST-MVP: split the vault into its own minimal process.
- **Assumption:** Composio's token custody is acceptable for OAuth providers — we inherit their
  security posture and record that in the data-processing map
  ([`12-safety-and-compliance.md`](12-safety-and-compliance.md)).
- **Open:** should Mechanism B's proxy also man-in-the-middle TLS for non-allowlisted hosts, or
  hard-deny? MVP hard-denies (allowlist per manifest); some scrapers may need broader egress with
  auth-stripping instead.
- **Open:** TOTP seeds in the vault let ceremonies re-auth without the founder — convenient, but
  it weakens "the founder holds the second factor." MVP stores them only when the founder opts in
  per account.
- **Open:** grant TTL (15 min) vs D07's long builds — the egress proxy re-grants transparently on
  expiry mid-run today; confirm this never yields a half-authenticated push.
- **POST-MVP:** cloud KMS with envelope-encryption offload, hardware-backed master keys,
  per-credential access policies in KMS itself, and an HSM story for the signing key.
