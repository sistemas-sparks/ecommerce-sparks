# Plano de segurança (planos gratuitos)

Nenhum sistema é impenetrável. O objetivo é ter camadas independentes, privilégio mínimo, detecção rápida e backup restaurável.

## P0 — obrigatório antes de publicar
- [ ] RLS em todas as tabelas, com testes automáticos de acesso negado (anon, cliente A tentando acessar dados do cliente B).
- [ ] `service_role`, token do Mercado Pago e token do Melhor Envio apenas como secrets do Worker; `gitleaks` no CI.
- [ ] Melhor Envio: chamado só pela API, com timeout curto e resposta validada com Zod; envia só CEPs, medidas, pesos e valor segurado (nenhum dado pessoal); falha vira "frete a combinar", nunca preço inventado.
- [ ] Preço, frete, cupom, embalagem e total recalculados no servidor.
- [ ] Webhook do Mercado Pago: assinatura validada, consulta do pagamento na API do Mercado Pago, conferência de valor e `external_reference`, idempotência por `provider_event_id`.
- [ ] Turnstile em checkout, consulta de pedido, cupom e login; limite de requisições na API (tabela `rate_limits` ou recurso nativo do Cloudflare).
- [x] Painel: papel `admin` em `app_metadata` + TOTP (AAL2) verificados na API (T-023, código e testes). **Falta com conta (T-031/T-038):** conferir no Supabase de teste o cadastro e a verificação do TOTP e a regra de só aceitar novo fator com `aal2` quando já existe um; sessão curta (configuração do projeto Supabase); seguir o procedimento do primeiro cadastro do TOTP (seção "Primeiro cadastro do TOTP" abaixo), que a tela não consegue garantir sozinha.
- [x] Cabeçalhos: CSP restrita, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'` (T-023: `apps/web/public/_headers` + `scripts/harden-export.mjs`, com testes). **Falta com conta (T-031):** build de produção com `NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_SUPABASE_URL` reais (`harden-export.mjs --strict`), conferir no navegador (Turnstile, fontes, fotos do Storage) e rodar `py -3 ferramentas/auditar_url.py` no site publicado.
- [ ] CORS só com as origens exatas do site.
- [ ] Upload de fotos: só JPEG, PNG e WebP, até 5 MB, URL assinada, reprocessamento da imagem (remove metadados); sem SVG.
- [ ] Backup noturno criptografado e um teste de restauração feito antes da publicação. **Escrito, não executado** (T-023): `.github/workflows/backup.yml` e `scripts/backup/test-restore.sh`; procedimento em `docs/backup.md`. **Falta com conta (T-031):** repositório no GitHub, segredos `SUPABASE_DB_URL` e `BACKUP_AGE_RECIPIENT`, par de chaves age gerado pelo Rafael, uma execução manual e um teste de restauração real.
- [ ] DNS no Cloudflare com SSL "Full (strict)", HTTPS obrigatório e DNSSEC.

### Estado do P0 em 12/11/2026 (T-023)
- **Feito em código e arquivos nesta rodada:** painel com `aal2` (API e telas de cadastro e verificação do TOTP), cabeçalhos e CSP, workflow e script de backup (escritos, não executados).
- **Já existiam no código, sem revisão nova aqui:** testes de RLS no banco simulado (`supabase/tests/rls.test.ts`), `gitleaks` no CI, Turnstile e limite de requisições nas rotas públicas, webhook, CORS por origem exata. Marcar os itens correspondentes só depois da revisão e, onde há serviço real, da validação na T-031.
- **Depende de conta (T-031):** RLS conferida no Supabase real, secrets do Worker, Turnstile e CAPTCHA do Supabase Auth, DNS, SSL e DNSSEC no Cloudflare, execução real do backup e da restauração, Melhor Envio e Mercado Pago reais.

