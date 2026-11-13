'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  productsListResponseSchema,
  adminProductSchema,
  categoryInputSchema,
  categoryRowSchema,
  formatBRL,
  type ProductsListResponse,
  type ProductsListQuery,
  type AdminProduct,
  type CategoryRow,
} from '@sparks/shared';
import { apiFetch } from '@/lib/api';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import { ProductEditor, slugify } from './editor';
import { ProductPhotos } from './photos';
import './products.css';

const INITIAL: ProductsListQuery = { q: '', kind: 'all', active: 'all', page: 1 };
export function ProductsPanel() {
  const { getAccessToken } = useAdmin();
  const [data, setData] = useState<ProductsListResponse | null>(null);
  const [query, setQuery] = useState(INITIAL);
  const [filters, setFilters] = useState(INITIAL);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ product: AdminProduct | null } | null>(null);
  const [photos, setPhotos] = useState<string | null>(null);
  const [category, setCategory] = useState<{
    row: CategoryRow | null;
    name: string;
    slug: string;
    position: string;
    active: boolean;
    slugTouched: boolean;
  } | null>(null);
  const load = useCallback(async () => {
    const params = new URLSearchParams({
      q: query.q,
      kind: query.kind,
      active: query.active,
      page: String(query.page),
      ...(query.category ? { category: query.category } : {}),
    });
    return productsListResponseSchema.parse(
      await apiFetch(`/admin/products?${params}`, { token: await getAccessToken() }),
    );
  }, [getAccessToken, query]);
  useEffect(() => {
    let active = true;
    void load()
      .then((rows) => {
        if (active) {
          setData(rows);
          setError('');
        }
      })
      .catch((err) => {
        if (active)
          setError(err instanceof Error ? err.message : 'Não foi possível carregar os produtos.');
      });
    return () => {
      active = false;
    };
  }, [load]);
  const refresh = useCallback(async () => {
    setData(await load());
  }, [load]);
  async function edit(product: AdminProduct) {
    setBusy(true);
    setError('');
    setPhotos(null);
    try {
      const row = adminProductSchema.parse(
        await apiFetch(`/admin/products/${product.id}`, { token: await getAccessToken() }),
      );
      setEditor({ product: row });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o produto.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(row: AdminProduct | CategoryRow, entity: 'products' | 'categories') {
    if (!window.confirm(`Excluir ${entity === 'products' ? 'este produto' : 'esta categoria'}?`))
      return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/admin/products/${entity === 'categories' ? 'categories/' : ''}${row.id}`, {
        method: 'DELETE',
        token: await getAccessToken(),
        body: JSON.stringify({ expectedUpdatedAt: row.updated_at }),
      });
      await refresh();
      setNotice('Cadastro excluído.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir.');
    } finally {
      setBusy(false);
    }
  }
  async function saveCategory() {
    if (!category) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const input = categoryInputSchema.parse({
        name: category.name,
        slug: category.slug,
        position: Number(category.position),
        active: category.active,
      });
      categoryRowSchema.parse(
        await apiFetch(`/admin/products/categories${category.row ? `/${category.row.id}` : ''}`, {
          method: category.row ? 'PATCH' : 'POST',
          token: await getAccessToken(),
          body: JSON.stringify({
            ...input,
            ...(category.row ? { expectedUpdatedAt: category.row.updated_at } : {}),
          }),
        }),
      );
      await refresh();
      setCategory(null);
      setNotice('Categoria salva.');
    } catch (err) {
      setError(
        err instanceof Error && err.name !== 'ZodError'
          ? err.message
          : 'Confira nome, link e posição da categoria.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="products-panel">
      <div className="products-heading">
        <h1>Produtos</h1>
        <Button
          onClick={() => {
            setEditor({ product: null });
            setPhotos(null);
            setNotice('');
          }}
          disabled={busy}
        >
          Novo produto
        </Button>
      </div>
      <p>
        Cadastre produtos, fotos e categorias. Use “Publicar alterações” quando o cadastro estiver
        pronto para atualizar a vitrine.
      </p>
      {error && (
        <p className="products-error" role="alert">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      {!data ? (
        <>
          <p>Carregando produtos…</p>
          {error && (
            <Button
              variant="white"
              onClick={() =>
                void refresh().catch(() => setError('Não foi possível carregar os produtos.'))
              }
            >
              Tentar de novo
            </Button>
          )}
        </>
      ) : (
        <>
          <form
            className="products-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery({ ...filters, page: 1 });
            }}
          >
            <label>
              Buscar produto
              <input
                value={filters.q}
                maxLength={120}
                onChange={(event) => setFilters({ ...filters, q: event.target.value })}
              />
            </label>
            <label>
              Mostrar
              <select
                value={filters.kind}
                onChange={(event) =>
                  setFilters({ ...filters, kind: event.target.value as ProductsListQuery['kind'] })
                }
              >
                <option value="all">Produtos e embalagens</option>
                <option value="regular">Produtos da loja</option>
                <option value="gift_wrap">Embalagens de presente</option>
              </select>
            </label>
            <label>
              Situação
              <select
                value={filters.active}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    active: event.target.value as ProductsListQuery['active'],
                  })
                }
              >
                <option value="all">Ativos e inativos</option>
                <option value="true">Ativos</option>
                <option value="false">Inativos</option>
              </select>
            </label>
            <label>
              Categoria
              <select
                value={filters.category ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, category: event.target.value || undefined })
                }
              >
                <option value="">Todas</option>
                {data.categories.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">Filtrar</Button>
          </form>
          {editor && (
            <ProductEditor
              key={editor.product?.id ?? 'new'}
              product={editor.product}
              categories={data.categories}
              onClose={() => setEditor(null)}
              onSaved={async (row) => {
                await refresh();
                setEditor(null);
                setNotice('Produto salvo.');
                if (!editor.product) setPhotos(row.id);
              }}
            />
          )}
          {photos && (
            <ProductPhotos
              key={photos}
              productId={photos}
              onClose={() => setPhotos(null)}
              onChanged={refresh}
            />
          )}
          <section aria-label="Lista de produtos">
            <h2>
              {data.count} {data.count === 1 ? 'produto' : 'produtos'}
            </h2>
            {data.products.length === 0 ? (
              <p>Nenhum produto encontrado. Cadastre o primeiro produto ou ajuste os filtros.</p>
            ) : (
              <ul className="products-rows">
                {data.products.map((row) => (
                  <li key={row.id}>
                    <div>
                      <h3>{row.name}</h3>
                      <p>
                        {row.kind === 'gift_wrap' ? 'Embalagem de presente' : 'Produto da loja'} ·{' '}
                        {row.active ? 'Ativo' : 'Inativo'}
                      </p>
                      <p>
                        /{row.kind === 'regular' ? 'produto' : 'embalagem'}/{row.slug}
                      </p>
                    </div>
                    <dl>
                      <div>
                        <dt>Preço</dt>
                        <dd>{formatBRL(row.price_cents)}</dd>
                      </div>
                      <div>
                        <dt>Custo</dt>
                        <dd>{formatBRL(row.cost_cents)}</dd>
                      </div>
                      <div>
                        <dt>Estoque</dt>
                        <dd>{row.stock}</dd>
                      </div>
                    </dl>
                    <div className="products-actions">
                      <Button variant="white" disabled={busy} onClick={() => void edit(row)}>
                        Editar
                      </Button>
                      <Button
                        variant="white"
                        disabled={busy}
                        onClick={() => {
                          setEditor(null);
                          setPhotos(row.id);
                        }}
                      >
                        Fotos ({row.images.length})
                      </Button>
                      <Button
                        variant="white"
                        disabled={busy}
                        onClick={() => void remove(row, 'products')}
                      >
                        Excluir
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="products-actions">
              <Button
                variant="white"
                disabled={query.page <= 1}
                onClick={() => {
                  setQuery({ ...query, page: query.page - 1 });
                }}
              >
                Anterior
              </Button>
              <span>Página {data.page}</span>
              <Button
                variant="white"
                disabled={data.page * data.pageSize >= data.count}
                onClick={() => {
                  setQuery({ ...query, page: query.page + 1 });
                }}
              >
                Próxima
              </Button>
              <Button
                variant="white"
                onClick={() => {
                  setError('');
                  void refresh().catch(() => setError('Não foi possível atualizar os produtos.'));
                }}
              >
                Atualizar lista
              </Button>
            </div>
          </section>
          <section aria-label="Categorias">
            <div className="products-heading">
              <h2>Categorias</h2>
              <Button
                variant="white"
                disabled={busy}
                onClick={() =>
                  setCategory({
                    row: null,
                    name: '',
                    slug: '',
                    position: '0',
                    active: true,
                    slugTouched: false,
                  })
                }
              >
                Nova categoria
              </Button>
            </div>
            {category && (
              <form
                className="products-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveCategory();
                }}
              >
                <h3>{category.row ? 'Editar categoria' : 'Nova categoria'}</h3>
                <div className="products-fields">
                  <label>
                    Nome da categoria
                    <input
                      required
                      maxLength={80}
                      value={category.name}
                      onChange={(event) =>
                        setCategory({
                          ...category,
                          name: event.target.value,
                          ...(!category.slugTouched ? { slug: slugify(event.target.value) } : {}),
                        })
                      }
                    />
                  </label>
                  <label>
                    Nome no link da categoria
                    <input
                      required
                      maxLength={120}
                      value={category.slug}
                      onChange={(event) =>
                        setCategory({ ...category, slug: event.target.value, slugTouched: true })
                      }
                    />
                  </label>
                  <label>
                    Posição da categoria
                    <input
                      type="number"
                      min={0}
                      max={9999}
                      step={1}
                      required
                      value={category.position}
                      onChange={(event) =>
                        setCategory({ ...category, position: event.target.value })
                      }
                    />
                  </label>
                  <label className="products-check">
                    <input
                      type="checkbox"
                      checked={category.active}
                      onChange={(event) =>
                        setCategory({ ...category, active: event.target.checked })
                      }
                    />
                    Categoria ativa
                  </label>
                </div>
                <div className="products-actions">
                  <Button type="submit" loading={busy}>
                    Salvar categoria
                  </Button>
                  <Button variant="white" disabled={busy} onClick={() => setCategory(null)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            )}
            {data.categories.length === 0 ? (
              <p>Nenhuma categoria cadastrada.</p>
            ) : (
              <ul className="products-categories">
                {data.categories.map((row) => (
                  <li key={row.id}>
                    <div>
                      <h3>{row.name}</h3>
                      <p>
                        Posição {row.position} · {row.active ? 'Ativa' : 'Inativa'}
                      </p>
                    </div>
                    <div className="products-actions">
                      <Button
                        variant="white"
                        disabled={busy}
                        onClick={() =>
                          setCategory({
                            row,
                            name: row.name,
                            slug: row.slug,
                            position: String(row.position),
                            active: row.active,
                            slugTouched: true,
                          })
                        }
                      >
                        Editar categoria
                      </Button>
                      <Button
                        variant="white"
                        disabled={busy}
                        onClick={() => void remove(row, 'categories')}
                      >
                        Excluir categoria
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
