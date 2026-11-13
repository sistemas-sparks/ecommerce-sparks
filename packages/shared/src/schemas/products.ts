import { z } from 'zod';
import { singleLineText, uuidSchema } from './common';
import { catalogImageSchema } from './catalog';

const amount = z.number().int().min(0).max(2147483647);
const positive = amount.min(1);
export const productSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const productTimestampSchema = z.iso.datetime({ offset: true });
export const productInputSchema = z.object({
  slug: productSlugSchema,
  name: singleLineText(1, 120, 'Nome'),
  description: z.string().trim().max(10000),
  category_id: uuidSchema.nullable(),
  kind: z.enum(['regular', 'gift_wrap']),
  price_cents: amount,
  cost_cents: amount,
  stock: amount,
  weight_g: positive.nullable(),
  package_size: z.enum(['P', 'M', 'G']),
  length_cm: positive.nullable(),
  width_cm: positive.nullable(),
  height_cm: positive.nullable(),
  active: z.boolean(),
  featured: z.boolean(),
  badge: singleLineText(0, 30, 'Selo').nullable(),
});
export const productUpdateSchema = productInputSchema.extend({
  expectedUpdatedAt: productTimestampSchema,
});
export const productRowSchema = productInputSchema.extend({
  id: uuidSchema,
  updated_at: productTimestampSchema,
});
export const categoryInputSchema = z.object({
  slug: productSlugSchema,
  name: singleLineText(1, 80, 'Nome da categoria'),
  position: amount.max(9999),
  active: z.boolean(),
});
export const categoryRowSchema = categoryInputSchema.extend({
  id: uuidSchema,
  updated_at: productTimestampSchema,
});
export const categoryUpdateSchema = categoryInputSchema.extend({
  expectedUpdatedAt: productTimestampSchema,
});
export const productDeleteSchema = z.object({ expectedUpdatedAt: productTimestampSchema });
export const PRODUCT_IMAGE_WIDTHS = [360, 720, 1080] as const;
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_COUNT = 12;
export const productImageBytesSchema = z
  .instanceof(Uint8Array)
  .refine(
    (bytes) => bytes.length >= 30 && bytes.length <= PRODUCT_IMAGE_MAX_BYTES,
    'Foto inválida ou maior que 5 MB.',
  );
export const productImageInputSchema = z.object({
  alt: singleLineText(1, 300, 'Descrição da foto'),
  position: amount.max(PRODUCT_IMAGE_MAX_COUNT - 1),
});
export const productImagePathSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(360|720|1080)\.webp$/);
export const productImageRowSchema = productImageInputSchema.extend({
  id: uuidSchema,
  product_id: uuidSchema,
  path: productImagePathSchema,
  updated_at: productTimestampSchema,
});
export const productDatabaseRowSchema = productRowSchema.extend({
  product_images: z.array(productImageRowSchema).max(PRODUCT_IMAGE_MAX_COUNT),
});
export const adminProductImageSchema = productImageRowSchema.extend({
  url: z.url({ protocol: /^https?$/ }),
  sources: catalogImageSchema.shape.sources,
});
export const adminProductSchema = productRowSchema.extend({
  images: z.array(adminProductImageSchema).max(PRODUCT_IMAGE_MAX_COUNT),
});
export const productsListQuerySchema = z.object({
  q: z.string().trim().max(120).default(''),
  kind: z.enum(['all', 'regular', 'gift_wrap']).default('all'),
  active: z.enum(['all', 'true', 'false']).default('all'),
  category: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export const productsListResponseSchema = z.object({
  products: z.array(adminProductSchema).max(50),
  count: amount,
  page: positive,
  pageSize: z.literal(50),
  categories: z.array(categoryRowSchema).max(500),
});
export const productUploadInputSchema = z.object({
  type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: positive.max(PRODUCT_IMAGE_MAX_BYTES),
});
export const productSignedFileSchema = z.object({
  path: productImagePathSchema,
  token: z.string().min(1).max(4096),
  signedUrl: z.url({ protocol: /^https?$/ }),
});
export const productUploadResponseSchema = z.object({
  imageId: uuidSchema,
  files: z
    .array(
      productSignedFileSchema.extend({
        width: z.union([z.literal(360), z.literal(720), z.literal(1080)]),
      }),
    )
    .length(3),
});
export const productImageConfirmSchema = productImageInputSchema.extend({ imageId: uuidSchema });
export const productImageUpdateSchema = productImageInputSchema.extend({
  expectedUpdatedAt: productTimestampSchema,
});
export const liveProductIdsSchema = z
  .string()
  .max(2000)
  .transform((value) => value.split(','))
  .pipe(
    z
      .array(uuidSchema)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length),
  );
export const productBucketSchema = z.object({
  id: z.literal('products'),
  public: z.literal(true),
  file_size_limit: z.literal(PRODUCT_IMAGE_MAX_BYTES),
  allowed_mime_types: z.array(z.literal('image/webp')).length(1),
});
export const catalogMutationResultSchema = z.object({ id: uuidSchema });
export const catalogMutationErrorSchema = z.object({ code: z.string(), message: z.string() });
export type ProductInput = z.infer<typeof productInputSchema>;
export type ProductRow = z.infer<typeof productRowSchema>;
export type AdminProduct = z.infer<typeof adminProductSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type CategoryRow = z.infer<typeof categoryRowSchema>;
export type ProductsListQuery = z.infer<typeof productsListQuerySchema>;
export type ProductsListResponse = z.infer<typeof productsListResponseSchema>;
export type ProductImageInput = z.infer<typeof productImageInputSchema>;
export type ProductImageRow = z.infer<typeof productImageRowSchema>;
export type ProductUploadResponse = z.infer<typeof productUploadResponseSchema>;
