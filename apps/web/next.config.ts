import type { NextConfig } from 'next';

// Site 100% estático (docs/arquitetura.md §2): nada de SSR, rotas de API ou otimização de imagem no servidor.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ['@sparks/shared'],
};

export default nextConfig;
