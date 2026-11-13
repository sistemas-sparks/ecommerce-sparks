# Auditoria de acessibilidade WCAG 2.2 AA: loja e painel (T-006)

Data: 2026-11-12. Escopo: loja pública (home, categoria, produto, sacola, checkout, políticas) e painel admin.
Método: revisão estática do código (`apps/web/src`), cálculo de contraste com as cores de `ui/theme.css` e
verificação de typecheck, lint e testes. **Não houve auditoria renderizada** (sem Lighthouse nem axe nesta
rodada): a revisão no navegador fica como pendência. Áreas excluídas: `admin/login`, cabeçalhos HTTP e API.

## Corrigido nesta rodada (contraste de campos, 1.4.11)
A borda de 2px dos campos usava `--color-line` (#F0D9E2), com contraste de 1,34:1 sobre branco.
Troquei por `--color-mauve` (#948588), que já é a borda aprovada dos campos do checkout (`.checkout-input`)
e dá 3,52:1 sobre branco e 3,30:1 sobre o fundo da página (mínimo 3:1).

| Arquivo | Seletor |
|---|---|
| `apps/web/src/app/(site)/site.css` | `.site-search input`, `.site-results-bar select` |
| `apps/web/src/features/cart/cart.css` | `.cart-field` |
| `apps/web/src/app/admin/(painel)/cupons/coupons.css` | `.coupons-field input/select` |
| `apps/web/src/app/admin/(painel)/frete/shipping.css` | `.shipping-field input/select` |
| `apps/web/src/app/admin/(painel)/importar/import.css` | `.import-file input` |
| `apps/web/src/app/admin/(painel)/produtos/products.css` | `.products-panel select/textarea` |

Evidência: `pnpm --filter @sparks/web typecheck` (exit 0), `pnpm --filter @sparks/web lint` (exit 0, `--max-warnings=0`),
`pnpm --filter @sparks/web test` (8 arquivos, 73 testes passando), `prettier --check` nos 6 CSS (ok).

## Verificado e conforme
- Idioma: `<html lang="pt-BR">` (`app/layout.tsx`).
- Link "Ir para o conteúdo" no cabeçalho da loja, com `id="conteudo"` em todas as `<main>` da loja.
- Foco visível: `:focus-visible` com contorno magenta de 3px (`ui/theme.css`), contraste 4,84:1 sobre o fundo.
- Alvos de toque: botões, ícones, quantidade, pontinhos do carrossel e links do menu com 44px ou mais.
- Movimento: `prefers-reduced-motion` em `ui/theme.css` e `features/cart/cart.css`. O carrossel não gira sozinho.
- Sacola (diálogo): `role="dialog"`, `aria-modal`, nome por `aria-labelledby`, foco preso, Esc fecha, foco volta à origem.
- Checkout: `label htmlFor` em todos os campos, `aria-invalid` e `aria-describedby` nos erros, `role="alert"` no CEP,
  foco no primeiro campo inválido.
- Painel: erros com `role="alert"` ou `role="status"`, `aria-invalid` em cupons e importação, `nav` com `aria-current`.
- Imagens: `alt` vindo do catálogo; logo com alt; imagens decorativas do carrossel em `aria-hidden`.
- Botões sem texto visível têm `aria-label` (busca, favoritos, sacola, quantidade, fechar, favoritar).
  Cards de produto usam nome do produto no `aria-label` ("Adicionar à sacola: <nome>").
- Títulos: uma `h1` por página (no carrossel, a primeira fala é `h1` e os demais slides são `h2`).
- Contraste de texto: texto branco sobre magenta (5,17:1) e violeta (6,57:1), ameixa sobre manteiga (10,5:1) e sobre teal
  (7,2:1), `ink-soft` sobre fundo (6,0:1), magenta-dark sobre branco (6,8:1).

## Pendências (não corrigidas)
1. **`.admin-input` em `app/admin/admin.css` (borda `--color-line`, 1,34:1).** Usado pelo login e pelo `mfa-step`.
   Área do T-036 (login): trocar depois que o outro agente terminar, com o mesmo token `--color-mauve`.
2. **Cabeçalho fixo com foco possivelmente escondido (2.4.11).** `.site-header` é `position: sticky` e não há
   `scroll-padding-top` em `html`. Falta medir a altura renderizada do cabeçalho (compacto e normal) para definir o valor.
3. **Bordas de contêineres em `--color-line`** (`.cart-qty`, `.site-quantity > div`, `.sparks-card`). Decidir se são
   fronteira necessária para identificar o controle (1.4.11). Se for, usar mauve.
4. **Botão fixo de WhatsApp** (`.site-whatsapp`, canto inferior direito) pode cobrir o foco de elementos no rodapé
   (2.4.11). Conferir no navegador.
5. **Conteúdo visível "[A DEFINIR]"** no 2º slide do carrossel e nas fotos sem imagem. Não é acessibilidade, mas o
   cliente vê o texto. Depende de dado da Sparks (já pendente).
6. **Painel admin sem link "Ir para o conteúdo"** (`app/admin/(painel)/layout.tsx`). Baixa prioridade.
7. **Auditoria renderizada pendente.** Rodar Lighthouse (mobile 390px e desktop 1280px) nas rotas da loja e do painel
   após o build, e um teste com teclado e leitor de tela no checkout e na sacola.

## Arquivos alterados
Os 6 CSS listados acima e este relatório. Nada em `admin/login`, cabeçalhos HTTP ou `apps/api`.
Tarefa T-006 não marcada como feita (decisão do orquestrador).
