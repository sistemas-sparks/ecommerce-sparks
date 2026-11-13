'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OrderView } from '@sparks/shared';
import { Turnstile } from '@/app/admin/_components/turnstile';
import { ApiError } from '@/lib/api';
import { publicConfig } from '@/lib/public-config';
import { Button } from '@/ui';
import { lookupOrder } from '../../pedido/_lib/api';
import { OrderDetails, ORDER_HEADING_ID } from '../../pedido/_components/order-details';
import { validateLookup, type LookupErrors } from '../_lib/lookup-logic';

export function LookupForm() {
  const [code, setCode] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [errors, setErrors] = useState<LookupErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<OrderView | null>(null);
  // Turnstile: um token vale uma consulta (R3.6).
  const canCall = Boolean(publicConfig.apiUrl && publicConfig.turnstileSiteKey);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const resultShown = useRef(false);

  useEffect(() => {
    if (order && !resultShown.current) {
      resultShown.current = true;
      document.getElementById(ORDER_HEADING_ID)?.focus();
    }
    if (!order) resultShown.current = false;
  }, [order]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setServerError(null);
    const found = validateLookup(code, whatsapp);
    setErrors(found);
    if (found.code) return document.getElementById('lookup-code')?.focus();
    if (found.whatsapp) return document.getElementById('lookup-whatsapp')?.focus();
    const turnstileToken = token;
    if (!turnstileToken) return;
    setToken(null);
    setResetKey((k) => k + 1);
    setBusy(true);
    try {
      setOrder(await lookupOrder({ code, whatsapp, turnstileToken }));
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : 'Não foi possível consultar o pedido agora.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (order) {
    return (
      <OrderDetails order={order}>
        <Button
          variant="plum"
          onClick={() => {
            setOrder(null);
            setWhatsapp('');
          }}
        >
          Consultar outro pedido
        </Button>
      </OrderDetails>
    );
  }

  return (
    <form className="order-form" onSubmit={(e) => void submit(e)} noValidate>
      <div className="order-field">
        <label htmlFor="lookup-code">Código do pedido</label>
        <input
          id="lookup-code"
          className="order-input"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            if (errors.code) setErrors((prev) => ({ ...prev, code: undefined }));
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          aria-invalid={errors.code ? true : undefined}
          aria-describedby={errors.code ? 'lookup-code-error' : 'lookup-code-hint'}
        />
        <p id="lookup-code-hint" className="order-hint">
          Começa com SPK, por exemplo SPK-7F3K2. Está na confirmação do pedido.
        </p>
        {errors.code ? (
          <p id="lookup-code-error" className="order-field-error">
            {errors.code}
          </p>
        ) : null}
      </div>

      <div className="order-field">
        <label htmlFor="lookup-whatsapp">WhatsApp usado na compra</label>
        <input
          id="lookup-whatsapp"
          className="order-input"
          value={whatsapp}
          onChange={(e) => {
            setWhatsapp(e.target.value);
            if (errors.whatsapp) setErrors((prev) => ({ ...prev, whatsapp: undefined }));
          }}
          autoComplete="tel-national"
          inputMode="tel"
          maxLength={20}
          aria-invalid={errors.whatsapp ? true : undefined}
          aria-describedby={errors.whatsapp ? 'lookup-whatsapp-error' : undefined}
        />
        {errors.whatsapp ? (
          <p id="lookup-whatsapp-error" className="order-field-error">
            {errors.whatsapp}
          </p>
        ) : null}
      </div>

      {canCall ? (
        <div className="order-turnstile">
          <Turnstile
            siteKey={publicConfig.turnstileSiteKey}
            onToken={setToken}
            resetKey={resetKey}
          />
        </div>
      ) : (
        <p className="order-error" role="alert">
          A consulta está indisponível no momento. Tente de novo mais tarde.
        </p>
      )}

      {serverError ? (
        <p className="order-error" role="alert">
          {serverError}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={busy} disabled={!canCall || !token}>
          Consultar pedido
        </Button>
        {canCall && !token && !busy ? (
          <p className="order-hint" role="status">
            Aguarde a verificação de segurança para consultar.
          </p>
        ) : null}
      </div>
    </form>
  );
}
