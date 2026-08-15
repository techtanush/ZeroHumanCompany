# 15 — Anthropic Claude

Purpose: define how ZEROTH uses Claude models, the Anthropic API, the Agent SDK, and Claude Code without turning model calls into an ungoverned black box.

| Layer | Use | Owner |
|---|---|---|
| Agent runtime | Department Heads, workers, critics | `packages/agent-kit` |
| Build workflow | Claude Code agents produce app code in branches | D07 Build |
| Evaluation | Critics judge artifacts against rubrics | D07/D13 |
| Cost control | Prompt caching, model routing, budget meter | D11 + platform |

## Model routing

```ts
export const ModelRoute = z.object({
  task_kind: z.enum(['strategy','research','coding','extraction','classification','critic','voice_script']),
  default_model: z.enum(['claude-opus','claude-sonnet','claude-haiku']),
  fallback_model: z.enum(['claude-sonnet','claude-haiku']).optional(),
  max_input_tokens: z.number().int(),
  max_output_tokens: z.number().int(),
  cache_prefix_refs: z.array(z.string()).default([]),
  budget_department_id: z.string(),
  requires_citations: z.boolean().default(true),
});
```

| Task | Default | Fallback | Rule |
|---|---|---|---|
| Head synthesis with hard judgment | Opus | Sonnet | Use only for D02/D03/D06/D10 high-stakes decisions |
| Worker research/drafting | Sonnet | Haiku | Must return gaps instead of guesses |
| Extraction/classification | Haiku | Pioneer fine-tune when promoted | No uncited new claims |
| Code generation | Sonnet through Claude Code | Opus for architecture blockers | D07 must commit to a branch |
| Critic | Sonnet | none for compliance/money | A downgraded critic cannot approve irreversible actions |

## Agent SDK contract

```ts
export const ClaudeAgentInvocation = z.object({
  invocation_id: z.string().uuid(),
  venture_id: z.string().uuid(),
  department_id: z.string(),
  agent_id: z.string(),
  model_route_id: z.string(),
  system_prompt_ref: z.string(),
  input_artifact_refs: z.array(ArtifactRef),
  tool_allowlist: z.array(z.string()),
  budget_limit_usd: z.number().positive(),
  cache_key: z.string(),
  trace_id: z.string(),
});
```

Every call emits `model.invocation_started`, `money.metered`, and `model.invocation_completed`.
The completed event stores token counts, cache hit status, latency, output hash, and safety flags.

## Claude Code in D07

**MVP:** D07 creates a GitHub branch named `agent/{work-order-slug}`. Claude Code receives a
bounded work order, source tree, contracts, acceptance tests, and a commit rule. It may edit code,
run tests, commit, and open a draft PR. It may not deploy production, create paid infrastructure,
or expose secrets without a gate.

```yaml
claude_code_policy:
  branch_prefix: agent/
  required_commit_trailer: "work_order=<uuid>"
  forbidden:
    - production deploy without deployment_approval gate
    - committing .env or secrets
    - paid infrastructure creation
    - force-push to main
  required_checks:
    - npm test or documented equivalent
    - typecheck when TypeScript exists
    - Replay run for web UI p0 flows
```

## Prompt caching

Stable context is split into cacheable prefixes:

| Prefix | Contents | Invalidated by |
|---|---|---|
| `company-principles` | Start-here docs, invariants, department roster | architecture version bump |
| `venture-history` | signed artifacts and event summaries | new signed artifact |
| `department-manifest` | manifest + prompts + schemas | manifest hash change |
| `work-order` | current task, budget, success criteria | never reused |

The budget meter records cache hits separately so D11 can distinguish expensive reasoning from
avoidable prompt bloat.

## Safety and privacy

- PII is passed as aliases or encrypted handle refs whenever possible.
- Full transcripts are fetched only by agents with `memory.read` scope for that source class.
- Model outputs that propose external side effects are drafts until the gate engine approves.
- Tool calls are mediated by `packages/agent-kit`; Claude never receives ambient credentials.
- Any model uncertainty about legal, financial, medical, identity, or platform-policy facts raises
  `needs_human` or `needs_approval`.

## Evaluation

Claude-based critics are useful but not authoritative by themselves. A passing artifact needs:

1. Schema validation.
2. Evidence validation.
3. Budget check.
4. Critic rubric score.
5. Gate review when the artifact causes irreversible action.

## Demo use

The Boardroom shows token spend and cache hits during D07 build. A Claude Code branch appears,
Replay fails one p0 flow, Claude Code patches it, tests pass, and D07 requests deployment approval.

## Assumptions & open questions

- **MVP:** Use hosted Anthropic models through the official SDK.
- **POST-MVP:** Promote repeated classifiers to Pioneer fine-tunes when labels exceed thresholds.
- **Open:** Final model names and pricing must be updated at build time from current Anthropic docs.
