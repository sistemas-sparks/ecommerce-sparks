import {
  PRODUCT_IMAGE_WIDTHS,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_COUNT,
  productDatabaseRowSchema,
  adminProductSchema,
  categoryRowSchema,
  productsListResponseSchema,
  productSignedFileSchema,
  productUploadResponseSchema,
  productBucketSchema,
  liveProductsSchema,
  catalogMutationResultSchema,
  catalogMutationErrorSchema,
  type AdminProduct,
  type ProductInput,
  type CategoryInput,
  type CategoryRow,
  type ProductsListQuery,
  type ProductsListResponse,
  type ProductImageInput,
  type ProductImageRow,
  type ProductUploadResponse,
  type LiveProduct,
} from '@sparks/shared';
import type { Config } from '../env';
import { getServiceClient } from '../lib/supabase';
import { apiError } from '../lib/errors';
import { inspectProductWebp } from './products-image';

export interface ProductsRepo {
  list(query: ProductsListQuery): Promise<ProductsListResponse>;
  get(id: string): Promise<AdminProduct>;
  save(
    id: string | null,
    data: ProductInput,
    expected: string | null,
    actor: string,
  ): Promise<AdminProduct>;
  remove(id: string, expected: string, actor: string): Promise<void>;
  categories(): Promise<CategoryRow[]>;
  saveCategory(
    id: string | null,
    data: CategoryInput,
    expected: string | null,
    actor: string,
  ): Promise<CategoryRow>;
  removeCategory(id: string, expected: string, actor: string): Promise<void>;
  signImage(id: string): Promise<ProductUploadResponse>;
  confirmImage(id: string, imageId: string, data: ProductImageInput, actor: string): Promise<void>;
  editImage(
    id: string,
    imageId: string,
    data: ProductImageInput,
    expected: string,
    actor: string,
  ): Promise<void>;
  removeImage(id: string, imageId: string, expected: string, actor: string): Promise<void>;
  live(ids: string[]): Promise<LiveProduct[]>;
}
const PRODUCT_FIELDS =
  'id,slug,name,description,category_id,kind,price_cents,cost_cents,stock,weight_g,package_size,length_cm,width_cm,height_cm,active,featured,badge,updated_at';
const IMAGE_FIELDS = 'id,product_id,path,alt,position,updated_at';
const CATEGORY_FIELDS = 'id,slug,name,position,active,updated_at';
const stale = () =>
  apiError(
    409,
    'product_changed',
    'O cadastro mudou. Atualize a lista e confira o estoque antes de salvar.',
  );
function check(error: { code?: string; message?: string } | null, updating = false) {
  if (!error) return;
  const parsed = catalogMutationErrorSchema.safeParse(error);
  if (parsed.success && parsed.data.code === 'P0001') {
    if (parsed.data.message === 'catalog_changed') throw stale();
    if (parsed.data.message === 'image_limit')
      throw apiError(409, 'image_limit', 'Limite de 12 fotos por produto.');
    if (parsed.data.message === 'category_in_use')
      throw apiError(
        409,
        'category_in_use',
        'Mova os produtos desta categoria antes de excluí-la.',
      );
    if (parsed.data.message === 'catalog_invalid')
      throw apiError(400, 'invalid_input', 'Confira os dados do cadastro.');
  }
  if (error.code === 'PGRST116') {
    if (updating) throw stale();
    throw apiError(404, 'not_found', 'Cadastro não encontrado.');
  }
  if (['23505', '23503', '23514'].includes(error.code ?? ''))
    throw apiError(
      409,
      'product_conflict',
      'Confira o link, os valores e a categoria: há um cadastro repetido ou vinculado.',
    );
  throw apiError(503, 'unavailable', 'Não foi possível acessar os produtos.');
}
const paths = (id: string, imageId: string) =>
  PRODUCT_IMAGE_WIDTHS.map((width) => `${id}/${imageId}/${width}.webp`);

