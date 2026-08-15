import { createHash } from 'node:crypto';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(',')}}`;
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function prngFromHash(hash: string): () => number {
  let state = Number.parseInt(hash.slice(0, 8), 16) || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function id(prefix: string, hash: string): string {
  return `${prefix}_${hash.slice(0, 18)}`;
}

function iso(hash: string, offsetDays = 0): string {
  const base = Date.UTC(2026, 0, 1, 12, 0, 0);
  const seconds = Number.parseInt(hash.slice(8, 16), 16) % (86400 * 180);
  return new Date(base + (seconds + offsetDays * 86400) * 1000).toISOString();
}

function textFromArgs(args: unknown): string {
  if (args && typeof args === 'object') {
    const obj = args as Record<string, unknown>;
    const candidate = obj.query ?? obj.url ?? obj.text ?? obj.name ?? obj.task ?? obj.title;
    if (typeof candidate === 'string') return candidate;
  }
  return 'request';
}

export async function mockTool(name: string, args: unknown): Promise<unknown> {
  if (name === 'calc') return undefined;

  const hash = stableHash({ name, args });
  const rand = prngFromHash(hash);
  const subject = textFromArgs(args);

  switch (name) {
    case 'web_search': {
      const count = 3 + Math.floor(rand() * 3);
      return {
        results: Array.from({ length: count }, (_, index) => ({
          title: `${pick(rand, ['Guide', 'Report', 'Analysis', 'Overview'])}: ${subject} ${index + 1}`,
          url: `https://example.com/${hash.slice(index * 4, index * 4 + 4)}/${encodeURIComponent(subject.toLowerCase().slice(0, 32))}`,
          snippet: `A plausible deterministic search result about ${subject}, ranked ${index + 1}.`,
          published_at: iso(hash, -index),
        })),
      };
    }
    case 'web_fetch': {
      const url = (args as { url?: string }).url ?? 'https://example.com';
      const text = `Fetched mock page for ${url}. ${subject} appears in a deterministic article body.`;
      return {
        url,
        status: 200,
        title: `Mock page for ${new URL(url).hostname}`,
        text,
        content_hash: stableHash(text),
        retrieved_at: iso(hash),
      };
    }
    case 'apify.run_actor':
      return { items: [] };
    case 'solari.browse':
      return {
        steps: [
          { action: 'open', url: (args as { url?: string }).url ?? 'about:blank' },
          { action: 'observe', note: `Inspected page for ${subject}` },
        ],
        final_url: (args as { url?: string }).url ?? `https://example.com/${hash.slice(0, 8)}`,
        screenshot_uri: `mock://screenshots/${hash.slice(0, 16)}.png`,
      };
    case 'composio.gmail_send':
      return { message_id: id('msg', hash), thread_id: id('thr', hash.slice(8)), sent_at: iso(hash) };
    case 'stripe.create_payment_link':
      return { id: id('plink', hash), url: `https://buy.stripe.com/test_${hash.slice(0, 24)}`, livemode: false };
    case 'render.deploy':
      return { service_id: id('srv', hash), deploy_id: id('dep', hash.slice(6)), url: `https://svc-${hash.slice(0, 8)}.onrender.com`, status: 'created' };
    case 'replay.run_suite': {
      const total = 5 + Math.floor(rand() * 8);
      const failed = Math.floor(rand() * 2);
      return { passed: total - failed, total, failed, recording_url: `https://app.replay.io/recording/${hash.slice(0, 20)}` };
    }
    case 'elevenlabs.tts':
      return { audio_uri: `mock://audio/${hash.slice(0, 16)}.mp3`, duration_s: Number((1 + subject.length / 15).toFixed(2)), voice_id: (args as { voice_id?: string }).voice_id ?? 'mock_voice' };
    case 'terac.post_requisition':
      return { requisition_id: id('req', hash), status: 'filed' };
    case 'linq.send_card':
      return { message_id: id('linq_msg', hash), delivered: true };
    case 'pioneer.classify':
      return { label: pick(rand, ['high_intent', 'medium_intent', 'low_intent']), confidence: Number((0.6 + rand() * 0.39).toFixed(3)) };
    case 'simpop.build_panel': {
      const region = (args as { region?: string }).region ?? 'CA';
      const archetypeCount = (args as { archetypes?: number }).archetypes ?? 12;
      return {
        region,
        seed: (args as { seed?: number }).seed ?? 42,
        archetypes: Array.from({ length: Math.max(4, archetypeCount) }, (_, index) => ({
          label: `mock-archetype-${index}-${hash.slice(index, index + 6)}`,
          attributes: { region, age_band: pick(rand, ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']), income_quintile: 1 + (index % 5) },
          population_weight: 100 + Math.floor(rand() * 900),
        })),
        pums_vintage: 'mock PUMS fixture',
      };
    }
    case 'simpop.poll': {
      const questions = (args as { questions?: string[] }).questions ?? ['Would you try it?'];
      return {
        region: (args as { region?: string }).region ?? 'CA',
        seed: (args as { seed?: number }).seed ?? 42,
        questions: questions.map((question) => {
          const estimate = Number((0.25 + rand() * 0.5).toFixed(3));
          return {
            question,
            estimate,
            ci: [Math.max(0, Number((estimate - 0.12).toFixed(3))), Math.min(1, Number((estimate + 0.12).toFixed(3)))],
            n_eff: Number((5 + rand() * 20).toFixed(3)),
            design_effect: Number((1 + rand()).toFixed(3)),
          };
        }),
        honesty_note: 'Model-based estimate from Census PUMS microdata, not a survey of real respondents.',
      };
    }
    case 'github.push':
      return { commit_sha: hash.slice(0, 40), branch: (args as { branch?: string }).branch ?? 'main', url: `https://github.com/mock/repo/commit/${hash.slice(0, 40)}` };
    case 'band.publish':
      return { message_id: id('band_msg', hash), room: (args as { room?: string }).room ?? 'default' };
    case 'whop.create_checkout':
      return { id: id('chk', hash), checkout_url: `https://whop.com/checkout/${hash.slice(0, 16)}` };
    case 'dodo.create_checkout':
      return { id: id('dodo_chk', hash), checkout_url: `https://checkout.dodopayments.com/buy/${hash.slice(0, 16)}` };
    case 'memory_read':
      return { entries: [] };
    case 'memory_write':
      return { stored: true, key: (args as { key?: string }).key ?? id('memory', hash) };
    default:
      throw new Error(`No mock implemented for ${name}`);
  }
}
