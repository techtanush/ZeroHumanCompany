import { createHash } from 'node:crypto';
import { numericAnswer, type ArchetypeResponse } from './poll.js';

export type WeightedEstimate = {
  estimate: number;
  ci: [number, number];
  variance: number;
  nEff: number;
  designEffect: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rng(seed: string): () => number {
  let s = Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedMean(xs: number[], weights: number[]): number {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return totalWeight <= 0 ? 0 : xs.reduce((sum, x, index) => sum + x * weights[index], 0) / totalWeight;
}

function quantile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

function weightedBootstrapCi(xs: number[], weights: number[], seed: string, draws = 300): [number, number] {
  if (xs.length <= 1) return [xs[0] ?? 0, xs[0] ?? 0];
  const random = rng(seed);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const cumulative: number[] = [];
  weights.reduce((sum, weight) => {
    const next = sum + weight / total;
    cumulative.push(next);
    return next;
  }, 0);

  const estimates: number[] = [];
  for (let draw = 0; draw < draws; draw++) {
    const sample: number[] = [];
    for (let i = 0; i < xs.length; i++) {
      const r = random();
      const idx = cumulative.findIndex((cutoff) => r <= cutoff);
      sample.push(xs[idx === -1 ? xs.length - 1 : idx]!);
    }
    estimates.push(sample.reduce((sum, x) => sum + x, 0) / sample.length);
  }
  return [clamp01(quantile(estimates, 0.025)), clamp01(quantile(estimates, 0.975))];
}

export function weightedEstimate(responses: ArchetypeResponse[], seed = 'default'): WeightedEstimate {
  const weights = responses.map((r) => Math.max(0, r.weight));
  const xs = responses.map((r) => numericAnswer(r.answer));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0 || xs.length === 0) return { estimate: 0, ci: [0, 0], variance: 0, nEff: 0, designEffect: 0 };

  const estimate = weightedMean(xs, weights);
  const sumW2 = weights.reduce((sum, weight) => sum + weight * weight, 0);
  const nEff = sumW2 === 0 ? 0 : (totalWeight * totalWeight) / sumW2;
  const designEffect = nEff === 0 ? 0 : responses.length / nEff;
  const sampleVariance = xs.reduce((sum, x, index) => sum + weights[index] * (x - estimate) ** 2, 0) / totalWeight;
  const variance = nEff > 1 ? sampleVariance / nEff : 0;
  const ci = weightedBootstrapCi(xs, weights, `${seed}:${responses.map((r) => `${r.archetype}:${r.answer}:${r.weight}`).join('|')}`);
  return {
    estimate: Number(estimate.toFixed(6)),
    ci: [Number(ci[0].toFixed(6)), Number(ci[1].toFixed(6))],
    variance: Number(variance.toFixed(12)),
    nEff: Number(nEff.toFixed(3)),
    designEffect: Number(designEffect.toFixed(3)),
  };
}
