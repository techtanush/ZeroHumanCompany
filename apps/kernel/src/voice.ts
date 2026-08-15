import { ToolPlane } from '@zeroth/tool-plane';
import type { EventStore } from './event-store.js';
import type { SettingsStore } from './settings.js';
import type { GateEngine } from './gates.js';
import { setIntegrationVar } from './integrations.js';
import { nowIso } from './util.js';

export const VOICE_CONSENT_TEXT_V1 = [
  'I am the founder and this is my own voice.',
  'I allow YCBF to clone my voice for THIS venture\'s discovery and sales calls only.',
  'Every call made in my voice must disclose that it is an AI in the first utterance.',
  'I can revoke this consent at any time; the clone is then deleted from ElevenLabs.',
].join(' ');

/**
 * Consent-first voice cloning. Nothing touches ElevenLabs until the founder has
 * (1) recorded consent — persisted as a `human.consent_recorded` event, and
 * (2) uploaded a sample. Cloning opens the `voice_clone_consent` gate, which the
 * founder's own click resolves; the resulting voice_id is stored, never the audio.
 */
export class VoiceService {
  constructor(
    private readonly events: EventStore,
    private readonly settings: SettingsStore,
    private readonly gates: GateEngine,
    private readonly traceFor: (venture_id: string) => Promise<string>,
    private readonly toolDriver: () => 'mock' | 'real',
  ) {}

  async consent(venture_id: string, input: { display_name?: string; accepted: boolean; text_version?: string }): Promise<{ consent_event_id: string; settings: unknown }> {
    if (!input.accepted) throw new Error('consent must be explicitly accepted');
    const trace_id = await this.traceFor(venture_id);
    const e = await this.events.append({
      venture_id, type: 'human.consent_recorded', actor_kind: 'founder', actor_id: input.display_name ?? 'founder',
      payload: { kind: 'voice_clone', text_version: input.text_version ?? 'v1', text: VOICE_CONSENT_TEXT_V1, disclosure_required: true, revocable: true, at: nowIso() },
      trace_id,
    });
    const settings = await this.settings.update(venture_id, { voice: { consent_given: true, consent_at: nowIso(), consent_event_id: e.id, consent_text_version: input.text_version ?? 'v1', status: 'consented' } });
    return { consent_event_id: e.id, settings };
  }

  async clone(venture_id: string, input: { audio_base64: string; mime_type?: string; name?: string; duration_s?: number }): Promise<{ voice_id: string; driver: string; degraded?: string; settings: unknown }> {
    const s = await this.settings.get(venture_id);
    if (!s.voice.consent_given || !s.voice.consent_event_id) throw new Error('voice consent has not been recorded for this venture');
    if (!input.audio_base64 || input.audio_base64.length < 200) throw new Error('voice sample too short');
    const trace_id = await this.traceFor(venture_id);
    const bytes = Math.floor((input.audio_base64.length * 3) / 4);
    await this.settings.update(venture_id, { voice: { status: 'sample_uploaded', sample_meta: { mime_type: input.mime_type ?? 'audio/webm', bytes, duration_s: input.duration_s, uploaded_at: nowIso() } } });

    // The founder is the one asking; the gate is opened and resolved by that same act, so the audit trail is complete.
    const gate = await this.gates.open({
      venture_id, gate_type: 'voice_clone_consent', requested_by: 'founder', department_id: 'D04',
      action: { tool: 'elevenlabs.clone_voice', args: { name: input.name ?? 'Founder voice', consent_event_id: s.voice.consent_event_id, mime_type: input.mime_type ?? 'audio/webm', bytes } },
      preview: { summary: 'Clone the founder\'s voice from a consented sample', title: 'Voice clone' },
      options: [{ id: 'approve', label: 'Clone my voice', consequence: 'ElevenLabs creates a voice; calls will disclose AI' }, { id: 'reject', label: 'Cancel', consequence: 'nothing is cloned' }],
      suggested_option_id: 'approve', risk: 'medium', reversible: true, channel: 'boardroom', timeout_s: 600, on_timeout: 'auto_reject',
      idempotency_key: `voice-clone:${venture_id}:${s.voice.consent_event_id}:${bytes}`, trace_id,
    } as any);
    if (gate.status === 'pending') await this.gates.decide(gate.id, { option_id: 'approve', decided_by: 'founder', decision: 'approve', note: 'founder-initiated in Boardroom' });

    let degraded: string | undefined;
    const plane = new ToolPlane({ driver: this.toolDriver(), onCall: (ev) => { if (ev.type === 'degraded') degraded = ev.reason; } });
    const ctx = { venture_id, department_id: 'D04', agent_id: 'founder', budget: { record() {} }, requestGate: async () => true };
    const [tool] = plane.build(['elevenlabs.clone_voice'], ctx);
    const result = (await tool.run({ name: input.name ?? 'Founder voice', consent_event_id: s.voice.consent_event_id, audio_base64: input.audio_base64, mime_type: input.mime_type ?? 'audio/webm', description: `${process.env.COMPANY_NAME ?? 'YCBF'} venture ${venture_id}` }, ctx)) as any;
    const voice_id = String(result?.voice_id ?? result?.voiceId ?? '');
    if (!voice_id) throw new Error('clone returned no voice_id');
    await setIntegrationVar('ELEVENLABS_VOICE_ID', voice_id).catch(() => undefined);
    const settings = await this.settings.update(venture_id, { voice: { voice_id, voice_name: input.name ?? 'Founder voice', status: 'cloned' } });
    return { voice_id, driver: this.toolDriver(), degraded, settings };
  }

  async revoke(venture_id: string, reason = 'founder revoked consent'): Promise<{ deleted: boolean; degraded?: string; settings: unknown }> {
    const s = await this.settings.get(venture_id);
    const trace_id = await this.traceFor(venture_id);
    const e = await this.events.append({ venture_id, type: 'human.consent_revoked', actor_kind: 'founder', actor_id: 'founder', payload: { kind: 'voice_clone', voice_id: s.voice.voice_id }, trace_id });
    let deleted = false;
    let degraded: string | undefined;
    if (s.voice.voice_id) {
      const plane = new ToolPlane({ driver: this.toolDriver(), onCall: (ev) => { if (ev.type === 'degraded') degraded = ev.reason; } });
      const ctx = { venture_id, department_id: 'D04', agent_id: 'founder', budget: { record() {} }, requestGate: async () => true };
      const [tool] = plane.build(['elevenlabs.delete_voice'], ctx);
      try { await tool.run({ voice_id: s.voice.voice_id, revocation_event_id: e.id }, ctx); deleted = true; } catch (err) { degraded = err instanceof Error ? err.message : String(err); }
      if (process.env.ELEVENLABS_VOICE_ID === s.voice.voice_id) await setIntegrationVar('ELEVENLABS_VOICE_ID', '').catch(() => undefined);
    }
    const settings = await this.settings.update(venture_id, { voice: { consent_given: false, status: 'revoked', revoked_at: nowIso(), voice_id: undefined } });
    return { deleted, degraded, settings };
  }
}
