import localFont from 'next/font/local';

export const displayFont = localFont({
  src: [
    { path: './fonts/big-shoulders-text-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: './fonts/big-shoulders-text-latin-800-normal.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-big-shoulders',
  display: 'swap',
  fallback: ['Arial Narrow', 'sans-serif'],
});

export const bodyFont = localFont({
  src: [
    { path: './fonts/nunito-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/nunito-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/nunito-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: './fonts/nunito-latin-800-normal.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-nunito',
  display: 'swap',
  fallback: ['Segoe UI', 'sans-serif'],
});
