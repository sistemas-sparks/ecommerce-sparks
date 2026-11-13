'use client';

// Formulários genéricos do painel de frete. Dinheiro: texto em reais -> centavos inteiros com
// `parseBRLToCents` e volta com `formatBRL` (ambos de @sparks/shared, sem float).
import { formatBRL, parseBRLToCents } from '@sparks/shared';
import { ApiError } from '@/lib/api';

export type Values = Record<string, string | boolean>;
export type Choice = readonly [string, string];
export type Field = {
  name: string;
  label: string;
  type: 'text' | 'integer' | 'money' | 'cep' | 'boolean' | 'select';
  nullable?: boolean;
  allowEmpty?: boolean;
  choices?: readonly Choice[];
};

/** Erro de preenchimento com mensagem já em português, segura para mostrar. */
export class FormError extends Error {}

/** Só mostra mensagem vinda da API (já em português); qualquer outro erro vira o texto padrão. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof FormError || err instanceof ApiError) return err.message;
  return fallback;
}

/** Máscara 00000-000: mantém só dígitos (até 8) e põe o hífen. */
export function maskCep(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export function moneyText(cents: number): string {
  return formatBRL(cents).replace(/^R\$\s*/, '');
}

export function formValues(fields: Field[], row: Record<string, unknown>): Values {
  return Object.fromEntries(
    fields.map((field) => {
      const value = row[field.name];
      if (field.type === 'boolean') return [field.name, value === true];
      if (value === null || value === undefined) return [field.name, ''];
      if (field.type === 'money' && typeof value === 'number')
        return [field.name, moneyText(value)];
      if (field.type === 'cep') return [field.name, maskCep(String(value))];
      return [field.name, String(value)];
    }),
  );
}

/** Converte os textos do formulário no corpo da API. Lança `FormError` se o valor for inválido. */
export function payload(fields: Field[], values: Values): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => {
      const value = values[field.name];
      if (field.type === 'boolean') return [field.name, value === true];
      const text = String(value ?? '').trim();
      if (!text && field.nullable) return [field.name, null];
      if (!text && field.allowEmpty) return [field.name, ''];
      if (field.type === 'money') {
        const cents = parseBRLToCents(text);
        if (cents === null) throw new FormError(`Confira o valor de "${field.label}".`);
        return [field.name, cents];
      }
      if (field.type === 'integer') {
        if (!/^\d{1,9}$/.test(text)) throw new FormError(`Confira o número de "${field.label}".`);
        return [field.name, Number(text)];
      }
      if (field.type === 'cep') {
        const digits = text.replace(/\D/g, '');
        if (digits.length !== 8) throw new FormError(`Confira o CEP de "${field.label}".`);
        return [field.name, digits];
      }
      return [field.name, text];
    }),
  );
}

export function displayValue(field: Field, row: Record<string, unknown>): string {
  const value = row[field.name];
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'money') return formatBRL(Number(value));
  if (field.type === 'boolean') return value ? 'Sim' : 'Não';
  if (field.type === 'cep') return maskCep(String(value));
  if (field.type === 'select')
    return field.choices?.find(([key]) => key === value)?.[1] ?? String(value);
  return String(value);
}

export function FormFields({
  fields,
  values,
  onChange,
}: {
  fields: Field[];
  values: Values;
  onChange: (name: string, value: string | boolean) => void;
}) {
  return (
    <div className="shipping-fields">
      {fields.map((field) => {
        if (field.type === 'boolean')
          return (
            <label key={field.name} className="shipping-check">
              <input
                type="checkbox"
                checked={values[field.name] === true}
                onChange={(event) => onChange(field.name, event.target.checked)}
              />
              {field.label}
            </label>
          );
        if (field.type === 'select')
          return (
            <label key={field.name} className="shipping-field">
              {field.label}
              <select
                value={String(values[field.name] ?? '')}
                onChange={(event) => onChange(field.name, event.target.value)}
                required={!field.nullable}
              >
                <option value="">{field.nullable ? 'Não informado' : 'Selecione'}</option>
                {field.choices?.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          );
        return (
          <label key={field.name} className="shipping-field">
            {field.label}
            <input
              type="text"
              inputMode={
                field.type === 'money' ? 'decimal' : field.type === 'text' ? undefined : 'numeric'
              }
              placeholder={field.type === 'cep' ? '00000-000' : undefined}
              maxLength={field.type === 'cep' ? 9 : undefined}
              autoComplete="off"
              value={String(values[field.name] ?? '')}
              onChange={(event) =>
                onChange(
                  field.name,
                  field.type === 'cep' ? maskCep(event.target.value) : event.target.value,
                )
              }
              required={!field.nullable && !field.allowEmpty}
            />
          </label>
        );
      })}
    </div>
  );
}
