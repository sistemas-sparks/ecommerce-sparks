# Fatos do projeto para SEO

Fontes: `docs/seo.md`, `docs/prd.md`, `docs/regras.md` (R2, R6), `docs/arquitetura.md`, `docs/design.md` e a pasta `seo/` na raiz (modelos prontos). Em conflito, vale a hierarquia do `AGENTS.md` §2.

## Negócio
- **Sparks Papelaria**, papelaria afetiva (cadernos, canetas, kits escolares, presentes). Dona: Varlene. Instagram @sparks_papelaria.
- Nome de marca e variações: Sparks Papelaria (padrão), Papelaria Sparks, Sparks Pink, Sparks Pink Papelaria. As variações vão em `alternateName` do JSON-LD e no "Quem somos". **Sem repetir em massa.**
- Cidade **[A DEFINIR]** (indício: Aracaju/SE). Endereço, CNPJ, WhatsApp e e-mail de contato: **[A DEFINIR]** até a cliente confirmar. Não publicar `address` nem `telephone` no JSON-LD sem confirmação.
- Entrega local (Aracaju, Barra dos Coqueiros, Nossa Senhora do Socorro) é hipótese até a cliente confirmar. Ver `docs/frete.md`.
- Assuntos: papelaria fofa, criativa, afetiva; cadernos e canetas fofos; kit e material escolar; presentes de papelaria; papelaria online. Lista completa em `docs/seo.md` §2.

## Técnica
- Site **estático** (`output: 'export'`, Next.js) em `apps/web/out/`; sem renderização no servidor. Bom para rastreamento: o conteúdo já vem no HTML.
- Catálogo pré-renderizado no build; preço e estoque "ao vivo" vêm da API. O JSON-LD de `Product` usa o que está **visível no HTML estático** e precisa bater com ele (R6.2).
- Modelos prontos em `seo/`: `robots.txt`, `sitemap.example.xml`, `site.webmanifest`, ícones, `og-image.jpg`, `jsonld/*.json` (WebSite, Store, Product, BreadcrumbList) e `meta/head-template.html`. A T-022 os leva para `apps/web/public/` e para o `metadata` das páginas.
- Uma prévia antiga existe em `*.netlify.app`: deve ficar `noindex` ou redirecionar, para não competir com o domínio oficial (T-025).

## Indexação por rota
| Rota | Regra |
|---|---|
| `/`, `/categoria/*`, `/produto/*`, `/quem-somos`, `/links` | indexar e listar no sitemap |
| `/politicas/*` | indexar; entrar no sitemap é opcional (decidir) |
| `/admin/*`, `/sacola`, `/checkout`, `/pedido/*`, `/minha-conta`, `/consultar-pedido` | `noindex` (o script confere) |
| `/busca` | decisão pendente do Rafael: sugerido `noindex, follow` para não indexar resultados finos |
| 404 | página útil, com busca e categorias |

**Atenção:** hoje o layout raiz marca o site inteiro como `noindex` (placeholder da T-001). A T-022 precisa **remover** isso das páginas públicas e deixar `noindex` só nas privadas. A auditoria acusa o problema como P0.

## Estado das tarefas
- **T-022** implementa o básico (metadados, JSON-LD, sitemap, robots, OG, 404). **T-032** é a rodada de auditoria e melhoria com esta skill, depois da T-022.
- Contas e domínio (Search Console, Perfil da Empresa, Merchant Center) ainda não existem: tudo isso é `SEM ACESSO` e vai para a T-025/T-031.
