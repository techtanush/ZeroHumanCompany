import { hasEnv, requestWithRetry, sanitizeError } from './common.js';

const env = 'ELEVENLABS_API_KEY';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
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
