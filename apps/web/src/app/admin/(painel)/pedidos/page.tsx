import { Suspense } from 'react';
import { OrdersPanel } from './panel';

export default function OrdersPage() {
  return (
    <Suspense fallback={<p role="status">Carregando pedidos…</p>}>
      <OrdersPanel />
    </Suspense>
  );
}
