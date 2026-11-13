'use client';

import {
  MAX_QUOTE_DAYS,
  MAX_QUOTE_SHIPPING_CENTS,
  formatBRL,
  type AdminOrderDetail,
} from '@sparks/shared';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { Button } from '@/ui';
import { previewTotal, reaisToCents } from './logic';
import { releaseQuote } from './orders-api';

interface Props {
  order: AdminOrderDetail;
  getToken: () => Promise<string>;
  onDone: (order: AdminOrderDetail) => void;
}

/**
 * Frete a combinar (frete.md §7): a lojista informa valor e prazo. O total mostrado aqui é só
 * uma prévia; o servidor recalcula com os dados gravados do pedido, cria o link de pagamento
 * (48 horas) e só então libera a cobrança.
 */
export function QuoteForm({ order, getToken, onDone }: Props) {
  const [price, setPrice] = useState('');
  const [daysMin, setDaysMin] = useState('');
  const [daysMax, setDaysMax] = useState('');
  const [label, setLabel] = useState('');
  const [carrier, setCarrier] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function parse() {
    const next: Record<string, string> = {};
    const shippingCents = reaisToCents(price);
    if (shippingCents === null) next.price = 'Informe o valor do frete, ex.: 35,90.';
    else if (shippingCents > MAX_QUOTE_SHIPPING_CENTS) {
      next.price = 'Esse valor de frete parece alto demais. Confira.';
    }
    const min = /^\d{1,2}$/.test(daysMin) ? Number(daysMin) : null;
    const max = /^\d{1,2}$/.test(daysMax) ? Number(daysMax) : null;
    if (min === null || min > MAX_QUOTE_DAYS) next.daysMin = 'Informe os dias úteis.';
    if (max === null || max > MAX_QUOTE_DAYS) next.daysMax = 'Informe os dias úteis.';
    if (min !== null && max !== null && max < min)
      next.daysMax = 'Não pode ser menor que o mínimo.';
    setErrors(next);
    if (Object.keys(next).length > 0 || shippingCents === null || min === null || max === null) {
      return null;
    }
    return { shippingCents, daysMin: min, daysMax: max };
  }

  function review(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (parse()) setConfirming(true);
  }

  async function release() {
    const values = parse();
    if (!values) return setConfirming(false);
    setBusy(true);
    setError('');
    try {
      const updated = await releaseQuote(await getToken(), order.id, {
        ...values,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(carrier.trim() ? { carrier: carrier.trim() } : {}),
      });
      onDone(updated);
    } catch (err) {
      setConfirming(false);
      setError(err instanceof ApiError ? err.message : 'Não foi possível liberar a cobrança.');
    } finally {
      setBusy(false);
    }
  }

  const cents = reaisToCents(price);
  const total = cents === null ? null : previewTotal(order, cents);

  return (
    <section aria-labelledby="orders-quote" className="orders-section">
      <h2 id="orders-quote">Frete a combinar</h2>
      <p>Nada foi cobrado. Informe o frete para liberar o pagamento por 48 horas.</p>
      <form onSubmit={review} noValidate>
        <div className="orders-fields">
          <label className="orders-field">
            Valor do frete (R$)
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-invalid={Boolean(errors.price)}
              aria-describedby={errors.price ? 'quote-price-error' : undefined}
              autoComplete="off"
            />
            {errors.price && (
              <span id="quote-price-error" className="orders-error">
                {errors.price}
              </span>
            )}
          </label>
          <label className="orders-field">
            Prazo mínimo (dias úteis)
            <input
              inputMode="numeric"
              value={daysMin}
              onChange={(e) => setDaysMin(e.target.value)}
              aria-invalid={Boolean(errors.daysMin)}
              aria-describedby={errors.daysMin ? 'quote-min-error' : undefined}
              autoComplete="off"
            />
            {errors.daysMin && (
              <span id="quote-min-error" className="orders-error">
                {errors.daysMin}
              </span>
            )}
          </label>
          <label className="orders-field">
            Prazo máximo (dias úteis)
            <input
              inputMode="numeric"
              value={daysMax}
              onChange={(e) => setDaysMax(e.target.value)}
              aria-invalid={Boolean(errors.daysMax)}
              aria-describedby={errors.daysMax ? 'quote-max-error' : undefined}
              autoComplete="off"
            />
            {errors.daysMax && (
              <span id="quote-max-error" className="orders-error">
                {errors.daysMax}
              </span>
            )}
          </label>
          <label className="orders-field">
            Serviço (opcional)
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </label>
          <label className="orders-field">
            Transportadora (opcional)
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} maxLength={100} />
          </label>
        </div>
        {total !== null && (
          <p className="orders-total-preview">Total estimado: {formatBRL(total)}</p>
        )}
        {error && (
          <p role="alert" className="orders-error">
            {error}
          </p>
        )}
        {confirming && total !== null ? (
          <div className="orders-actions">
            <p className="orders-confirm">
              Liberar a cobrança de {formatBRL(total)} (frete {formatBRL(cents ?? 0)})?
            </p>
            <Button loading={busy} onClick={() => void release()}>
              Sim, liberar
            </Button>
            <Button variant="white" disabled={busy} onClick={() => setConfirming(false)}>
              Voltar
            </Button>
          </div>
        ) : (
          <div className="orders-actions">
            <Button type="submit">Liberar cobrança</Button>
          </div>
        )}
      </form>
    </section>
  );
}
