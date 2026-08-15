import { createHash } from 'node:crypto';
import type { Archetype } from './archetype.js';

export type Ask = (prompt: string) => Promise<string>;
export type ArchetypeResponse = {
  archetype: string;
  answer: string | number;
  weight: number;
  rationale?: string;
  coverage?: number;
};

const cache = new Map<string, string | number | { answer: string | number; rationale?: string }>();

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function defaultAsk(prompt: string): Promise<string> {
  const h = Number.parseInt(createHash('sha256').update(prompt).digest('hex').slice(0, 8), 16);
  const p_yes = Number(((h % 100) / 100).toFixed(2));
  return JSON.stringify({ p_yes, why: p_yes >= 0.55 ? 'synthetic persona leans toward adoption' : 'synthetic persona sees weak urgency' });
}

export function numericAnswer(answer: string | number): number {
  if (typeof answer === 'number') return Math.max(0, Math.min(1, answer));
  const normalized = answer.trim().toLowerCase();
  if (/^(yes|true|support|would|1)/.test(normalized)) return 1;
  if (/^(no|false|oppose|would not|0)/.test(normalized)) return 0;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    try {
      return JSON.parse(match[0]);
    } catch {
      return undefined;
    }
  }
}

function parseAnswer(raw: string): { answer: string | number; rationale?: string } {
  const json = extractJson(raw) as any;
  if (json && typeof json === 'object') {
    const answer = json.p_yes ?? json.answer ?? json.yes_share ?? json.probability;
    if (typeof answer === 'number' || typeof answer === 'string') {
      return { answer, rationale: typeof json.why === 'string' ? json.why : typeof json.rationale === 'string' ? json.rationale : undefined };
    }
  }
  return { answer: raw };
}

function promptFor(question: string, archetype: Archetype, seed: number): string {
  return [
    'You are estimating a synthetic population archetype, not surveying a real person.',
    `Seed: ${seed}`,
    `Question: ${question}`,
    `Representative: ${archetype.representative.persona}`,
    `Weighted attributes: ${JSON.stringify(archetype.attributes)}`,
    `Lifestyle: ${archetype.representative.lifestyle.join('; ')}`,
    'Return compact JSON only: {"p_yes":0..1,"why":"one sentence grounded in the persona"}',
  ].join('\n');
}

export async function pollArchetypes(questions: string[], archetypes: Archetype[], seed: number, ask: Ask = defaultAsk): Promise<Map<string, ArchetypeResponse[]>> {
  const out = new Map<string, ArchetypeResponse[]>();
  for (const question of questions) {
    const responses: ArchetypeResponse[] = [];
    for (const archetype of archetypes) {
      const key = hash({ question, archetype: archetype.label, attrs: archetype.attributes, seed });
      let parsed = cache.get(key);
      if (parsed === undefined) {
        parsed = parseAnswer(await ask(promptFor(question, archetype, seed)));
        cache.set(key, parsed);
      }
      const normalized = typeof parsed === 'object' ? parsed : { answer: parsed };
      responses.push({
        archetype: archetype.label,
        answer: normalized.answer,
        rationale: normalized.rationale,
        weight: archetype.population_weight,
        coverage: archetype.coverage,
      });
    }
    out.set(question, responses);
  }
  return out;
}

export function clearPollCache(): void {
  cache.clear();
}
