'use client';

import { useState, type FormEvent } from 'react';
import {
  couponAdminCreateSchema,
  couponAdminRowSchema,
  couponAdminUpdateSchema,
  parseBRLToCents,
  type CouponAdminRow,
  type CouponType,
} from '@sparks/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { Button } from '@/ui';
import { isoToLocalInput, localInputToIso } from './format';

type Values = {
  code: string;
  type: CouponType;
  value: string;
  minOrder: string;
  maxUses: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

// Centavos inteiros -> texto "12,50" sem passar por float.
function centsText(cents: number): string {
  const text = String(cents).padStart(3, '0');
  return `${text.slice(0, -2)},${text.slice(-2)}`;
}

function initialValues(coupon: CouponAdminRow | null): Values {
  if (!coupon) {
    return {
      code: '',
      type: 'percent',
      value: '',
      minOrder: '',
      maxUses: '',
      startsAt: '',
      endsAt: '',
      active: true,
    };
  }
  return {
    code: coupon.code,
    type: coupon.type,
    value: coupon.type === 'percent' ? String(coupon.value) : centsText(coupon.value),
    minOrder: coupon.minOrderCents ? centsText(coupon.minOrderCents) : '',
    maxUses: coupon.maxUses === null ? '' : String(coupon.maxUses),
    startsAt: isoToLocalInput(coupon.startsAt),
    endsAt: isoToLocalInput(coupon.endsAt),
    active: coupon.active,
  };
}

type Errors = Partial<Record<keyof Values | 'general', string>>;

// Converte os textos nos tipos do contrato. A API continua sendo quem decide.
function buildBody(values: Values): { body?: Record<string, unknown>; errors: Errors } {
  const errors: Errors = {};
  let value: number | null;
  if (values.type === 'percent') {
    value = /^\d{1,3}$/.test(values.value.trim()) ? Number(values.value.trim()) : null;
    if (value === null) errors.value = 'Informe um percentual inteiro de 1 a 100.';
  } else {
    value = parseBRLToCents(values.value);
    if (value === null) errors.value = 'Informe o valor em reais, por exemplo 10,00.';
  }

  let minOrderCents: number | null = null;
  if (values.minOrder.trim()) {
    minOrderCents = parseBRLToCents(values.minOrder);
    if (minOrderCents === null) errors.minOrder = 'Informe a compra mínima em reais.';
  }

  let maxUses: number | null = null;
  if (values.maxUses.trim()) {
    maxUses = /^\d{1,7}$/.test(values.maxUses.trim()) ? Number(values.maxUses.trim()) : null;
    if (maxUses === null) errors.maxUses = 'Informe um número inteiro de usos.';
  }

  const startsAt = localInputToIso(values.startsAt);
  if (values.startsAt && !startsAt) errors.startsAt = 'Data de início inválida.';
  const endsAt = localInputToIso(values.endsAt);
  if (values.endsAt && !endsAt) errors.endsAt = 'Data de fim inválida.';

  if (Object.keys(errors).length > 0) return { errors };
  return {
    body: {
      type: values.type,
      value,
      minOrderCents,
      maxUses,
      startsAt,
      endsAt,
      active: values.active,
    },
    errors,
  };
}

// Campos do schema -> campos da tela.
const FIELD_OF_PATH: Record<string, keyof Errors> = {
  code: 'code',
  type: 'type',
  value: 'value',
  minOrderCents: 'minOrder',
  maxUses: 'maxUses',
  startsAt: 'startsAt',
  endsAt: 'endsAt',
};

export function CouponForm({
  coupon,
  getToken,
  onSaved,
  onCancel,
}: {
  coupon: CouponAdminRow | null;
  getToken: () => Promise<string>;
  onSaved: (saved: CouponAdminRow) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Values>(() => initialValues(coupon));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const built = buildBody(values);
    if (!built.body) {
      setErrors(built.errors);
      return;
    }
    const payload = coupon ? built.body : { ...built.body, code: values.code.trim() };
    const check = (coupon ? couponAdminUpdateSchema : couponAdminCreateSchema).safeParse(payload);
    if (!check.success) {
      const next: Errors = {};
      for (const issue of check.error.issues) {
        const key = FIELD_OF_PATH[String(issue.path[0])] ?? 'general';
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const token = await getToken();
      const path = coupon ? `/admin/coupons/${coupon.id}` : '/admin/coupons';
      const saved = couponAdminRowSchema.parse(
        await apiFetch(path, {
          method: coupon ? 'PATCH' : 'POST',
          token,
          body: JSON.stringify(check.data),
        }),
      );
      onSaved(saved);
    } catch (err) {
      setErrors({
        general: err instanceof ApiError ? err.message : 'Não foi possível salvar o cupom.',
      });
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (key: keyof Errors) =>
    errors[key] ? (
      <span role="alert" className="coupons-error">
        {errors[key]}
      </span>
    ) : null;

  return (
    <form className="coupons-form" onSubmit={(event) => void submit(event)} noValidate>
      <h2>{coupon ? `Editar ${coupon.code}` : 'Novo cupom'}</h2>
      <p>O desconto vale só para os produtos. Frete e embalagem não entram.</p>
      <div className="coupons-fields">
        <label className="coupons-field">
          Código
          {coupon ? (
            <input type="text" value={coupon.code} readOnly />
          ) : (
            <input
              type="text"
              value={values.code}
              maxLength={20}
              autoComplete="off"
              autoCapitalize="characters"
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              aria-invalid={Boolean(errors.code)}
            />
          )}
          {fieldError('code')}
        </label>
        <label className="coupons-field">
          Tipo de desconto
          <select value={values.type} onChange={(e) => set('type', e.target.value as CouponType)}>
            <option value="percent">Percentual (%)</option>
            <option value="fixed">Valor fixo (R$)</option>
          </select>
        </label>
        <label className="coupons-field">
          {values.type === 'percent' ? 'Percentual (1 a 100)' : 'Valor do desconto (R$)'}
          <input
            type="text"
            inputMode={values.type === 'percent' ? 'numeric' : 'decimal'}
            autoComplete="off"
            value={values.value}
            onChange={(e) => set('value', e.target.value)}
            aria-invalid={Boolean(errors.value)}
          />
          {fieldError('value')}
        </label>
        <label className="coupons-field">
          Compra mínima (R$, opcional)
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={values.minOrder}
            onChange={(e) => set('minOrder', e.target.value)}
            aria-invalid={Boolean(errors.minOrder)}
          />
          {fieldError('minOrder')}
        </label>
        <label className="coupons-field">
          Limite de usos (opcional)
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={values.maxUses}
            onChange={(e) => set('maxUses', e.target.value)}
            aria-invalid={Boolean(errors.maxUses)}
          />
          {fieldError('maxUses')}
        </label>
        <label className="coupons-field">
          Início da validade (opcional)
          <input
            type="datetime-local"
            value={values.startsAt}
            onChange={(e) => set('startsAt', e.target.value)}
            aria-invalid={Boolean(errors.startsAt)}
          />
          {fieldError('startsAt')}
        </label>
        <label className="coupons-field">
          Fim da validade (opcional)
          <input
            type="datetime-local"
            value={values.endsAt}
            onChange={(e) => set('endsAt', e.target.value)}
            aria-invalid={Boolean(errors.endsAt)}
          />
          {fieldError('endsAt')}
        </label>
        <label className="coupons-check">
          <input
            type="checkbox"
            checked={values.active}
            onChange={(e) => set('active', e.target.checked)}
          />
          Cupom ativo
        </label>
      </div>
      {errors.general && (
        <p role="alert" className="coupons-error">
          {errors.general}
        </p>
      )}
      <div className="coupons-actions">
        <Button type="submit" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar cupom'}
        </Button>
        <Button type="button" variant="white" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
