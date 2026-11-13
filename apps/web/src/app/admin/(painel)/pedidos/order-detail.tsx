'use client';

import {
  ORDER_STATUS_LABELS,
  TRACKING_STATUS_TARGETS,
  formatBRL,
  type AdminOrderDetail,
  type AdminStatusTarget,
} from '@sparks/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import { GiftCard } from './gift-card';
import {
  ACTION_LABELS,
  ADDRESS_TYPE_LABELS,
  actorLabel,
  addressLines,
  cancelConfirmText,
  formatDateTime,
  formatPhone,
  nextStatuses,
  shippingSummary,
  whatsappLink,
  whatsappMessage,
} from './logic';
import { changeStatus, fetchOrder, saveTracking } from './orders-api';
import { QuoteForm } from './quote-form';

const PAYMENT_LABELS = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
};
const TRACKING_STATUSES = new Set(['preparing', 'shipped', 'delivered']);
// Cancelar e devolver mudam o estoque ou o dinheiro: pedem uma confirmação.
const NEEDS_CONFIRM = new Set<AdminStatusTarget>(['canceled', 'returned']);

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

export function OrderDetail({ id }: { id: string }) {
  const { getAccessToken } = useAdmin();
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void getAccessToken()
      .then((token) => fetchOrder(token, id))
      .then((found) => {
        if (active) setOrder(found);
      })
      .catch((err) => {
        if (active) setLoadError(errorText(err, 'Não foi possível carregar o pedido.'));
      });
    return () => {
      active = false;
    };
  }, [id, attempt, getAccessToken]);

  if (!order) {
    return (
      <div className="orders-panel">
        <Link href="/admin/pedidos/" className="orders-back">
          Voltar aos pedidos
        </Link>
        {loadError ? (
          <>
            <p role="alert" className="orders-error">
              {loadError}
            </p>
            <Button
              onClick={() => {
                setLoadError('');
                setAttempt((n) => n + 1);
              }}
            >
              Tentar de novo
            </Button>
          </>
        ) : (
          <p role="status">Carregando pedido…</p>
        )}
      </div>
    );
  }
  return <Loaded order={order} onChange={setOrder} getToken={getAccessToken} />;
}

