import { createHash } from 'node:crypto';
import type { Archetype } from './archetype.js';

export type Ask = (prompt: string) => Promise<string>;
export type ArchetypeResponse = { archetype: string; answer: string | number; weight: number };

const cache = new Map<string, string | number>();

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function defaultAsk(prompt: string): Promise<string> {
  const h = Number.parseInt(createHash('sha256').update(prompt).digest('hex').slice(0, 8), 16);
  return h % 100 < 55 ? 'yes' : 'no';
}

export function numericAnswer(answer: string | number): number {
  if (typeof answer === 'number') return Math.max(0, Math.min(1, answer));
  const normalized = answer.trim().toLowerCase();
  if (/^(yes|true|support|would|1)/.test(normalized)) return 1;
  if (/^(no|false|oppose|would not|0)/.test(normalized)) return 0;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;
}

export async function pollArchetypes(questions: string[], archetypes: Archetype[], seed: number, ask: Ask = defaultAsk): Promise<Map<string, ArchetypeResponse[]>> {
  const out = new Map<string, ArchetypeResponse[]>();
  for (const question of questions) {
    const responses: ArchetypeResponse[] = [];
    for (const archetype of archetypes) {
      const key = hash({ question, archetype: archetype.label, attrs: archetype.attributes, seed });
      let answer = cache.get(key);
      if (answer === undefined) {
        const prompt = `Synthetic estimate only. Seed ${seed}. Person archetype ${archetype.label}: ${JSON.stringify(archetype.attributes)}. Answer 0..1 or yes/no: ${question}`;
        answer = await ask(prompt);
        cache.set(key, answer);
      }
      responses.push({ archetype: archetype.label, answer, weight: archetype.population_weight });
    }
    out.set(question, responses);
  }
  return out;
}

export function clearPollCache(): void {
  cache.clear();
}
