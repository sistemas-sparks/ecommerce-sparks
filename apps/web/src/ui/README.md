# Componentes base — T-004

Tokens e proporções seguem `docs/design.md` e `referencias/prototipo/index.html`. Fontes WOFF2 locais copiadas de `marca/fontes/`, com as licenças OFL preservadas. `layout.tsx` aplica as variáveis de `next/font/local`; `globals.css` importa o tema.

Importe os componentes de `@/ui`. Importe as fontes de `@/ui/fonts` apenas no servidor. Utilitários Tailwind disponíveis: `bg-bg`, `bg-surface`, `text-ink`, `text-magenta`, `font-body`, `font-display`, `rounded-card`. As quebras `phone`, `tablet` e `desktop` representam 560, 760 e 1020px.

- `Button`: variantes `primary` (magenta), `plum`, `white`, `outline`; `loading` bloqueia novos cliques e aplica `aria-busy`. Padrão `type="button"`; use `type="submit"` em formulários. `outline` é usado sobre fundo escuro.
- `ButtonLink`: mesmas variantes para navegação com Next Link.
- `IconButton`: exige `aria-label`. Alvo de 48px; nos cards, 44px.
- `Card` e `Badge`: superfície branca e selo amarelo. Conteúdo livre, sem regras de negócio.
- `Clip` e `ClipDivider`: ornamentos SVG do protótipo, ignorados por leitores de tela; nunca substituem o logo.
- `SectionHeading`: título com clipe, descrição e ação opcionais; `as` define `h1`, `h2` ou `h3` conforme a hierarquia da página.
- `ProductCard`: foto 4:5, selo, favorito controlado e botão de sacola. Recebe `onAdd` e `onFavoriteChange` de um componente cliente. `priceLabel` é só apresentação: o chamador usa o formatador de centavos da T-003. Não calcula preços, frete ou estoque.

Use `sparks-product-grid` no contêiner dos produtos (2 colunas no celular, 3 no tablet, 4 no desktop). Os clipes alternam magenta/violeta/dourado/turquesa; `clipColor` permite uma escolha explícita. Fotos reais vêm do catálogo; não usar os recortes de Instagram em produção.

Não há dados de exemplo da cliente nem chamadas à API neste módulo. Foco visível, contraste dos textos, movimento reduzido e alvos de toque fazem parte da base.
