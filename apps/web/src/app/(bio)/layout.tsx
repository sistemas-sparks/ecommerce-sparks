import type { ReactNode } from 'react';
import { Libras } from '@/features/libras/libras';

// T-021 · Páginas "avulsas" para quem chega pela bio do Instagram: sem cabeçalho, busca, sacola nem
// botão fixo de WhatsApp (a página já tem o próprio). O VLibras continua presente, como no resto da loja.
export default function BioLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      {children}
      <Libras />
    </>
  );
}
