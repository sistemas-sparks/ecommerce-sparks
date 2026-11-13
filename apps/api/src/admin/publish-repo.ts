// T-010 · Banco da publicação: trava do intervalo mínimo e snapshot público do catálogo.
import {
  BANNER_IMAGE_WIDTHS,
  type ClaimPublishResult,
  PRODUCT_IMAGE_WIDTHS,
  type PublicCatalog,
  claimPublishResultSchema,
  publicCatalogSchema,
  bannerImagePaths,
  snapshotBannerRowsSchema,
  snapshotBioLinkRowsSchema,
  snapshotCategoryRowsSchema,
  snapshotProductRowsSchema,
  snapshotSettingsRowSchema,
} from '@sparks/shared';
import { z } from 'zod';
import type { Config } from '../env';
import { getServiceClient } from '../lib/supabase';

export interface PublishRepo {
  claim(intervalSeconds: number, actor: string): Promise<ClaimPublishResult>;
  revert(claimedAt: string, previous: string | null): Promise<void>;
  lastPublishAt(): Promise<string | null>;
  /** Catálogo público (sem custo, sem embalagem, sem inativos), no contrato da T-006. */
  snapshot(): Promise<PublicCatalog>;
}

const PAGE = 1000;
const MAX_PRODUCTS = 10000;

function fail(what: string): never {
  throw new Error(`publish_repo_${what}`);
}

type CategoryRows = z.infer<typeof snapshotCategoryRowsSchema>;
type ProductRows = z.infer<typeof snapshotProductRowsSchema>;
type SettingsRow = z.infer<typeof snapshotSettingsRowSchema>;
type BannerRows = z.infer<typeof snapshotBannerRowsSchema>;
type BioLinkRows = z.infer<typeof snapshotBioLinkRowsSchema>;

/** Banners e links da bio já filtrados (só ativos) como vêm do banco, mais o instante do build. */
export interface SiteContentRows {
  banners: BannerRows;
  bioLinks: BioLinkRows;
  now: number;
}

/**
 * Banners e links públicos (T-021). O banco já entrega só os ativos, na ordem do painel. Aqui sai
 * quem já terminou o período E quem ainda não começou na data do build: um banner agendado não pode
 * vazar (imagem, texto e link) no HTML público antes do início. Consequência: o "Publicar" precisa
 * rodar depois da data de início para o banner entrar; o site ainda tira no navegador quem
 * terminar o período depois do build (isBannerLive).
 */
export function buildSiteContent(site: SiteContentRows, publicUrl: (path: string) => string) {
  return {
    banners: site.banners
      .filter(
        (row) =>
          (row.starts_at === null || Date.parse(row.starts_at) <= site.now) &&
          (row.ends_at === null || Date.parse(row.ends_at) > site.now),
      )
      .map((row) => {
        const paths = bannerImagePaths(row.image_id);
        return {
          id: row.id,
          href: row.href,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          image: {
            url: publicUrl(paths[paths.length - 1]!),
            alt: row.alt,
            sources: BANNER_IMAGE_WIDTHS.map((width, index) => ({
              width,
              url: publicUrl(paths[index]!),
            })),
          },
        };
      }),
    bio_links: site.bioLinks.map((row) => ({ id: row.id, label: row.label, href: row.href })),
  };
}

