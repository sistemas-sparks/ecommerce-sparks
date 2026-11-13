import type { ComponentPropsWithoutRef } from 'react';

export function Card({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={`sparks-card ${className ?? ''}`} />;
}

export function Badge({ className, ...props }: ComponentPropsWithoutRef<'span'>) {
  return <span {...props} className={`sparks-badge ${className ?? ''}`} />;
}
