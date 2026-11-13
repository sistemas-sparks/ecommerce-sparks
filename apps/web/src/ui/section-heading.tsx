import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Clip } from './clip';

export type SectionHeadingProps = ComponentPropsWithoutRef<'h2'> & {
  as?: 'h1' | 'h2' | 'h3';
  description?: string;
  action?: ReactNode;
};

export function SectionHeading({
  as: Heading = 'h2',
  description,
  action,
  className,
  children,
  ...props
}: SectionHeadingProps) {
  return (
    <div className={`sparks-section-heading ${className ?? ''}`}>
      <div>
        <Heading {...props}>
          <Clip />
          {children}
        </Heading>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
