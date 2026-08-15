import { createHash } from 'node:crypto';
import type { PumsRow } from './pums.js';

export type Archetype = {
  cluster_index: number;
  label: string;
  attributes: Record<string, string | number>;
  population_weight: number;
  members: PumsRow[];
};

const educationScore: Record<string, number> = { less_than_hs: 0, high_school: 1, some_college: 2, bachelors: 3, graduate: 4 };
const occupationScore = new Map<string, number>();

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vector(row: PumsRow): number[] {
  if (!occupationScore.has(row.occupation)) occupationScore.set(row.occupation, occupationScore.size);
  return [row.age / 90, row.income / 250000, row.household_size / 8, (educationScore[row.education] ?? 2) / 4, (occupationScore.get(row.occupation) ?? 0) / 12, row.sex === 'female' ? 1 : 0];
}

function dist(a: number[], b: number[]): number {
  return a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0);
}

function mode(values: string[]): string {
  return [...values].sort((a, b) => values.filter((v) => v === b).length - values.filter((v) => v === a).length || a.localeCompare(b))[0] ?? '';
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

function stableLabel(attrs: Record<string, string | number>, idx: number): string {
  const digest = createHash('sha256').update(JSON.stringify(attrs)).digest('hex').slice(0, 6);
  return `archetype-${idx}-${attrs.region}-${attrs.education}-${digest}`;
}

export function buildArchetypes(rows: PumsRow[], count = 12, seed = 42): Archetype[] {
  const k = Math.max(4, Math.min(count, rows.length));
  const vectors = rows.map(vector);
  const rng = rand(seed);
  const chosen = new Set<number>();
  while (chosen.size < k) chosen.add(Math.floor(rng() * rows.length));
  let centroids = [...chosen].map((i) => [...vectors[i]]);
  let assignments = new Array<number>(rows.length).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    assignments = vectors.map((v) => centroids.reduce((best, c, i) => dist(v, c) < dist(v, centroids[best]) ? i : best, 0));
    centroids = centroids.map((c, i) => {
      const assigned = vectors.filter((_, rowIndex) => assignments[rowIndex] === i);
      if (assigned.length === 0) return c;
      return c.map((_, dim) => mean(assigned.map((v) => v[dim])));
    });
  }
  return centroids.map((_, i) => {
    let members = rows.filter((_, rowIndex) => assignments[rowIndex] === i);
    if (members.length === 0) members = [rows[i % rows.length]];
    const attributes = {
      age: Math.round(mean(members.map((m) => m.age))),
      sex: mode(members.map((m) => m.sex)),
      income: Math.round(mean(members.map((m) => m.income))),
      education: mode(members.map((m) => m.education)),
      occupation: mode(members.map((m) => m.occupation)),
      household_size: Math.round(mean(members.map((m) => m.household_size))),
      region: mode(members.map((m) => m.region)),
    };
    return { cluster_index: i, label: stableLabel(attributes, i), attributes, population_weight: members.reduce((s, m) => s + m.PWGTP, 0), members };
  }).sort((a, b) => a.cluster_index - b.cluster_index);
}
