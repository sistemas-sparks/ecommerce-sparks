import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_IMAGE_MAX_BYTES, type AdminProduct } from '@sparks/shared';
import { createApp } from '../app';
import { createTestKey, signToken, testEnv, USER_ID, type TestKey } from '../test-utils';
import type { ProductsRepo } from './products-repo';

const productId = '11111111-1111-4111-8111-111111111111';
const stamp = '2026-10-07T12:00:00.000000+00:00';
let key: TestKey;
let product: AdminProduct;
let repo: ProductsRepo;
beforeAll(async () => {
  key = await createTestKey();
});
beforeEach(() => {
  product = {
    id: productId,
    slug: 'produto-teste',
    name: 'Produto de teste',
    description: '',
    category_id: null,
    kind: 'regular',
    price_cents: 1234,
    cost_cents: 700,
    stock: 10,
    weight_g: null,
    package_size: 'P',
    length_cm: null,
    width_cm: null,
    height_cm: null,
    active: true,
    featured: false,
    badge: null,
    updated_at: stamp,
    images: [],
  };
  repo = {
    list: vi.fn<ProductsRepo['list']>(async () => ({
      products: [product],
      count: 1,
      page: 1,
      pageSize: 50,
      categories: [],
    })),
    get: vi.fn(async () => product),
    save: vi.fn(async () => product),
    remove: vi.fn(async () => {}),
    categories: vi.fn(async () => []),
    saveCategory: vi.fn(),
    removeCategory: vi.fn(async () => {}),
    signImage: vi.fn(),
    confirmImage: vi.fn(async () => {}),
    editImage: vi.fn(async () => {}),
    removeImage: vi.fn(async () => {}),
    live: vi.fn(async () => [product]),
  };
});
const app = (allow = true) =>
  createApp({
    productsRepo: () => repo,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async () => allow,
  });
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  role: string | null = 'admin',
) {
  const token =
    role === null ? null : await signToken(key, { app_metadata: { role }, aal: 'aal2' });
  return app().request(
    path,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    testEnv,
  );
}
function input() {
  const { id: _id, updated_at: _stamp, images: _images, ...fields } = product;
  void _id;
  void _stamp;
  void _images;
  return fields;
}

describe('administração do catálogo', () => {
  it('recusa leitura e gravação sem papel admin, antes de acessar o banco', async () => {
    for (const role of [null, 'customer']) {
      expect((await request('/admin/products', 'GET', undefined, role)).status).toBe(
        role === null ? 401 : 403,
      );
      expect((await request('/admin/products', 'POST', input(), role)).status).toBe(
        role === null ? 401 : 403,
      );
      expect(
        (
          await request(
            `/admin/products/${productId}/images/upload`,
            'POST',
            { type: 'image/png', size: 10 },
            role,
          )
        ).status,
      ).toBe(role === null ? 401 : 403);
    }
    expect(repo.list).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.signImage).not.toHaveBeenCalled();
  });
  it('rejeita preço, custo e estoque fracionários antes da gravação', async () => {
    for (const field of ['price_cents', 'cost_cents', 'stock'])
      expect((await request('/admin/products', 'POST', { ...input(), [field]: 1.2 })).status).toBe(
        400,
      );
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('descarta campos extras e usa o autor autenticado', async () => {
    expect(
      (
        await request('/admin/products', 'POST', {
          ...input(),
          deleted_at: stamp,
          actor: 'outra-pessoa',
        })
      ).status,
    ).toBe(201);
    expect(repo.save).toHaveBeenCalledWith(null, input(), null, USER_ID);
  });
  it('edição e exclusão exigem a versão do cadastro', async () => {
    expect((await request(`/admin/products/${productId}`, 'PATCH', input())).status).toBe(400);
    expect((await request(`/admin/products/${productId}`, 'DELETE', {})).status).toBe(400);
    expect(
      (
        await request(`/admin/products/${productId}`, 'PATCH', {
          ...input(),
          expectedUpdatedAt: stamp,
        })
      ).status,
    ).toBe(200);
    expect(repo.save).toHaveBeenCalledWith(productId, input(), stamp, USER_ID);
  });
  it('recusa SVG e arquivos acima de 5 MB antes de emitir a URL', async () => {
    for (const body of [
      { type: 'image/svg+xml', size: 100 },
      { type: 'image/png', size: PRODUCT_IMAGE_MAX_BYTES + 1 },
    ])
      expect(
        (await request(`/admin/products/${productId}/images/upload`, 'POST', body)).status,
      ).toBe(400);
    expect(repo.signImage).not.toHaveBeenCalled();
  });
  it('não aceita paths enviados pelo navegador na confirmação da foto', async () => {
    const imageId = '22222222-2222-4222-8222-222222222222';
    expect(
      (
        await request(`/admin/products/${productId}/images`, 'POST', {
          imageId,
          alt: 'Foto do produto',
          position: 0,
          path: '../outro-arquivo',
        })
      ).status,
    ).toBe(201);
    expect(repo.confirmImage).toHaveBeenCalledWith(
      productId,
      imageId,
      { alt: 'Foto do produto', position: 0 },
      USER_ID,
    );
  });
});
describe('disponibilidade pública', () => {
  it('exibe somente IDs, preço, estoque e situação; nunca o custo ou fotos administrativas', async () => {
    const response = await request(`/products/live?ids=${productId}`, 'GET', undefined, null);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      products: [{ id: productId, price_cents: 1234, stock: 10, active: true }],
    });
  });
  it('limita e valida IDs antes de consultar produtos', async () => {
    expect((await request('/products/live?ids=inválido', 'GET', undefined, null)).status).toBe(400);
    expect(
      (await request(`/products/live?ids=${productId},${productId}`, 'GET', undefined, null))
        .status,
    ).toBe(400);
    expect(repo.live).not.toHaveBeenCalled();
    expect((await app(false).request(`/products/live?ids=${productId}`, {}, testEnv)).status).toBe(
      429,
    );
  });
});
