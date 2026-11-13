'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { OrderView } from '@sparks/shared';
import { ApiError } from '@/lib/api';
import { Button, ButtonLink } from '@/ui';
import { useCustomerAuth } from '../../minha-conta/_lib/use-customer-auth';
import { claimOrder, fetchOrderByToken } from '../_lib/api';
import { shouldPoll, tokenFromPath } from '../_lib/order-view-model';
import { OrderDetails, ORDER_HEADING_ID } from './order-details';
import { OrderState } from './order-state';

type View =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; order: OrderView };

/** Pergunta de novo a cada 20 s enquanto aguarda o pagamento, por no máximo 10 minutos. */
const POLL_MS = 20_000;
const POLL_MAX = 30;

const subscribeNothing = () => () => {};

function InvalidOrder({ kind }: { kind: 'invalid' | 'not-found' }) {
  return (
    <OrderState title="Não encontramos este pedido" alert>
      <p>
        {kind === 'invalid'
          ? 'O endereço do pedido parece incompleto. Abra o link exatamente como você o recebeu.'
          : 'Confira o link que você recebeu. Se preferir, consulte o pedido com o código e o WhatsApp.'}
      </p>
      <ButtonLink href="/consultar-pedido/">Consultar pedido</ButtonLink>
    </OrderState>
  );
}

/**
 * Página do pedido por link exclusivo (/pedido/<código secreto>/). O destino do retorno do
 * Mercado Pago é esta página: o que ele manda na URL é ignorado, vale só o que o servidor responde.
 */
export function OrderByToken() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [claim, setClaim] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  });
  const auth = useCustomerAuth();
  const focused = useRef(false);

  // O endereço é lido no navegador: o site é estático e o código do link não existe no build.
  // No servidor (e na hidratação) o caminho é vazio: ainda não dá para saber qual é o pedido.
  const pathname = useSyncExternalStore(
    subscribeNothing,
    () => window.location.pathname,
    () => '',
  );
  const token = pathname === '' ? undefined : tokenFromPath(pathname);

  const load = useCallback((value: string, quiet: boolean) => {
    return fetchOrderByToken(value).then(
      (order) => setView({ kind: 'ready', order }),
      (err: unknown) => {
        if (quiet) return; // numa atualização silenciosa, mantém o que já está na tela
        if (err instanceof ApiError && err.code === 'order_not_found') {
          setView({ kind: 'not-found' });
        } else {
          setView({
            kind: 'error',
            message: err instanceof ApiError ? err.message : 'Não foi possível abrir o pedido.',
          });
        }
      },
    );
  }, []);

  useEffect(() => {
    if (token) void load(token, false);
  }, [token, load]);

  const status = view.kind === 'ready' ? view.order.status : null;
  useEffect(() => {
    if (!token || !status || !shouldPoll(status)) return;
    let runs = 0;
    const timer = window.setInterval(() => {
      runs += 1;
      if (runs > POLL_MAX) {
        window.clearInterval(timer);
        return;
      }
      void load(token, true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [token, status, load]);

  // Leva o foco ao código do pedido na primeira vez que ele aparece (leitores de tela).
  useEffect(() => {
    if (view.kind === 'ready' && !focused.current) {
      focused.current = true;
      document.getElementById(ORDER_HEADING_ID)?.focus();
    }
  }, [view.kind]);

  if (token === null) {
    return <InvalidOrder kind="invalid" />;
  }
  if (view.kind === 'loading') {
    return (
      <OrderState title="Abrindo o seu pedido" busy>
        <div className="order-skeleton" aria-hidden="true" />
        <div className="order-skeleton" aria-hidden="true" style={{ width: '70%' }} />
      </OrderState>
    );
  }
  if (view.kind === 'not-found') {
    return <InvalidOrder kind="not-found" />;
  }
  if (view.kind === 'error') {
    return (
      <OrderState title="Não foi possível abrir o pedido" alert>
        <p>{view.message}</p>
        {token ? (
          <Button
            onClick={() => {
              setView({ kind: 'loading' });
              void load(token, false);
            }}
          >
            Tentar de novo
          </Button>
        ) : null}
      </OrderState>
    );
  }

  const { order } = view;
  const canClaim = token && auth.status === 'signed-in' && !order.linkedToAccount && !claim.message;

  const saveInAccount = async () => {
    if (!token || auth.status !== 'signed-in') return;
    setClaim({ busy: true, message: null });
    try {
      await claimOrder(token, auth.session.accessToken);
      setClaim({ busy: false, message: 'Pedido guardado na sua conta.' });
      void load(token, true);
    } catch (err) {
      setClaim({
        busy: false,
        message: err instanceof ApiError ? err.message : 'Não foi possível guardar o pedido.',
      });
    }
  };

  return (
    <OrderDetails order={order}>
      {canClaim ? (
        <Button variant="plum" loading={claim.busy} onClick={() => void saveInAccount()}>
          Guardar na minha conta
        </Button>
      ) : null}
      {auth.status === 'signed-out' && auth.enabled && !order.linkedToAccount ? (
        <Link className="order-link" href="/minha-conta/">
          Entrar para guardar este pedido
        </Link>
      ) : null}
      {shouldPoll(order.status) ? (
        <button
          type="button"
          className="order-link"
          onClick={() => token && void load(token, true)}
        >
          Atualizar agora
        </button>
      ) : null}
      {claim.message ? (
        <p role="status" className="order-muted">
          {claim.message}
        </p>
      ) : null}
    </OrderDetails>
  );
}
