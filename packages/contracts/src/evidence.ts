import { z } from 'zod';
import { Usd, Uuid } from './common.js';

/** How a claim was arrived at. `asserted` may never back a load-bearing number. */
export const EvidenceMethod = z.enum(['measured', 'derived', 'estimated', 'asserted']);
export type EvidenceMethod = z.infer<typeof EvidenceMethod>;

export const SourceKind = z.enum([
  'web_page', 'api_response', 'census_pums', 'interview', 'stripe_object',
  'repo_file', 'support_ticket', 'synthetic_panel', 'human_hire_output', 'model_estimate',
]);
export type SourceKind = z.infer<typeof SourceKind>;

/** Kinds that are not real-world observations. Cannot solely back a load-bearing decision. */
export const SYNTHETIC_SOURCE_KINDS: ReadonlyArray<z.infer<typeof SourceKind>> = [
  'synthetic_panel',
  'model_estimate',
];

export const Source = z.object({
  id: Uuid,
  venture_id: Uuid,
  kind: SourceKind,
  uri: z.string().optional(),
  title: z.string().optional(),
  retrieved_at: z.string(),
  content_hash: z.string().optional(),
  snapshot_uri: z.string().optional(),
  publisher: z.string().optional(),
  reliability: z.number().min(0).max(1).optional(),
  fetched_by: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

/** A claim-level citation: this JSON pointer inside the artifact is backed by this source. */
export const SourceRef = z.object({
  source_id: Uuid,
  json_pointer: z.string().regex(/^\/.*/, 'json_pointer must start with "/"'),
  excerpt: z.string().min(1),
  confidence: z.number().min(0).max(1),
  method: EvidenceMethod,
});
export type SourceRef = z.infer<typeof SourceRef>;

/** A number that carries its own citation. */
export const Cited = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    value: inner,
    unit: z.string().optional(),
    source_ids: z.array(Uuid).min(1),
    method: EvidenceMethod,
    as_of: z.string().optional(),
  });

export const CitedMoney = Cited(Usd);
export type CitedMoney = z.infer<typeof CitedMoney>;

export const CitedNumber = Cited(z.number());
export type CitedNumber = z.infer<typeof CitedNumber>;
