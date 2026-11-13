'use client';

import { useState } from 'react';
import Image from 'next/image';
import { formatBRL, giftMessageSchema, type GiftWrapModel } from '@sparks/shared';

export interface CartGiftWrapProps {
  models: GiftWrapModel[];
  /** Escolha guardada na sessão (null = sem embalagem). */
  value: { productId: string; message: string } | null;
  onChange: (value: { productId: string; message: string } | null) => void;
  /** Avisa quando a mensagem digitada é inválida (não vai para a sessão). */
  onValidity: (invalid: boolean) => void;
}

const MESSAGE_MAX = 140;
const chars = (text: string) => Array.from(text);

export function CartGiftWrap({ models, value, onChange, onValidity }: CartGiftWrapProps) {
  // O texto digitado fica local (a sessão guarda a versão sem espaços nas pontas).
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  if (models.length === 0) return null;
  const message = draftMessage ?? value?.message ?? '';

  const toggle = (checked: boolean) => {
    setDraftMessage(null);
    onValidity(false);
    onChange(checked && models[0] ? { productId: models[0].id, message: '' } : null);
  };
  const choose = (productId: string) => onChange({ productId, message: value?.message ?? '' });
  const typeMessage = (raw: string) => {
    const text = chars(raw).slice(0, MESSAGE_MAX).join('');
    setDraftMessage(text);
    const parsed = giftMessageSchema.safeParse(text);
    onValidity(!parsed.success);
    if (parsed.success && value) onChange({ productId: value.productId, message: parsed.data });
  };
  const invalid = value !== null && !giftMessageSchema.safeParse(message).success;

  return (
    <section className="cart-section" aria-labelledby="cart-gift-title">
      <h3 id="cart-gift-title" className="cart-title">
        Presente
      </h3>
      <label className="cart-check">
        <input
          type="checkbox"
          checked={value !== null}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>Embalagem de presente</span>
      </label>
      {value && (
        <>
          <fieldset className="cart-radios">
            <legend className="cart-visually-hidden">Modelo da embalagem</legend>
            {models.map((model) => (
              <label key={model.id} className="cart-radio">
                <input
                  type="radio"
                  name="cart-gift-model"
                  checked={value.productId === model.id}
                  onChange={() => choose(model.id)}
                />
                {model.photo && (
                  <Image
                    src={model.photo.url}
                    alt={model.photo.alt}
                    width={40}
                    height={40}
                    className="cart-gift-photo"
                  />
                )}
                <span className="cart-radio-text">{model.name}</span>
                <strong>{formatBRL(model.priceCents)}</strong>
              </label>
            ))}
          </fieldset>
          <label className="cart-label" htmlFor="cart-gift-message">
            Mensagem do cartão
          </label>
          <textarea
            id="cart-gift-message"
            className="cart-field"
            rows={3}
            value={message}
            aria-invalid={invalid || undefined}
            aria-describedby="cart-gift-count"
            onChange={(e) => typeMessage(e.target.value)}
          />
          <p id="cart-gift-count" className="cart-count">
            {chars(message).length}/{MESSAGE_MAX}
          </p>
          {invalid && (
            <p className="cart-error" role="alert">
              A mensagem tem caracteres inválidos.
            </p>
          )}
        </>
      )}
    </section>
  );
}
