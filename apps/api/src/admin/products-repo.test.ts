import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_IMAGE_MAX_BYTES } from '@sparks/shared';
import { supabaseProductsRepo } from './products-repo';
import { loadConfig } from '../env';
import { testEnv, USER_ID } from '../test-utils';

const productId = '11111111-1111-4111-8111-111111111111';
const input = {
  slug: 'produto-teste',
  name: 'Produto de teste',
  description: '',
  category_id: null,
  kind: 'regular' as const,
  price_cents: 1234,
  cost_cents: 700,
  stock: 10,
  weight_g: null,
  package_size: 'P' as const,
  length_cm: null,
  width_cm: null,
  height_cm: null,
  active: true,
  featured: false,
  badge: null,
};
const row = {
  ...input,
  id: productId,
  updated_at: '2026-10-07T12:00:00.000000+00:00',
  product_images: [],
};
afterEach(() => vi.unstubAllGlobals());
function setup(handler: (request: Request) => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(new Request(input, init)),
    ),
  );
  return supabaseProductsRepo(
    loadConfig({ ...testEnv, SUPABASE_SERVICE_ROLE_KEY: `product-test-${crypto.randomUUID()}` }),
  );
}

describe('respostas externas do catálogo', () => {
  it('não aceita dinheiro malformado retornado pelo banco', async () => {
    const repo = setup(async () => Response.json({ ...row, price_cents: 12.34 }));
    await expect(repo.get(productId)).rejects.toThrow();
  });
  it('a falha de versão da RPC vira conflito seguro, sem sobrescrever o cadastro', async () => {
    const repo = setup(async () =>
      Response.json(
        { code: 'P0001', message: 'catalog_changed', details: null, hint: null },
        { status: 400 },
      ),
    );
    await expect(repo.save(productId, input, row.updated_at, USER_ID)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('bucket ausente é criado com restrições antes de emitir as três URLs', async () => {
    let created = false;
    let settings: unknown;
    const repo = setup(async (request) => {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/rest/v1/products')) return Response.json(row);
      if (path === '/storage/v1/bucket/products')
        return created
          ? Response.json({
              id: 'products',
              public: true,
              file_size_limit: PRODUCT_IMAGE_MAX_BYTES,
              allowed_mime_types: ['image/webp'],
            })
          : Response.json({ code: 'NoSuchBucket', message: 'Missing' }, { status: 404 });
      if (path === '/storage/v1/bucket') {
        created = true;
        settings = await request.json();
        return Response.json({ name: 'products' }, { status: 201 });
      }
      if (path.startsWith('/storage/v1/object/upload/sign/'))
        return Response.json({ url: path.slice('/storage/v1'.length) + '?token=test-token' });
      throw new Error('Requisição inesperada');
    });
    const signed = await repo.signImage(productId);
    expect(settings).toMatchObject({
      id: 'products',
      public: true,
      file_size_limit: PRODUCT_IMAGE_MAX_BYTES,
      allowed_mime_types: ['image/webp'],
    });
    expect(signed.files.map((file) => file.width)).toEqual([360, 720, 1080]);
    expect(
      signed.files.every((file) => file.path.startsWith(`${productId}/${signed.imageId}/`)),
    ).toBe(true);
  });
  it('bucket permissivo não recebe URLs assinadas', async () => {
    const requests: string[] = [];
    const repo = setup(async (request) => {
      const path = new URL(request.url).pathname;
      requests.push(path);
      return Response.json(
        path.startsWith('/rest')
          ? row
          : { id: 'products', public: true, file_size_limit: null, allowed_mime_types: null },
      );
    });
    await expect(repo.signImage(productId)).rejects.toMatchObject({ status: 503 });
    expect(requests.some((path) => path.includes('/upload/sign/'))).toBe(false);
  });
  it('arquivo com MIME WebP mas bytes de SVG não é associado ao produto', async () => {
    const requests: string[] = [];
    const repo = setup(async (request) => {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path.startsWith('/rest/v1/products')) return Response.json(row);
      return new Response('<svg><script/></svg>', { headers: { 'Content-Type': 'image/webp' } });
    });
    await expect(
      repo.confirmImage(productId, crypto.randomUUID(), { alt: 'Foto', position: 0 }, USER_ID),
    ).rejects.toMatchObject({ status: 400 });
    expect(requests.some((path) => path.includes('/rpc/'))).toBe(false);
  });
});
