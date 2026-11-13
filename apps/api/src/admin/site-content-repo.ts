// T-021 · Banners e links do mini site da bio no banco. Toda gravação passa pela função SQL
// `admin_site_content_mutate` (supabase/migrations/20261114000001_site_content.sql): transação única,
// trava de edição por updated_at e auditoria. Com a chave de serviço do Worker (R3.2); a resposta do
// banco passa por Zod (R3.5) e o erro devolvido à tela nunca carrega texto do banco.
import {
  type AdminBanner,
  type AdminBioLink,
  BANNER_IMAGE_WIDTHS,
  type BannerCreate,
  type BannerUpdate,
  type BannerUploadResponse,
  type BioLinkCreate,
  type BioLinkUpdate,
  PRODUCT_IMAGE_MAX_BYTES,
  adminBannerSchema,
  adminBioLinkSchema,
  bannerImageHeight,
  bannerImagePaths,
  bannerUploadResponseSchema,
  catalogMutationErrorSchema,
  catalogMutationResultSchema,
  productBucketSchema,
} from '@sparks/shared';
import { z } from 'zod';
import type { Config } from '../env';
import { apiError } from '../lib/errors';
import { getServiceClient } from '../lib/supabase';
import { inspectProductWebp } from './products-image';

type Entity = 'banners' | 'bio_links';

export interface SiteContentRepo {
  listBanners(): Promise<AdminBanner[]>;
  listBioLinks(): Promise<{ links: AdminBioLink[]; whatsapp: string | null }>;
  /** URLs assinadas para o navegador enviar as 3 larguras do banner (só para admin). */
  signBannerImage(): Promise<BannerUploadResponse>;
  createBanner(input: BannerCreate, actor: string): Promise<AdminBanner>;
  updateBanner(
    id: string,
    input: Omit<BannerUpdate, 'expectedUpdatedAt'>,
    expected: string,
    actor: string,
  ): Promise<AdminBanner>;
  deleteBanner(id: string, expected: string, actor: string): Promise<void>;
  reorderBanners(ids: string[], actor: string): Promise<void>;
  createBioLink(input: BioLinkCreate, actor: string): Promise<AdminBioLink>;
  updateBioLink(
    id: string,
    input: Omit<BioLinkUpdate, 'expectedUpdatedAt'>,
    expected: string,
    actor: string,
  ): Promise<AdminBioLink>;
  deleteBioLink(id: string, expected: string, actor: string): Promise<void>;
  reorderBioLinks(ids: string[], actor: string): Promise<void>;
}

const BANNER_COLUMNS = 'id,image_id,alt,href,starts_at,ends_at,active,position,updated_at';
const LINK_COLUMNS = 'id,label,href,active,position,updated_at';
const timestamp = z.iso.datetime({ offset: true });
const bannerRowSchema = z.object({
  id: z.uuid(),
  image_id: z.uuid(),
  alt: z.string(),
  href: z.string(),
  starts_at: timestamp.nullable(),
  ends_at: timestamp.nullable(),
  active: z.boolean(),
  position: z.number().int().nonnegative(),
  updated_at: timestamp,
});
const linkRowSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  href: z.string(),
  active: z.boolean(),
  position: z.number().int().nonnegative(),
  updated_at: timestamp,
});

const unavailable = () =>
  apiError(503, 'unavailable', 'Não foi possível acessar os banners e links agora.');
const storageUnavailable = () =>
  apiError(503, 'storage_unavailable', 'Não foi possível preparar o envio da imagem.');

/** Traduz o erro do banco para uma resposta segura em português. */
export function checkMutation(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  const parsed = catalogMutationErrorSchema.safeParse(error);
  if (parsed.success && parsed.data.code === 'P0001') {
    if (parsed.data.message === 'content_changed')
      throw apiError(
        409,
        'content_changed',
        'Este item foi alterado em outro lugar. Atualize a página e tente de novo.',
      );
    if (parsed.data.message === 'limit_reached')
      throw apiError(409, 'limit_reached', 'Você chegou ao limite de itens desta lista.');
    if (parsed.data.message === 'content_invalid')
      throw apiError(400, 'invalid_input', 'Confira os campos informados.');
  }
  if (error.code === '23514' || error.code === '22007' || error.code === '22008')
    throw apiError(400, 'invalid_input', 'Confira o texto, o destino do link e o período.');
  throw unavailable();
}

export function bannerPublicUrls(
  imageId: string,
  publicUrl: (path: string) => string,
): { imageUrl: string; sources: { url: string; width: number }[] } {
  const paths = bannerImagePaths(imageId);
  return {
    imageUrl: publicUrl(paths[paths.length - 1]!),
    sources: BANNER_IMAGE_WIDTHS.map((width, index) => ({ url: publicUrl(paths[index]!), width })),
  };
}

