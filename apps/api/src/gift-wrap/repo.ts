import {
  GIFT_WRAP_MODELS_MAX,
  PRODUCT_IMAGE_WIDTHS,
  giftWrapPublicSchema,
  type GiftWrapPublic,
} from '@sparks/shared';
import { z } from 'zod';
import type { Config } from '../env';
import { apiError } from '../lib/errors';
import { getServiceClient } from '../lib/supabase';

export interface GiftWrapRepo {
  /** Interruptor ao vivo e modelos disponíveis (só `gift_wrap` ativo, não excluído e com estoque). */
  load(): Promise<GiftWrapPublic>;
}

const fail = () => apiError(503, 'unavailable', 'Não foi possível consultar a embalagem agora.');
const modelRows = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    price_cents: z.number().int(),
    product_images: z.array(
      z.object({ path: z.string(), alt: z.string().nullable(), position: z.number() }),
    ),
  }),
);

export function supabaseGiftWrapRepo(config: Config): GiftWrapRepo {
  const db = getServiceClient(config);
  const storage = db.storage.from('products');
  const publicUrl = (path: string) => storage.getPublicUrl(path).data.publicUrl;
  return {
    async load() {
      const settings = await db.from('settings').select('gift_wrap_enabled').eq('id', 1).single();
      if (settings.error) throw fail();
      if (settings.data.gift_wrap_enabled !== true)
        return giftWrapPublicSchema.parse({ enabled: false, models: [] });
      const result = await db
        .from('products')
        .select('id,name,description,price_cents,product_images(path,alt,position)')
        .eq('kind', 'gift_wrap')
        .eq('active', true)
        .is('deleted_at', null)
        .gt('stock', 0)
        .order('name', { ascending: true })
        .limit(GIFT_WRAP_MODELS_MAX);
      if (result.error) throw fail();
      const models = modelRows.parse(result.data).map((row) => {
        // Mesmo formato do catálogo público: foto de menor `position`, com as 3 larguras.
        const first = [...row.product_images].sort((a, b) => a.position - b.position)[0];
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          priceCents: row.price_cents,
          photo: first
            ? {
                url: publicUrl(first.path),
                alt: first.alt || row.name,
                sources: PRODUCT_IMAGE_WIDTHS.map((width) => ({
                  width,
                  url: publicUrl(first.path.replace(/\/(360|720|1080)\.webp$/, `/${width}.webp`)),
                })),
              }
            : null,
        };
      });
      return giftWrapPublicSchema.parse({ enabled: true, models });
    },
  };
}
