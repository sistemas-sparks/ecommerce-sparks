// T-021 · Banners da vitrine e links do mini site da bio (/links): contrato do painel e do site.
// Toda entrada passa por aqui (R3.5). O destino de um link é sempre um caminho do próprio site
// ("/busca/") ou um endereço https; nunca javascript:, data:, http: nem //outro-site.
import { z } from 'zod';
import { singleLineText } from './common';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });

/** Até 10 banners cadastrados (o carrossel não fica longo demais). */
export const BANNER_MAX_COUNT = 10;
/** WhatsApp e Instagram da loja ocupam 2 dos 5 botões do mini site (docs/design.md, item 13). */
export const BIO_BUTTONS_MAX = 5;
export const BIO_LINK_MAX_COUNT = 3;
/** Larguras geradas no navegador da lojista. A proporção é fixa em 2:1 (largura ÷ altura). */
export const BANNER_IMAGE_WIDTHS = [640, 1280, 1920] as const;
export const bannerImageHeight = (width: number) => Math.round(width / 2);
/** Maior versão: é a imagem "padrão" do banner e a que define o tamanho intrínseco. */
export const BANNER_IMAGE_MAX_WIDTH = 1920;

// eslint-disable-next-line no-control-regex
const UNSAFE_HREF_CHARS = /[\s\\\u0000-\u001F\u007F-\u009F]/;

/** Caminho do próprio site (começa com uma barra, não com duas) ou endereço https com domínio. */
export function isSafeSiteHref(value: string): boolean {
  if (value.length < 1 || value.length > 2048 || UNSAFE_HREF_CHARS.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  if (!/^https:\/\/[^/?#]+/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const siteHrefSchema = z
  .string({ error: 'Informe o destino do link.' })
  .trim()
  .refine(isSafeSiteHref, {
    error:
      'O destino deve ser um caminho do site (como /busca/) ou um endereço que comece com https://.',
  });

/** O link é externo (https) e, por isso, abre em outra aba com rel="noopener noreferrer". */
export const isExternalHref = (href: string) => href.startsWith('https://');

const bannerAlt = singleLineText(1, 300, 'O texto alternativo');
const bioLabel = singleLineText(1, 60, 'O rótulo');

function refinePeriod(
  value: { startsAt: string | null; endsAt: string | null },
  ctx: z.RefinementCtx,
) {
  if (
    value.startsAt !== null &&
    value.endsAt !== null &&
    Date.parse(value.endsAt) <= Date.parse(value.startsAt)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'O fim do período deve ser depois do início.',
    });
  }
}

const bannerFieldsSchema = z.strictObject({
  alt: bannerAlt,
  href: siteHrefSchema,
  startsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
  active: z.boolean({ error: 'Informe se o banner está ativo.' }),
});

/** POST /admin/banners: a imagem já foi enviada pela URL assinada (imageId). */
export const bannerCreateSchema = bannerFieldsSchema
  .extend({ imageId: uuid })
  .superRefine(refinePeriod);
/** PATCH /admin/banners/:id: imageId só vem se a foto foi trocada. */
export const bannerUpdateSchema = bannerFieldsSchema
  .extend({ imageId: uuid.optional(), expectedUpdatedAt: timestamp })
  .superRefine(refinePeriod);
export const siteContentDeleteSchema = z.strictObject({ expectedUpdatedAt: timestamp });
/** PUT /admin/banners/order e /admin/bio-links/order: a lista completa, na nova ordem. */
export const siteContentOrderSchema = z.strictObject({
  ids: z
    .array(uuid)
    .min(1)
    .max(BANNER_MAX_COUNT)
    .refine((ids) => new Set(ids).size === ids.length, { error: 'Ids repetidos.' }),
});

export const bioLinkCreateSchema = z.strictObject({
  label: bioLabel,
  href: siteHrefSchema,
  active: z.boolean({ error: 'Informe se o link está ativo.' }),
});
export const bioLinkUpdateSchema = bioLinkCreateSchema.extend({ expectedUpdatedAt: timestamp });

/** Caminho dos arquivos no bucket público `products`, sob o prefixo `banners/`. */
export const bannerImagePathSchema = z
  .string()
  .regex(/^banners\/[0-9a-f-]{36}\/(640|1280|1920)\.webp$/);
export const bannerImagePaths = (imageId: string) =>
  BANNER_IMAGE_WIDTHS.map((width) => `banners/${imageId}/${width}.webp`);

export const bannerUploadResponseSchema = z.object({
  imageId: uuid,
  files: z
    .array(
      z.object({
        path: bannerImagePathSchema,
        token: z.string().min(1).max(4096),
        signedUrl: z.url({ protocol: /^https?$/ }),
        width: z.union([z.literal(640), z.literal(1280), z.literal(1920)]),
      }),
    )
    .length(3),
});

export const adminBannerSchema = z.object({
  id: uuid,
  alt: z.string(),
  href: z.string(),
  startsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
  active: z.boolean(),
  position: z.number().int().nonnegative(),
  updatedAt: timestamp,
  imageUrl: z.url(),
  sources: z.array(z.object({ url: z.url(), width: z.number().int().positive() })).max(3),
});
export const adminBannersResponseSchema = z.object({
  banners: z.array(adminBannerSchema).max(BANNER_MAX_COUNT),
  limit: z.literal(BANNER_MAX_COUNT),
});

export const adminBioLinkSchema = z.object({
  id: uuid,
  label: z.string(),
  href: z.string(),
  active: z.boolean(),
  position: z.number().int().nonnegative(),
  updatedAt: timestamp,
});
export const adminBioLinksResponseSchema = z.object({
  links: z.array(adminBioLinkSchema).max(BIO_LINK_MAX_COUNT),
  limit: z.literal(BIO_LINK_MAX_COUNT),
  /** Só dígitos com DDD, como em settings.store_whatsapp; null enquanto a cliente não informa. */
  whatsapp: z
    .string()
    .regex(/^\d{10,11}$/)
    .nullable(),
});

/** Linhas do banco usadas para montar o snapshot público (só colunas públicas). */
export const snapshotBannerRowsSchema = z.array(
  z.object({
    id: uuid,
    image_id: uuid,
    alt: z.string(),
    href: z.string(),
    starts_at: timestamp.nullable(),
    ends_at: timestamp.nullable(),
  }),
);
export const snapshotBioLinkRowsSchema = z.array(
  z.object({ id: uuid, label: z.string(), href: z.string() }),
);

/** Banner dentro do período (início e fim opcionais; o fim já é "depois do fim"). */
export function isBannerLive(
  banner: { starts_at: string | null; ends_at: string | null },
  now: number,
): boolean {
  if (banner.starts_at !== null && Date.parse(banner.starts_at) > now) return false;
  if (banner.ends_at !== null && Date.parse(banner.ends_at) <= now) return false;
  return true;
}

export type BannerCreate = z.infer<typeof bannerCreateSchema>;
export type BannerUpdate = z.infer<typeof bannerUpdateSchema>;
export type BioLinkCreate = z.infer<typeof bioLinkCreateSchema>;
export type BioLinkUpdate = z.infer<typeof bioLinkUpdateSchema>;
export type AdminBanner = z.infer<typeof adminBannerSchema>;
export type AdminBioLink = z.infer<typeof adminBioLinkSchema>;
export type BannerUploadResponse = z.infer<typeof bannerUploadResponseSchema>;