export function supabaseSiteContentRepo(config: Config): SiteContentRepo {
  const db = getServiceClient(config);
  const storage = db.storage.from('products');
  const publicUrl = (path: string) => storage.getPublicUrl(path).data.publicUrl;

  const banner = (raw: unknown): AdminBanner => {
    const row = bannerRowSchema.parse(raw);
    return adminBannerSchema.parse({
      id: row.id,
      alt: row.alt,
      href: row.href,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      active: row.active,
      position: row.position,
      updatedAt: row.updated_at,
      ...bannerPublicUrls(row.image_id, publicUrl),
    });
  };
  const link = (raw: unknown): AdminBioLink => {
    const row = linkRowSchema.parse(raw);
    return adminBioLinkSchema.parse({
      id: row.id,
      label: row.label,
      href: row.href,
      active: row.active,
      position: row.position,
      updatedAt: row.updated_at,
    });
  };

  async function mutate(
    entity: Entity,
    action: 'create' | 'update' | 'delete' | 'reorder',
    id: string | null,
    data: Record<string, unknown>,
    expected: string | null,
    actor: string,
  ): Promise<string> {
    const result = await db.rpc('admin_site_content_mutate', {
      p_entity: entity,
      p_action: action,
      p_id: id,
      p_data: data,
      p_expected: expected,
      p_actor: actor,
    });
    checkMutation(result.error);
    return catalogMutationResultSchema.parse(result.data).id;
  }

  const readBanner = async (id: string) => {
    const result = await db.from('banners').select(BANNER_COLUMNS).eq('id', id).single();
    checkMutation(result.error);
    return banner(result.data);
  };
  const readLink = async (id: string) => {
    const result = await db.from('bio_links').select(LINK_COLUMNS).eq('id', id).single();
    checkMutation(result.error);
    return link(result.data);
  };

  /** O bucket `products` já existe desde a T-008; confere a configuração antes de emitir URLs. */
  async function prepareBucket() {
    let result = await db.storage.getBucket('products');
    if (result.error?.status === 404) {
      await db.storage.createBucket('products', {
        public: true,
        fileSizeLimit: PRODUCT_IMAGE_MAX_BYTES,
        allowedMimeTypes: ['image/webp'],
      });
      result = await db.storage.getBucket('products');
    }
    if (result.error || !productBucketSchema.safeParse(result.data).success)
      throw apiError(
        503,
        'storage_configuration',
        'A configuração das imagens está incompleta. Peça ao responsável pelo site para ajustar.',
      );
  }

  /** Confere os 3 arquivos enviados: WebP estático, sem metadados, nas larguras e na proporção 2:1. */
  async function assertImageUploaded(imageId: string) {
    const paths = bannerImagePaths(imageId);
    for (let index = 0; index < paths.length; index++) {
      const { data: blob, error } = await storage.download(paths[index]!);
      if (error || !blob || blob.type !== 'image/webp' || blob.size > PRODUCT_IMAGE_MAX_BYTES)
        throw apiError(
          400,
          'invalid_image',
          'Envie a imagem de novo e aguarde terminar antes de salvar.',
        );
      const width = BANNER_IMAGE_WIDTHS[index]!;
      inspectProductWebp(new Uint8Array(await blob.arrayBuffer()), width, bannerImageHeight(width));
    }
  }

  const fieldsOf = (input: BannerCreate | Omit<BannerUpdate, 'expectedUpdatedAt'>) => ({
    alt: input.alt,
    href: input.href,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    active: input.active,
    image_id: input.imageId ?? null,
  });

  return {
    async listBanners() {
      const result = await db
        .from('banners')
        .select(BANNER_COLUMNS)
        .order('position')
        .order('created_at')
        .limit(20);
      checkMutation(result.error);
      return z.array(z.unknown()).parse(result.data).map(banner);
    },
    async listBioLinks() {
      const [links, settings] = await Promise.all([
        db.from('bio_links').select(LINK_COLUMNS).order('position').order('created_at').limit(10),
        db.from('settings').select('store_whatsapp').eq('id', 1).single(),
      ]);
      checkMutation(links.error);
      checkMutation(settings.error);
      return {
        links: z.array(z.unknown()).parse(links.data).map(link),
        whatsapp: z.object({ store_whatsapp: z.string().nullable() }).parse(settings.data)
          .store_whatsapp,
      };
    },
    async signBannerImage() {
      await prepareBucket();
      const imageId = crypto.randomUUID();
      const files = [];
      const paths = bannerImagePaths(imageId);
      for (let index = 0; index < paths.length; index++) {
        const result = await storage.createSignedUploadUrl(paths[index]!, { upsert: false });
        if (result.error) throw storageUnavailable();
        const signed = result.data;
        // A URL assinada precisa apontar para o Supabase configurado (nunca para outro host).
        if (
          signed.path !== paths[index] ||
          new URL(signed.signedUrl).origin !== new URL(config.supabaseUrl).origin
        )
          throw storageUnavailable();
        files.push({ ...signed, width: BANNER_IMAGE_WIDTHS[index]! });
      }
      return bannerUploadResponseSchema.parse({ imageId, files });
    },
    async createBanner(input, actor) {
      await assertImageUploaded(input.imageId);
      const id = await mutate('banners', 'create', null, fieldsOf(input), null, actor);
      return readBanner(id);
    },
    async updateBanner(id, input, expected, actor) {
      if (input.imageId) await assertImageUploaded(input.imageId);
      await mutate('banners', 'update', id, fieldsOf(input), expected, actor);
      return readBanner(id);
    },
    async deleteBanner(id, expected, actor) {
      // Os arquivos ficam no bucket: a versão estática ainda publicada pode usá-los até o próximo build.
      await mutate('banners', 'delete', id, {}, expected, actor);
    },
    async reorderBanners(ids, actor) {
      await mutate('banners', 'reorder', null, { ids }, null, actor);
    },
    async createBioLink(input, actor) {
      const id = await mutate('bio_links', 'create', null, input, null, actor);
      return readLink(id);
    },
    async updateBioLink(id, input, expected, actor) {
      await mutate('bio_links', 'update', id, input, expected, actor);
      return readLink(id);
    },
    async deleteBioLink(id, expected, actor) {
      await mutate('bio_links', 'delete', id, {}, expected, actor);
    },
    async reorderBioLinks(ids, actor) {
      await mutate('bio_links', 'reorder', null, { ids }, null, actor);
    },
  };
}
