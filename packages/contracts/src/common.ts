import { z } from 'zod';

export const DepartmentId = z.enum([
  'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07',
  'D08', 'D09', 'D10', 'D11', 'D12', 'D13',
]);
export type DepartmentId = z.infer<typeof DepartmentId>;

export const DEPARTMENT_NAMES: Record<DepartmentId, string> = {
  D01: 'Intake',
  D02: 'Office Hours',
  D03: 'Market Research',
  D04: 'Outreach & Validation',
  D05: 'Synthetic Population',
  D06: 'Pivot & Decision',
  D07: 'Build',
  D08: 'Strategy',
  D09: 'Leads',
  D10: 'Sales',
  D11: 'Finance & HR',
  D12: 'Support',
  D13: 'Chief of Staff',
};

export const Cluster = z.enum(['discovery', 'validation', 'build', 'gtm', 'ops']);
export type Cluster = z.infer<typeof Cluster>;

export const Uuid = z.string().uuid();
export const Iso = z.string().datetime({ offset: true });

/** Money is carried as a number of USD; DB stores numeric(14,6). */
export const Usd = z.number().finite();

export const Quality = z.enum(['draft', 'signed', 'partial', 'contested', 'superseded']);
export type Quality = z.infer<typeof Quality>;

export const ModelTier = z.enum(['opus', 'sonnet', 'haiku', 'pioneer']);
export type ModelTier = z.infer<typeof ModelTier>;

export const ActorKind = z.enum(['agent', 'founder', 'system', 'webhook', 'human_hire']);
export type ActorKind = z.infer<typeof ActorKind>;

export const AutonomyLevel = z.enum(['copilot', 'supervised', 'autonomous']);
export const VentureMode = z.enum(['founder_led', 'autonomous_origination']);
export const VentureStatus = z.enum(['active', 'paused', 'killed', 'graduated']);
