# PRD — Loja virtual Sparks Papelaria

## 1. Visão
Loja virtual própria da Sparks Papelaria, com a identidade da marca ("papelaria também é afeto"), para vender pelo site com pagamento automático, tirando a operação de vendas do improviso do WhatsApp e dando seriedade e visibilidade à marca.

## 2. Contexto
- A Sparks vende hoje por Instagram e WhatsApp e passou a ter ponto físico em um espaço colaborativo.
- A identidade visual (logo, cores, fonte) já existe e deve ser respeitada.
- Plano contratado: **Completo (R$ 1.200)**; era R$ 1.000, com aditivo do frete (Melhor Envio + fretes próprios) aceito em 20/10/2026. Prazo: **até 20 dias úteis** após a 1ª parcela e o envio dos materiais.

## 3. Público
- Pais e mães comprando material escolar, mimos e presentes.
- Estudantes e adultos que gostam de papelaria fofa e colecionável.
- Quem compra presentes para datas comemorativas.
- Região da loja (entrega rápida e entrega local, fretes próprios) e todo o Brasil (transportadoras cotadas pelo Melhor Envio).

## 4. Escopo incluído

### 4.1 Vitrine (cliente final)
- Site responsivo (celular e computador) com a identidade da Sparks.
- Cabeçalho com logo, busca, favoritos e sacola; o cabeçalho encolhe ao rolar.
- Banner em carrossel logo abaixo do cabeçalho.
- Categorias, busca, favoritos e página de produto com várias fotos e descrição.
- Página "Consultar pedido", página "Minha conta" e mini site de links para a bio do Instagram.

### 4.2 Compra
- Sacola com quantidade, cupom, embalagem de presente e frete.
- **Frete automático por CEP** com preço e prazo: fretes próprios por faixa de CEP (entregas rápidas e entrega local) + cotação nacional pelo Melhor Envio (só cotação). Ver `frete.md`.
- **Cupom**: percentual ou valor fixo, validade, limite de usos, compra mínima, um por pedido. Não desconta frete nem embalagem.
- **Embalagem de presente**: disponível se ativada no painel; o cliente escolhe um modelo cadastrado e escreve a mensagem do cartão (até 140 caracteres). Uma por pedido.
- Checkout **sem cadastro obrigatório** (nome, WhatsApp, endereço completo, tipo de endereço). E-mail opcional.
- Pagamento por **Pix ou cartão** no checkout hospedado do Mercado Pago, com confirmação automática por webhook.
- Endereço rural ou de difícil acesso → pedido "aguardando frete", sem cobrança, até a lojista confirmar valor e prazo.

### 4.3 Pós-compra
- Link exclusivo do pedido e "Consultar pedido" (código + WhatsApp).
- Status: aguardando pagamento → pago → em separação → enviado → entregue (mais cancelado, expirado, aguardando frete, devolvido).
- Código de rastreio (informado pela lojista) exibido com link de rastreio da transportadora.
- Conta opcional com Google: "Meus pedidos", endereço salvo e favoritos.

### 4.4 Painel administrativo
- Login com verificação em duas etapas.
- Produtos: cadastro, fotos, preço, custo, estoque, categoria, tamanho de embalagem (P/M/G) e peso, ativo/inativo, destaque, selo.
- Importação de produtos por planilha (CSV no modelo fornecido).
- Pedidos: lista, filtros, detalhe, mudança de status, rastreio, mensagem do cartão para impressão e botão "Avisar no WhatsApp" com mensagem pronta.
- Frete: tipos de frete próprios (ex.: entrega rápida, entrega local) com áreas por faixa de CEP, preço e prazo; serviços do Melhor Envio exibidos e folga em R$; exceções, limites, frete grátis, tempo de preparo.
- Cupons, embalagem de presente (interruptor e modelos), banners e textos básicos.
- **Relatório de lucro simples**: vendas, custo e lucro por período e por produto.
- Botão "Publicar alterações" (gera nova versão estática do site).

### 4.5 Outros
- SEO completo (ver `seo.md`), sem garantia de posição.
- Segurança (ver `seguranca.md`).
- Treinamento de 1 hora e cadastro de 10 a 15 produtos de exemplo.
- Publicação no domínio .com.br da cliente.

## 5. Fora do escopo
Boleto · e-mails para clientes · etiqueta e rastreio automáticos (inclusive compra de etiqueta pelo Melhor Envio) · cotação de frete por terceiros além do Melhor Envio · orçamentos para escolas e empresas · cupons avançados (por categoria, primeira compra) · painel financeiro completo · venda de balcão no sistema · nota fiscal · marketplaces · aplicativo nativo · outros idiomas · avaliações · carrinho abandonado · chat ao vivo.

## 6. Fluxos principais
1. **Compra**: produto → sacola → CEP e frete → cupom/embalagem → dados e endereço → revisão → Mercado Pago → retorno → página do pedido.
2. **Pós-pagamento**: webhook confirma → pedido "pago" → estoque baixado → lojista vê no painel → separa → "Avisar no WhatsApp".
3. **Envio**: lojista posta → informa rastreio → status "enviado" → avisa no WhatsApp.
3a. **Etiqueta**: a lojista compra a etiqueta no painel do Melhor Envio (fora do nosso sistema) e copia o rastreio para o painel da loja.
4. **Rural** (e falha do Melhor Envio sem frete próprio para o CEP): "aguardando frete" → lojista define valor e prazo → link de pagamento (48h) → fluxo normal.

## 7. Critérios de aceite (resumo)
- Cliente compra do celular em até 5 telas, sem criar conta.
- Total pago = soma calculada pelo servidor (testes automatizados cobrindo frete, cupom e embalagem).
- Webhook repetido não gera duplicidade de pedido, estoque ou cupom.
- Estoque nunca fica negativo, mesmo com compras simultâneas.
- Pedido rural nunca é cobrado antes da confirmação da lojista.
- Painel inacessível sem papel admin e sem verificação em duas etapas.
- Lighthouse no celular: SEO ≥ 95, acessibilidade ≥ 90, desempenho ≥ 85 na home.