/** Monta o catálogo público a partir das linhas do banco (função pura, testada à parte). */
export function buildPublicCatalog(
  categories: CategoryRows,
  rows: ProductRows,
  settings: SettingsRow,
  publicUrl: (path: string) => string,
  site: SiteContentRows = { banners: [], bioLinks: [], now: 0 },
): PublicCatalog {
  // Produto de categoria inativa não aparece (contrato em apps/web/src/app/(site)/_data).
  const activeCategories = new Set(categories.map((c) => c.id));
  const products = rows
    .filter((p) => p.category_id === null || activeCategories.has(p.category_id))
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      category_id: p.category_id,
      kind: 'regular' as const,
      price_cents: p.price_cents,
      stock: p.stock,
      featured: p.featured,
      badge: p.badge,
      images: [...p.product_images]
        .sort((a, b) => a.position - b.position)
        .map((image) => ({
          url: publicUrl(image.path),
          alt: image.alt || p.name,
          sources: PRODUCT_IMAGE_WIDTHS.map((width) => ({
            width,
            url: publicUrl(image.path.replace(/\/(360|720|1080)\.webp$/, `/${width}.webp`)),
          })),
        })),
    }));

  return publicCatalogSchema.parse({
    categories: categories.map((c) => ({ ...c, image: null })),
    products,
    contact: {
      whatsapp: settings.store_whatsapp ? `55${settings.store_whatsapp}` : null,
      // Endereço da loja ainda não confirmado pela cliente (Pendências na memória).
      address: null,
    },
    instagram_images: [],
    ...buildSiteContent(site, publicUrl),
  });
}

export function supabasePublishRepo(config: Config): PublishRepo {
  const db = getServiceClient(config);
  const storage = db.storage.from('products');
  const publicUrl = (path: string) => storage.getPublicUrl(path).data.publicUrl;

  return {
    async claim(intervalSeconds, actor) {
      const { data, error } = await db.rpc('claim_publish', {
        p_min_interval_seconds: intervalSeconds,
        p_actor: actor,
      });
      if (error) fail('claim');
      return claimPublishResultSchema.parse(data);
    },

    async revert(claimedAt, previous) {
      const { error } = await db.rpc('revert_publish', {
        p_claimed_at: claimedAt,
        p_previous: previous,
      });
      if (error) fail('revert');
    },

    async lastPublishAt() {
      const { data, error } = await db
        .from('settings')
        .select('last_publish_at')
        .eq('id', 1)
        .single();
      if (error) fail('status');
      return z.object({ last_publish_at: z.iso.datetime({ offset: true }).nullable() }).parse(data)
        .last_publish_at;
    },

    async snapshot() {
      const [categoriesResult, settingsResult, bannersResult, linksResult] = await Promise.all([
        db
          .from('categories')
          .select('id, slug, name, position')
          .eq('active', true)
          .order('position'),
        db.from('settings').select('store_whatsapp').eq('id', 1).single(),
        // Só colunas públicas e só itens ativos, na ordem escolhida no painel.
        db
          .from('banners')
          .select('id, image_id, alt, href, starts_at, ends_at')
          .eq('active', true)
          .order('position')
          .order('created_at')
          .limit(10),
        db
          .from('bio_links')
          .select('id, label, href')
          .eq('active', true)
          .order('position')
          .order('created_at')
          .limit(3),
      ]);
      if (
        categoriesResult.error ||
        settingsResult.error ||
        bannersResult.error ||
        linksResult.error
      )
        fail('snapshot');
      const categories = snapshotCategoryRowsSchema.parse(categoriesResult.data);
      const settings = snapshotSettingsRowSchema.parse(settingsResult.data);

      // Só produtos à venda: ativos, do tipo regular e sem exclusão lógica. Paginado (limite do
      // PostgREST). As colunas são escolhidas uma a uma: custo e campos internos nunca saem daqui.
      const rows: ProductRows = [];
      for (let from = 0; from < MAX_PRODUCTS; from += PAGE) {
        const { data, error } = await db
          .from('products')
          .select(
            'id, slug, name, description, category_id, price_cents, stock, featured, badge, product_images(path, alt, position)',
          )
          .eq('active', true)
          .eq('kind', 'regular')
          .is('deleted_at', null)
          .order('name')
          .range(from, from + PAGE - 1);
        if (error) fail('snapshot_products');
        const page = snapshotProductRowsSchema.parse(data);
        rows.push(...page);
        if (page.length < PAGE) break;
      }

      return buildPublicCatalog(categories, rows, settings, publicUrl, {
        banners: snapshotBannerRowsSchema.parse(bannersResult.data),
        bioLinks: snapshotBioLinkRowsSchema.parse(linksResult.data),
        now: Date.now(),
      });
    },
  };
}
