import { createHash } from 'node:crypto';
import { buildPopulation, type Agent } from './persona.js';
import type { PumsRow } from './pums.js';

export type Archetype = {
  cluster_index: number;
  label: string;
  attributes: Record<string, string | number>;
  population_weight: number;
  members: Agent[];
  representative: Agent;
  coverage: number;
};

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

function weightedMean(rows: Agent[], selector: (row: Agent) => number): number {
  const total = rows.reduce((sum, row) => sum + row.PWGTP, 0);
  return total === 0 ? mean(rows.map(selector)) : rows.reduce((sum, row) => sum + selector(row) * row.PWGTP, 0) / total;
}

function groupKey(agent: Agent): string {
  return [
    agent.region,
    agent.age_band,
    agent.sex,
    agent.education,
    `q${agent.income_quintile}`,
    agent.employed ? 'employed' : 'not-employed',
  ].join('|');
}

function representative(members: Agent[], seed: number): Agent {
  const targetAge = mean(members.map((m) => m.age));
  const targetIncome = mean(members.map((m) => m.income));
  return [...members].sort((a, b) => {
    const aDistance = Math.abs(a.age - targetAge) / 100 + Math.abs(a.income - targetIncome) / 250_000;
    const bDistance = Math.abs(b.age - targetAge) / 100 + Math.abs(b.income - targetIncome) / 250_000;
    if (aDistance !== bDistance) return aDistance - bDistance;
    return hash([seed, a.agent_id]).localeCompare(hash([seed, b.agent_id]));
  })[0]!;
}

function attrsFor(members: Agent[], rep: Agent): Record<string, string | number> {
  return {
    age: Math.round(weightedMean(members, (m) => m.age)),
    age_band: mode(members.map((m) => m.age_band)),
    sex: mode(members.map((m) => m.sex)),
    income: Math.round(weightedMean(members, (m) => m.income)),
    income_quintile: Math.round(weightedMean(members, (m) => m.income_quintile)),
    education: mode(members.map((m) => m.education)),
    occupation: mode(members.map((m) => m.occupation)),
    employed_share: Number(weightedMean(members, (m) => (m.employed ? 1 : 0)).toFixed(3)),
    household_size: Number(weightedMean(members, (m) => m.household_size).toFixed(1)),
    region: mode(members.map((m) => m.region)),
    religion: mode(members.map((m) => m.religion)),
    representative_persona: rep.persona,
    price_sensitivity: Number(weightedMean(members, (m) => m.values.price_sensitivity).toFixed(3)),
    novelty_seeking: Number(weightedMean(members, (m) => m.values.novelty_seeking).toFixed(3)),
    convenience_bias: Number(weightedMean(members, (m) => m.values.convenience_bias).toFixed(3)),
  };
}

function makeArchetype(members: Agent[], clusterIndex: number, seed: number, totalWeight: number): Archetype {
  const rep = representative(members, seed);
  const attributes = attrsFor(members, rep);
  const populationWeight = members.reduce((sum, row) => sum + row.PWGTP, 0);
  const digest = hash({ clusterIndex, seed, attributes, rep: rep.agent_id }).slice(0, 6);
  return {
    cluster_index: clusterIndex,
    label: `archetype-${clusterIndex}-${attributes.region}-${attributes.age_band}-${digest}`,
    attributes,
    population_weight: populationWeight,
    members,
    representative: rep,
    coverage: totalWeight === 0 ? 0 : populationWeight / totalWeight,
  };
}

export function buildArchetypes(rows: PumsRow[], count = 12, seed = 42): Archetype[] {
  const population = buildPopulation(rows, seed);
  const totalWeight = population.reduce((sum, row) => sum + row.PWGTP, 0);
  const grouped = new Map<string, Agent[]>();
  for (const agent of population) {
    const key = groupKey(agent);
    grouped.set(key, [...(grouped.get(key) ?? []), agent]);
  }

  const desired = Math.max(4, Math.min(count, population.length));
  const groups = [...grouped.values()]
    .sort((a, b) => b.reduce((sum, row) => sum + row.PWGTP, 0) - a.reduce((sum, row) => sum + row.PWGTP, 0)
      || representative(a, seed).agent_id.localeCompare(representative(b, seed).agent_id));

  const selected = groups.slice(0, desired);
  const overflow = groups.slice(desired).flat();
  if (overflow.length > 0) {
    selected[selected.length - 1] = [...selected[selected.length - 1]!, ...overflow];
  }

  return selected
    .map((members, index) => makeArchetype(members, index, seed, totalWeight))
    .sort((a, b) => a.cluster_index - b.cluster_index);
}
