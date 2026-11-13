'use client';

import { useId, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { UFS, maskCep } from '@sparks/shared';
import { Turnstile } from '@/app/admin/_components/turnstile';
import { errorMessage } from '@/features/cart/cart-local';
import { ApiError } from '@/lib/api';
import { publicConfig } from '@/lib/public-config';
import { Button } from '@/ui';
import { submitCheckout } from './api';
import {
  ADDRESS_TYPE_LABELS,
  EMPTY_FORM,
  buildCheckoutRequest,
  errorNeedsBag,
  firstInvalidField,
  maskWhatsapp,
  validateForm,
  type CheckoutOutcome,
  type FieldErrors,
  type FieldName,
  type FormValues,
} from './checkout-logic';
import { CheckoutReview } from './checkout-review';
import type { CheckoutCart } from './use-checkout-cart';

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email';
  type?: 'text' | 'email' | 'tel';
  maxLength?: number;
  disabled?: boolean;
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  optional,
  autoComplete,
  inputMode,
  type = 'text',
  maxLength,
  disabled,
}: FieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="checkout-field">
      <label htmlFor={id}>
        {label}
        {optional ? <span className="checkout-optional"> (opcional)</span> : null}
      </label>
      <input
        id={id}
        className="checkout-input"
        type={type}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? (
        <p id={hintId} className="checkout-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="checkout-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section className="checkout-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="checkout-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

export interface CheckoutFormProps {
  cart: CheckoutCart;
  /** Pedido criado: a página limpa a sacola e mostra a confirmação ou abre o pagamento. */
  onDone: (outcome: CheckoutOutcome) => void;
}

export function CheckoutForm({ cart, onDone }: CheckoutFormProps) {
  const { session, shipping, view, coupon, chosenModel, draft } = cart;
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<{ message: string; needsBag: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  // Turnstile: um token vale uma chamada (R3.6).
  const canCall = Boolean(publicConfig.apiUrl && publicConfig.turnstileSiteKey);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  if (!shipping) return null;
  const consult = shipping.mode === 'consult';

  const set = (field: FieldName) => (value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setServerError(null);
    const result = validateForm(values, session.cep, session.addressType);
    if (!result.ok) {
      setErrors(result.errors);
      const first = firstInvalidField(result.errors);
      if (first && first !== 'cep') document.getElementById(`checkout-${first}`)?.focus();
      return;
    }
    setErrors({});
    const turnstileToken = token;
    if (!turnstileToken) return;
    setToken(null);
    setResetKey((k) => k + 1);
    setBusy(true);
    try {
      const outcome = await submitCheckout(
        buildCheckoutRequest({
          draft,
          session,
          couponCode: coupon?.code ?? null,
          customer: result.customer,
          address: result.address,
          turnstileToken,
        }),
      );
      onDone(outcome);
    } catch (error) {
      setServerError({
        message: errorMessage(error),
        needsBag: error instanceof ApiError && errorNeedsBag(error.code),
      });
      setBusy(false);
    }
  };

  const hasErrors = Object.values(errors).some(Boolean);
  const waitingToken = canCall && !token && !busy;
  const submitDisabled = !canCall || !token || busy;

  return (
    <form className="checkout-layout" onSubmit={submit} noValidate aria-busy={busy}>
      <div className="checkout-main">
        <Section title="Seus dados">
          <Field
            id="checkout-name"
            label="Nome completo"
            value={values.name}
            onChange={set('name')}
            error={errors.name}
            autoComplete="name"
            maxLength={80}
          />
          <Field
            id="checkout-whatsapp"
            label="WhatsApp"
            type="tel"
            value={values.whatsapp}
            onChange={(v) => set('whatsapp')(maskWhatsapp(v))}
            error={errors.whatsapp}
            hint="Com DDD. A loja entra em contato por este número sobre o pedido."
            autoComplete="tel-national"
            inputMode="tel"
            maxLength={16}
          />
          <Field
            id="checkout-email"
            label="E-mail"
            type="email"
            optional
            value={values.email}
            onChange={set('email')}
            error={errors.email}
            autoComplete="email"
            inputMode="email"
            maxLength={254}
          />
        </Section>

        <Section title="Entrega">
          <div className="checkout-destination">
            <dl>
              <div>
                <dt>CEP</dt>
                <dd>{maskCep(session.cep)}</dd>
              </div>
              <div>
                <dt>Tipo de endereço</dt>
                <dd>{ADDRESS_TYPE_LABELS[session.addressType]}</dd>
              </div>
            </dl>
            <Link href="/sacola/" className="checkout-link">
              Alterar na sacola
            </Link>
          </div>
          {errors.cep ? (
            <p className="checkout-field-error" role="alert">
              {errors.cep} Volte à sacola para corrigir.
            </p>
          ) : null}
          <Field
            id="checkout-street"
            label="Rua ou estrada"
            value={values.street}
            onChange={set('street')}
            error={errors.street}
            autoComplete="address-line1"
            maxLength={120}
          />
          <div className="checkout-pair">
            <Field
              id="checkout-number"
              label="Número"
              value={values.number}
              onChange={set('number')}
              error={errors.number}
              hint="Sem número? Escreva S/N."
              autoComplete="off"
              maxLength={20}
            />
            <Field
              id="checkout-complement"
              label="Complemento"
              optional
              value={values.complement}
              onChange={set('complement')}
              error={errors.complement}
              autoComplete="address-line2"
              maxLength={60}
            />
          </div>
          <Field
            id="checkout-district"
            label="Bairro ou localidade"
            value={values.district}
            onChange={set('district')}
            error={errors.district}
            autoComplete="address-level3"
            maxLength={80}
          />
          <div className="checkout-pair checkout-pair-city">
            <Field
              id="checkout-city"
              label="Cidade"
              value={values.city}
              onChange={set('city')}
              error={errors.city}
              autoComplete="address-level2"
              maxLength={80}
            />
            <div className="checkout-field">
              <label htmlFor="checkout-uf">Estado</label>
              <select
                id="checkout-uf"
                className="checkout-input"
                value={values.uf}
                onChange={(e) => set('uf')(e.target.value)}
                autoComplete="address-level1"
                aria-invalid={errors.uf ? true : undefined}
                aria-describedby={errors.uf ? 'checkout-uf-error' : undefined}
              >
                <option value="">UF</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
              {errors.uf ? (
                <p id="checkout-uf-error" className="checkout-field-error">
                  {errors.uf}
                </p>
              ) : null}
            </div>
          </div>
          <Field
            id="checkout-reference"
            label="Ponto de referência"
            optional
            value={values.reference}
            onChange={set('reference')}
            error={errors.reference}
            hint={
              session.addressType === 'urban'
                ? undefined
                : 'Ajuda a loja a combinar a entrega. Ex.: porteira azul, ao lado da igreja.'
            }
            maxLength={120}
          />
        </Section>
      </div>

      <aside className="checkout-summary" aria-labelledby="checkout-summary-title">
        <h2 id="checkout-summary-title" className="checkout-title">
          Resumo do pedido
        </h2>
        <CheckoutReview
          view={view}
          shipping={shipping}
          couponCode={coupon?.code ?? null}
          giftWrapName={chosenModel?.name ?? null}
          giftMessage={session.giftWrap?.message || null}
        />
        <p className="checkout-muted">
          <Link href="/sacola/" className="checkout-link">
            Alterar itens na sacola
          </Link>
        </p>

        {consult ? (
          <p className="checkout-note">
            <strong>Nada será cobrado agora.</strong> {shipping.message} A cobrança só acontece
            depois que a loja confirmar o frete com você pelo WhatsApp.
          </p>
        ) : (
          <p className="checkout-hint">
            Você paga por Pix ou cartão no ambiente seguro do Mercado Pago. O valor final é
            confirmado pelo servidor ao criar o pedido.
          </p>
        )}

        {canCall ? (
          <div className="checkout-turnstile">
            <Turnstile
              siteKey={publicConfig.turnstileSiteKey}
              onToken={setToken}
              resetKey={resetKey}
            />
          </div>
        ) : (
          <p className="checkout-field-error" role="alert">
            Finalizar compra indisponível no momento. Tente de novo mais tarde.
          </p>
        )}

        {hasErrors ? (
          <p className="checkout-field-error" role="alert">
            Confira os campos destacados.
          </p>
        ) : null}
        {serverError ? (
          <p className="checkout-field-error" role="alert">
            {serverError.message}{' '}
            {serverError.needsBag ? (
              <Link href="/sacola/" className="checkout-link">
                Voltar à sacola
              </Link>
            ) : null}
          </p>
        ) : null}

        <Button type="submit" loading={busy} disabled={submitDisabled}>
          {consult ? 'Enviar pedido' : 'Ir para o pagamento'}
        </Button>
        {waitingToken ? (
          <p className="checkout-hint" role="status">
            Aguardando a verificação de segurança.
          </p>
        ) : null}
      </aside>
    </form>
  );
}
