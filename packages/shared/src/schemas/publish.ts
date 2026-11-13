// T-010 · "Publicar alterações" e o snapshot público do catálogo usado no build.
import { z } from 'zod';
import { uuidSchema } from './common';

const timestamp = z.iso.datetime({ offset: true });

/** Intervalo mínimo entre publicações (docs/arquitetura.md §4): economiza a cota de builds. */
export const PUBLISH_MIN_INTERVAL_SECONDS = 600;

/** Resultado de public.claim_publish. */
export const claimPublishResultSchema = z.object({
  ok: z.boolean(),
  previous: timestamp.nullable(),
  claimed_at: timestamp.nullable(),
  next_allowed_at: timestamp,
});
export type ClaimPublishResult = z.infer<typeof claimPublishResultSchema>;

/** GET /admin/publish */
export const publishStatusSchema = z.object({
  configured: z.boolean(),
  lastPublishedAt: timestamp.nullable(),
  nextAllowedAt: timestamp.nullable(),
});
export type PublishStatus = z.infer<typeof publishStatusSchema>;

/** POST /admin/publish (202) */
export const publishResultSchema = z.object({
  publishedAt: timestamp,
  nextAllowedAt: timestamp,
});

/** Linhas lidas do banco para montar o catálogo público (só colunas públicas). */
export const snapshotCategoryRowsSchema = z.array(
  z.object({
    id: uuidSchema,
    slug: z.string(),
    name: z.string(),
    position: z.number().int(),
  }),
);
export const snapshotProductRowsSchema = z.array(
  z.object({
    id: uuidSchema,
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    category_id: uuidSchema.nullable(),
    price_cents: z.number().int().nonnegative(),
    stock: z.number().int().nonnegative(),
    featured: z.boolean(),
    badge: z.string().nullable(),
    product_images: z.array(
      z.object({ path: z.string().min(1), alt: z.string(), position: z.number().int() }),
    ),
  }),
);
export const snapshotSettingsRowSchema = z.object({
  store_whatsapp: z
    .string()
    .regex(/^\d{10,11}$/)
    .nullable(),
});
