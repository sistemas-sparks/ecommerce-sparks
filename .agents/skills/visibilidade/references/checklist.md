# Checklist de visibilidade (o que o script não cobre)

Marque cada item: `CONFIRMADO` (com evidência) · `HIPÓTESE` · `SEM ACESSO` · `NÃO SE APLICA`. O script `seo:audit` já cobre título, description, canonical, H1, Open Graph, JSON-LD válido, alt, links quebrados, robots, sitemap e noindex.

## Conteúdo e intenção
- [ ] Cada categoria tem 2 a 3 frases próprias, úteis para quem compra (não texto de enchimento).
- [ ] Cada produto tem descrição original (material, tamanho, cor, quantidade, para quem serve), não copiada do fabricante.
- [ ] O título responde ao que a pessoa procura ("Caderno de pelúcia pink | Sparks Papelaria"), sem repetir palavra-chave.
- [ ] Páginas de entrega, trocas, privacidade e "Quem somos" existem, são claras e têm dados reais ou `[A DEFINIR]` visível só ao time (não na página pública).
- [ ] Links internos: home → categorias → produtos; produto → categoria; migalhas de pão.
- [ ] URLs em português, sem acento, estáveis (mudar slug exige redirecionamento).

## Dados estruturados (fidelidade, R6.2)
- [ ] `Product`: nome, imagem, preço e disponibilidade batem **exatamente** com o que a página mostra. Sem `aggregateRating` nem `review` enquanto não houver avaliação real exibida.
- [ ] `Store`/`WebSite`: nome e `alternateName` corretos; `sameAs` só com o Instagram real; `address`/`telephone` só depois de confirmados.
- [ ] `BreadcrumbList` igual à migalha visível.
- [ ] Nenhum schema para conteúdo que não existe na página (por exemplo FAQ sem perguntas visíveis).
- [ ] Teste de pesquisa aprimorada do Google sem erros (`SEM ACESSO` até haver domínio).

## Desempenho e experiência
- [ ] Imagens em WebP, com largura e altura declaradas e `srcset`; imagem principal sem `loading="lazy"`.
- [ ] Fontes locais com `font-display` definido; nada bloqueando o primeiro desenho.
- [ ] Sem rolagem horizontal em 390px e 1280px; alvos de toque de 44px; contraste AA (R5.4).
- [ ] Lighthouse no celular: SEO ≥ 95, acessibilidade ≥ 90, desempenho ≥ 85 na home (`prd.md` §7). Rode no build servido localmente; o valor final só vale no domínio real.

## Compartilhamento
- [ ] Prévia do link com imagem, título e descrição (Open Graph e Twitter Card); imagem 1200×630 acessível por URL absoluta.
- [ ] Ícones e `site.webmanifest` presentes.

## Publicação (tudo `SEM ACESSO` por ora → T-025/T-031)
- [ ] Search Console: propriedade de domínio por TXT no DNS, envio do sitemap, inspeção das páginas principais.
- [ ] Domínio de demonstração com `noindex` ou redirecionamento.
- [ ] `robots.txt` e o WAF/Bot Fight do Cloudflare não bloqueiam Googlebot nem Bingbot por engano.
- [ ] Cabeçalhos e CSP da T-023 não quebram a renderização nem o JSON-LD.
