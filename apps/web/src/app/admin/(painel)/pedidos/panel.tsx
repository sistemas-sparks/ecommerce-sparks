'use client';

// Pedidos do painel. Como o site é exportado como arquivos estáticos, a tela escolhe entre a lista
// e o detalhe pelo endereço (/admin/pedidos/?id=...). Os filtros também ficam no endereço, então o
// botão Voltar do navegador devolve a lista como estava.
import { ORDER_STATUSES, uuidSchema } from '@sparks/shared';
import { useSearchParams } from 'next/navigation';
import { OrderDetail } from './order-detail';
import { OrderList } from './order-list';
import { EMPTY_FILTERS, type ListFilters } from './orders-api';
import './orders.css';

export function OrdersPanel() {
  const params = useSearchParams();
  const id = uuidSchema.safeParse(params.get('id'));
  if (id.success) return <OrderDetail key={id.data} id={id.data} />;

  const status = params.get('status') ?? '';
  const page = Number(params.get('page'));
  const filters: ListFilters = {
    ...EMPTY_FILTERS,
    status: (ORDER_STATUSES as readonly string[]).includes(status) ? status : '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    q: params.get('q') ?? '',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
  return <OrderList filters={filters} />;
}
