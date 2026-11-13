'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  adminProductSchema,
  productUploadResponseSchema,
  productImageInputSchema,
  PRODUCT_IMAGE_MAX_COUNT,
  productUploadInputSchema,
  type AdminProduct,
  type ProductImageRow,
} from '@sparks/shared';
import { apiFetch } from '@/lib/api';
import { getSupabase } from '@/lib/supabase';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import { prepareProductImages } from './images';

export function ProductPhotos({
  productId,
  onClose,
  onChanged,
}: {
  productId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { getAccessToken } = useAdmin();
  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [alt, setAlt] = useState('');
  const [editing, setEditing] = useState<{
    image: ProductImageRow;
    alt: string;
    position: string;
  } | null>(null);
  const load = useCallback(
    async () =>
      adminProductSchema.parse(
        await apiFetch(`/admin/products/${productId}`, { token: await getAccessToken() }),
      ),
    [productId, getAccessToken],
  );
  useEffect(() => {
    let active = true;
    void load()
      .then((row) => {
        if (active) {
          setProduct(row);
          setAlt(row.name);
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar as fotos.');
      });
    return () => {
      active = false;
    };
  }, [load]);
  async function reload() {
    setProduct(await load());
    await onChanged();
  }
  async function upload(files: File[]) {
    if (!product || files.length === 0) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (product.images.length + files.length > PRODUCT_IMAGE_MAX_COUNT)
        throw new Error('Cada produto pode ter até 12 fotos.');
      const supabase = getSupabase();
      if (!supabase) throw new Error('Confira a configuração do painel antes de enviar fotos.');
      let position = product.images.length;
      for (const file of files) {
        const input = productImageInputSchema.parse({ alt, position });
        const variants = await prepareProductImages(file);
        const request = productUploadInputSchema.parse({ type: file.type, size: file.size });
        const signed = productUploadResponseSchema.parse(
          await apiFetch(`/admin/products/${productId}/images/upload`, {
            method: 'POST',
            token: await getAccessToken(),
            body: JSON.stringify(request),
          }),
        );
        for (const variant of variants) {
          const target = signed.files.find((row) => row.width === variant.width);
          if (!target || target.path !== `${productId}/${signed.imageId}/${variant.width}.webp`)
            throw new Error('Não foi possível preparar o destino da foto.');
          const { error: storageError } = await supabase.storage
            .from('products')
            .uploadToSignedUrl(target.path, target.token, variant.blob, {
              contentType: 'image/webp',
              cacheControl: '31536000',
            });
          if (storageError) throw new Error('O envio da foto falhou. Tente de novo.');
        }
        await apiFetch(`/admin/products/${productId}/images`, {
          method: 'POST',
          token: await getAccessToken(),
          body: JSON.stringify({ ...input, imageId: signed.imageId }),
        });
        position++;
      }
      setNotice('Fotos enviadas.');
    } catch (err) {
      setError(
        err instanceof Error && err.name !== 'ZodError'
          ? err.message
          : 'Confira o formato, tamanho e descrição da foto.',
      );
    } finally {
      await reload().catch(() => setError('Não foi possível atualizar as fotos.'));
      setBusy(false);
    }
  }
  async function change(image: ProductImageRow, method: 'PATCH' | 'DELETE', input?: unknown) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await apiFetch(`/admin/products/${productId}/images/${image.id}`, {
        method,
        token: await getAccessToken(),
        body: JSON.stringify({
          ...(typeof input === 'object' && input !== null ? input : {}),
          expectedUpdatedAt: image.updated_at,
        }),
      });
      await reload();
      setEditing(null);
      setNotice('Foto atualizada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar a foto.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="products-editor" aria-label="Fotos do produto">
      <div className="products-heading">
        <h2>Fotos{product ? ` · ${product.name}` : ''}</h2>
        <Button variant="white" onClick={onClose} disabled={busy}>
          Fechar fotos
        </Button>
      </div>
      {error && (
        <p role="alert" className="products-error">
          {error}
        </p>
      )}
      <p role="status">{busy ? 'Preparando fotos…' : notice}</p>
      {!product ? (
        <p>Carregando fotos…</p>
      ) : (
        <>
          <p>
            Até 12 fotos, em JPEG, PNG ou WebP, com até 5 MB cada. A foto inteira é preservada em um
            quadro 4:5.
          </p>
          <div className="products-fields">
            <label>
              Descrição das novas fotos
              <input
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
                maxLength={300}
                disabled={busy}
              />
            </label>
            <label>
              Adicionar fotos
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={busy || product.images.length >= 12}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  void upload(files);
                }}
              />
            </label>
          </div>
          <ul className="products-photos">
            {product.images.map((image) => (
              <li key={image.id}>
                {/* Fotos externas já convertidas em WebP com larguras próprias. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  srcSet={image.sources
                    .map((source) => `${source.url} ${source.width}w`)
                    .join(', ')}
                  sizes="(max-width: 760px) 160px, 240px"
                  alt={image.alt}
                  loading="lazy"
                />
                <p>{image.alt}</p>
                <p>Posição {image.position + 1}</p>
                <div className="products-actions">
                  <Button
                    variant="white"
                    disabled={busy}
                    onClick={() =>
                      setEditing({ image, alt: image.alt, position: String(image.position + 1) })
                    }
                  >
                    Editar foto
                  </Button>
                  <Button
                    variant="white"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Remover esta foto do produto?'))
                        void change(image, 'DELETE');
                    }}
                  >
                    Remover foto
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {editing && (
            <form
              className="products-fields"
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  const input = productImageInputSchema.parse({
                    alt: editing.alt,
                    position: Number(editing.position) - 1,
                  });
                  void change(editing.image, 'PATCH', input);
                } catch {
                  setError('Confira a descrição e a posição da foto.');
                }
              }}
            >
              <label>
                Descrição da foto
                <input
                  value={editing.alt}
                  required
                  maxLength={300}
                  onChange={(event) => setEditing({ ...editing, alt: event.target.value })}
                />
              </label>
              <label>
                Posição da foto
                <input
                  type="number"
                  min={1}
                  max={12}
                  step={1}
                  value={editing.position}
                  required
                  onChange={(event) => setEditing({ ...editing, position: event.target.value })}
                />
              </label>
              <div className="products-actions">
                <Button type="submit" loading={busy}>
                  Salvar foto
                </Button>
                <Button variant="white" disabled={busy} onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
