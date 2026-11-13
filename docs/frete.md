# Frete híbrido: fretes próprios + Melhor Envio

**Decisão de 20/10/2026 (Rafael), substitui o "motor próprio por tabelas":** a cotação junta duas fontes.
1. **Fretes próprios**: tipos de frete cadastrados pela lojista (ex.: "Entrega rápida", num raio menor, e "Entrega local"), com áreas por faixa de CEP, preço e prazo.
2. **Melhor Envio**: cotação nacional das transportadoras (Correios e outras). **Só cotação.** A lojista compra a etiqueta no painel do Melhor Envio, fora do nosso sistema, e copia o rastreio para o painel da loja.

Nenhuma outra cotação de terceiros (Frenet, API dos Correios etc.) sem aprovação do Rafael (`regras.md` R2.5).
O cliente digita o CEP e vê as opções com preço e prazo, como em qualquer loja. Implementação na **T-028**; painel na **T-029**.

## 1. Entradas
CEP de destino (8 dígitos), itens da sacola (peso, tamanho P/M/G ou medidas, quantidade e preço), embalagem de presente (se houver) e tipo de endereço.

## 2. Algoritmo (`packages/shared/shipping` + chamada ao Melhor Envio na API)
1. **Validar o CEP** (formato). Se for inválido: "CEP não encontrado, confira o número."
2. **Exceções** (`shipping_cep_exceptions`): `block` → sem entrega; `consult` → frete a combinar; `extra_days` / `extra_cents` → somar a todas as opções no fim.
3. **Tipo de endereço** rural ou de difícil acesso → sempre frete a combinar (status `awaiting_shipping_quote`), mesmo em área de frete próprio.
4. **Volumes e peso** = soma de (peso real ou peso do tamanho P/M/G) × quantidade + embalagem de presente + tara da caixa. Medidas do volume a partir dos tamanhos P/M/G (regra de montagem do volume definida e testada na T-028).
5. **Limites**: acima de `max_weight_auto_g` ou de `max_items_auto_shipping` → frete a combinar.
6. **Fretes próprios**: para cada tipo de frete ativo, a área mais específica que contém o CEP gera uma opção (nome do tipo, preço e prazo da área).
7. **Melhor Envio**: cotar os serviços habilitados no painel (ver §4). Opções que voltarem com erro (ex.: transportadora não atende o CEP) são descartadas. Somar a folga em R$ configurada pela lojista.
8. **Prazo** = `handling_days` + prazo da opção, em dias úteis a partir da confirmação do pagamento.
9. **Acréscimos** das exceções (`extra_days`/`extra_cents`) em todas as opções.
10. **Frete grátis**: se o subtotal com desconto for maior ou igual a `free_shipping_min_cents`, a **opção mais barata do Melhor Envio** fica R$ 0,00 (a lojista paga a etiqueta). *Proposta, confirmar com a cliente; também está pendente se vale para os fretes próprios.*
11. **Nenhuma opção** (Melhor Envio fora do ar e sem frete próprio para o CEP, ou nenhuma transportadora atende) → frete a combinar, com a mensagem "Não conseguimos calcular o frete agora. Você pode finalizar e a loja confirma o valor pelo WhatsApp, sem cobrança antes disso."

Saída: lista de opções `{service, carrier, label, price_cents, days_min, days_max}` ou `{mode: 'consult' | 'blocked', message}`.
`service` identifica a origem: `own:<id do tipo>` ou `me:<id do serviço no Melhor Envio>`.
A cotação é **recalculada no `/checkout`** (chama o Melhor Envio de novo). O valor enviado pelo navegador nunca é usado (R3.3). Se a opção escolhida sumir ou mudar de preço no recálculo, o checkout recusa e pede para escolher o frete de novo.

