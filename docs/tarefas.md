# Tarefas

Status: `LIVRE` · `EM ANDAMENTO (CLAUDE|CODEX) dd/mm` · `REVISÃO` · `FEITA` · `BLOQUEADA (motivo)`
**Área** = caminhos que a tarefa pode alterar. Duas tarefas em andamento não podem ter áreas sobrepostas.
**Sugestão de dono:** Claude Code fica com arquitetura, banco, segurança, pagamento e regras de negócio; Codex fica com interface, telas do painel e utilitários. O Rafael pode trocar.
**[RC]** = revisão cruzada obrigatória pela outra IA.

> **20/10/2026:** o frete passou a ser **híbrido** (fretes próprios por faixa de CEP + cotação nacional pelo Melhor Envio, só cotação). Ver `frete.md` e as tarefas T-028 e T-029. O motor da T-011 e o painel da T-012 continuam valendo para exceções, rural, limites, preparo e frete grátis; zonas e tarifas nacionais saem.

> **20/10/2026, contas externas:** ainda **não existem** GitHub, Cloudflare, Supabase, Mercado Pago nem Melhor Envio, então nenhuma API real pode ser conectada. Tudo é desenvolvido e testado com **simulações** (PGlite, APIs falsas injetáveis, Playwright com respostas interceptadas). A ligação com os serviços reais fica **toda** na **T-031**, quando o Rafael liberar as contas. Enquanto isso, a T-025 e a T-026 ficam paradas.
> **Codex indisponível desde 20/10:** o Claude assume as tarefas dele (decisão do Rafael). A coluna "Dono sugerido" continua mostrando a sugestão original.

## Fila sugerida (ordem de prioridade)
**Feito:** T-001 a T-008, T-010 a T-017, T-027, T-028 e T-029 (19 de 32).

**A. Dá para fazer agora, sem contas** (uma tarefa por vez, nesta ordem):
1. **T-030** página `/checkout/` (sem ela ninguém consegue comprar; hoje dá 404).
2. **T-019** painel de pedidos (deve mostrar pagamento duplicado, fora do prazo e valor diferente, hoje só no log).
3. **T-018** página do pedido, "Consultar pedido" e conta Google.
4. **T-023** segurança P0: parte de código e arquivos (TOTP no código e nas telas, CSP, workflow de backup escrito), sem rodar nada real.
5. **T-009** importação CSV.
6. **T-021** mini site da bio e banners.
7. **T-022** SEO básico (sem isso o site inteiro está `noindex`) → **T-032** rodada de visibilidade (SEO, GEO e local) com a skill `/visibilidade`.
8. **T-020** relatório de lucro.
9. **T-024** testes ponta a ponta com serviços simulados.

**B. Depende das contas (adiado até o Rafael liberar)**
10. **T-031** conectar GitHub, Supabase, Cloudflare, Mercado Pago e Melhor Envio, e validar o que só roda com o serviço real.
11. **T-025** deploy, DNS e checklist final → **T-026** treinamento e cadastro dos produtos de exemplo.

## Semana 1 — Fundação
| ID | Tarefa | Área | Dono sugerido | Depende | Status |
|---|---|---|---|---|---|
| T-001 | Inicializar monorepo (pnpm, TS strict, ESLint, Prettier, Vitest, CI com lint/typecheck/test/gitleaks) e preencher "Comandos" no AGENTS.md | raiz, `.github/` | Claude | — | FEITA (revisada pelo CODEX em 06/10) |
| T-002 | Schema do banco, RLS negando tudo, seeds (UF/CEP, zonas, tamanhos) e testes de RLS **[RC]** | `supabase/` | Claude | T-001 | FEITA (revisada pelo CODEX em 06/10) |
| T-003 | `packages/shared`: dinheiro em centavos, schemas Zod, tipos de pedido | `packages/shared/` | Claude (era Codex; trocado pelo Rafael em 06/10) | T-001 | FEITA (revisada pelo CODEX em 06/10) |
| T-004 | Tokens de design, fontes locais e componentes base (botões, cards, clipe SVG) a partir do protótipo | `apps/web/src/ui/` | Codex | T-001 | FEITA |
| T-005 | Worker Hono: estrutura, CORS, cabeçalhos, validação de JWT, limite de requisições e Turnstile **[RC]** | `apps/api/` | Claude | T-001 | FEITA (revisada pelo CODEX em 07/10) |

