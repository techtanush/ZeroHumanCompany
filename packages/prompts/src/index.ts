import { existsSync, readFileSync } from 'node:fs';
import { dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedRefs = [
  '_shared/company-context.md',
  '_shared/evidence-rules.md',
  '_shared/safety.md',
  '_shared/execution-playbook.md',
  '_shared/daily-cadence.md',
  '_shared/output-contract.md',
];

function promptPath(ref: string): string {
  const cleaned = ref.replace(/^prompts\//, '');
  const fullPath = resolve(packageDir, cleaned);
  const rel = normalize(fullPath).startsWith(normalize(packageDir));
  if (!rel) throw new Error(`Prompt ref escapes package: ${ref}`);
  if (!existsSync(fullPath)) throw new Error(`Prompt file not found: ${ref}`);
  return fullPath;
}

function substitute(template: string, vars: Record<string, unknown>): string {
  return template.replace(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g, (_, key: string) => {
    if (!(key in vars)) return '';
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}

export function renderPrompt(ref: string, vars: Record<string, unknown> = {}): string {
  const parts = [...sharedRefs, ref].map((item) => readFileSync(promptPath(item), 'utf8').trim());
  return substitute(parts.join('\n\n---\n\n'), vars);
}
