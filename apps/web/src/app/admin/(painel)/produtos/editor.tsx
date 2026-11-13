'use client';

import { useEffect, useRef, useState } from 'react';
import {
  formatBRL,
  parseBRLToCents,
  productInputSchema,
  adminProductSchema,
  type AdminProduct,
  type CategoryRow,
} from '@sparks/shared';
import { apiFetch } from '@/lib/api';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';

type Values = Record<string, string | boolean>;
export function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
    .replace(/-$/, '');
}
function valuesFor(product: AdminProduct | null): Values {
  if (!product)
    return {
      name: '',
      slug: '',
      description: '',
      category_id: '',
      kind: 'regular',
      price_cents: '',
      cost_cents: '',
      stock: '0',
      weight_g: '',
      package_size: 'P',
      length_cm: '',
      width_cm: '',
      height_cm: '',
      active: false,
      featured: false,
      badge: '',
    };
  return Object.fromEntries(
    Object.entries(product).map(([key, value]) => [
      key,
      key === 'price_cents' || key === 'cost_cents'
        ? formatBRL(Number(value)).replace(/^R\$\s*/, '')
        : typeof value === 'boolean'
          ? value
          : value === null
            ? ''
            : String(value),
    ]),
  );
}
export function ProductEditor({
  product,
  categories,
  onSaved,
  onClose,
}: {
  product: AdminProduct | null;
  categories: CategoryRow[];
  onSaved: (row: AdminProduct) => Promise<void>;
  onClose: () => void;
}) {
  const { getAccessToken } = useAdmin();
  const [values, setValues] = useState<Values>(() => valuesFor(product));
  const [expected, setExpected] = useState(product?.updated_at ?? null);
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.scrollIntoView({ block: 'start' });
    section.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, []);
  function change(name: string, value: string | boolean) {
    if (name === 'slug') setSlugTouched(true);
    setValues((current) => ({
      ...current,
      [name]: value,
      ...(name === 'name' && !slugTouched ? { slug: slugify(String(value)) } : {}),
    }));
  }
  async function reload() {
    if (!product) return;
    setBusy(true);
    setError('');
    try {
      const row = adminProductSchema.parse(
        await apiFetch(`/admin/products/${product.id}`, { token: await getAccessToken() }),
      );
      setValues(valuesFor(row));
      setExpected(row.updated_at);
    } catch {
      setError('Não foi possível atualizar o cadastro.');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setError('');
    setBusy(true);
    try {
      const numeric = (key: string) =>
        String(values[key]).trim() === '' ? null : Number(values[key]);
      const input = productInputSchema.parse({
        ...values,
        price_cents: parseBRLToCents(String(values.price_cents)),
        cost_cents: parseBRLToCents(String(values.cost_cents)),
        stock: numeric('stock'),
        weight_g: numeric('weight_g'),
        length_cm: numeric('length_cm'),
        width_cm: numeric('width_cm'),
        height_cm: numeric('height_cm'),
        category_id: values.category_id || null,
        badge: values.badge || null,
      });
      const result = adminProductSchema.parse(
        await apiFetch(`/admin/products${product ? `/${product.id}` : ''}`, {
          method: product ? 'PATCH' : 'POST',
          token: await getAccessToken(),
          body: JSON.stringify({ ...input, ...(product ? { expectedUpdatedAt: expected } : {}) }),
        }),
      );
      await onSaved(result);
    } catch (err) {
      setError(
        err instanceof Error && err.name !== 'ZodError'
          ? err.message
          : 'Confira nome, link, preços, estoque e medidas antes de salvar.',
      );
    } finally {
      setBusy(false);
    }
  }
  const text = (name: string, label: string, required = false, maxLength?: number) => (
    <label>
      {label}
      <input
        value={String(values[name] ?? '')}
        required={required}
        maxLength={maxLength}
        disabled={busy}
        onChange={(event) => change(name, event.target.value)}
      />
    </label>
  );
  const number = (name: string, label: string, required = false) => (
    <label>
      {label}
      <input
        type="number"
        min={name === 'stock' ? 0 : 1}
        step={1}
        value={String(values[name] ?? '')}
        required={required}
        disabled={busy}
        onChange={(event) => change(name, event.target.value)}
      />
    </label>
  );
  return (
    <section ref={section} className="products-editor" aria-label="Cadastro do produto">
      <h2>{product ? 'Editar produto' : 'Novo produto'}</h2>
      {error && (
        <p role="alert" className="products-error">
          {error}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="products-fields">
          {text('name', 'Nome do produto', true, 120)}
          {text('slug', 'Nome no link', true, 120)}
          <label>
            Categoria
            <select
              disabled={busy}
              value={String(values.category_id)}
              onChange={(event) => change('category_id', event.target.value)}
            >
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                  {!category.active ? ' (inativa)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo
            <select
              disabled={busy}
              value={String(values.kind)}
              onChange={(event) => change('kind', event.target.value)}
            >
              <option value="regular">Produto da loja</option>
              <option value="gift_wrap">Embalagem de presente</option>
            </select>
          </label>
          <label>
            Preço de venda (R$)
            <input
              inputMode="decimal"
              required
              disabled={busy}
              value={String(values.price_cents)}
              onChange={(event) => change('price_cents', event.target.value)}
            />
          </label>
          <label>
            Custo (R$)
            <input
              inputMode="decimal"
              required
              disabled={busy}
              value={String(values.cost_cents)}
              onChange={(event) => change('cost_cents', event.target.value)}
            />
          </label>
          {number('stock', 'Estoque', true)}
          {number('weight_g', 'Peso real (g)')}
          <label>
            Tamanho para envio
            <select
              value={String(values.package_size)}
              disabled={busy}
              onChange={(event) => change('package_size', event.target.value)}
            >
              {['P', 'M', 'G'].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          {number('length_cm', 'Comprimento (cm)')}
          {number('width_cm', 'Largura (cm)')}
          {number('height_cm', 'Altura (cm)')}
          {text('badge', 'Selo do produto', false, 30)}
          <label className="products-wide">
            Descrição
            <textarea
              rows={5}
              maxLength={10000}
              value={String(values.description)}
              disabled={busy}
              onChange={(event) => change('description', event.target.value)}
            />
          </label>
          <label className="products-check">
            <input
              type="checkbox"
              checked={values.active === true}
              disabled={busy}
              onChange={(event) => change('active', event.target.checked)}
            />
            Produto ativo
          </label>
          <label className="products-check">
            <input
              type="checkbox"
              checked={values.featured === true}
              disabled={busy}
              onChange={(event) => change('featured', event.target.checked)}
            />
            Destaque na home
          </label>
        </div>
        <p>
          Sem peso real, o frete usa o peso do tamanho P, M ou G. Embalagens de presente ficam
          ocultas da vitrine.
        </p>
        <div className="products-actions">
          <Button type="submit" loading={busy}>
            Salvar produto
          </Button>
          <Button variant="white" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          {product && (
            <Button
              variant="white"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    'Recarregar os dados atuais? As edições ainda não salvas serão descartadas.',
                  )
                )
                  void reload();
              }}
            >
              Recarregar cadastro
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