export function supabaseProductsRepo(config: Config): ProductsRepo {
  const db = getServiceClient(config);
  const storage = db.storage.from('products');
  const publicUrl = (path: string) => storage.getPublicUrl(path).data.publicUrl;
  const photo = (row: ProductImageRow) => ({
    ...row,
    url: publicUrl(row.path),
    sources: PRODUCT_IMAGE_WIDTHS.map((width) => ({
      width,
      url: publicUrl(row.path.replace(/\/(360|720|1080)\.webp$/, `/${width}.webp`)),
    })),
  });
  const product = (raw: unknown) => {
    const { product_images, ...row } = productDatabaseRowSchema.parse(raw);
    return adminProductSchema.parse({
      ...row,
      images: product_images
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map(photo),
    });
  };
  const mutate = async (
    entity: 'products' | 'categories' | 'product_images',
    action: 'create' | 'update' | 'delete',
    id: string | null,
    data: Record<string, unknown>,
    expected: string | null,
    actor: string,
    productId: string | null = null,
  ) => {
    const result = await db.rpc('admin_catalog_mutate', {
      p_entity: entity,
      p_action: action,
      p_id: id,
      p_data: data,
      p_expected: expected,
      p_actor: actor,
      p_product_id: productId,
    });
    check(result.error);
    return catalogMutationResultSchema.parse(result.data).id;
  };
  const categories = async () => {
    const result = await db
      .from('categories')
      .select(CATEGORY_FIELDS)
      .order('position')
      .order('name')
      .limit(500);
    check(result.error);
    return categoryRowSchema.array().max(500).parse(result.data);
  };
  const get = async (id: string) => {
    const result = await db
      .from('products')
      .select(`${PRODUCT_FIELDS},product_images(${IMAGE_FIELDS})`)
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    check(result.error);
    return product(result.data);
  };
  async function prepareBucket() {
    let result = await db.storage.getBucket('products');
    if (result.error?.status === 404) {
      await db.storage.createBucket('products', {
        public: true,
        fileSizeLimit: PRODUCT_IMAGE_MAX_BYTES,
        allowedMimeTypes: ['image/webp'],
      });
      // Uma segunda chamada pode ter criado o bucket enquanto esta aguardava.
      // A leitura abaixo precisa comprovar a configuração antes de emitir URLs.
      result = await db.storage.getBucket('products');
    }
    if (result.error || !productBucketSchema.safeParse(result.data).success)
      throw apiError(
        503,
        'storage_configuration',
        'A configuração das fotos está incompleta. Peça ao responsável pelo site para ajustar.',
      );
  }
  return {
    categories,
    get,
    async list(query) {
      let request = db
        .from('products')
        .select(`${PRODUCT_FIELDS},product_images(${IMAGE_FIELDS})`, { count: 'exact' })
        .is('deleted_at', null);
      if (query.q) request = request.ilike('name', `%${query.q.replace(/[\\%_]/g, '\\$&')}%`);
      if (query.kind !== 'all') request = request.eq('kind', query.kind);
      if (query.active !== 'all') request = request.eq('active', query.active === 'true');
      if (query.category) request = request.eq('category_id', query.category);
      const [result, rows] = await Promise.all([
        request
          .order('name')
          .order('id')
          .range((query.page - 1) * 50, query.page * 50 - 1),
        categories(),
      ]);
      check(result.error);
      const products = productDatabaseRowSchema.array().max(50).parse(result.data).map(product);
      return productsListResponseSchema.parse({
        products,
        count: result.count,
        page: query.page,
        pageSize: 50,
        categories: rows,
      });
    },
    async save(id, data, expected, actor) {
      return get(await mutate('products', id ? 'update' : 'create', id, data, expected, actor));
    },
    async remove(id, expected, actor) {
      await mutate('products', 'delete', id, {}, expected, actor);
    },
    async saveCategory(id, data, expected, actor) {
      const written = await mutate(
        'categories',
        id ? 'update' : 'create',
        id,
        data,
        expected,
        actor,
      );
      const result = await db.from('categories').select(CATEGORY_FIELDS).eq('id', written).single();
      check(result.error);
      return categoryRowSchema.parse(result.data);
    },
    async removeCategory(id, expected, actor) {
      await mutate('categories', 'delete', id, {}, expected, actor);
    },
    async signImage(id) {
      const row = await get(id);
      if (row.images.length >= PRODUCT_IMAGE_MAX_COUNT)
        throw apiError(409, 'image_limit', 'Limite de 12 fotos por produto.');
      await prepareBucket();
      const imageId = crypto.randomUUID();
      const files = [];
      for (const width of PRODUCT_IMAGE_WIDTHS) {
        const path = `${id}/${imageId}/${width}.webp`;
        const result = await storage.createSignedUploadUrl(path, { upsert: false });
        if (result.error)
          throw apiError(503, 'storage_unavailable', 'Não foi possível preparar o envio da foto.');
        const signed = productSignedFileSchema.parse(result.data);
        if (
          signed.path !== path ||
          new URL(signed.signedUrl).origin !== new URL(config.supabaseUrl).origin
        )
          throw apiError(503, 'storage_unavailable', 'Não foi possível preparar o envio da foto.');
        files.push({ ...signed, width });
      }
      return productUploadResponseSchema.parse({ imageId, files });
    },
    async confirmImage(id, imageId, data, actor) {
      const row = await get(id);
      if (row.images.length >= PRODUCT_IMAGE_MAX_COUNT)
        throw apiError(409, 'image_limit', 'Limite de 12 fotos por produto.');
      const locations = paths(id, imageId);
      for (let index = 0; index < locations.length; index++) {
        const { data: blob, error } = await storage.download(locations[index]!);
        if (error || !blob || blob.type !== 'image/webp' || blob.size > PRODUCT_IMAGE_MAX_BYTES)
          throw apiError(
            400,
            'invalid_image',
            'Envie todas as versões da foto antes de confirmar.',
          );
        inspectProductWebp(new Uint8Array(await blob.arrayBuffer()), PRODUCT_IMAGE_WIDTHS[index]!);
      }
      await mutate(
        'product_images',
        'create',
        imageId,
        { path: locations[2], ...data },
        null,
        actor,
        id,
      );
    },
    async editImage(id, imageId, data, expected, actor) {
      await mutate('product_images', 'update', imageId, data, expected, actor, id);
    },
    async removeImage(id, imageId, expected, actor) {
      await mutate('product_images', 'delete', imageId, {}, expected, actor, id);
      // Mantém os arquivos para a versão estática ainda publicada. O próximo build remove a referência.
    },
    async live(ids) {
      const result = await db
        .from('products')
        .select('id,price_cents,stock,active')
        .in('id', ids)
        .eq('kind', 'regular')
        .eq('active', true)
        .is('deleted_at', null);
      check(result.error);
      return liveProductsSchema.parse({ products: result.data }).products;
    },
  };
}
