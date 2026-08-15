# 17 — API Contracts

Purpose: the kernel HTTP, SSE, webhook, and internal queue surface that all apps and integrations use.

| Surface | Protocol | Caller | Auth |
|---|---|---|---|
| Boardroom API | REST + SSE | founder UI | founder session JWT |
| Agent API | REST | orchestrator/sandboxes | short-lived agent JWT |
| Webhooks | REST | Stripe, Composio, Linq, Terac, Replay | vendor signature |
| Internal queue | BullMQ/Redis | kernel/orchestrator | service identity |

## REST resources

```ts
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    trace_id: z.string(),
    retryable: z.boolean(),
    details: z.record(z.any()).optional(),
  }),
});
```

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/ventures` | Create venture from founder-led or autonomous mode |
| `GET` | `/v1/ventures/:id` | Read venture projection |
| `GET` | `/v1/ventures/:id/timeline` | Paged event timeline |
| `GET` | `/v1/ventures/:id/artifacts` | Filter artifacts by type/quality |
| `GET` | `/v1/artifacts/:id` | Fetch artifact body and source map |
| `POST` | `/v1/work-orders` | Create a typed work order |
| `POST` | `/v1/events` | Agent emits an event; kernel validates/reduces |
| `GET` | `/v1/gates` | Founder-visible approval cards |
| `POST` | `/v1/gates/:id/decision` | Approve/reject/provide code/text |
| `GET` | `/v1/budgets/:venture_id` | Department envelopes and spend |
| `POST` | `/v1/kill-switch` | Pause all side effects for a venture |

## Create venture

```ts
export const CreateVentureRequest = z.object({
  mode: z.enum(['founder_led','autonomous_origination']),
  founder_profile: FounderProfile,
  idea_seed: IdeaSeed.optional(),
  autonomy_level: z.enum(['copilot','supervised','autonomous']).default('supervised'),
  spend_cap_usd: z.number().min(0).max(10000),
  terac_cap_usd: z.number().min(0).max(10000),
});
```

Response:

```ts
export const CreateVentureResponse = z.object({
  venture_id: z.string().uuid(),
  trace_id: z.string(),
  first_work_order_id: z.string().uuid(),
  sse_url: z.string(),
});
```

## Agent event emit

```ts
export const EmitEventRequest = z.object({
  venture_id: z.string().uuid(),
  type: z.string(),
  actor_id: z.string(),
  department_id: z.string().optional(),
  payload: z.record(z.any()),
  causation_id: z.string().uuid().optional(),
  correlation_id: z.string().uuid().optional(),
  trace_id: z.string(),
  idempotency_key: z.string(),
});
```

Rules:

- Idempotency key is required for every external side effect result.
- Payload validates against `packages/contracts/src/events.ts`.
- Reducers are synchronous for gate/budget/state projections; slow projections subscribe later.
- Events that imply a side effect but lack a matching gate are rejected with `403 gate_required`.

## SSE stream

`GET /v1/ventures/:id/stream`

```ts
export const SseEnvelope = z.object({
  seq: z.number().int(),
  event: z.enum(['event','projection','gate','budget','department','toast','heartbeat']),
  venture_id: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.any()),
  trace_id: z.string(),
});
```

The Boardroom resumes with `Last-Event-ID`. If the cursor is older than retention, the client
refreshes projections then reconnects from the latest sequence.

## Webhook receivers

| Path | Vendor | Important events |
|---|---|---|
| `/v1/webhooks/stripe` | Stripe | checkout completed, invoice paid/failed, refund, dispute |
| `/v1/webhooks/composio` | Composio | Gmail reply, calendar booked, connector revoked |
| `/v1/webhooks/linq` | Linq | founder approval reply, prospect SMS reply |
| `/v1/webhooks/terac` | Terac | requisition accepted, deliverable submitted, payout |
| `/v1/webhooks/replay` | Replay | run completed, bug found, regression passed |
| `/v1/webhooks/render` | Render | deploy started/succeeded/failed |

Every webhook handler verifies signature, records raw snapshot in object storage, emits a normalized
event, and returns 2xx only after idempotency is recorded.

## Authentication and scopes

```ts
export const Principal = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('founder'), founder_id: z.string().uuid(), venture_ids: z.array(z.string().uuid())}),
  z.object({kind: z.literal('agent'), agent_id: z.string(), department_id: z.string(), venture_id: z.string().uuid(), scopes: z.array(z.string())}),
  z.object({kind: z.literal('service'), service_id: z.string(), scopes: z.array(z.string())}),
  z.object({kind: z.literal('webhook'), vendor: z.string(), scopes: z.array(z.string())}),
]);
```

Agent JWTs expire within 15 minutes and are minted per work order. Tool credentials are never in
JWT claims; scopes only authorize the tool plane to fetch a credential from the vault.

## Assumptions & open questions

- **MVP:** REST + SSE is enough; no GraphQL.
- **MVP:** Webhook snapshots go to S3-compatible storage and are referenced by `source_id`.
- **POST-MVP:** Add tenant-level admin API and analytics export.
