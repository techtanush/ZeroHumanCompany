import { bearer, hasEnv, postJson } from './common.js';
import { mcpClientFor } from './mcp.js';

/**
 * Terac — the human-labor layer. MCP is the primary surface (tools are
 * discovered from https://terac.com/api/mcp and called by name); the REST API
 * under TERAC_BASE_URL is the fallback for anything the MCP does not expose.
 *
 * Auth: the same `tk_` key works as a bearer token for both surfaces
 * (verified against the live MCP endpoint).
 */
const env = 'TERAC_API_KEY';
const DEFAULT_MCP_URL = 'https://terac.com/api/mcp';
const DEFAULT_REST_URL = 'https://terac.com/api/external/v2';

export function hasKey(): boolean {
  return hasEnv(env);
}

export function mcpUrl(): string {
  return process.env.TERAC_MCP_URL ?? DEFAULT_MCP_URL;
}

function client() {
  return mcpClientFor(mcpUrl(), process.env.TERAC_API_KEY);
}

/** Call any Terac MCP tool by its published name (e.g. `terac_list_opportunities`). */
export async function mcpCall(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const r = await client().callTool(tool, args);
  return r.json ?? { text: r.text };
}

export async function listMcpTools(): Promise<Array<{ name: string; description?: string }>> {
  const tools = await client().listTools();
  return tools.map((t) => ({ name: t.name, description: t.description }));
}

/**
 * `terac.post_requisition`: the company decided it needs humans. Over MCP this
 * is a two-step "feasibility → draft opportunity" flow, which never spends
 * money on its own — launching (money_out) is a separate, gated tool.
 */
async function postRequisition(args: Record<string, unknown>): Promise<unknown> {
  const role = String(args.role ?? args.title ?? 'Contract specialist');
  const task = String(args.task ?? args.description ?? args.summary ?? `Help ${role} for an early-stage venture.`);
  const panel = String(args.panel ?? args.criteria ?? args.screening ?? `Experienced ${role}`);
  const count = Number(args.count ?? args.num_participants ?? 1);
  const timelineHours = Number(args.timeline_hours ?? 72);

  const feasibility = await mcpCall('terac_request_feasibility', {
    taskDescription: task,
    panelDescription: panel,
    submissionCount: Math.max(1, Math.round(count)),
    timelineHours: Math.max(1, Math.round(timelineHours)),
  });

  let draft: unknown = null;
  if (args.create_draft !== false) {
    draft = await mcpCall('terac_create_opportunity', {
      title: String(args.title ?? role).slice(0, 200),
      internal_title: `zeroth:${String(args.venture_id ?? 'venture')}:${role}`.slice(0, 200),
      description: task.slice(0, 8000),
      num_participants: Math.max(1, Math.round(count)),
      ...(args.project_id ? { project_id: String(args.project_id) } : {}),
    }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  }

  return { surface: 'mcp', feasibility, draft, launched: false, note: 'draft only; launch is a money_out gate' };
}

async function restFallback(path: string, args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const baseUrl = process.env.TERAC_BASE_URL ?? DEFAULT_REST_URL;
  return postJson({ vendor: 'terac', url: `${baseUrl}${path}`, apiKey: key, headers: bearer(key), body: args });
}

export async function run(args: unknown): Promise<unknown> {
  return runTool('terac.post_requisition', args);
}

export async function runTool(toolName: string, args: unknown): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    switch (toolName) {
      case 'terac.post_requisition': return await postRequisition(a);
      case 'terac.request_feasibility':
        return await mcpCall('terac_request_feasibility', {
          taskDescription: String(a.task ?? a.taskDescription ?? ''),
          panelDescription: String(a.panel ?? a.panelDescription ?? ''),
          ...(a.count != null ? { submissionCount: Number(a.count) } : {}),
          ...(a.timeline_hours != null ? { timelineHours: Number(a.timeline_hours) } : {}),
        });
      case 'terac.get_feasibility': return await mcpCall('terac_get_feasibility_request', { requestId: String(a.request_id) });
      case 'terac.list_opportunities': return await mcpCall('terac_list_opportunities', a);
      case 'terac.get_submissions': return await mcpCall('terac_get_submissions', { opportunityId: String(a.opportunity_id), ...(a.status ? { status: a.status } : {}) });
      case 'terac.launch_opportunity': return await mcpCall('terac_launch_draft_opportunity', { opportunityId: String(a.opportunity_id) });
      case 'terac.approve_submission': return await mcpCall('terac_approve_submission', { submissionId: String(a.submission_id) });
      case 'terac.mcp_call': {
        const tool = String(a.tool);
        // Money-moving or irreversible MCP tools must go through their gated wrappers.
        if (/^terac_(launch_draft_opportunity|approve_submission|reject_submission|stop_opportunity|delete_opportunity)$/.test(tool)) {
          throw new Error(`${tool} is gated: use terac.launch_opportunity / terac.approve_submission instead`);
        }
        return await mcpCall(tool, (a.args as Record<string, unknown>) ?? {});
      }
      default: return await postRequisition(a);
    }
  } catch (mcpErr) {
    // MCP failed (network, unknown tool, auth): try the REST surface for the
    // one operation it is known to cover, otherwise surface the MCP error.
    if (toolName === 'terac.post_requisition') {
      try { return { surface: 'rest', result: await restFallback('/opportunities', a), mcp_error: String(mcpErr) }; } catch { /* fall through */ }
    }
    throw mcpErr;
  }
}
