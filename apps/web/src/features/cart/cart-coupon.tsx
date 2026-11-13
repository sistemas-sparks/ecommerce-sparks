'use client';

import { useState } from 'react';
import { formatBRL } from '@sparks/shared';
import { Button } from '@/ui';

export interface CartCouponProps {
  /** Cupom aplicado e válido para a sacola atual. */
  appliedCode: string | null;
  discountCents: number;
  /** O cupom foi validado para outra versão da sacola. */
  stale: boolean;
  /** "Aplicar" bloqueado: sem token, chamada em andamento ou serviço indisponível. */
  disabled: boolean;
  busy: boolean;
  waitingToken: boolean;
  error: string | null;
  onApply: (code: string) => void;
  onRemove: () => void;
}

export function CartCoupon({
  appliedCode,
  discountCents,
  stale,
  disabled,
  busy,
  waitingToken,
  error,
  onApply,
  onRemove,
}: CartCouponProps) {
  const [code, setCode] = useState('');
  return (
    <section className="cart-section" aria-labelledby="cart-coupon-title">
      <h3 id="cart-coupon-title" className="cart-title">
        Cupom
      </h3>
      {appliedCode ? (
        <div className="cart-applied">
          <p>
            <strong>{appliedCode}</strong>: desconto de {formatBRL(discountCents)}
          </p>
          <button type="button" className="cart-link-button" onClick={onRemove}>
            Remover
          </button>
        </div>
      ) : (
        <form
          className="cart-row"
          onSubmit={(e) => {
            e.preventDefault();
            onApply(code);
          }}
        >
          <label className="cart-visually-hidden" htmlFor="cart-coupon-input">
            Código do cupom
          </label>
          <input
            id="cart-coupon-input"
            className="cart-field"
            value={code}
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={20}
            placeholder="Código do cupom"
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" variant="plum" loading={busy} disabled={disabled || !code.trim()}>
            {waitingToken && !busy ? 'Verificando...' : 'Aplicar'}
          </Button>
        </form>
      )}
      {stale && !appliedCode && (
        <p className="cart-hint">A sacola mudou. Aplique o cupom de novo.</p>
      )}
      {error && (
        <p className="cart-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