## Semana 2 — Catálogo e painel
| ID | Tarefa | Área | Dono sugerido | Depende | Status |
|---|---|---|---|---|---|
| T-006 | Páginas públicas estáticas: home, categoria, produto, busca, quem somos e políticas | `apps/web/src/app/(site)/` | Codex | T-002, T-004 | FEITA (CODEX em 07/10) |
| T-007 | Login do admin com TOTP (AAL2) e layout do painel **[RC]** — TOTP adiado pelo Rafael em 06/10 (vai para a T-023) | `apps/web/src/app/admin/`, `apps/api/src/admin/auth*` | Claude | T-005 | FEITA (revisada pelo CODEX em 07/10; TOTP na T-023) |
| T-008 | CRUD de produtos, upload de fotos (URL assinada) e categorias | `apps/web/src/app/admin/(painel)/produtos/`, `apps/api/src/admin/products*` | Codex | T-007 | FEITA (concluída pelo Claude em 20/10, com o Codex indisponível) |
| T-009 | Importação de produtos por CSV (modelo + validação + relatório de erros) | `apps/api/src/admin/import*`, `apps/web/src/app/admin/importar/` | Codex | T-008 | LIVRE |
| T-010 | "Publicar alterações" (deploy hook com intervalo mínimo) e geração estática no build | `apps/api/src/admin/publish*`, `apps/web/scripts/` | Claude | T-006 | FEITA (revisada pelo revisor Claude por indisponibilidade do Codex, 20/10) |

## Semana 3 — Compra
| ID | Tarefa | Área | Dono sugerido | Depende | Status |
|---|---|---|---|---|---|
| T-011 | Motor de frete (funções puras + testes) conforme `frete.md` **[RC]** | `packages/shared/src/shipping/` | Claude | T-003 | FEITA (revisada pelo CODEX em 06/10) · parcialmente substituída pela T-028 |
| T-012 | Endpoint de cotação + telas de frete no painel (tabelas, regras locais, exceções, preparo, frete grátis) | `apps/api/src/shipping*`, `apps/web/src/app/admin/(painel)/frete/` | Codex | T-011 | FEITA (CODEX em 07/10) · parcialmente substituída pela T-028/T-029 |
| T-028 | **Frete híbrido** conforme `frete.md`: cliente do Melhor Envio (só cotação, token só no Worker, timeout, Zod), fretes próprios com áreas por CEP (entrega rápida e local), migration (sai zonas/tarifas/UF; entram tipos e áreas próprias, serviços do Melhor Envio e snapshot do serviço no pedido), contrato novo de `/shipping/quote` e recálculo no checkout, testes do §8 **[RC]** | `packages/shared/src/shipping/`, `packages/shared/src/schemas/shipping*`, `apps/api/src/shipping*` (exceto `admin*`), `supabase/migrations/`; `apps/api/src/checkout*` só depois da T-014 FEITA | Claude | T-011, T-012 | FEITA (revisão cruzada feita pelo revisor Claude por indisponibilidade do Codex, 20/10). Desenvolvida contra Melhor Envio simulado: validar no sandbox quando houver token. Tabelas, rotas e telas antigas de zonas/tarifas/UF seguem no código até a T-029 (decisão do Rafael) |
| T-029 | Painel de frete v2: tipos de frete próprios e áreas de entrega rápida/local, serviços do Melhor Envio exibidos e folga; retirar telas de zonas e tarifas | `apps/web/src/app/admin/(painel)/frete/`, `apps/api/src/shipping/admin*` | Codex | T-028 | FEITA (feita pelo Claude em 20/10, com o Codex indisponível; visual conferido em 390px/1280px com API simulada) |
| T-013 | Sacola: CEP, frete (várias opções, transportadora, "a combinar"), cupom, embalagem de presente com mensagem | `apps/web/src/features/cart/` | Claude (assumida do Codex) | T-012, T-028 (contrato da cotação) | FEITA (feita pelo Claude em 20/10, com o Codex indisponível; visual e fluxo conferidos em 390px/1280px com API simulada; termina no botão "Finalizar compra", a página `/checkout/` não tem tarefa) |
| T-014 | Checkout: `create_order`, reserva de estoque, preferência do Mercado Pago (Pix e cartão, sem boleto) **[RC]** | `apps/api/src/checkout*`, `supabase/migrations/` | Claude | T-002, T-011 | FEITA (revisão cruzada feita pelo revisor Claude por indisponibilidade do Codex, 20/10) |
| T-015 | Webhook do Mercado Pago com idempotência + cron de expiração **[RC]** | `apps/api/src/webhooks*`, `apps/api/src/cron*` | Claude | T-014 | FEITA (revisão cruzada feita pelo revisor Claude por indisponibilidade do Codex, 20/10) |
| T-030 | **Página `/checkout/` do site** (lacuna achada na T-013; está no fluxo do `prd.md` §6 e é escopo contratado): dados do cliente (nome, WhatsApp, e-mail opcional), endereço completo e tipo (urbano, rural, difícil acesso), revisão do pedido, Turnstile, chamada a `POST /checkout` (a API da T-014 já existe) e redirecionamento ao link do Mercado Pago; pedido "aguardando frete" mostra a mensagem de que não há cobrança antes da confirmação. Sem pagamento real: testar com a API simulada. A página de retorno é a T-018 | `apps/web/src/app/(site)/checkout/`, `apps/web/src/features/checkout/` | Claude | T-013, T-014 | LIVRE |
| T-016 | Cupons (painel + validação + uso atômico) **[RC]** | `apps/api/src/coupons*`, `apps/web/src/app/admin/cupons/` | Claude (assumida do Codex) | T-014 | FEITA (revisão cruzada feita pelo revisor Claude por indisponibilidade do Codex; visual conferido em 390px/1280px com API simulada, 20/10) |
| T-017 | Embalagem de presente (interruptor, produtos do tipo `gift_wrap` ocultos da vitrine) | `apps/web/src/app/admin/configuracoes/`, `apps/api/src/admin/settings*` | Codex | T-008 | FEITA (feita pelo Claude em 20/10, com o Codex indisponível; visual conferido em 390px/1280px com API simulada) |

