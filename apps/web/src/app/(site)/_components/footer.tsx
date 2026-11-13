import Link from 'next/link';
import { ClipDivider } from '@/ui';
import { catalog, whatsappHref } from '../_lib/catalog';
import { Brand } from './brand';
import { MaximosCredit } from './maximos-credit';

export function Footer() {
  return (
    <>
      <ClipDivider className="site-wrap" />
      <footer className="site-footer">
        <div className="site-wrap site-footer-grid">
          <Link href="/" aria-label="Sparks Papelaria, início">
            <Brand variant="original" />
          </Link>
          <nav aria-label="Informações da loja">
            <h2>A Sparks</h2>
            <Link href="/quem-somos/">Quem somos</Link>
            <Link href="/consultar-pedido/">Consultar pedido</Link>
            <Link href="/minha-conta/">Minha conta</Link>
            <Link href="/politicas/entrega/">Entrega</Link>
            <Link href="/politicas/trocas-e-devolucoes/">Trocas e devoluções</Link>
            <Link href="/politicas/privacidade/">Privacidade</Link>
          </nav>
          <div>
            <h2>Fale com a gente</h2>
            <a
              href="https://www.instagram.com/sparks_papelaria/"
              target="_blank"
              rel="noopener noreferrer"
            >
              @sparks_papelaria
            </a>
            {whatsappHref ? (
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                Atendimento no WhatsApp
              </a>
            ) : (
              <p>WhatsApp: [A DEFINIR]</p>
            )}
            <p>{catalog.contact.address ?? 'Endereço: [A DEFINIR]'}</p>
          </div>
          <div>
            <h2>Formas de pagamento</h2>
            <p>Pix e cartão pelo Mercado Pago.</p>
            <p>Papelaria também é afeto.</p>
          </div>
        </div>
        <div className="site-wrap site-footer-bottom">
          <span>Sparks Papelaria</span>
          <MaximosCredit />
        </div>
      </footer>
      {whatsappHref && (
        <a
          className="site-whatsapp"
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Conversar com a Sparks no WhatsApp"
        >
          WhatsApp ↗
        </a>
      )}
    </>
  );
}
