import { hasEnv, postJson, requestWithRetry, sanitizeError } from './common.js';

const env = 'ELEVENLABS_API_KEY';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  return runTool('elevenlabs.tts', args);
}

export async function runTool(toolName: string, args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  if (toolName === 'elevenlabs.clone_voice') return cloneVoice(args, key);
  if (toolName === 'elevenlabs.create_agent') return postJson({ vendor: 'elevenlabs', url: 'https://api.elevenlabs.io/v1/convai/agents/create', apiKey: key, headers: { 'xi-api-key': key }, body: args });
  if (toolName === 'elevenlabs.place_call') return postJson({ vendor: 'elevenlabs', url: 'https://api.elevenlabs.io/v1/convai/twilio/outbound-call', apiKey: key, headers: { 'xi-api-key': key }, body: args });
  if (toolName === 'elevenlabs.transcribe') return postJson({ vendor: 'elevenlabs', url: 'https://api.elevenlabs.io/v1/speech-to-text', apiKey: key, headers: { 'xi-api-key': key }, body: args });
  if (toolName === 'elevenlabs.delete_voice') {
    const input = args as { voice_id: string };
    return postJson({ vendor: 'elevenlabs', url: `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(input.voice_id)}`, apiKey: key, headers: { 'xi-api-key': key }, body: {}, method: 'DELETE' });
  }

  const input = args as { text: string; voice_id?: string; model_id?: string };
  const voiceId = input.voice_id ?? process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Error('Missing ELEVENLABS_VOICE_ID');

  try {
    const response = await requestWithRetry(
      'elevenlabs',
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify({ text: input.text, model_id: input.model_id ?? 'eleven_multilingual_v2' }),
      },
      key,
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`elevenlabs ${response.status}: ${bytes.toString('utf8').slice(0, 300)}`);
    return { audio_base64: bytes.toString('base64'), content_type: response.headers.get('content-type') ?? 'audio/mpeg', voice_id: voiceId };
  } catch (error) {
    throw sanitizeError(error, key);
  }
}

async function cloneVoice(args: unknown, key: string): Promise<unknown> {
  const input = args as { name: string; audio_base64: string; mime_type?: string; description?: string; consent_event_id: string };
  const form = new FormData();
  form.set('name', input.name);
  if (input.description) form.set('description', `${input.description}\nconsent_event_id=${input.consent_event_id}`);
  else form.set('description', `consent_event_id=${input.consent_event_id}`);
  const binary = Buffer.from(input.audio_base64, 'base64');
  form.append('files', new Blob([binary], { type: input.mime_type ?? 'audio/mpeg' }), 'voice-sample');
  try {
    const response = await requestWithRetry('elevenlabs', 'https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    }, key);
    const text = await response.text();
    if (!response.ok) throw new Error(`elevenlabs ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw sanitizeError(error, key);
  }
}
