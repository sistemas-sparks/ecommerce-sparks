'use client';

// Widget do Cloudflare Turnstile (R3.6). O token vai para o Supabase Auth (captchaToken),
// que confere no servidor quando a proteção CAPTCHA está ligada no projeto.
import { useEffect, useRef } from 'react';

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile'));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileProps {
  siteKey: string;
  /** Recebe o token novo, ou null quando ele expira ou falha. */
  onToken: (token: string | null) => void;
  /** Mude este número para pedir um token novo (ex.: depois de uma tentativa de login). */
  resetKey?: number;
}

export function Turnstile({ siteKey, onToken, resetKey = 0 }: TurnstileProps) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let canceled = false;
    loadTurnstile()
      .then((api) => {
        if (canceled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          language: 'pt-br',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      canceled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current) {
      window.turnstile?.reset(widgetId.current);
      onTokenRef.current(null);
    }
  }, [resetKey]);

  return <div ref={container} className="min-h-[65px]" />;
}
