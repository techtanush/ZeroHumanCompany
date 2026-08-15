# 07 — Source Control & GitHub

How Claude Code and the department agents interact with source control, for **both** repos in
play: the ZEROTH monorepo itself (built by us and our build agents) and the venture repos the
company generates (built by D07 for its products). The two have different owners, different
policies, and must never be confused.

> **The invariant, stated once:** GitHub is durable state; every working directory — human
> checkout, agent worktree, or sandbox filesystem — is a cache. Nothing exists only in a working
> directory for longer than one task. This is D07's rule
> ([`../02-departments/D07-build.md`](../02-departments/D07-build.md) §3) generalized to
> everything that touches git in this project.

Read alongside [`06-repo-layout.md`](06-repo-layout.md) (the ZEROTH tree),
[`02-speed-playbook.md`](02-speed-playbook.md) §4 (worktrees + merge cadence),
[`../01-platform/07-identity-and-accounts.md`](../01-platform/07-identity-and-accounts.md)
(who holds which token), and [`08-cicd-and-testing.md`](08-cicd-and-testing.md) (what runs on
every push).

---

## 1. The two repo worlds

```
WORLD A — the ZEROTH monorepo                WORLD B — generated venture repos
(we build the company)                       (the company builds products)
┌─────────────────────────────┐              ┌─────────────────────────────────┐
│ github.com/<team>/zeroth     │              │ org: zeroth-vn-<venture_short>  │
│ one repo · one main          │              │ repo: <product-slug>            │
│ authors: 4 humans +           │              │ authors: build.* agents ONLY    │
│   4 jcode lane agents +       │              │ created at runtime via          │
│   Claude Code sessions        │              │   Composio/GitHub API           │
│ token: human PATs / gh auth   │              │ token: scoped handle from the   │
│                               │              │   Identity Vault, org-scoped    │
│ policy: §2                    │              │ policy: §4                      │
└─────────────────────────────┘              └─────────────────────────────────┘
```

| Question | World A (ZEROTH) | World B (venture) |
|---|---|---|
| Who creates the repo | A human, before `T+0` | The company, at venture start (§3) |
| Who commits | Humans + build agents under human identity | `build.*` agents under the venture org's bot identity |
| Default branch | `main`, always green | `main`, protected, merge-only |
| Branch model | Lane branches + 45-min merge cadence | `build/<n>` + `feat/<n>/<F-ID>` per D07 |
| Deploy trigger | Manual / CI on tag (see [`08-cicd-and-testing.md`](08-cicd-and-testing.md)) | `build.deployer`, gated |
| Who ultimately owns it | The team | **The founder** — transferable in one API call |

---

## 2. World A — the ZEROTH monorepo **MVP**

### 2.1 Local workspace layout

One clone per agent or human, via `git worktree`, exactly as
[`02-speed-playbook.md`](02-speed-playbook.md) §4.2 prescribes:

```bash
~/work/zeroth/                 # primary clone, main — the merge arbiter works here
~/work/zeroth-L1/              # worktree, branch lane/kernel
~/work/zeroth-L2/              # worktree, branch lane/departments
~/work/zeroth-L3/              # worktree, branch lane/boardroom
~/work/zeroth-L4/              # worktree, branch lane/integrations

git worktree add ../zeroth-L1 -b lane/kernel
# each worktree: own node_modules (shared pnpm store), own .env, own dev ports
```

Rules: no agent ever works in another agent's worktree; the primary clone is only for merging and
tagging; `.env` files are per-worktree and gitignored everywhere.

### 2.2 Branch naming

| Branch | Pattern | Created by | Merged by |
|---|---|---|---|
| Mainline | `main` | — | merge arbiter only |
| Lane | `lane/<kernel\|departments\|boardroom\|integrations>` | lane agent at `T+0` | 45-min cadence |
| Spike | `spike/<slug>` | anyone | deleted, never merged — spikes are for learning |
| Fix after freeze | `hotfix/<slug>` | clock-owner approval | merge arbiter |

### 2.3 Commit policy

Conventional commits, `type ∈ {feat, fix, chore, test, infra, docs}`, scope = package name:

```
feat(kernel): gate engine timeout path

Refs: 01-build-order.md 1.11
Lane: L1 · Session: jcode/lane-kernel
```

| Rule | Why |
|---|---|
| Commit at every green checkpoint, push immediately | Working dirs are caches; unpushed work did not happen |
| `pnpm build && pnpm test` green before any merge to `main` | A red `main` blocks 4 lanes = 4× cost |
| Rebase lane branches onto `main`, never merge-commit | Readable history at 4am |
| Tag every milestone (`m0-skeleton`, `m1-vertical-slice`, …) | Rollback points, per [`01-build-order.md`](01-build-order.md) §13 |
| Never commit: `.env`, fixtures with real personal data, vendor responses containing live keys | Secret hygiene; CI enforces with a scan (see [`08-cicd-and-testing.md`](08-cicd-and-testing.md) §2) |
| Contracts commits land first in every merge window | Everyone rebases onto the new truth |

