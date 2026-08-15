import { SyntheticPanelResult, SYNTHETIC_HONESTY_NOTE, type SyntheticPanelResult as SyntheticPanelResultType } from '../../../packages/contracts/src/artifacts.js';
import { buildArchetypes, type Archetype } from './archetype.js';
import { pollArchetypes, type Ask } from './poll.js';
import { loadPumsRows, PUMS_VINTAGE } from './pums.js';
import { weightedEstimate } from './weight.js';

export type RunPanelInput = {
  region: string;
  questions: string[];
  seed?: number;
  archetypes?: number;
  ask?: Ask;
};

export type PublicArchetype = Omit<Archetype, 'members' | 'cluster_index'>;

export async function runPanel(input: RunPanelInput): Promise<SyntheticPanelResultType> {
  const seed = input.seed ?? 42;
  const rows = loadPumsRows(input.region);
  const archetypes = buildArchetypes(rows, input.archetypes ?? 12, seed);
  const responseMap = await pollArchetypes(input.questions, archetypes, seed, input.ask);
  const questions = input.questions.map((question) => {
    const responses = responseMap.get(question) ?? [];
    const estimate = weightedEstimate(responses);
    return { question, estimate: estimate.estimate, ci: estimate.ci, responses };
  });
  return SyntheticPanelResult.parse({
    region: input.region,
    pums_vintage: PUMS_VINTAGE,
    seed,
    archetypes: archetypes.map(({ label, attributes, population_weight }) => ({ label, attributes, population_weight })),
    questions,
    honesty_note: SYNTHETIC_HONESTY_NOTE,
  });
}

export { buildArchetypes } from './archetype.js';
export { loadPumsRows } from './pums.js';
export { pollArchetypes, defaultAsk, clearPollCache } from './poll.js';
export { weightedEstimate } from './weight.js';
export { SYNTHETIC_HONESTY_NOTE } from '../../../packages/contracts/src/artifacts.js';
