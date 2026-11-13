export type ClipColor = 'magenta' | 'violet' | 'gold' | 'teal' | 'orchid';

export type ClipProps = { color?: ClipColor; className?: string };

// Elemento decorativo do protótipo; não substitui o logotipo da marca.
export function Clip({ color, className }: ClipProps) {
  const path = 'M20 26V54a8 8 0 0 1-16 0V16a10 10 0 0 1 20 0V50';
  return (
    <svg
      className={`sparks-clip ${className ?? ''}`}
      data-color={color}
      viewBox="0 0 28 68"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} stroke="white" strokeWidth="7" />
      <path d={path} stroke="currentColor" strokeWidth="3.2" />
    </svg>
  );
}

export function ClipDivider({ className }: { className?: string }) {
  return (
    <div className={`sparks-clip-divider ${className ?? ''}`} aria-hidden="true">
      <Clip color="magenta" />
      <Clip color="orchid" />
      <Clip color="gold" />
      <Clip color="violet" />
    </div>
  );
}