## 3. Fretes próprios
- **Tipo de frete**: nome exibido (ex.: "Entrega rápida"), ativo/inativo, ordem.
- **Área**: faixa de CEP (`cep_start`..`cep_end`), rótulo (ex.: "Jardins"), preço em centavos, `days_min`/`days_max` (0 = no mesmo dia), ativa/inativa.
- O "raio" da entrega rápida é desenhado pela lojista com faixas de CEP ou bairros. **Não** usamos distância nem geolocalização, porque isso exigiria outro serviço de terceiros.
- Horário de corte da entrega rápida (ex.: "pedidos pagos até 14h saem no mesmo dia"): **[A DEFINIR]** com a cliente; se existir, entra como texto da opção na T-028/T-029.

## 4. Integração com o Melhor Envio (só cotação)
- **Endpoint:** `POST /api/v2/me/shipment/calculate` (produção `https://melhorenvio.com.br`, sandbox `https://sandbox.melhorenvio.com.br`). Conferir na documentação oficial na T-028.
- **Autenticação:** `Authorization: Bearer <MELHOR_ENVIO_TOKEN>`, token da conta da loja só com o escopo de cotação, guardado **só como secret do Worker**. Cabeçalho `User-Agent` com o nome da aplicação e o e-mail de contato técnico, exigido pelo Melhor Envio. Validade e renovação do token: **confirmar** (pendência).
- **O que é enviado:** CEP de origem (`settings.origin_cep`), CEP de destino, medidas, peso e valor segurado dos volumes, e os serviços habilitados. **Nenhum dado pessoal** (nome, WhatsApp, endereço completo).
- **Resposta:** validada com Zod (`packages/shared`). O preço chega em reais (texto) e é convertido para centavos sem `float` (parse do decimal), com teste.
- **Falha:** timeout curto (ex.: 5 s), erro 4xx/5xx ou resposta inválida → ignora o Melhor Envio nessa cotação, loga só o código do erro (sem CEP completo nem segredo) e segue o passo 11.
- **Painel:** a lojista escolhe quais serviços aparecem (padrão: PAC e SEDEX) e uma folga opcional em R$ por envio.
- **Custo e cota:** a API de cotação é gratuita (paga-se só a etiqueta, fora do sistema). A cotação usa o mesmo limite de requisições e Turnstile já exigidos (R3.6). Cache curto por CEP + volumes é opcional e decidido na T-028.

## 5. Tamanhos padrão (editáveis no painel)
| Tamanho | Exemplo | Peso padrão | Medidas padrão |
|---|---|---|---|
| P | canetas, lápis, borrachas | 100 g | 16 × 11 × 4 cm |
| M | cadernos, blocos | 400 g | 30 × 22 × 5 cm |
| G | kits, estojos | 1.000 g | 35 × 25 × 12 cm |
Valores de exemplo, **a confirmar com a cliente**. Agora as medidas também são usadas na cotação do Melhor Envio.

## 6. Entrega local (informada pela cliente, **confirmar cidades e faixas de CEP**)
Vira um tipo de frete próprio na T-028.
| Área | Preço |
|---|---|
| Jardins e demais bairros (provável Aracaju) | R$ 12,00 |
| Barra (provável Barra dos Coqueiros) | R$ 17,00 |
| Socorro (provável Nossa Senhora do Socorro) | R$ 17,00 |

## 7. Frete a combinar
- Pedido criado como `awaiting_shipping_quote`, **sem cobrança**. Acontece com endereço rural ou de difícil acesso, exceção `consult`, limites de peso ou itens, ou quando nenhuma opção pôde ser calculada.
- A lojista define valor e prazo no painel. O sistema gera o link do pedido para pagamento, válido por 48 horas, e o botão "Avisar no WhatsApp".
- Se ela recusar: pedido cancelado, sem cobrança.

## 8. Testes obrigatórios
CEP inválido · exceções (as quatro ações) · rural · limites de peso e itens · área de frete próprio mais específica vence · vários tipos próprios para o mesmo CEP · Melhor Envio: resposta válida, serviço desligado no painel, transportadora com erro descartada, timeout, 5xx, resposta fora do schema, token inválido · conversão de preço em reais para centavos · folga · frete grátis no limite exato · nenhuma opção → a combinar · recálculo no checkout diferente do enviado pelo navegador · opção que mudou ou sumiu no recálculo.
