import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import {
  OG_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  THEME_COLOR,
  absoluteUrl,
} from '@/lib/seo';
import { bodyFont, displayFont } from '@/ui/fonts';
import './globals.css';

// Sem robots aqui: o site é indexável por padrão. Rotas privadas (admin, sacola, checkout) têm noindex próprio.
// Páginas sobrescrevem title, description, canonical e Open Graph com pageMetadata (lib/seo.ts).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | Cadernos, canetas e presentes com afeto`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: '/site.webmanifest',
  icons: {
    icon: [{ url: '/favicon.png', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png' }],
  },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: SITE_NAME,
    images: [{ url: absoluteUrl(OG_IMAGE.path), width: OG_IMAGE.width, height: OG_IMAGE.height }],
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = { themeColor: THEME_COLOR };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>{children}</body>
    </html>
  );
}