### Notas do login do painel (T-023)
- A API responde `403 mfa_required` ao admin que entrou só com a senha (`aal1`); quem não é admin recebe `403 forbidden` e nunca vê a segunda etapa. Todas as rotas `/admin/*` (inclusive `/admin/me`) exigem `aal2`.
- Primeiro acesso: a tela mostra o QR e a chave para cadastrar o aplicativo autenticador e pede o primeiro código. Depois, só o código. Se o aparelho for perdido, a recuperação é feita pelo Rafael no painel do Supabase (apagar o fator do usuário); o site não tem código de recuperação.
- **A confirmar no Supabase real:** com um TOTP já confirmado, uma sessão `aal1` não pode cadastrar outro fator (senão quem souber só a senha cadastraria o seu). A tela nunca oferece isso, mas a regra precisa valer no servidor do Supabase.

### Primeiro cadastro do TOTP (TOFU) e criação do admin (C-1 da revisão T-036)
**Risco:** o site não consegue impedir que quem souber só a senha do admin chame o Supabase Auth direto (sem a tela) e cadastre o **seu** aplicativo como fator, antes da lojista. Depois do primeiro fator confirmado, a regra do servidor (item abaixo) protege; **antes dele, só o procedimento protege**.

**Procedimento obrigatório (Rafael, na criação do admin; nenhuma senha de admin circula antes):**
1. Criar o usuário no painel do Supabase **sem** `app_metadata.role=admin` e com senha forte gerada na hora (gerenciador de senhas; nunca por e-mail, WhatsApp ou chat).
2. Com a lojista presente (ou em chamada com tela compartilhada só da tela dela, sem mostrar a senha), ela entra pela página de login do painel e cadastra o TOTP no próprio celular, na tela de cadastro do site, e confirma o primeiro código.
3. **Só depois** de o fator estar confirmado, o Rafael define `app_metadata.role=admin` no Supabase. Até lá o usuário não tem acesso a nenhuma rota `/admin/*` e a API não mostra a segunda etapa (`403 forbidden`).
4. No painel do Supabase (Authentication, Users), conferir que há **exatamente 1** fator `totp` com status `verified` e nenhum `unverified` pendente; apagar os pendentes. Anotar a data em `docs/memoria.md`.
5. A senha só é entregue à lojista **depois** dos passos 2 a 4 (se o cadastro foi feito no aparelho dela, ela mesma a digitou; senão, trocar a senha logo em seguida pelo fluxo de recuperação). Se a senha circulou antes do passo 2, tratá-la como vazada: trocar a senha e apagar todos os fatores antes de continuar.
6. Perda do aparelho: o Rafael apaga o fator no painel e repete este procedimento (a senha deve ser trocada antes do novo cadastro).

**Verificação no Supabase real (tarefa T-038, com conta):**
- [ ] Limitar fatores por usuário (`max_enrolled_factors`/limite de fatores MFA no Auth do projeto) ao mínimo viável, sem permitir um segundo TOTP verificado.
- [ ] Com o admin já com TOTP confirmado, uma sessão `aal1` (só a senha) chamando `POST /auth/v1/factors` (enroll) é **recusada**. Se não for, a regra precisa ser imposta de outro modo (por exemplo, revogar sessões ou alertar) e a decisão volta ao Rafael.
- [ ] Um usuário sem `role=admin` que cadastra TOTP não passa em nenhuma rota `/admin/*` (a API devolve `403 forbidden`).
- [ ] Contagem de fatores `verified` do admin é 1 depois do passo 4; o passo 3 foi feito nessa ordem (conferir no log de auditoria do Auth).
- [ ] Opcional: rotina com `service_role` (só no Worker, fora do navegador) que alerte se o admin tiver mais de 1 fator verificado.

## P1 — logo após publicar
- [ ] Regras do WAF gratuito: bloquear caminhos de varredura (`/.env`, `/.git`, `/wp-admin`); permitir só GET e POST; desafio para tráfego estrangeiro em `/admin` e na API.
- [ ] Alertas: erros 5xx, falhas de assinatura do webhook, pico de tentativas de cupom e de login, uso da cota do Worker acima de 70%.
- [ ] `audit_log` em todas as ações do painel.
- [ ] Dependabot e `pnpm audit` no CI.
- [ ] Varredura com OWASP ZAP no ambiente de teste.

