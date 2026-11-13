import type { CheckoutRepo } from './checkout/repo';
import type { AdminOrdersRepo } from './admin/orders-repo';
import type { AdminReportsRepo } from './admin/reports-repo';
import type { ProductImportRepo } from './admin/import-repo';
import type { ProductsRepo } from './admin/products-repo';
import type { PublishRepo } from './admin/publish-repo';
import type { SettingsRepo } from './admin/settings-repo';
import type { SiteContentRepo } from './admin/site-content-repo';
import type { CouponsRepo } from './coupons/repo';
import type { GiftWrapRepo } from './gift-wrap/repo';
import type { Bindings, Config } from './env';
import type { OrdersRepo } from './orders/repo';
import type { AuthUser } from './middleware/auth';
import type { MelhorEnvioClient } from './shipping/melhor-envio';
import type { ShippingRepo } from './shipping/repo';
import type { WebhookRepo } from './webhooks/mercadopago';

/** Dependências externas, injetáveis nos testes. */
export interface Deps {
  fetch: typeof fetch;
  /** Conta uma requisição na janela e diz se ainda está dentro do limite. */
  rateLimitHit: (
    config: Config,
    key: string,
    windowSeconds: number,
    max: number,
  ) => Promise<boolean>;
  /** Chaves públicas (JWKS) do Supabase Auth. */
  getJwks: (config: Config, opts?: { refresh?: boolean }) => Promise<JsonWebKeyWithKid[]>;
  /** Acesso ao banco do checkout (T-014). */
  checkoutRepo: (config: Config) => CheckoutRepo;
  shippingRepo: (config: Config) => ShippingRepo;
  /** Cliente do Melhor Envio (só cotação); null sem token configurado. */
  melhorEnvio: (config: Config, fetchImpl: typeof fetch) => MelhorEnvioClient | null;
  productsRepo: (config: Config) => ProductsRepo;
  /** Importação de produtos por CSV (painel). */
  productImportRepo: (config: Config) => ProductImportRepo;
  /** Confirmação de pagamento no banco (T-015). */
  webhookRepo: (config: Config) => WebhookRepo;
  /** Publicação do site e snapshot do catálogo (T-010). */
  publishRepo: (config: Config) => PublishRepo;
  /** Interruptor da embalagem de presente no painel (T-017). */
  settingsRepo: (config: Config) => SettingsRepo;
  /** Leitura pública da embalagem de presente (T-017). */
  giftWrapRepo: (config: Config) => GiftWrapRepo;
  /** Cupons do painel (T-016). */
  couponsRepo: (config: Config) => CouponsRepo;
  /** Pedido do cliente, conta, endereço salvo e favoritos (T-018). */
  ordersRepo: (config: Config) => OrdersRepo;
  /** Pedidos no painel: status, rastreio, frete a combinar (T-019). */
  adminOrdersRepo: (config: Config) => AdminOrdersRepo;
  /** Relatório de lucro, só leitura (T-020). */
  adminReportsRepo: (config: Config) => AdminReportsRepo;
  /** Banners e links do mini site da bio, no painel (T-021). */
  siteContentRepo: (config: Config) => SiteContentRepo;
}

export interface JsonWebKeyWithKid extends JsonWebKey {
  kid?: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    config: Config;
    deps: Deps;
    user: AuthUser;
    requestId: string;
  };
}
