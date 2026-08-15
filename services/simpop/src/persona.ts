import { createHash } from 'node:crypto';
import type { PumsRow } from './pums.js';

export type ValueVector = {
  price_sensitivity: number;
  novelty_seeking: number;
  trust_in_institutions: number;
  convenience_bias: number;
  risk_tolerance: number;
};

export type Agent = PumsRow & {
  agent_id: string;
  age_band: string;
  income_quintile: number;
  employed: boolean;
  persona: string;
  religion: string;
  lifestyle: string[];
  values: ValueVector;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function hashNumber(parts: unknown[]): number {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 12);
  return Number.parseInt(digest, 16) / 0xffffffffffff;
}

export function agentSeed(row: PumsRow, seed: number, index: number): string {
  return createHash('sha256')
    .update(`${seed}:${index}:${row.region}:${row.age}:${row.sex}:${row.income}:${row.education}:${row.occupation}:${row.PWGTP}`)
    .digest('hex')
    .slice(0, 16);
}

export function ageBand(age: number): string {
  if (age < 25) return '18-24';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  if (age < 65) return '55-64';
  return '65+';
}

function occupationLabel(row: PumsRow): string {
  const labels: Record<string, string> = {
    admin: 'administrative worker',
    education: 'education worker',
    management: 'manager',
    production: 'production worker',
    retired: 'retiree',
    sales: 'sales worker',
    service: 'service worker',
    software: 'software worker',
    student: 'student',
    transportation: 'transportation worker',
  };
  return labels[row.occupation] ?? `${row.occupation} worker`;
}

function assignReligion(row: PumsRow, seed: number, index: number): string {
  const r = hashNumber(['religion', seed, index, row.region, row.age, row.education]);
  if (r < 0.28) return 'unaffiliated';
  if (r < 0.49) return 'catholic';
  if (r < 0.68) return 'protestant';
  if (r < 0.76) return 'other christian';
  if (r < 0.84) return 'jewish';
  if (r < 0.91) return 'muslim';
  return 'other faith';
}

function lifestyle(row: PumsRow, seed: number, index: number): string[] {
  const traits = [
    row.household_size >= 4 ? 'family logistics' : 'solo or small-household routines',
    row.income >= 120_000 ? 'premium-service exposure' : 'budget-aware spending',
    row.age >= 65 ? 'healthcare and retirement planning' : 'workweek time pressure',
    hashNumber(['hobby', seed, index]) > 0.5 ? 'local community activities' : 'digital entertainment',
  ];
  if (row.occupation === 'student') traits.push('student schedule constraints');
  if (row.occupation === 'retired') traits.push('fixed-income planning');
  return traits;
}

function valueVector(row: PumsRow, incomeQuintile: number, seed: number, index: number): ValueVector {
  const eduBoost = ['bachelors', 'graduate'].includes(row.education) ? 0.12 : 0;
  const ageDrag = row.age >= 65 ? -0.08 : row.age < 30 ? 0.1 : 0;
  const jitter = (label: string) => hashNumber([label, seed, index]) * 0.16 - 0.08;
  return {
    price_sensitivity: clamp01(0.72 - incomeQuintile * 0.09 + jitter('price')),
    novelty_seeking: clamp01(0.43 + eduBoost + ageDrag + jitter('novelty')),
    trust_in_institutions: clamp01(0.48 + (row.age >= 55 ? 0.1 : 0) + jitter('trust')),
    convenience_bias: clamp01(0.5 + (row.household_size >= 3 ? 0.12 : 0) + jitter('convenience')),
    risk_tolerance: clamp01(0.42 + eduBoost - (row.age >= 65 ? 0.1 : 0) + jitter('risk')),
  };
}

function weightedQuintileCutoffs(rows: PumsRow[]): number[] {
  const sorted = [...rows].sort((a, b) => a.income - b.income);
  const total = sorted.reduce((sum, row) => sum + row.PWGTP, 0);
  const targets = [0.2, 0.4, 0.6, 0.8].map((p) => p * total);
  const cutoffs: number[] = [];
  let cumulative = 0;
  let targetIndex = 0;
  for (const row of sorted) {
    cumulative += row.PWGTP;
    while (targetIndex < targets.length && cumulative >= targets[targetIndex]) {
      cutoffs.push(row.income);
      targetIndex++;
    }
  }
  return cutoffs;
}

function incomeQuintile(income: number, cutoffs: number[]): number {
  return cutoffs.findIndex((cutoff) => income <= cutoff) + 1 || 5;
}

export function buildPopulation(rows: PumsRow[], seed = 42): Agent[] {
  const cutoffs = weightedQuintileCutoffs(rows);
  return rows.map((row, index) => {
    const quintile = incomeQuintile(row.income, cutoffs);
    const band = ageBand(row.age);
    const religion = assignReligion(row, seed, index);
    return {
      ...row,
      agent_id: agentSeed(row, seed, index),
      age_band: band,
      income_quintile: quintile,
      employed: !['retired', 'student'].includes(row.occupation),
      religion,
      lifestyle: lifestyle(row, seed, index),
      values: valueVector(row, quintile, seed, index),
      persona: `${band} ${row.sex} ${occupationLabel(row)} in ${row.region}, ${row.education.replaceAll('_', ' ')}, income quintile ${quintile}, ${religion}.`,
    };
  });
}
