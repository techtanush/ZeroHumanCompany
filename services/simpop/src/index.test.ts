import { describe, expect, it } from 'vitest';
import { SyntheticPanelResult, SYNTHETIC_HONESTY_NOTE } from '../../../packages/contracts/src/artifacts.js';
import { buildArchetypes } from './archetype.js';
import { runPanel } from './index.js';
import { loadPumsRows } from './pums.js';
import { weightedEstimate } from './weight.js';

const questions = ['Would you try a low-cost scheduling assistant?'];

describe('simpop panel', () => {
  it('same seed gives byte-identical result', async () => {
    const a = await runPanel({ region: 'CA', questions, seed: 123, archetypes: 8 });
    const b = await runPanel({ region: 'CA', questions, seed: 123, archetypes: 8 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('different seed gives different clustering', () => {
    const rows = loadPumsRows('CA');
    const a = buildArchetypes(rows, 8, 1).map((x) => x.label).join('|');
    const b = buildArchetypes(rows, 8, 2).map((x) => x.label).join('|');
    expect(a).not.toEqual(b);
  });

  it('output parses against frozen schema and exact honesty note', async () => {
    const result = await runPanel({ region: 'CA', questions, seed: 7, archetypes: 12 });
    expect(() => SyntheticPanelResult.parse(result)).not.toThrow();
    expect(result.honesty_note).toBe(SYNTHETIC_HONESTY_NOTE);
  });

  it('weighted mean and CI are hand checked', () => {
    const got = weightedEstimate([
      { archetype: 'a', answer: 1, weight: 1 },
      { archetype: 'b', answer: 0, weight: 3 },
    ]);
    expect(got.estimate).toBeCloseTo(0.25, 12);
    expect(got.variance).toBeCloseTo(0.1171875, 12);
    expect(got.ci[0]).toBe(0);
    expect(got.ci[1]).toBeCloseTo(0.920960132944, 10);
  });

  it('every archetype has positive population weight and at least four exist', async () => {
    const result = await runPanel({ region: 'CA', questions, seed: 99, archetypes: 6 });
    expect(result.archetypes.length).toBeGreaterThanOrEqual(4);
    expect(result.archetypes.every((a) => a.population_weight > 0)).toBe(true);
  });
});
