// Montagem da API: configuração, cabeçalhos de segurança, CORS, limite de corpo e erros.
// As rotas de cada área entram nas suas tarefas (frete, checkout, webhook, pedidos, admin).
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { adminAuthRoutes, adminGuards } from './admin/auth';
import { PRODUCT_IMPORT_PATH, productImportRoutes } from './admin/import';
import { supabaseProductImportRepo } from './admin/import-repo';
import { ordersAdminRoutes } from './admin/orders';
import { supabaseAdminOrdersRepo } from './admin/orders-repo';
import { reportsAdminRoutes } from './admin/reports';
import { supabaseAdminReportsRepo } from './admin/reports-repo';
import { productsAdminRoutes, productsLiveRoutes } from './admin/products';
import { supabaseProductsRepo } from './admin/products-repo';
import { catalogSnapshotRoutes, publishAdminRoutes } from './admin/publish';
import { supabasePublishRepo } from './admin/publish-repo';
import { settingsAdminRoutes } from './admin/settings';
import { supabaseSettingsRepo } from './admin/settings-repo';
import { bannersAdminRoutes, bioLinksAdminRoutes } from './admin/site-content';
import { supabaseSiteContentRepo } from './admin/site-content-repo';
import { couponsAdminRoutes } from './coupons/admin';
import { supabaseCouponsRepo } from './coupons/repo';
import { couponsRoutes } from './coupons/route';
import { giftWrapRoutes } from './gift-wrap/route';
import { supabaseGiftWrapRepo } from './gift-wrap/repo';
import { supabaseCheckoutRepo } from './checkout/repo';
import { checkoutRoutes } from './checkout/route';
import { meRoutes } from './orders/me';
import { supabaseOrdersRepo } from './orders/repo';
import { ordersRoutes } from './orders/route';
import { createMelhorEnvioClient } from './shipping/melhor-envio';
import { shippingRoutes } from './shipping/route';
import { shippingAdminRoutes } from './shipping/admin';
import { supabaseShippingRepo } from './shipping/repo';
import { ConfigError, loadConfig } from './env';
import { MESSAGES, apiError } from './lib/errors';
import { fetchSupabaseJwks, supabaseRateLimitHit } from './lib/supabase';
import type { AppEnv, Deps } from './types';
import { supabaseWebhookRepo } from './webhooks/mercadopago';
import { webhookRoutes } from './webhooks/route';

const defaultDeps: Deps = {
  fetch: (...args) => fetch(...args),
  rateLimitHit: supabaseRateLimitHit,
  getJwks: (config, opts) => fetchSupabaseJwks(config, opts),
  checkoutRepo: supabaseCheckoutRepo,
  shippingRepo: supabaseShippingRepo,
  melhorEnvio: (config, fetchImpl) =>
    config.melhorEnvio
      ? createMelhorEnvioClient({ ...config.melhorEnvio, fetch: fetchImpl })
      : null,
  productsRepo: supabaseProductsRepo,
  productImportRepo: supabaseProductImportRepo,
  webhookRepo: supabaseWebhookRepo,
  publishRepo: supabasePublishRepo,
  settingsRepo: supabaseSettingsRepo,
  giftWrapRepo: supabaseGiftWrapRepo,
  couponsRepo: supabaseCouponsRepo,
  ordersRepo: supabaseOrdersRepo,
  adminOrdersRepo: supabaseAdminOrdersRepo,
  adminReportsRepo: supabaseAdminReportsRepo,
  siteContentRepo: supabaseSiteContentRepo,
};

/** Corpo máximo padrão. Rotas maiores (ex.: importação CSV) definem o próprio limite. */
export const DEFAULT_BODY_LIMIT = 64 * 1024;

export function createApp(overrides: Partial<Deps> = {}) {
  const deps: Deps = { ...defaultDeps, ...overrides };
  const app = new Hono<AppEnv>();

  app.use(requestId());

  app.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      strictTransportSecurity: 'max-age=63072000; includeSubDomains',
      xFrameOptions: 'DENY',
      referrerPolicy: 'no-referrer',
      crossOriginResourcePolicy: 'same-site',
      permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
    }),
  );

  // Respostas da API nunca vão para cache (dados de pedido, preço e estoque ao vivo).
  app.use(async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  // Rota de saúde: responde mesmo sem configuração, para o monitoramento.
  app.get('/health', (c) => c.json({ ok: true }));

  // Configuração validada (falha fechada) e dependências.
  app.use(async (c, next) => {
    c.set('config', loadConfig(c.env ?? {}));
    c.set('deps', deps);
    await next();
  });

  app.use(
    cors({
      origin: (origin, c) => (c.var.config.siteOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
      credentials: false,
    }),
  );

  const defaultBodyLimit = bodyLimit({
    maxSize: DEFAULT_BODY_LIMIT,
    onError: () => apiError(413, 'payload_too_large', MESSAGES.payloadTooLarge).getResponse(),
  });
  // A importação de CSV tem limite próprio (maior), definido na própria rota.
  app.use((c, next) =>
    c.req.method === 'POST' && c.req.path === PRODUCT_IMPORT_PATH
      ? next()
      : defaultBodyLimit(c, next),
  );

  app.route('/checkout', checkoutRoutes);
  app.route('/webhooks', webhookRoutes);
  app.route('/orders', ordersRoutes);
  app.route('/me', meRoutes);

  // Painel: toda rota /admin/* exige login com papel admin (o preflight do CORS é respondido antes).
  app.use('/admin/*', ...adminGuards);
  app.route('/admin', adminAuthRoutes);
  app.route('/admin/shipping', shippingAdminRoutes);
  app.route('/admin/products', productsAdminRoutes);
  app.route('/admin/import', productImportRoutes);
  app.route('/admin/publish', publishAdminRoutes);
  app.route('/admin/settings', settingsAdminRoutes);
  app.route('/admin/coupons', couponsAdminRoutes);
  app.route('/admin/orders', ordersAdminRoutes);
  app.route('/admin/reports', reportsAdminRoutes);
  app.route('/admin/banners', bannersAdminRoutes);
  app.route('/admin/bio-links', bioLinksAdminRoutes);
  app.route('/coupons', couponsRoutes);
  app.route('/gift-wrap', giftWrapRoutes);
  app.route('/catalog', catalogSnapshotRoutes);
  app.route('/products', productsLiveRoutes);
  app.route('/shipping', shippingRoutes);

  app.notFound(() => apiError(404, 'not_found', MESSAGES.notFound).getResponse());

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();

    // Log sem dados pessoais nem segredos (R3.7): só identificadores técnicos.
    const requestIdValue = c.get('requestId');
    if (err instanceof ConfigError) {
      console.error(
        JSON.stringify({ level: 'error', requestId: requestIdValue, error: err.message }),
      );
      return apiError(503, 'unavailable', MESSAGES.unavailable).getResponse();
    }
    console.error(
      JSON.stringify({
        level: 'error',
        requestId: requestIdValue,
        method: c.req.method,
        path: c.req.routePath,
        error: err.name,
      }),
    );
    return apiError(500, 'internal', MESSAGES.internal).getResponse();
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
