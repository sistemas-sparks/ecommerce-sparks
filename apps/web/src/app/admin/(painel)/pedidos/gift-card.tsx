'use client';

import { Button } from '@/ui';
import { GIFT_MESSAGE_MAX, giftCardText } from './logic';

/**
 * Cartão de presente. A mensagem é do cliente: entra como texto (React escapa), no máximo 140
 * caracteres, sem HTML. Na impressão (CSS em orders.css) só este bloco sai na folha; o resto da
 * tela some. O atributo no body vale só durante a impressão e não afeta outras páginas.
 */
export function GiftCard({
  message,
  packagingName,
}: {
  message: string | null;
  packagingName: string | null;
}) {
  const text = giftCardText(message);

  function print() {
    document.body.dataset.print = 'gift-card';
    const clear = () => {
      delete document.body.dataset.print;
      window.removeEventListener('afterprint', clear);
    };
    window.addEventListener('afterprint', clear);
    window.print();
  }

  return (
    <section aria-labelledby="orders-gift" className="orders-section">
      <h2 id="orders-gift">Cartão de presente</h2>
      {packagingName && <p>Embalagem: {packagingName}</p>}
      {text ? (
        <>
          <div className="orders-gift-card" data-gift-card>
            <p>{text}</p>
          </div>
          <p className="orders-hint">
            {[...text].length} de {GIFT_MESSAGE_MAX} caracteres
          </p>
          <Button variant="white" onClick={print}>
            Imprimir cartão
          </Button>
        </>
      ) : (
        <p>O cliente não escreveu mensagem.</p>
      )}
    </section>
  );
}