### 2.4 Protection **MVP-light**

During the hackathon, `main` protection is social (the merge arbiter), not mechanical — branch
protection rules slow a 45-minute cadence. Post-hackathon (Week 1,
[`10-roadmap-and-milestones.md`](10-roadmap-and-milestones.md)): required status checks
(`build`, `test`, `fixtures:check`), PR-only merges, one review — where "review" is usually a
review agent (§5).

---

## 3. World B — venture repo creation **MVP (simplified) / POST-MVP (full ceremony)**

### 3.1 The full design (POST-MVP)

At venture start, per [`../01-platform/07-identity-and-accounts.md`](../01-platform/07-identity-and-accounts.md),
the Identity service runs an `AccountCeremony`: create GitHub org `zeroth-vn-<short>` under the
company's own Gmail identity, mint a fine-grained PAT scoped to that org, store it in the vault.
If GitHub demands a human step (phone, 2FA), Solari drives the browser and Linq texts the founder
for the code. D07 receives only a scoped vault handle, never the raw token.

### 3.2 The MVP simplification (what actually runs at the hackathon)

One pre-created org, one fine-grained PAT minted the night before, injected via env. The ceremony
is narrated, not executed. This is a FAKED-BUT-HONEST row in
[`05-mvp-scope.md`](05-mvp-scope.md) §2.1.

```
GITHUB_ORG=zeroth-vn-demo         # pre-created; PAT scoped to exactly this org
GITHUB_TOKEN=github_pat_...       # fine-grained: repos RW, admin RW, NOTHING else, 7-day expiry
```

### 3.3 Repo creation call path

Repo creation goes through the tool plane like every other side effect, so it is metered, evented,
and mockable. Composio's GitHub toolkit is the primary driver (it also carries the OAuth story for
other founder-connected tools); the raw GitHub REST API is the fallback driver behind the same
interface.

```ts
// packages/tool-plane/src/drivers/real/github.ts
export const githubReal: GitHubDriver = {
  async createVentureRepo(input: { org: string; name: string; description: string }) {
    // 1. POST /orgs/{org}/repos  { name, private: true, auto_init: false }
    // 2. PUT branch protection on main (see §4.3) — applied BEFORE first push
    // 3. Create the zeroth-bot deploy key / installation token for CI
    // 4. emit('venture.repo_created', { org, name, url })   ← every side effect is an event
    return VentureRepo.parse(/* ... */);
  },
  // via Composio when COMPOSIO_API_KEY is set and the founder entity is connected;
  // direct REST with GITHUB_TOKEN otherwise. Same Zod-validated return either way.
};
```

Mock driver: returns `fixtures/vendors/github/repo-created.json`, so D07 development never needs
a real org (the M3 acceptance test flips to real).

---

## 4. World B — branch, commit, and merge policy inside a venture repo **MVP**

This is D07's contract, restated from
[`../02-departments/D07-build.md`](../02-departments/D07-build.md) §3 so this file is a complete
reference on its own. D07's file governs if they ever drift.

### 4.1 Branch model

| Branch | Created by | Lifetime | Protection |
|---|---|---|---|
| `main` | Architect (scaffold commit) | forever | No direct pushes. Merge only from `build/<n>` after QA green |
| `build/<n>` | Integrator, per cycle `n` | one cycle | Integration target; all `feat/*` merge here |
| `feat/<n>/<FEATURE_ID>` | Implementer `k` | one task | Owned by exactly one implementer |
| `hotfix/<ticket>` | D12-triggered build | until merged | Same gate as `build/*` |

Implementers work in **git worktrees inside the sandbox** (`/workspace/wt/impl-k`), one object
store, N working dirs, no two agents ever in one directory.

### 4.2 Commit conventions

```
<type>(<feature_id>): <imperative summary>

<why — cite the evidence>
Evidence: claim_id=CL-114 ("I spend Sunday night rebuilding the roster by hand")
Spec: ProductSpec v2 F-03
Agent: build.implementer#2 · model=sonnet · work_order=<uuid> · tokens=18412

Co-Authored-By: Zeroth Build Agent <build@zeroth-vn-4f2a.dev>
```

Every commit trailer carries the work-order id: `git log` is a second audit trail that agrees
with the event store, and `git blame` answers *which agent wrote this line and which customer
quote justified it*. That answer is demo material
([`05-mvp-scope.md`](05-mvp-scope.md) §7).

### 4.3 Protected branches (venture repos)

Applied by `createVentureRepo` before the first push, so no window exists where an agent could
push straight to `main`:

