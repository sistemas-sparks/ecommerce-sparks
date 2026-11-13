# Arquitetura

## 1. Visão geral
```
Navegador
  │  páginas estáticas (HTML/CSS/JS) ─────────────► Cloudflare Workers (static assets, grátis e ilimitado)
  │  chamadas dinâmicas (fetch /api/*) ───────────► Worker "api" (Hono) ──► Supabase (Postgres, Storage)
  │                                                          │ cotação ─► Melhor Envio (só cotação de frete)
  │  login (Google / e-mail + TOTP admin) ────────► Supabase Auth                 │
  │  pagamento ───────────────────────────────────► Mercado Pago (checkout hospedado)
  │                                                          │ webhook
  └────────────────────────────────────────────────────────► Worker "api" /webhooks/mercadopago
```

## 2. Por que essa arquitetura
Os limites do plano gratuito do Cloudflare Workers (cerca de 100 mil requisições dinâmicas por dia, 10 ms de CPU por requisição e Worker de até 3 MiB compactado) não comportam o Next.js com renderização no servidor. Por isso:
- O site é **gerado estático** (`output: 'export'`) e servido como arquivos estáticos, que são gratuitos e não consomem a cota.
- Só o que precisa de servidor passa pelo **Worker da API**, pequeno, com Hono.
- O catálogo é pré-renderizado no build. Preço e estoque "ao vivo" vêm da API, e tudo é recalculado no checkout.

## 3. Monorepo (pnpm workspaces)
```
apps/web        Next.js (App Router) + TypeScript + Tailwind, output: 'export'
apps/api        Cloudflare Worker com Hono (wrangler)
packages/shared Tipos, schemas Zod, utilitários de dinheiro, motor de frete (funções puras), regras de cupom
supabase/       migrations SQL, seeds, testes de RLS (Supabase CLI)
```
O motor de frete e as regras de preço ficam em `packages/shared` como **funções puras e testadas**, usadas pela API. O front só exibe.

## 4. Front-end (apps/web)
- Rotas públicas: `/`, `/categoria/[slug]`, `/produto/[slug]`, `/busca`, `/sacola`, `/checkout`, `/pedido/[token]`, `/consultar-pedido`, `/minha-conta`, `/links` (mini site da bio), `/politicas/*`, `/quem-somos`.
- Rotas do painel: `/admin/*` (aplicação client-side, `noindex`). Toda autorização é feita na API.
- Geração estática: o build lê categorias e produtos ativos do Supabase e gera as páginas, o `sitemap.xml` e os JSON-LD.
- **Publicar alterações**: o painel chama a API, que dispara o deploy hook do build (no máximo 1 build a cada 10 minutos, para economizar cota).
- Fontes servidas localmente (`marca/fontes/`), imagens em WebP com tamanhos responsivos.

## 5. API (apps/api)
### Públicas (com limite de requisições)
| Método | Rota | Função |
|---|---|---|
| GET | `/products/live?ids=` | preço e estoque atuais |
| POST | `/shipping/quote` | cotação híbrida: fretes próprios + Melhor Envio, chamado só pela API (Turnstile se repetitivo) |
| POST | `/coupons/validate` | valida cupom (Turnstile) |
| POST | `/checkout` | cria pedido + reserva estoque + preferência no Mercado Pago (Turnstile) |
| POST | `/webhooks/mercadopago` | confirma pagamento (assinatura + consulta à API + idempotência) |
| POST | `/orders/by-token` | pedido pelo link exclusivo (link no corpo `{ token }`, nunca na URL) |
| POST | `/orders/lookup` | consulta por código + WhatsApp (Turnstile) |
| GET | `/me/orders` | pedidos do cliente logado (JWT do Supabase) |
| GET | `/me/orders/:code` | detalhe de um pedido da conta (só do dono) |
| POST | `/orders/claim` | guarda na conta (logado) um pedido aberto pelo link exclusivo |
| GET, PUT | `/me/profile` | endereço salvo da conta |
| GET, PUT | `/me/favorites` | favoritos da conta (ids de produtos) |

### Admin (JWT com papel admin + nível AAL2)
`/admin/products` (CRUD, upload assinado de fotos) · `/admin/import` (CSV) · `/admin/orders` (status, rastreio, frete a combinar) · `/admin/shipping` (fretes próprios, serviços do Melhor Envio, exceções) · `/admin/coupons` · `/admin/settings` (embalagem, frete grátis, preparo, WhatsApp) · `/admin/banners` · `/admin/reports/profit` · `/admin/publish`.

### Tarefas agendadas (Cron Triggers)
- A cada 15 min: expirar pedidos não pagos e devolver o estoque reservado.
- 1x por dia: consulta simples ao banco (evita a pausa do projeto gratuito do Supabase por inatividade).
Confirmar os limites de Cron Triggers do plano gratuito antes de configurar.

## 6. Autenticação
- **Cliente**: compra sem conta. Conta opcional por login com Google (Supabase Auth).
- **Admin**: e-mail + senha + TOTP. Papel `admin` em `app_metadata`. A API exige `aal2` nas rotas `/admin/*`.
- A API valida o JWT do Supabase em cada requisição autenticada.

## 7. Pagamento (Mercado Pago)
1. `/checkout` cria o pedido (`awaiting_payment`) e a preferência de pagamento com `external_reference = order.id`, Pix e cartão habilitados, boleto excluído.
2. O cliente paga no checkout hospedado e volta para `/pedido/[token]`.
3. O webhook valida a assinatura, busca o pagamento na API do Mercado Pago, confere valor e referência, e chama a função SQL `mark_order_paid` (idempotente).
4. Parcelamento no cartão: configuração definida pela cliente (ver pendências em `memoria.md`).

## 8. Armazenamento de imagens
Supabase Storage, bucket `products` público para leitura e escrita só via URL assinada gerada pela API para admins. Só JPEG, PNG e WebP, até 5 MB, convertidos e redimensionados no upload.

## 9. Ambientes
| Ambiente | Front | API | Banco |
|---|---|---|---|
| local | `next dev` | `wrangler dev` | Supabase local (CLI) |
| teste | `*.workers.dev` | Worker de teste | Projeto Supabase gratuito nº 2 |
| produção | domínio da cliente | Worker de produção | Projeto Supabase gratuito nº 1 |

## 10. Variáveis de ambiente
Ver `.env.example`. Segredos de produção só via `wrangler secret put` e no painel do Cloudflare.

## 11. Backup e observabilidade
- Backup noturno do banco com `pg_dump` via GitHub Actions, criptografado, com teste de restauração mensal.
- Logs do Worker sem dados pessoais. Alertas de erro e de uso da cota (ver `seguranca.md`).

## 12. Serviços permitidos
Cloudflare (Workers, Turnstile, DNS, WAF), Supabase, Mercado Pago, **Melhor Envio (só cotação de frete, desde 20/10/2026)**, GitHub, Google (login e Search Console), Registro.br, **VLibras (assistente de Libras do Governo Federal, gratuito, carregado sob demanda no navegador do visitante; autorizado pelo Rafael em 12/11/2026)**.
**Proibido** adicionar outros sem aprovação do Rafael.