## Ameaças × defesas
| Ameaça | Defesa |
|---|---|
| Alterar preço ou frete pelo navegador | Recalcular tudo no servidor |
| Webhook falso ou repetido | Assinatura + consulta à API + idempotência |
| Ler pedidos de outros | RLS + token com hash + código do pedido e WhatsApp com Turnstile |
| Teste de cartões roubados | Checkout hospedado do Mercado Pago + Turnstile + limite de tentativas |
| Força bruta em cupom | Limite de requisições + mesma resposta para inválido ou expirado |
| Esgotar estoque sem pagar | Reserva com expiração + limite de pedidos pendentes por IP/WhatsApp |
| Esgotar a cota gratuita (DoS) | Páginas estáticas + WAF + limite de requisições + Turnstile |
| XSS (incluindo a mensagem do cartão) | Escape sempre, sem HTML vindo do usuário, CSP |
| Vazamento de segredos | Secrets do Worker, gitleaks, nada em logs |
| Perda de dados | Backup noturno + teste de restauração + exclusão lógica |

## Acessos da cliente (decisão do Rafael)
A cliente cria o e-mail da loja e a conta do Mercado Pago e envia os acessos ao Rafael. A verificação em duas etapas fica desligada até a entrega.
**Na entrega:** a cliente troca todas as senhas, ativa a verificação em duas etapas e guarda os códigos de recuperação. O Rafael segue como colaborador apenas onde for necessário.
Enquanto isso, o acesso à conta do Mercado Pago é usado **somente** para gerar as credenciais da loja. Guardar as senhas em gerenciador de senhas, nunca em texto.

## Plano de incidente
1. Ativar o modo "Under Attack" do Cloudflare e desligar o checkout (variável de ambiente).
2. Rotacionar todas as chaves (Supabase, Mercado Pago, Melhor Envio, Turnstile).
3. Analisar o `audit_log` e os logs.
4. Restaurar o backup, se necessário.
5. Avisar a cliente e, havendo dados pessoais envolvidos, seguir a LGPD.

## Propostas pendentes (mexem em banco, aguardam o OK do Rafael)
Do relatório da T-003 (`Projetos/sparks/seguranca/revisao-ia-2026-10-26.md`). Nada disto foi aplicado: as duas mudanças ficam dentro de `public.create_order` (nova migration) e pedem teste em `supabase/tests/checkout.test.ts`.

**S-04: estoque esvaziável por pedidos não pagos.** Hoje há 10 pedidos por 10 min por IP e 3 pendentes por hora por WhatsApp. Proposta:
1. Teto global de pedidos `awaiting_payment` criados nos últimos 30 minutos (ex.: 30). Acima disso, `raise exception 'too_many_pending'` (o mesmo erro que o cliente já recebe).
2. Teto de unidades por item proporcional ao estoque: `v_qty <= greatest(1, floor(v_product.stock * 0.5))`; acima, `raise exception 'qty_over_limit'` (nova mensagem ao cliente: "Essa quantidade é maior do que podemos reservar de uma vez. Fale com a loja.").
3. Painel: contar os pedidos expirados nas últimas 24 h e avisar a lojista quando passar de um limite.
Os números são pontos de partida; os valores finais dependem do volume real da loja ([A DEFINIR] com a cliente).

**S-02: "frete a combinar" segura estoque sem prazo.** É decisão travada do Rafael (reserva sem prazo até a lojista confirmar). Para limitar o estrago sem tirar a decisão:
1. Teto global de pedidos `awaiting_shipping_quote` abertos (ex.: 20), com o mesmo erro `too_many_pending`.
2. Aviso no painel quando houver pedido `awaiting_shipping_quote` com mais de 24 h.
3. **Só se o Rafael topar:** prazo longo (72 h) com aviso antes, estendendo `expire_unpaid_orders` para esse status.
O item 3 muda uma regra travada e não deve ser feito sem o "sim" dele.
