import { numericAnswer, type ArchetypeResponse } from './poll.js';

export type WeightedEstimate = { estimate: number; ci: [number, number]; variance: number; nEff: number };

export function weightedEstimate(responses: ArchetypeResponse[]): WeightedEstimate {
  const totalWeight = responses.reduce((sum, r) => sum + r.weight, 0);
  if (totalWeight <= 0) return { estimate: 0, ci: [0, 0], variance: 0, nEff: 0 };
  const xs = responses.map((r) => numericAnswer(r.answer));
  const weights = responses.map((r) => r.weight);
  const estimate = xs.reduce((sum, x, i) => sum + x * weights[i], 0) / totalWeight;
  const sumW2 = weights.reduce((sum, w) => sum + w * w, 0);
  const nEff = sumW2 === 0 ? 0 : (totalWeight * totalWeight) / sumW2;
  const sampleVariance = xs.reduce((sum, x, i) => sum + weights[i] * (x - estimate) ** 2, 0) / totalWeight;
  const variance = nEff > 1 ? sampleVariance / nEff : 0;
  const margin = 1.96 * Math.sqrt(Math.max(0, variance));
  return { estimate, ci: [Math.max(0, estimate - margin), Math.min(1, estimate + margin)], variance, nEff };
}
