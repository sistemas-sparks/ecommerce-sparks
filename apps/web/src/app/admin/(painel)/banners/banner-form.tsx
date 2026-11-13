'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  bannerCreateSchema,
  bannerUploadResponseSchema,
  productUploadInputSchema,
  type AdminBanner,
} from '@sparks/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { getSupabase } from '@/lib/supabase';
import { Button } from '@/ui';
import { isoToLocalInput, localInputToIso } from '../cupons/format';
import { prepareBannerImages } from './image';

type Values = { alt: string; href: string; startsAt: string; endsAt: string; active: boolean };
type Field = keyof Values | 'file' | 'general';
type Errors = Partial<Record<Field, string>>;

// Só para conferir os campos antes de enviar a imagem; o id verdadeiro vem do envio.
const PLACEHOLDER_IMAGE_ID = '00000000-0000-4000-8000-000000000000';

function initial(banner: AdminBanner | null): Values {
  return banner
    ? {
        alt: banner.alt,
        href: banner.href,
        startsAt: isoToLocalInput(banner.startsAt),
        endsAt: isoToLocalInput(banner.endsAt),
        active: banner.active,
      }
    : { alt: '', href: '', startsAt: '', endsAt: '', active: true };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

export function BannerForm({
  banner,
  getToken,
  onSaved,
  onCancel,
}: {
  banner: AdminBanner | null;
  getToken: () => Promise<string>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Values>(() => initial(banner));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  // Prévia por data: URL (a CSP do site não libera blob:).
  useEffect(() => {
    if (!file) return;
    let active = true;
    void readAsDataUrl(file)
      .then((url) => active && setPreview(url))
      .catch(() => active && setPreview(null));
    return () => {
      active = false;
    };
  }, [file]);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    const startsAt = localInputToIso(values.startsAt);
    const endsAt = localInputToIso(values.endsAt);
    if (values.startsAt && !startsAt) next.startsAt = 'Data de início inválida.';
    if (values.endsAt && !endsAt) next.endsAt = 'Data de fim inválida.';
    if (!banner && !file) next.file = 'Escolha a imagem do banner.';
    if (file) {
      const accepted = productUploadInputSchema.safeParse({ type: file.type, size: file.size });
      if (!accepted.success) next.file = 'Use uma imagem JPEG, PNG ou WebP com até 5 MB.';
    }
    const fields = {
      alt: values.alt,
      href: values.href,
      startsAt,
      endsAt,
      active: values.active,
    };
    const parsed = bannerCreateSchema.safeParse({ ...fields, imageId: PLACEHOLDER_IMAGE_ID });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'alt' || key === 'href' || key === 'startsAt' || key === 'endsAt')
          next[key] ??= issue.message;
      }
    }
    if (Object.keys(next).length > 0 || !parsed.success) {
      setErrors(next);
      return;
    }

    setSaving(true);
    setErrors({});
    try {
      let imageId: string | undefined;
      if (file) {
        const supabase = getSupabase();
        if (!supabase) throw new Error('Confira a configuração do painel antes de enviar imagens.');
        const variants = await prepareBannerImages(file);
        const signed = bannerUploadResponseSchema.parse(
          await apiFetch('/admin/banners/upload', {
            method: 'POST',
            token: await getToken(),
            body: JSON.stringify({ type: file.type, size: file.size }),
          }),
        );
        for (const variant of variants) {
          const target = signed.files.find((row) => row.width === variant.width);
          if (!target || target.path !== `banners/${signed.imageId}/${variant.width}.webp`)
            throw new Error('Não foi possível preparar o destino da imagem.');
          const { error } = await supabase.storage
            .from('products')
            .uploadToSignedUrl(target.path, target.token, variant.blob, {
              contentType: 'image/webp',
              cacheControl: '31536000',
            });
          if (error) throw new Error('O envio da imagem falhou. Tente de novo.');
        }
        imageId = signed.imageId;
      }
      const body = banner
        ? { ...parsed.data, imageId, expectedUpdatedAt: banner.updatedAt }
        : { ...parsed.data, imageId };
      await apiFetch(banner ? `/admin/banners/${banner.id}` : '/admin/banners', {
        method: banner ? 'PATCH' : 'POST',
        token: await getToken(),
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setErrors({
        general:
          err instanceof ApiError || (err instanceof Error && err.name !== 'ZodError')
            ? err.message
            : 'Não foi possível salvar o banner. Confira os campos e tente de novo.',
      });
    } finally {
      setSaving(false);
    }
  }

  const shown = preview ?? banner?.imageUrl ?? null;
  const fieldError = (key: Field) =>
    errors[key] ? (
      <span id={`banner-${key}-erro`} className="content-error">
        {errors[key]}
      </span>
    ) : null;
  const describedBy = (key: Field) => (errors[key] ? `banner-${key}-erro` : undefined);

  return (
    <form className="content-form" onSubmit={(event) => void submit(event)} noValidate>
      <h2>{banner ? 'Editar banner' : 'Novo banner'}</h2>
      {errors.general && (
        <p role="alert" className="content-error">
          {errors.general}
        </p>
      )}
      <div className="content-fields">
        <div className="content-field content-field-wide">
          <label htmlFor="banner-file">{banner ? 'Trocar a imagem (opcional)' : 'Imagem'}</label>
          <input
            id="banner-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={saving}
            aria-invalid={Boolean(errors.file)}
            aria-describedby={`banner-file-dica ${describedBy('file') ?? ''}`.trim()}
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              setFile(chosen);
              if (!chosen) setPreview(null);
            }}
          />
          <span id="banner-file-dica" className="content-hint">
            Imagem larga, na proporção 2:1 (por exemplo 1600 × 800 px), com o texto já dentro dela.
            Outras proporções são cortadas no centro. JPEG, PNG ou WebP, até 5 MB.
          </span>
          {fieldError('file')}
          {shown && (
            // Prévia local (data: URL) ou imagem já publicada; não passa pelo otimizador do Next.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="content-preview" src={shown} alt="" width={480} height={240} />
          )}
        </div>
        <div className="content-field content-field-wide">
          <label htmlFor="banner-alt">Texto alternativo (obrigatório)</label>
          <input
            id="banner-alt"
            value={values.alt}
            maxLength={300}
            required
            disabled={saving}
            aria-invalid={Boolean(errors.alt)}
            aria-describedby={`banner-alt-dica ${describedBy('alt') ?? ''}`.trim()}
            onChange={(event) => set('alt', event.target.value)}
          />
          <span id="banner-alt-dica" className="content-hint">
            Descreva o que a imagem mostra e diz, para quem não consegue vê-la.
          </span>
          {fieldError('alt')}
        </div>
        <div className="content-field content-field-wide">
          <label htmlFor="banner-href">Para onde o banner leva</label>
          <input
            id="banner-href"
            value={values.href}
            maxLength={2048}
            required
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            disabled={saving}
            aria-invalid={Boolean(errors.href)}
            aria-describedby={`banner-href-dica ${describedBy('href') ?? ''}`.trim()}
            onChange={(event) => set('href', event.target.value)}
          />
          <span id="banner-href-dica" className="content-hint">
            Um caminho da loja, como /busca/?q=caderno, ou um endereço que comece com https://
          </span>
          {fieldError('href')}
        </div>
        <div className="content-field">
          <label htmlFor="banner-start">Início (opcional)</label>
          <input
            id="banner-start"
            type="datetime-local"
            value={values.startsAt}
            disabled={saving}
            aria-invalid={Boolean(errors.startsAt)}
            aria-describedby={describedBy('startsAt')}
            onChange={(event) => set('startsAt', event.target.value)}
          />
          {fieldError('startsAt')}
        </div>
        <div className="content-field">
          <label htmlFor="banner-end">Fim (opcional)</label>
          <input
            id="banner-end"
            type="datetime-local"
            value={values.endsAt}
            disabled={saving}
            aria-invalid={Boolean(errors.endsAt)}
            aria-describedby={describedBy('endsAt')}
            onChange={(event) => set('endsAt', event.target.value)}
          />
          {fieldError('endsAt')}
        </div>
      </div>
      <label className="content-check">
        <input
          type="checkbox"
          checked={values.active}
          disabled={saving}
          onChange={(event) => set('active', event.target.checked)}
        />
        Banner ativo
      </label>
      <div className="content-actions">
        <Button type="submit" loading={saving}>
          {saving ? 'Salvando…' : 'Salvar banner'}
        </Button>
        <Button variant="white" disabled={saving} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
