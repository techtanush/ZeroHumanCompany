/**
 * Minimal Model Context Protocol client over Streamable HTTP.
 * Enough for `initialize` → `tools/list` → `tools/call` against a hosted MCP
 * server (Terac's lives at https://terac.com/api/mcp). Responses may arrive
 * as plain JSON or as an SSE body; both are handled.
 */

export interface McpClientOptions {
  url: string;
  bearer?: string;
  timeoutMs?: number;
  clientName?: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpError extends Error {
  constructor(message: string, public readonly code?: number, public readonly data?: unknown) {
    super(message);
    this.name = 'McpError';
  }
}

export class McpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private initialized = false;
  private toolCache: McpToolInfo[] | null = null;

  constructor(private readonly opts: McpClientOptions) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: this.opts.clientName ?? 'zeroth', version: '0.1.0' },
    });
    // Notifications carry no id and expect no reply; failures here are non-fatal.
    await this.notify('notifications/initialized').catch(() => undefined);
    this.initialized = true;
  }

  async listTools(): Promise<McpToolInfo[]> {
    if (this.toolCache) return this.toolCache;
    await this.initialize();
    const res = (await this.rpc('tools/list', {})) as { tools?: McpToolInfo[] };
    this.toolCache = res.tools ?? [];
    return this.toolCache;
  }

  /** Calls a tool and returns the parsed result. Text content that is JSON is decoded. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<{ raw: unknown; text: string; json: unknown; isError: boolean }> {
    await this.initialize();
    const res = (await this.rpc('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      structuredContent?: unknown;
      isError?: boolean;
    };
    const text = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
    let json: unknown = res.structuredContent ?? null;
    if (json == null && text) {
      try { json = JSON.parse(text); } catch { json = null; }
    }
    if (res.isError) throw new McpError(text || `tool ${name} failed`, undefined, res);
    return { raw: res, text, json, isError: Boolean(res.isError) };
  }

  private async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.post({ jsonrpc: '2.0', method, params });
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const body = await this.post({ jsonrpc: '2.0', id, method, params });
    const msg = pickResponse(body, id);
    if (!msg) throw new McpError(`no response for ${method}`);
    if (msg.error) throw new McpError(msg.error.message, msg.error.code, msg.error.data);
    return msg.result;
  }

  private async post(payload: Record<string, unknown>): Promise<JsonRpcResponse[]> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs ?? 30_000);
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      if (this.opts.bearer) headers.authorization = `Bearer ${this.opts.bearer}`;
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
      const res = await fetch(this.opts.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: ac.signal });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      const text = await res.text();
      if (!res.ok) {
        const safe = this.opts.bearer ? text.split(this.opts.bearer).join('[redacted]') : text;
        throw new McpError(`mcp ${res.status}: ${safe.slice(0, 200)}`, res.status);
      }
      return parseBody(text, res.headers.get('content-type') ?? '');
    } finally {
      clearTimeout(timer);
    }
  }
}

function pickResponse(msgs: JsonRpcResponse[], id: number): JsonRpcResponse | undefined {
  return msgs.find((m) => m.id === id) ?? msgs.find((m) => m.result !== undefined || m.error !== undefined);
}

/** Accepts either a JSON body or an SSE stream ("data: {...}" lines). */
export function parseBody(text: string, contentType: string): JsonRpcResponse[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (contentType.includes('text/event-stream') || trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const out: JsonRpcResponse[] = [];
    for (const line of trimmed.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try { out.push(JSON.parse(payload) as JsonRpcResponse); } catch { /* keepalive or partial */ }
    }
    return out;
  }
  const parsed = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcResponse[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

const clients = new Map<string, McpClient>();

/** One client per (url, bearer) so the MCP session survives across tool calls. */
export function mcpClientFor(url: string, bearer?: string): McpClient {
  const key = `${url}::${bearer ? bearer.slice(0, 8) : 'anon'}`;
  let c = clients.get(key);
  if (!c) { c = new McpClient({ url, bearer }); clients.set(key, c); }
  return c;
}