```jsonc
// PUT /repos/{org}/{repo}/branches/main/protection
{
  "required_status_checks": { "strict": true, "contexts": ["ci/build", "ci/qa-replay"] },
  "enforce_admins": true,                    // the bot PAT obeys its own rules
  "required_pull_request_reviews": null,     // MVP: QA-green replaces human review (§5)
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
```

**MVP note:** `required_pull_request_reviews` is null because the reviewer is the pipeline (QA +
critic), not a GitHub review. POST-MVP, the review agent (§5.2) posts a real PR review and the
setting flips to `required_approving_review_count: 1`.

---

## 5. PR generation and review agents

### 5.1 MVP: merge-on-green, PR as record **MVP**

At hackathon pace, the Integrator merges `feat/*` → `build/<n>` directly (it *is* the review:
conflict classification + full suite). A PR is still opened for `build/<n>` → `main` — not for
review theater, but because the PR is the human-legible changelog of the cycle:

```markdown
<!-- PR body generated by build.integrator -->
## Build cycle 7 — ShiftSwap
**Spec:** ProductSpec v2 · **Features:** F-01..F-06 (p0)
**QA:** 14/14 scenarios green · [Replay recordings](...)
**Merged:** feat/7/F-01 ✓ F-02 ✓ F-03 ✓ F-04 ✓ · **Reverted:** — · **Parked:** —
**Deploy:** pending gate `deploy_to_production`
Evidence trail: every feature links its claim_ids. See commit trailers.
```

The founder never reads diffs. The founder reads this body, the QA line, and the Replay links.

### 5.2 POST-MVP: the review agent

A `build.reviewer` worker (same pattern as `build.critic`, different rubric) reviews the
`build/<n> → main` PR on GitHub itself:

| Check | Source |
|---|---|
| Diff touches only files owned by the cycle's task graph | task graph artifact |
| No new dependency without a stated reason in a commit body | D07 implementer prompt rule |
| No secret literals (regex + entropy scan on the diff) | critic rubric #6 |
| Migrations are additive or carry a down-path | [`08-cicd-and-testing.md`](08-cicd-and-testing.md) §6 |
| Every feature's acceptance criteria map to a passing QA scenario | QA matrix |

Verdict posted as a real PR review (`APPROVE` / `REQUEST_CHANGES` with file-line comments), which
satisfies the flipped branch-protection rule. One revision loop, then `contested` + escalation —
the same anti-thrash invariant as every other critic.

---

## 6. How the founder approves a production deploy **MVP**

The deploy gate is the bridge between git state and running state. Sequence, per
[`../02-departments/D07-build.md`](../02-departments/D07-build.md) §9 and the gate engine in
[`../01-platform/06-human-in-the-loop.md`](../01-platform/06-human-in-the-loop.md):

```
build/<n> green ── QA p0 green ── critic accept
        │
        ▼
kernel opens gate: deploy_to_production
        │                    autonomy=autonomous? ──yes──► auto-approve, log it
        ▼ no
Linq card → founder's phone:
  "ShiftSwap is ready. 14/14 checks green. [Deploy] [Watch QA] [Hold]"
  · Watch QA → Replay recording links, founder-readable summaries
  · Hold     → gate stays open; timeout policy after 4h: re-notify, never auto-approve money/deploy
        │ Deploy
        ▼
gate.approved event ──► build.deployer:
  merge build/<n> → main (satisfies protection: checks green)
  tag v0.1.<n> · deploy exact sha · health probe · Deployment artifact signed
        │
        ▼
Rollback needs NO gate: redeploy previous sha, emit build.rolled_back.
Deploying is gated; undeploying is always allowed.
```