function Loaded({
  order,
  onChange,
  getToken,
}: {
  order: AdminOrderDetail;
  onChange: (o: AdminOrderDetail) => void;
  getToken: () => Promise<string>;
}) {
  const [tracking, setTracking] = useState(order.trackingCode ?? '');
  const [confirm, setConfirm] = useState<AdminStatusTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const run = useCallback(
    async (action: () => Promise<AdminOrderDetail>, done: string, failure: string) => {
      setBusy(true);
      setError('');
      setNotice('');
      try {
        const updated = await action();
        onChange(updated);
        setTracking(updated.trackingCode ?? '');
        setNotice(done);
      } catch (err) {
        setError(errorText(err, failure));
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [onChange],
  );

  const message = whatsappMessage(order);
  const link = whatsappLink(order.customer.whatsapp, message);
  const next = nextStatuses(order.status);
  const showTracking = TRACKING_STATUSES.has(order.status);
  const trackingChanged = tracking.trim().toUpperCase() !== (order.trackingCode ?? '');

  function pick(status: AdminStatusTarget) {
    if (NEEDS_CONFIRM.has(status)) return setConfirm(status);
    void run(
      async () =>
        changeStatus(
          await getToken(),
          order.id,
          status,
          // O rastreio só acompanha a mudança para enviado ou entregue.
          TRACKING_STATUS_TARGETS.includes(status) ? tracking.trim() || undefined : undefined,
        ),
      `Status: ${ORDER_STATUS_LABELS[status]}.`,
      'Não foi possível mudar o status.',
    );
  }

  return (
    <div className="orders-panel orders-detail">
      <Link href="/admin/pedidos/" className="orders-back">
        Voltar aos pedidos
      </Link>
      <header className="orders-detail-head">
        <div>
          <h1 className="orders-title">{order.code}</h1>
          <p className="orders-detail-status">
            {ORDER_STATUS_LABELS[order.status]} · feito em {formatDateTime(order.createdAt)}
          </p>
        </div>
        {link ? (
          <a
            className="sparks-button"
            data-variant="primary"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Avisar no WhatsApp
          </a>
        ) : (
          <p role="alert" className="orders-error">
            WhatsApp do cliente inválido.
          </p>
        )}
      </header>

      {error && (
        <p role="alert" className="orders-error">
          {error}
        </p>
      )}
      <p role="status" className="orders-notice">
        {notice}
      </p>

      {order.status === 'awaiting_shipping_quote' && (
        <QuoteForm
          order={order}
          getToken={getToken}
          onDone={(updated) => {
            onChange(updated);
            setNotice('Cobrança liberada. Avise o cliente pelo WhatsApp.');
          }}
        />
      )}

      {order.status === 'awaiting_payment' && order.reservedUntil && (
        <p>Aguardando pagamento. Itens reservados até {formatDateTime(order.reservedUntil)}.</p>
      )}

      {order.status === 'awaiting_payment' && order.paymentUrl && (
        <PaymentLink url={order.paymentUrl} until={order.reservedUntil} />
      )}

      {(next.length > 0 || showTracking) && (
        <section aria-labelledby="orders-actions" className="orders-section">
          <h2 id="orders-actions">Andamento</h2>
          {showTracking && (
            <div className="orders-tracking">
              <label className="orders-field">
                Código de rastreio
                <input
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                  maxLength={40}
                  autoComplete="off"
                  autoCapitalize="characters"
                />
              </label>
              <Button
                variant="white"
                disabled={busy || !trackingChanged}
                onClick={() =>
                  void run(
                    async () => saveTracking(await getToken(), order.id, tracking),
                    tracking.trim() ? 'Rastreio salvo.' : 'Rastreio apagado.',
                    'Não foi possível salvar o rastreio.',
                  )
                }
              >
                Salvar rastreio
              </Button>
            </div>
          )}
          {showTracking && (
            <p className="orders-hint">
              A etiqueta é comprada no Melhor Envio. Copie o código de lá para cá.
            </p>
          )}
          {confirm ? (
            <div className="orders-actions">
              <p className="orders-confirm">
                {confirm === 'canceled'
                  ? cancelConfirmText(order)
                  : 'Registrar a devolução? O estoque não é alterado.'}
              </p>
              <Button
                loading={busy}
                onClick={() =>
                  void run(
                    async () => changeStatus(await getToken(), order.id, confirm),
                    `Status: ${ORDER_STATUS_LABELS[confirm]}.`,
                    'Não foi possível mudar o status.',
                  )
                }
              >
                Sim, confirmar
              </Button>
              <Button variant="white" disabled={busy} onClick={() => setConfirm(null)}>
                Não
              </Button>
            </div>
          ) : (
            <div className="orders-actions">
              {next.map((status) => (
                <Button
                  key={status}
                  variant={NEEDS_CONFIRM.has(status) ? 'white' : 'primary'}
                  disabled={busy}
                  onClick={() => pick(status)}
                >
                  {ACTION_LABELS[status]}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="orders-items" className="orders-section">
        <h2 id="orders-items">Itens</h2>
        <ul className="orders-items">
          {order.items.map((item, i) => (
            <li key={`${item.name}-${i}`}>
              <span>
                {item.qty} × {item.name}
              </span>
              <span>{formatBRL(item.unitPriceCents * item.qty)}</span>
            </li>
          ))}
        </ul>
        <dl className="orders-sums">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatBRL(order.subtotalCents)}</dd>
          </div>
          {order.discountCents > 0 && (
            <div>
              <dt>Cupom{order.couponCode ? ` ${order.couponCode}` : ''}</dt>
              <dd>− {formatBRL(order.discountCents)}</dd>
            </div>
          )}
          {order.giftWrap && order.giftWrap.cents > 0 && (
            <div>
              <dt>Embalagem de presente</dt>
              <dd>{formatBRL(order.giftWrap.cents)}</dd>
            </div>
          )}
          <div>
            <dt>Frete</dt>
            <dd>
              {order.shipping.cents === null ? 'A combinar' : formatBRL(order.shipping.cents)}
            </dd>
          </div>
          <div className="orders-sum-total">
            <dt>Total</dt>
            <dd>{formatBRL(order.totalCents)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="orders-ship" className="orders-section">
        <h2 id="orders-ship">Entrega</h2>
        <dl className="orders-facts">
          <div>
            <dt>Cliente</dt>
            <dd>{order.customer.name}</dd>
          </div>
          <div>
            <dt>WhatsApp</dt>
            <dd>{formatPhone(order.customer.whatsapp)}</dd>
          </div>
          {order.customer.email && (
            <div>
              <dt>E-mail</dt>
              <dd>{order.customer.email}</dd>
            </div>
          )}
          <div>
            <dt>Endereço</dt>
            <dd>
              {addressLines(order.address).map((line) => (
                <span key={line} className="orders-line">
                  {line}
                </span>
              ))}
              <span className="orders-line">Tipo: {ADDRESS_TYPE_LABELS[order.addressType]}</span>
            </dd>
          </div>
          <div>
            <dt>Frete e serviço</dt>
            <dd>{shippingSummary(order.shipping)}</dd>
          </div>
          {order.trackingCode && !showTracking && (
            <div>
              <dt>Rastreio</dt>
              <dd>{order.trackingCode}</dd>
            </div>
          )}
          <div>
            <dt>Pagamento</dt>
            <dd>
              {order.paidAt
                ? `${order.paymentMethod ? PAYMENT_LABELS[order.paymentMethod] : 'Pago'} em ${formatDateTime(order.paidAt)}`
                : 'Ainda não pago'}
            </dd>
          </div>
          {order.paymentId && (
            <div>
              <dt>Pagamento no Mercado Pago</dt>
              <dd>{order.paymentId}</dd>
            </div>
          )}
        </dl>
      </section>

      {order.giftWrap && (
        <GiftCard message={order.giftWrap.message} packagingName={order.giftWrap.name} />
      )}

      <section aria-labelledby="orders-history" className="orders-section">
        <h2 id="orders-history">Histórico</h2>
        <ol className="orders-history">
          {order.events.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span>{ORDER_STATUS_LABELS[e.to]}</span>
              <span>
                {actorLabel(e.actor)} · {formatDateTime(e.at)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** Link de pagamento à vista (frete a combinar): para copiar e mandar por outro meio além do WhatsApp. */
function PaymentLink({ url, until }: { url: string; until: string | null }) {
  const [copied, setCopied] = useState<'ok' | 'fail' | ''>('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  }
  return (
    <section aria-labelledby="orders-pay-link" className="orders-section">
      <h2 id="orders-pay-link">Link de pagamento</h2>
      <div className="orders-tracking">
        <label className="orders-field">
          Link para o cliente pagar
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <Button variant="white" onClick={() => void copy()}>
          Copiar link
        </Button>
      </div>
      <p className="orders-hint">
        {until ? `Vale até ${formatDateTime(until)}. ` : ''}
        Pode ser enviado por WhatsApp ou por outro meio.
      </p>
      <p role="status" className="orders-notice">
        {copied === 'ok' && 'Link copiado.'}
        {copied === 'fail' && 'Não foi possível copiar. Toque no campo e copie o texto.'}
      </p>
    </section>
  );
}
