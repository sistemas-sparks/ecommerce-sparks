# Regras invioláveis

Estas regras valem para humanos e IAs. Só o Rafael pode alterá-las, e toda alteração é registrada em `memoria.md`.

## R1. Escopo
1. O escopo é o do `prd.md`, que reflete o orçamento aprovado pela cliente (Plano Completo, R$ 1.200; era R$ 1.000, aditivo do frete aceito pela cliente em 20/10/2026). Não adicione nem remova funcionalidades.
2. Itens da lista "Fora do escopo" do `prd.md` não são implementados, nem "de brinde".
3. Dados da cliente não são inventados. Usar `[A DEFINIR]` e registrar a pendência.

## R2. Decisões travadas
1. Stack: Next.js + TypeScript + Tailwind (export estático) no front; Cloudflare Workers + Hono na API; Supabase (Postgres, Auth, Storage); Mercado Pago para pagamentos.
2. Tudo em **planos gratuitos** (Cloudflare, Supabase, GitHub). Nenhum serviço pago sem aprovação.
3. Pagamento: **Pix e cartões** via Mercado Pago (checkout hospedado). **Sem boleto.**
4. **Nenhum e-mail é enviado aos clientes.** Avisos de pedido são feitos pela lojista via WhatsApp (botão com mensagem pronta).
5. Frete **híbrido** (ver `frete.md`): **fretes próprios por faixa de CEP** (entregas rápidas e entrega local) no motor próprio + **cotação nacional pelo Melhor Envio, só cotação** (a etiqueta é comprada pela lojista no painel do Melhor Envio, nunca pela nossa API). **Proibido** integrar qualquer outra cotação de terceiros (Frenet, API dos Correios etc.) sem aprovação do Rafael. *(Alterada pelo Rafael em 20/10/2026; antes era só motor próprio por tabelas.)*
6. Compra sem cadastro obrigatório; login do cliente opcional com Google; acompanhamento por link exclusivo ou por código do pedido + WhatsApp.
7. A lojista cadastra os produtos. A embalagem de presente é um produto do tipo "embalagem", ativado ou não no painel.

## R3. Segurança (nunca relaxar)
1. RLS ativado em **todas** as tabelas, com negação por padrão.
2. A chave `service_role` do Supabase, o token do Mercado Pago e o token do Melhor Envio existem **apenas** como secrets do Worker. Nunca no front, em logs ou no Git.
3. Preço, frete, desconto, embalagem e total são **sempre recalculados no servidor**. O cliente envia só IDs, quantidades, CEP e cupom.
4. Webhook do Mercado Pago: validar assinatura, consultar o pagamento na API do Mercado Pago, conferir valor e moeda, e processar cada evento **uma única vez** (idempotência).
5. Toda entrada externa é validada com Zod. Proibido `dangerouslySetInnerHTML` com conteúdo vindo de usuário ou banco.
6. Turnstile e limite de requisições em: login, consulta de pedido, validação de cupom, cotação de frete e checkout.
7. Logs sem dados pessoais (CPF, telefone completo, endereço) e sem segredos.
8. Painel administrativo exige papel `admin` (em `app_metadata`) e verificação em duas etapas (TOTP) checada no servidor.

## R4. Dinheiro e estoque
1. Valores em centavos inteiros. Arredondamentos documentados e testados.
2. Estoque baixado de forma atômica (função SQL), nunca por leitura + escrita no código.
3. O pedido guarda cópia (snapshot) de nome, preço e custo de cada item no momento da compra.

## R5. Design
1. Seguir `design.md` e o protótipo em `referencias/prototipo/`. Ele é a referência visual aprovada pela cliente.
2. Sem efeitos neon ou brilho (glow). Tema claro fixo. Banner logo abaixo do cabeçalho.
3. Nunca redesenhar o logotipo nem reescrever o texto do logo com a fonte; usar os arquivos de `marca/logo/`.
4. Acessibilidade: contraste AA, foco visível, alvos de toque de pelo menos 44px.

## R6. SEO
1. Nada de truques: sem texto escondido, sem excesso de palavras-chave, sem avaliações ou dados estruturados falsos.
2. Dados estruturados devem bater exatamente com o conteúdo visível da página.
3. Nunca prometer posição no Google em textos da loja ou para a cliente.

## R7. Colaboração entre IAs
1. Uma tarefa por IA por vez; nunca editar a área de uma tarefa `EM ANDAMENTO` da outra IA.
2. Novas dependências (pacotes npm) só com justificativa registrada em `memoria.md`.
3. `memoria.md` é só de acréscimo (exceto "Estado atual"). Não apagar registros.
4. Na dúvida, perguntar ao Rafael em vez de supor.
