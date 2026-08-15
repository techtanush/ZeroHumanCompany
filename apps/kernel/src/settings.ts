import { VentureSettings } from '@zeroth/contracts';
import type { Db } from '@zeroth/db';
import type { EventStore } from './event-store.js';
import { nowIso } from './util.js';

/**
 * Founder-editable per-venture settings: the granted workspace folder, the
 * meeting/workday schedule, voice-clone consent state, integration acks.
 * Stored as one JSON document; every write is validated against the contract
 * and mirrored as a `venture.settings_updated` event so the Boardroom sees it.
 */
export class SettingsStore {
  constructor(private readonly db: Db, private readonly events: EventStore) {}

  async get(venture_id: string): Promise<VentureSettings> {
    const r = await this.db.query<{ settings: unknown }>('SELECT settings FROM venture_settings WHERE venture_id = $1', [venture_id]);
    const raw = r.rows[0]?.settings;
    const obj = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
    return VentureSettings.parse(normalizeWorkspace(obj));
  }

  /** Deep-merges a partial patch (one level per section) and persists. */
  async update(venture_id: string, patch: Record<string, unknown>, actor = 'founder'): Promise<VentureSettings> {
    const current = await this.get(venture_id);
    const merged: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof (current as any)[k] === 'object' && !Array.isArray((current as any)[k])) {
        merged[k] = { ...(current as any)[k], ...(v as Record<string, unknown>) };
      } else {
        merged[k] = v;
      }
    }
    const next = VentureSettings.parse(normalizeWorkspace(merged));
    await this.db.query(
      `INSERT INTO venture_settings (venture_id, settings, updated_at) VALUES ($1,$2,$3)
       ON CONFLICT (venture_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at`,
      [venture_id, JSON.stringify(next), nowIso()],
    );
    const trace = await this.db.query<{ trace_id: string }>('SELECT trace_id FROM ventures WHERE id = $1', [venture_id]);
    if (trace.rows[0]) {
      await this.events.append({
        venture_id,
        type: 'venture.settings_updated',
        actor_kind: 'founder',
        actor_id: actor,
        payload: { keys: Object.keys(patch ?? {}) },
        trace_id: trace.rows[0].trace_id,
      }).catch(() => undefined);
    }
    return next;
  }
}

/** `workspace_root` and `agency_workspace_path` are aliases; keep them in sync. */
function normalizeWorkspace(obj: Record<string, any>): Record<string, any> {
  const ws = obj.workspace ?? {};
  const root = ws.workspace_root ?? ws.agency_workspace_path;
  if (root) obj.workspace = { ...ws, workspace_root: root, agency_workspace_path: root };
  return obj;
}
