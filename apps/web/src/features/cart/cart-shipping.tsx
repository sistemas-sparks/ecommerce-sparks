'use client';

import { formatBRL } from '@sparks/shared';
import { Button } from '@/ui';
import { formatDays } from '@sparks/shared';

export interface ShippingOptionView {
  service: string;
  carrier: string | null;
  label: string;
  priceCents: number;
  daysMin: number;
  daysMax: number;
}

export type QuoteView =
  | { kind: 'options'; options: ShippingOptionView[] }
  | { kind: 'consult'; message: string }
  | { kind: 'message'; message: string };

export type AddressType = 'urban' | 'rural' | 'hard_access';

const ADDRESS_LABELS: Record<AddressType, string> = {
  urban: 'Cidade',
  rural: 'Zona rural',
  hard_access: 'Difícil acesso',
};

export interface CartShippingProps {
  cepText: string;
  addressType: AddressType;
  onCep: (text: string) => void;
  onAddressType: (value: AddressType) => void;
  onCalculate: () => void;
  disabled: boolean;
  busy: boolean;
  waitingToken: boolean;
  /** Resultado da última cotação (null = nenhuma ou invalidada). */
  quote: QuoteView | null;
  /** Mostrar "Calcule o frete de novo." */
  outdated: boolean;
  selectedService: string | null;
  onSelect: (option: ShippingOptionView) => void;
  error: string | null;
}

export function CartShipping({
  cepText,
  addressType,
  onCep,
  onAddressType,
  onCalculate,
  disabled,
  busy,
  waitingToken,
  quote,
  outdated,
  selectedService,
  onSelect,
  error,
}: CartShippingProps) {
  return (
    <section className="cart-section" aria-labelledby="cart-shipping-title" aria-busy={busy}>
      <h3 id="cart-shipping-title" className="cart-title">
        Frete
      </h3>
      <form
        className="cart-shipping-form"
        onSubmit={(e) => {
          e.preventDefault();
          onCalculate();
        }}
      >
        <div>
          <label className="cart-label" htmlFor="cart-cep">
            CEP
          </label>
          <input
            id="cart-cep"
            className="cart-field"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            maxLength={9}
            value={cepText}
            onChange={(e) => onCep(e.target.value)}
          />
        </div>
        <div>
          <label className="cart-label" htmlFor="cart-address-type">
            Tipo de endereço
          </label>
          <select
            id="cart-address-type"
            className="cart-field"
            value={addressType}
            onChange={(e) => onAddressType(e.target.value as AddressType)}
          >
            {(Object.keys(ADDRESS_LABELS) as AddressType[]).map((key) => (
              <option key={key} value={key}>
                {ADDRESS_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="plum" loading={busy} disabled={disabled}>
          {waitingToken && !busy ? 'Verificando...' : 'Calcular frete'}
        </Button>
      </form>

      {outdated && !quote && <p className="cart-hint">Calcule o frete de novo.</p>}
      {error && (
        <p className="cart-error" role="alert">
          {error}
        </p>
      )}

      {quote?.kind === 'options' && (
        <fieldset className="cart-radios">
          <legend className="cart-visually-hidden">Opções de frete</legend>
          {quote.options.map((option) => (
            <label key={option.service} className="cart-radio">
              <input
                type="radio"
                name="cart-shipping-option"
                checked={selectedService === option.service}
                onChange={() => onSelect(option)}
              />
              <span className="cart-radio-text">
                {option.label}
                <small>
                  {option.carrier ? `${option.carrier} · ` : ''}
                  {formatDays(option.daysMin, option.daysMax)}
                </small>
              </span>
              <strong>{option.priceCents === 0 ? 'Grátis' : formatBRL(option.priceCents)}</strong>
            </label>
          ))}
        </fieldset>
      )}
      {quote?.kind === 'consult' && (
        <p className="cart-note">
          <strong>Frete a combinar.</strong> {quote.message}
        </p>
      )}
      {quote?.kind === 'message' && (
        <p className="cart-error" role="alert">
          {quote.message}
        </p>
      )}
    </section>
  );
}
