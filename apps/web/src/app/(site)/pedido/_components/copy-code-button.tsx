'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Copia o código de rastreio. Se o navegador não deixar copiar, o código continua visível na tela
 * para a pessoa copiar à mão; nunca mostramos erro técnico.
 */
export function CopyCodeButton({ code }: { code: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 4000);
  }

  return (
    <>
      <button type="button" className="order-link" onClick={() => void copy()}>
        Copiar código
      </button>
      <span role="status" className="order-muted">
        {state === 'copied' ? ' Código copiado.' : ''}
        {state === 'failed' ? ' Não foi possível copiar. Selecione o código acima.' : ''}
      </span>
    </>
  );
}
