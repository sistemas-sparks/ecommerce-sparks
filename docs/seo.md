# SEO

**Aviso honesto:** SEO aumenta as chances de a loja aparecer bem no Google, mas **ninguém consegue garantir o topo** em todas as pesquisas. A posição depende do Google, da concorrência, do tempo e de sinais fora do site. Não usar truques (texto escondido, excesso de palavras-chave, avaliações falsas): o Google penaliza.

## 1. O que mais pesa para a Sparks
1. **Perfil da Empresa no Google** (Google Meu Negócio): é o que faz a loja aparecer em "papelaria perto de mim" e no mapa. Gratuito. A cliente precisa criar ou reivindicar, com o mesmo nome, endereço e telefone do site.
2. **Nome da marca** em todo lugar (site, Instagram, perfil no Google) igual e com link para o site.
3. **Conteúdo útil** nas páginas de categoria (2 a 3 frases próprias) e descrições originais de produto (não copiar do fabricante).
4. **Desempenho no celular** (Core Web Vitals) e site rastreável.

## 2. Palavras-chave
- **Marca e variações:** Sparks Papelaria · Papelaria Sparks · Sparks Pink · Sparks Pink Papelaria · sparks_papelaria · Sparks papelaria [cidade].
  As variações entram no campo `alternateName` dos dados estruturados e no texto "Quem somos". **Não repetir em massa** no conteúdo.
- **Assunto:** papelaria fofa · papelaria criativa · papelaria afetiva · cadernos fofos · canetas fofas · canetas de coração · caderno de pelúcia · caderno de discos · marca-texto pastel · kit escolar · material escolar · presentes de papelaria · mimos para presentear · papelaria [cidade] · papelaria online.
- Cidade **[A DEFINIR]** (provável Aracaju/SE).

## 3. Implementação técnica (obrigatória)
- `<title>` e `meta description` únicos por página (modelos em `seo/meta/head-template.html`).
- `canonical` absoluto em todas as páginas; `/admin`, `/sacola`, `/checkout`, `/pedido/*` e `/minha-conta` com `noindex`.
- `sitemap.xml` gerado no build com home, categorias, produtos ativos, `/quem-somos` e `/links`.
- `robots.txt` (modelo em `seo/robots.txt`).
- Dados estruturados (JSON-LD, modelos em `seo/jsonld/`):
  - `WebSite` (com `name` e `alternateName`, que ajudam o Google a mostrar o nome certo do site);
  - `Store` com logo, `sameAs` (Instagram) e endereço quando confirmado;
  - `Product` com `offers` (preço, disponibilidade), igual ao que aparece na página;
  - `BreadcrumbList` em categoria e produto.
- Open Graph e Twitter Card (prévia no WhatsApp e nas redes) com `seo/og-image.jpg`.
- URLs amigáveis em português, sem acentos: `/produto/caderno-de-pelucia-pink`.
- Imagens com `alt` descritivo, WebP e dimensões declaradas.
- Página 404 útil, com busca e categorias.
- Ícones e manifest (`seo/favicon.png`, `seo/apple-touch-icon.png`, `seo/site.webmanifest`).

## 4. Google Search Console (na publicação)
Ver `seo/google-search-console.md`: propriedade de domínio por registro TXT no DNS do Cloudflare, envio do sitemap e inspeção das páginas principais.

## 5. Checklist antes de publicar
- [ ] Lighthouse SEO ≥ 95 na home, numa categoria e num produto.
- [ ] Teste de pesquisa aprimorada do Google sem erros nos JSON-LD.
- [ ] Sitemap acessível e sem URLs `noindex`.
- [ ] Prévia do link no WhatsApp com imagem, título e descrição.
- [ ] Domínio antigo de demonstração (`*.netlify.app`) com `noindex` ou redirecionando, para não competir com o site oficial.
