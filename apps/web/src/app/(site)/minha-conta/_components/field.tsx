import type { ReactNode } from 'react';

export interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'tel';
  maxLength?: number;
  optional?: boolean;
}

/** Campo de texto com rótulo, dica e erro ligados por aria. */
export function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  inputMode,
  maxLength,
  optional,
}: FieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="order-field">
      <label htmlFor={id}>
        {label}
        {optional ? <span className="order-muted"> (opcional)</span> : null}
      </label>
      <input
        id={id}
        className="order-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="order-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="order-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  error,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="order-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="order-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        {children}
      </select>
      {error ? (
        <p id={`${id}-error`} className="order-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
