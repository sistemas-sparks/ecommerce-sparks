import { z } from 'zod';
import { textLength } from './common';
import { cartItemSchema } from './order-input';
import { BANNER_MAX_COUNT, BIO_LINK_MAX_COUNT, siteHrefSchema } from './site-content';

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const slug = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const imageUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    if (value.startsWith('/') && !value.startsWith('//')) return !value.includes('\\');
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Imagem deve ter URL HTTPS ou caminho local.');

export const catalogImageSchema = z.strictObject({
  url: imageUrl,
  // Mesma contagem do painel e do banco (caracteres, emoji vale 1): nunca trava o "Publicar".
  alt: z.string().refine((value) => textLength(value) <= 300),
  sources: z
    .array(z.strictObject({ url: imageUrl, width: z.number().int().min(1).max(4000) }))
    .max(8)
    .default([]),
});

// T-021: banners ativos (a imagem tem proporção 2:1) e links da lojista no mini site da bio.
export const publicBannerSchema = z.strictObject({
  id: z.uuid(),
  href: siteHrefSchema,
  starts_at: z.iso.datetime({ offset: true }).nullable(),
  ends_at: z.iso.datetime({ offset: true }).nullable(),
  image: catalogImageSchema,
});
export const publicBioLinkSchema = z.strictObject({
  id: z.uuid(),
  label: z
    .string()
    .min(1)
    .refine((value) => textLength(value) <= 60),
  href: siteHrefSchema,
});

export const publicCategorySchema = z.strictObject({
  id: z.uuid(),
  slug,
  name: z.string().min(1).max(80),
  position: z.number().int(),
  image: catalogImageSchema.nullable().default(null),
});

// DTO público: recusa custos, campos administrativos e produtos de embalagem.
export const publicProductSchema = z.strictObject({
  id: z.uuid(),
  slug,
  name: z.string().min(1).max(120),
  description: z.string().max(10000),
  category_id: z.uuid().nullable(),
  kind: z.literal('regular'),
  price_cents: cents,
  stock: z.number().int().nonnegative(),
  featured: z.boolean(),
  badge: z.string().max(30).nullable(),
  images: z.array(catalogImageSchema).max(12),
});

export const publicCatalogSchema = z
  .strictObject({
    categories: z.array(publicCategorySchema).max(500),
    products: z.array(publicProductSchema).max(10000),
    contact: z.strictObject({
      whatsapp: z
        .string()
        .regex(/^55\d{10,11}$/)
        .nullable(),
      address: z.string().max(500).nullable(),
    }),
    instagram_images: z.array(catalogImageSchema).max(6),
    banners: z.array(publicBannerSchema).max(BANNER_MAX_COUNT).default([]),
    bio_links: z.array(publicBioLinkSchema).max(BIO_LINK_MAX_COUNT).default([]),
  })
  .superRefine((catalog, ctx) => {
    for (const entries of [catalog.products, catalog.categories]) {
      if (
        new Set(entries.map((entry) => entry.id)).size !== entries.length ||
        new Set(entries.map((entry) => entry.slug)).size !== entries.length
      ) {
        ctx.addIssue({ code: 'custom', message: 'IDs e slugs devem ser únicos.' });
      }
    }
    const categories = new Set(catalog.categories.map((entry) => entry.id));
    if (
      catalog.products.some(
        (product) => product.category_id !== null && !categories.has(product.category_id),
      )
    ) {
      ctx.addIssue({ code: 'custom', message: 'Categoria do produto ausente no catálogo.' });
    }
  });

export const liveProductsSchema = z.object({
  products: z
    .array(
      z.object({
        id: z.uuid(),
        price_cents: cents,
        stock: z.number().int().nonnegative(),
        active: z.boolean(),
      }),
    )
    .max(50),
});

export const favoriteIdsSchema = z
  .array(z.uuid())
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length);
export const cartDraftSchema = z
  .array(cartItemSchema)
  .max(50)
  .refine((items) => new Set(items.map((item) => item.productId)).size === items.length);
export const searchInputSchema = z.object({
  q: z.string().trim().max(120),
  favorites: z.boolean(),
});
export type PublicCatalog = z.infer<typeof publicCatalogSchema>;
export type PublicProduct = z.infer<typeof publicProductSchema>;
export type PublicCategory = z.infer<typeof publicCategorySchema>;
export type PublicBanner = z.infer<typeof publicBannerSchema>;
export type PublicBioLink = z.infer<typeof publicBioLinkSchema>;
export type CatalogImage = z.infer<typeof catalogImageSchema>;
export type LiveProduct = z.infer<typeof liveProductsSchema>['products'][number];
