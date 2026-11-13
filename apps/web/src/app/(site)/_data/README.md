# Catálogo público da vitrine

`catalog.json` é validado por `publicCatalogSchema` antes de gerar as páginas. A T-010 deve preencher este arquivo antes de `next build`, com dados públicos obtidos pela API do Worker. O web nunca recebe a chave service_role.

- Somente categorias ativas e produtos `regular` ativos, sem exclusão lógica; excluir produtos cuja categoria esteja inativa.
- Projetar os campos do schema explicitamente. Campos extras, incluindo `cost_cents`, causam erro em vez de vazar para o site.
- Fotos públicas definitivas em WebP; `sources` contém URLs e larguras para o `srcSet`. Não usar recortes de prints de `marca/fotos-instagram`.
- A T-008 grava `product_images.path` como `<productId>/<imageId>/1080.webp`, no bucket público `products`. As outras versões ficam no mesmo diretório como `360.webp` e `720.webp`; montar `sources` com as três larguras (360, 720, 1080), preservando `alt` e a ordenação por `position` e `id`. Fotos removidas do cadastro mantêm os arquivos para a versão estática ainda publicada.
- Não gerar preço, endereço, telefone ou política fictícios. O snapshot inicial é vazio e contatos não confirmados são `null`.
- `instagram_images`: até seis fotos definitivas autorizadas, sem embed externo.
- Home, categorias e produtos são gerados com dados do snapshot; preço/estoque são confirmados em `/products/live?ids=` (até 50 IDs por chamada).
- A T-013 reutiliza `sparks-cart` (somente `{productId, qty}`) e o evento `sparks-shop-change`; favoritos ficam em `sparks-favorites`. Ambos são validados por schemas compartilhados.

As políticas ainda precisam dos textos aprovados. A página Quem somos usa a essência fornecida pela cliente.
