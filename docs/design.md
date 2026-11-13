# Design

**Referência visual aprovada pela cliente:** `referencias/prototipo/index.html` (também em https://sparkspapelaria.netlify.app).
A implementação em React/Tailwind deve reproduzir o protótipo. Quando houver dúvida, o protótipo vence.

## Personalidade
Afeto, cor, encantamento e seriedade. Lúdico sem ser "lojinha de canetas". Sem neon, sem brilho (glow), sem gradientes chamativos. Tema claro fixo.

## Cores (tokens)
| Token | Hex | Uso |
|---|---|---|
| `plum` | `#4B2145` | textos fortes, botões escuros, fundo de destaque |
| `magenta` | `#C8238A` | ação principal (botões, preços, ícones) |
| `magenta-dark` | `#A81C72` | hover da ação principal |
| `violet` | `#7A3BBE` | blocos de destaque, clipes |
| `gold` | `#F2B01E` | clipes, anel de categoria |
| `rose` | `#F7B7C4` | **cor do logo** (RGB 247 183 196) |
| `orchid` | `#DEA6CA` | **cor do logo** (RGB 222 166 202) |
| `mauve` | `#948588` | **cor do texto do logo** (RGB 148 133 136) |
| `rose-soft` | `#FDE6EC` | fundos de ícones e caixas |
| `lilac` | `#E6D5F3` | blocos suaves |
| `lilac-banner` | `#F1E4F7` | fundo do banner 1 |
| `butter` | `#FFE49E` | selos, destaque "novo" |
| `teal` | `#7CCFC2` | botão de WhatsApp, clipes |
| `bg` | `#FFF5F9` | fundo da página |
| `surface` | `#FFFFFF` | cartões |
| `ink` | `#3A1B38` | texto principal |
| `ink-soft` | `#6B5A63` | texto secundário |
| `line` | `#F0D9E2` | bordas |

Contraste mínimo AA. Texto branco só sobre `plum`, `magenta` e `violet`.

## Tipografia
- **Títulos:** Big Shoulders Text (fonte da marca), pesos 700 e 800, com altura de linha curta (0,92 a 1).
- **Texto:** Nunito, pesos 400, 600, 700 e 800.
- Arquivos em `marca/fontes/` (licença OFL), servidos localmente.
- **Nunca** reescreva o texto do logotipo com a fonte: o logo tem ajustes próprios. Use as imagens de `marca/logo/`.

## Identidade: o clipe
O símbolo da Sparks são dois clipes de papel. O clipe aparece como elemento gráfico:
- prendendo as fotos do banner e dos cards de produto (cores alternadas: magenta, violeta, dourado, turquesa);
- antes dos títulos das seções (clipe magenta inclinado);
- no divisor antes do rodapé (fileira de clipes coloridos).

SVG do clipe (viewBox `0 0 28 68`, traço 3,2, pontas arredondadas, contorno branco de 7 por baixo):
`M20 26V54a8 8 0 0 1-16 0V16a10 10 0 0 1 20 0V50`

## Layout e componentes (ver protótipo)
1. **Cabeçalho** fixo: logo alternativo, busca, favoritos e sacola, mais o menu de categorias centralizado. Ao rolar, encolhe e esconde o menu (no celular também esconde a busca). Sem barra de aviso acima.
2. **Banner** em carrossel (3 slides) com fundo dividido na diagonal:
   1. lilás claro e orquídea, texto ameixa: "Papelaria também é afeto.";
   2. violeta e manteiga: campanha sazonal (definir com a cliente);
   3. ameixa e orquídea: "Tudo para a volta às aulas."
   Colagem de 3 fotos presas por clipes. Texto curto: título, uma frase e um botão.
3. **Faixa de vantagens** (3 itens, centralizados): Embalagem de presente · Pix e cartão · Atendimento no WhatsApp.
4. **Categorias** em círculos com anel colorido.
5. **Cards de produto**: foto 4:5, clipe no topo, selo, favoritar, nome, preço (Big Shoulders, magenta) e botão "Adicionar à sacola".
6. **Para cada momento**: 4 cartões coloridos (Volta às aulas, Para presentear, Para estudar, Para colecionar).
7. **Seção da marca** em magenta: "Uma pequena faísca pode acender uma grande luz." e o símbolo sobre um cartão branco.
8. **Instagram**: grade de 6 fotos e o botão "Seguir no Instagram".
9. **Rodapé** branco com logo, links e endereço.
10. **Botão fixo de WhatsApp** (turquesa).
11. **Página de produto**: galeria com miniaturas, preço, nota de pagamento, quantidade, adicionar, favoritar, vantagens e acordeões (Detalhes, Entrega) e "Você também pode gostar".
12. **Sacola** (painel lateral): itens, embalagem de presente (modelo e mensagem com contador de 140), cupom, frete por CEP, subtotal, desconto, frete, embalagem e total.
13. **Mini site da bio** (`/links`): logo, frase da marca e até 5 botões grandes, nas cores da marca.

## Responsivo
Quebras em 1020px, 760px e 560px. Mobile-first. Alvos de toque de pelo menos 44px. Respeitar `prefers-reduced-motion`.

## Imagens
Produto em 4:5, fundo colorido como no Instagram da Sparks. WebP com várias larguras e carregamento preguiçoso fora da primeira dobra.
As fotos de `marca/fotos-instagram/` são recortes de prints, servem **só como referência** e não vão para produção.

## Painel administrativo
Mesmos tokens, visual mais neutro (fundo branco, acentos magenta). Prioridade: rápido de usar no celular (a lojista vai cadastrar produtos pelo telefone).
