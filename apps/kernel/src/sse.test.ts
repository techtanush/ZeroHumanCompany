import { describe, expect, it } from 'vitest';
import { openDb } from '@zeroth/db';
import { Kernel } from './kernel.js';
import { buildServer } from './server.js';

/**
 * SSE is how the Boardroom stays live. These tests hit a real listening socket
 * (not app.inject, which cannot express a streaming response), because the two
 * things that break in practice are resume-from-Last-Event-ID and live push.
 */
describe('SSE stream', () => {
  it('replays missed events and pushes new ones live', async () => {
    const db = await openDb({ dataDir: 'memory' });
    const kernel = await Kernel.create({ db, routing: [], signingKey: 'sse-key' });
    const app = buildServer({ kernel, token: 'tok' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as any).port;

    const v = await kernel.createVenture({
      mode: 'founder_led', name: 'Stream Co',
      founder: { display_name: 'Ada', email: 'sse@x.com' }, spend_cap_usd: 26,
    });

    // Something happened before the client ever connected.
    await kernel.events.append({
      venture_id: v.venture_id, type: 'agent.started', actor_id: 'early', trace_id: v.trace_id,
    });

    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/v1/ventures/${v.venture_id}/stream`, {
      headers: { authorization: 'Bearer tok', 'last-event-id': '0' },
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const readUntil = async (predicate: (s: string) => boolean, budgetMs = 5000) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        if (predicate(buf)) return true;
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
      return predicate(buf);
    };

    // 1. Backlog is replayed on connect.
    expect(await readUntil((s) => s.includes('venture.created') && s.includes('"actor_id":"early"'))).toBe(true);

    // 2. A brand new event arrives without reconnecting.
    await kernel.events.append({
      venture_id: v.venture_id, type: 'artifact.created', actor_id: 'live-one', trace_id: v.trace_id,
      payload: { artifact: { type: 'IdeaSeed', id: '11111111-1111-1111-1111-111111111111', version: 1, hash: 'h' } },
    });
    expect(await readUntil((s) => s.includes('live-one'))).toBe(true);

    // 3. Each frame carries an id, so Last-Event-ID resume works.
    expect(/^id: \d+$/m.test(buf)).toBe(true);

    ac.abort();
    await reader.cancel().catch(() => undefined);
    await app.close();
    await kernel.close();
  }, 20_000);

  it('does not leak events across ventures', async () => {
    const db = await openDb({ dataDir: 'memory' });
    const kernel = await Kernel.create({ db, routing: [], signingKey: 'sse-key' });
    const app = buildServer({ kernel, token: 'tok' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as any).port;

    const a = await kernel.createVenture({ mode: 'founder_led', name: 'A', founder: { display_name: 'A', email: 'a@sse.com' } });
    const b = await kernel.createVenture({ mode: 'founder_led', name: 'B', founder: { display_name: 'B', email: 'b@sse.com' } });

    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/v1/ventures/${a.venture_id}/stream`, {
      headers: { authorization: 'Bearer tok' }, signal: ac.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    await kernel.events.append({ venture_id: b.venture_id, type: 'agent.started', actor_id: 'other-venture', trace_id: b.trace_id });
    await kernel.events.append({ venture_id: a.venture_id, type: 'agent.started', actor_id: 'my-venture', trace_id: a.trace_id });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !buf.includes('my-venture')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    expect(buf).toContain('my-venture');
    expect(buf).not.toContain('other-venture');

    ac.abort();
    await reader.cancel().catch(() => undefined);
    await app.close();
    await kernel.close();
  }, 20_000);
});
