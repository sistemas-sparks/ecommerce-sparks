import Link from 'next/link';
import type { ComponentProps, ComponentPropsWithoutRef } from 'react';
import { SpinnerIcon } from './icons';

export type ButtonVariant = 'primary' | 'plum' | 'white' | 'outline';

export type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: ButtonVariant;
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`sparks-button ${className ?? ''}`}
      data-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <SpinnerIcon className="sparks-spinner" />}
      {children}
    </button>
  );
}

export type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant };

export function ButtonLink({ variant = 'primary', className, ...props }: ButtonLinkProps) {
  return <Link {...props} className={`sparks-button ${className ?? ''}`} data-variant={variant} />;
}

export type IconButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'aria-label'> & {
  'aria-label': string;
};

export function IconButton({ type = 'button', className, ...props }: IconButtonProps) {
  return <button {...props} type={type} className={`sparks-icon-button ${className ?? ''}`} />;
}