Fallback (Linq down): the same gate card renders in the Boardroom, approve there — identical
event, per [`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) §6.

**Founder handoff at venture end:** org ownership transfers to the founder's GitHub account in
one API call (`POST /orgs/{org}/invitations` role=admin, then bot demotes itself). The company
built it; the founder keeps it. The vault handle for that org is revoked at transfer.

---

## 7. Token and permission matrix **MVP**

Who holds what, scoped how. The raw-token rule: agents get vault handles, never raw PATs — except
the MVP env-var simplification, which still keeps World A and World B tokens distinct.

| Principal | Credential | Scope | Can | Cannot |
|---|---|---|---|---|
| Human teammate | own `gh auth` | ZEROTH repo | everything World A | touch venture orgs |
| jcode lane agent | teammate's ambient auth | ZEROTH repo, own lane branch | commit, push, PR | push to `main` directly (social contract) |
| `build.architect` | vault handle → venture PAT | one venture org | create repo (via tool plane), push scaffold | see other ventures, see the raw token |
| `build.implementer#k` | same handle, sandbox-injected | one repo, own `feat/*` branch | commit, push own branch | force-push, touch `main` or others' branches (protection + ownership rule) |
| `build.deployer` | vault handles: github + render | one org + its services | merge on green+gate, tag, deploy | approve its own gate |
| CI (venture) | per-repo installation token | one repo, read + checks | run checks, post statuses | push |
| Founder | own GitHub account | receives org transfer | everything, post-transfer | — |

Rotation: venture PATs are 7-day fine-grained tokens; the vault re-mints on expiry. World A PATs
are personal and outside the system's custody.

---

## 8. Failure modes and recoveries **MVP**

| Failure | Detection | Recovery |
|---|---|---|
| Sandbox destroyed mid-task | Head resumes, reads `/workspace/.zeroth/state.json` mirror from kernel | `git fetch --all`; any task whose branch head ≠ recorded sha is re-verified, not re-run. Worst loss: one task's uncommitted work |
| Two agents edited one file (ownership defect) | Integrator classifies conflict as SEMANTIC | Owner's branch wins; other diff parked in `.zeroth/parked/`; Architect re-dispatches reconciliation |
| Lockfile conflict | Integrator classification | Never hand-merged: `checkout --ours` + `pnpm install` + commit regenerated |
| GitHub API rate-limited mid-build | tool-plane error events | Pushes queue locally in the sandbox (the one permitted cache-overstay); retry with backoff; escalate at 10 min |
| PAT expired mid-cycle | 401 on push | Vault re-mints; sandbox env refreshed via handle re-resolution; task retries |
| Wrong-world push (venture code to ZEROTH or vice versa) | Pre-push hook comparing `origin` host+org against `.zeroth/world` marker file in each workspace | Hook blocks the push; loud event |
| Force-push attempted | Branch protection | Rejected by GitHub; `build.critic` treats the attempt as a defect |

---

## 9. Local git hooks (both worlds) **MVP**

Installed by `pnpm install` (husky-free — a 20-line script in `scripts/install-hooks.sh` copies
them into `.git/hooks/`; sandboxes get them baked into the D07 image).

```bash
#!/usr/bin/env bash
# .githooks/pre-push — the wrong-world guard + secret scan
set -euo pipefail
world=$(cat .zeroth/world 2>/dev/null || echo "unset")      # 'zeroth' | 'venture'
origin=$(git remote get-url origin)
case "$world" in
  zeroth)  [[ "$origin" == *"/zeroth"* ]]        || { echo "BLOCKED: venture remote in ZEROTH workspace"; exit 1; } ;;
  venture) [[ "$origin" == *"zeroth-vn-"* ]]     || { echo "BLOCKED: ZEROTH remote in venture workspace"; exit 1; } ;;
  *)       echo "BLOCKED: no .zeroth/world marker"; exit 1 ;;
esac
# cheap secret scan on outgoing commits (CI does the thorough one)
git diff --cached -U0 origin/HEAD.. 2>/dev/null | grep -E 'sk_live_|github_pat_|whsec_[A-Za-z0-9]{20,}' \
  && { echo "BLOCKED: secret-shaped string in diff"; exit 1; } || exit 0
```

```bash
#!/usr/bin/env bash
# .githooks/commit-msg — trailer enforcement in venture repos only
[[ "$(cat .zeroth/world)" == "venture" ]] || exit 0
grep -qE '^(feat|fix|chore|test|infra|docs)\(F?-?[A-Za-z0-9-]+\):' "$1" || { echo "BLOCKED: bad commit format"; exit 1; }
grep -q 'work_order=' "$1" || { echo "BLOCKED: missing work_order trailer"; exit 1; }
```

Hooks are a convenience layer, not a security boundary — branch protection and the vault scoping
in §7 are the boundary. A bypassed hook is caught by CI; a bypassed protection is impossible from
a scoped token.

---

## Assumptions & open questions

- **Assumed:** GitHub free-tier orgs suffice for venture repos at hackathon volume (private repos,
  API-created). If org-creation rate limits bite, fallback: repos under one umbrella org
  `zeroth-ventures` with per-repo team scoping — the transfer story still works per-repo.
- **Assumed:** Composio's GitHub toolkit covers repo + branch-protection endpoints; the direct
  REST driver is the same-interface fallback either way (30-minute rule applies).
- **Open:** whether jcode lane agents should sign commits (`Co-Authored-By` vs full GPG). MVP:
  trailer attribution only; GPG is Quarter 1 alongside SOC2-shaped posture
  ([`10-roadmap-and-milestones.md`](10-roadmap-and-milestones.md)).
- **Open:** monorepo push frequency vs. GitHub Actions minutes on World A once CI lands in Week 1
  — see the budget note in [`08-cicd-and-testing.md`](08-cicd-and-testing.md) §8.
- **Open:** whether the founder-handoff call also transfers Render service ownership atomically,
  or staggers (repo first, infra after first invoice). Leaning staggered; D11 owns the decision.