## Semana 4 — Pós-compra, extras e publicação
| ID | Tarefa | Área | Dono sugerido | Depende | Status |
|---|---|---|---|---|---|
| T-018 | Página do pedido (link), "Consultar pedido" (código + WhatsApp) e conta Google com "Meus pedidos" **[RC]** | `apps/web/src/app/(site)/pedido/`, `.../consultar-pedido/`, `.../minha-conta/`, `apps/api/src/orders*` | Claude | T-015 (T-030 para o redirecionamento de retorno do Mercado Pago) | REVISÃO (CLAUDE, 12/11/2026): aguarda a revisão cruzada [RC]. Feito com API e Supabase Auth simulados; a conta Google só funciona de verdade na T-031/T-038 (botão desligado por NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED). Detalhes e pendências em memoria.md |
| T-019 | Painel de pedidos: status, rastreio informado manualmente (etiqueta comprada no Melhor Envio), serviço/transportadora do pedido, frete a combinar, impressão do cartão, "Avisar no WhatsApp" | `apps/web/src/app/admin/(painel)/pedidos/`, `apps/api/src/admin/orders*`, `packages/shared/src/schemas/admin-orders.ts`, `supabase/migrations/20261112000001_admin_orders.sql` | Claude | T-015 | REVISÃO (CLAUDE, 13/11/2026): feito com API, Mercado Pago e Supabase simulados (PGlite); migration só escrita, **não aplicada**. Detalhes e pendências em memoria.md |
| T-020 | Relatório de lucro simples | `apps/web/src/app/admin/(painel)/relatorios/`, `apps/api/src/admin/reports*`, `packages/shared/src/profit-report.ts`, `packages/shared/src/schemas/admin-reports.ts`, `supabase/migrations/20261113000001_admin_reports.sql` | Claude | T-015 | REVISÃO (CLAUDE, 13/11/2026): feito com API e banco simulados (PGlite); migration só escrita, **não aplicada**; tela não vista no navegador (sem `next dev`). Regras de status, custo, frete e arredondamento em memoria.md |
| T-021 | Mini site da bio (`/links`) e banners editáveis | `apps/web/src/app/(bio)/links/`, `apps/web/src/app/(site)/_components/banner-carousel.tsx`, `apps/web/src/app/admin/(painel)/banners/` e `.../links/`, `apps/api/src/admin/site-content*`, `packages/shared/src/schemas/site-content.ts`, `supabase/migrations/20261114000001_site_content.sql` | Claude (assumida do Codex) | T-006 | REVISÃO (CLAUDE, 13/11/2026): feito com API e banco simulados (PGlite); migration só escrita, **não aplicada**; telas **não vistas no navegador** (sem `next dev`/`next build`). Detalhes e pendências em memoria.md |
| T-022 | SEO básico (ver `seo.md`): metadados por página, JSON-LD (WebSite, Store, Product, BreadcrumbList), `sitemap.xml` e `robots.txt` no build, Open Graph e Twitter Card, 404 útil, ícones e manifest, levando os modelos de `seo/` para o site. **Tirar o `noindex` do `layout.tsx` raiz** (hoje o site inteiro está fora do Google) e deixá-lo só nas rotas privadas. Siga a skill `/visibilidade` (o brief manda o executor ler) e feche com `pnpm --filter @sparks/web seo:audit` sem P0 | `apps/web/src/seo/`, `apps/web/public/`, `apps/web/src/app/layout.tsx`, `metadata` das páginas de `(site)/` | Codex | T-006 | LIVRE |
| T-032 | **Rodada de visibilidade** com a skill `/visibilidade corrigir`: auditar o site pronto (script `seo:audit` + checklist de conteúdo, dados estruturados, GEO e local), **preservar o que existe e criar o que falta** (descrições e textos de categoria e produto sem inventar dados, fidelidade do JSON-LD ao texto visível, links internos, imagens, desempenho no celular, decisão do `/busca`, rastreadores de IA em `[A DEFINIR]`) e escrever `docs/relatorios/visibilidade-AAAA-MM-DD.md`. O que depende de domínio ou conta (Search Console, Perfil da Empresa, Lighthouse no domínio real, WAF) vira lista para a T-025/T-031 | `apps/web/src/seo/`, `apps/web/public/`, `metadata` e textos de `(site)/`, `docs/relatorios/` | Claude | T-022 (e conteúdo das categorias, se houver) | LIVRE (depois da T-022) |
| T-023 | Segurança P0, **parte sem contas** (código e arquivos, sem rodar nada real): exigir `aal2` nas rotas `/admin/*` **e criar as telas de cadastro e verificação do TOTP no login do admin** (hoje não existem; sem elas o painel ficaria trancado), CSP e demais cabeçalhos do site, workflow de backup noturno e script de teste de restauração (escritos e conferidos, não executados), checklist P0 do `docs/seguranca.md` com o que depende de conta marcado. Testes com Supabase simulado **[RC]**. A execução real (ativar o TOTP no Supabase, rodar o backup, restaurar) fica na T-031 | `.github/`, `apps/api/`, `apps/web/src/app/admin/login/`, `docs/seguranca.md` | Claude | T-015 | LIVRE |
| T-024 | Testes ponta a ponta **com serviços simulados** (compra Pix e cartão, rural, cupom, estoque, cotação do Melhor Envio, entrega rápida e falha do Melhor Envio). A rodada com os sandboxes reais é da T-031 | `e2e/` | Claude | T-018, T-019, T-030 | LIVRE (depois de T-018, T-019 e T-030) |
| T-031 | **Conectar os serviços reais** (quando o Rafael criar as contas), nesta ordem: (1) GitHub: repositório, identidade do Git, CI rodando; (2) Supabase de teste: aplicar as migrations, Auth (sem cadastro por e-mail, só Google; JWT assimétrico; CAPTCHA), usuário admin com TOTP, bucket `products`, e validar o que ficou "só com Supabase real" na T-008, T-014 e T-015 (concorrência, `FOR UPDATE`, trava de versão); (3) Cloudflare: Worker de teste, secrets, Turnstile, `DEPLOY_HOOK_URL`; (4) Mercado Pago de teste: token, webhook e `MP_WEBHOOK_SECRET`, compra de teste de ponta a ponta; (5) Melhor Envio sandbox: token e validação da cotação; (6) backup noturno e teste de restauração; (7) repetir a T-024 com os sandboxes. Cada passo registra o resultado na `memoria.md` | `apps/*`, `supabase/`, `.github/`, infra | Rafael + Claude | contas criadas pelo Rafael; T-023, T-024 | BLOQUEADA (sem GitHub, Cloudflare, Supabase, Mercado Pago e Melhor Envio) |
| T-025 | Deploy de produção, DNS, Search Console, conta e token de produção do Melhor Envio (`MELHOR_ENVIO_TOKEN`) e checklist final | infra | Rafael + Claude | T-031 | BLOQUEADA (T-031, domínio e dados da cliente) |
| T-026 | Treinamento (roteiro de 1h) e cadastro de 10 a 15 produtos de exemplo | `docs/treinamento.md` | Rafael | T-025 | BLOQUEADA (depende da T-025) |
| T-027 | Assinatura do desenvolvedor ("by rumera.") no fim do rodapé, pedido do Rafael | `apps/web/src/app/(site)/_components/footer.tsx`, `.../rumera-credit.tsx`, `(site)/site.css` | Claude | T-006 | FEITA (CLAUDE em 08/10) |
