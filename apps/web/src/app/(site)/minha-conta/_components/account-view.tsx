'use client';

import Link from 'next/link';
import { Button } from '@/ui';
import { OrderState } from '../../pedido/_components/order-state';
import { useCustomerAuth } from '../_lib/use-customer-auth';
import { FavoritesSection } from './favorites-section';
import { OrdersSection } from './orders-section';
import { ProfileSection } from './profile-section';

export function AccountView() {
  const auth = useCustomerAuth();

  if (auth.status === 'loading') {
    return (
      <OrderState title="Carregando sua conta" busy>
        <div className="order-skeleton" aria-hidden="true" />
      </OrderState>
    );
  }

  if (auth.status === 'signed-out') {
    return (
      <div className="order-state">
        <h2 className="order-state-title">Entre para ver seus pedidos</h2>
        <p>
          Entrar é opcional: você compra e acompanha pedidos sem criar conta. Com o Google, os
          pedidos ficam guardados em “Meus pedidos”, junto com o endereço e os favoritos.
        </p>
        {auth.enabled ? (
          <Button onClick={() => void auth.signIn()}>Entrar com Google</Button>
        ) : (
          <>
            <Button disabled aria-describedby="google-off">
              Entrar com Google
            </Button>
            <p id="google-off" className="order-muted">
              O login com Google não está ativado nesta loja. Para acompanhar um pedido, use o link
              que você recebeu ou o código com o WhatsApp.
            </p>
          </>
        )}
        {auth.error ? (
          <p className="order-error" role="alert">
            {auth.error}
          </p>
        ) : null}
        <Link className="order-link" href="/consultar-pedido/">
          Consultar pedido com código e WhatsApp
        </Link>
      </div>
    );
  }

  const { accessToken, email } = auth.session;
  return (
    <>
      <div className="order-actions">
        <p>
          Você entrou como <strong>{email ?? 'sua conta Google'}</strong>
        </p>
        <button type="button" className="order-link" onClick={() => void auth.signOut()}>
          Sair
        </button>
      </div>
      <OrdersSection accessToken={accessToken} />
      <ProfileSection accessToken={accessToken} />
      <FavoritesSection accessToken={accessToken} />
    </>
  );
}
