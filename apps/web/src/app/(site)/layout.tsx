import type { ReactNode } from 'react';
import { CartDrawer } from '@/features/cart/cart-drawer';
import { CartProvider } from '@/features/cart/cart-provider';
import { Libras } from '@/features/libras/libras';
import { Header } from './_components/header';
import { Footer } from './_components/footer';
import { categories } from './_lib/catalog';
import './site.css';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <Header categories={categories} />
      {children}
      <Footer />
      <CartDrawer />
      <Libras />
    </CartProvider>
  );
}
