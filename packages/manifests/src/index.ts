import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { DepartmentManifest, RoutingTable, type DepartmentManifest as DepartmentManifestType, type RoutingTable as RoutingTableType } from '@zeroth/contracts';
import type { z } from 'zod';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let manifestCache: DepartmentManifestType[] | undefined;

function formatIssues(file: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => `${file}:${issue.path.length ? issue.path.join('.') : '<root>'}: ${issue.message}`);
}

function readYaml(file: string): unknown {
  return parse(readFileSync(file, 'utf8'));
}

export function loadManifests(dir = packageDir): DepartmentManifestType[] {
  const files = readdirSync(dir)
    .filter((file) => /^D\d{2}-.+\.ya?ml$/.test(file))
    .sort();
  const manifests: DepartmentManifestType[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const path = join(dir, file);
    try {
      const result = DepartmentManifest.safeParse(readYaml(path));
      if (result.success) manifests.push(result.data);
      else errors.push(...formatIssues(file, result.error));
    } catch (error) {
      errors.push(`${file}:<parse>: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length) throw new Error(`Manifest validation failed:\n${errors.join('\n')}`);
  manifestCache = manifests;
  return manifests;
}

export function loadRouting(dir = packageDir): RoutingTableType {
  const file = join(dir, 'routing.yaml');
  try {
    const result = RoutingTable.safeParse(readYaml(file));
    if (result.success) return result.data;
    throw new Error(formatIssues('routing.yaml', result.error).join('\n'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('routing.yaml:')) {
      throw new Error(`Routing validation failed:\n${error.message}`);
    }
    throw new Error(`Routing validation failed:\nrouting.yaml:<parse>: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function getManifest(id: DepartmentManifestType['id']): DepartmentManifestType {
  const manifest = (manifestCache ?? loadManifests()).find((item) => item.id === id);
  if (!manifest) throw new Error(`Manifest not found for department ${id}`);
  return manifest;
}
