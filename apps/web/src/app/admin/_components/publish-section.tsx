'use client';

// T-010 · "Publicar alterações": gera uma nova versão do site estático com o catálogo atual.
import { type PublishStatus, publishResultSchema, publishStatusSchema } from '@sparks/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { Button } from '@/ui';
import { useAdmin } from '../_lib/admin-context';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatWhen(iso: string): string {
  return dateTime.format(new Date(iso)).replace(',', ' às');
}

type Feedback = { kind: 'ok' | 'error'; text: string } | null;

export function PublishSection() {
  const { getAccessToken } = useAdmin();
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [publishing, setPublishing] = useState(false);

  const loadStatus = useCallback(async (): Promise<PublishStatus | null> => {
    try {
      const body = await apiFetch('/admin/publish', { token: await getAccessToken() });
      return publishStatusSchema.parse(body);
    } catch {
      return null;
    }
  }, [getAccessToken]);

  useEffect(() => {
    let active = true;
    void loadStatus().then((result) => {
      if (active) setStatus(result);
    });
    return () => {
      active = false;
    };
  }, [loadStatus]);

  async function publish() {
    setPublishing(true);
    setFeedback(null);
    try {
      const body = await apiFetch('/admin/publish', {
        method: 'POST',
        token: await getAccessToken(),
      });
      publishResultSchema.parse(body);
      setFeedback({ kind: 'ok', text: 'Publicação iniciada. O site atualiza em alguns minutos.' });
      setStatus(await loadStatus());
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Não foi possível publicar agora.',
      });
    } finally {
      setPublishing(false);
    }
  }

  const notConfigured = status !== null && !status.configured;

  return (
    <section aria-labelledby="publicar" className="mt-10 border-t-2 border-line pt-8">
      <h2 id="publicar" className="font-display text-3xl leading-none font-extrabold text-plum">
        Publicar alterações
      </h2>
      <p className="mt-3 max-w-prose text-ink-soft">
        Leva para o site as mudanças em produtos, preços, fotos e categorias.
      </p>
      {status?.lastPublishedAt && (
        <p className="mt-2 text-ink">Última publicação: {formatWhen(status.lastPublishedAt)}.</p>
      )}
      {notConfigured && (
        <p className="mt-2 text-ink">A publicação automática ainda não foi configurada.</p>
      )}

      <Button
        className="mt-5"
        onClick={() => void publish()}
        loading={publishing}
        disabled={notConfigured}
      >
        Publicar alterações
      </Button>

      {feedback && (
        <p
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`mt-4 font-bold ${feedback.kind === 'error' ? 'text-magenta-dark' : 'text-ink'}`}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}
