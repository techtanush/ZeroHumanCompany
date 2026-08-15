import rows from '../fixtures/pums-ca-slim.json' with { type: 'json' };

export type PumsRow = {
  age: number;
  sex: string;
  income: number;
  education: string;
  occupation: string;
  household_size: number;
  region: string;
  PWGTP: number;
};

export const PUMS_VINTAGE = 'Synthetic ACS PUMS-style CA slim fixture 2026';

export function loadPumsRows(region?: string): PumsRow[] {
  const all = rows as PumsRow[];
  const selected = region ? all.filter((row) => row.region === region || region === 'CA') : all;
  return selected.length > 0 ? selected.map((row) => ({ ...row })) : all.map((row) => ({ ...row }));
}
