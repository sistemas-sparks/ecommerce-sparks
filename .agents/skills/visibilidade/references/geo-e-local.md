# Buscas com IA (GEO/AEO) e SEO local

## Princípio
Para o Google, a documentação oficial diz que **não há otimização especial** para AI Overviews e AI Mode: a página precisa estar indexada e elegível a snippet, e valem as boas práticas de sempre (rastreável, texto útil, dados estruturados batendo com o texto visível). Coberturas de imprensa indicam que o guia mais novo do Google dispensa `llms.txt`, "quebrar o texto em pedaços" e schema especial. **Confirmar na fonte oficial** (Google Search Central, "AI features and your website") antes de mudar qualquer decisão, porque isso muda com o tempo. Por isso: **não criar `llms.txt`** nem schema "para IA".

## O que ajuda em todos os mecanismos
1. **HTML rastreável:** o site é estático, então o texto já está no HTML. Manter assim: nada importante carregado só por JavaScript depois do clique.
2. **Não bloquear por engano:** `robots.txt` e o WAF/Bot Fight do Cloudflare não podem barrar Googlebot, Bingbot nem os rastreadores de busca de IA (por exemplo OAI-SearchBot). Rastreadores de **treinamento** (GPTBot, CCBot, Google-Extended) são **escolha da cliente**: `[A DEFINIR]`, padrão sem bloquear até ela decidir. Conferir os nomes e efeitos nas páginas oficiais de cada empresa antes de editar o `robots.txt`.
3. **Entidade consistente:** nome, variações, cidade, WhatsApp, Instagram e horário iguais no site, no JSON-LD, no Instagram e no Perfil da Empresa. Divergência confunde mecanismos e pessoas.
4. **Respostas diretas e verificáveis** nas páginas: prazo de entrega, formas de pagamento, política de troca, como funciona a embalagem de presente, o que vem no kit. Frases curtas, com número quando há. Nada de afirmação que a loja não cumpre.
5. **Produto bem descrito:** material, tamanho, cor, quantidade, para quem serve, preço e disponibilidade visíveis. É o que um assistente de compras cita.
6. **Confiança:** CNPJ, contato e políticas visíveis quando a cliente confirmar. Avaliações **só reais** e exibidas na página antes de virar `aggregateRating`.
7. **FAQ:** pode haver seção de perguntas úteis na página. Não usar `FAQPage` só pelo schema: o Google limitou os resultados ricos de FAQ a poucos tipos de site (conferir).

## SEO local (Aracaju/SE, cidade ainda **[A DEFINIR]**)
- **Perfil da Empresa no Google:** a cliente cria ou reivindica, com o mesmo nome, endereço e telefone do site. É o maior fator para "papelaria perto de mim". `SEM ACESSO` → pendência para a cliente.
- **Sem páginas-fachada:** nada de uma página por bairro ou cidade só para repetir palavras-chave. Uma seção real de "Entrega e região atendida" na página de entrega basta.
- **Endereço no JSON-LD** (`Store`/`LocalBusiness`) só depois de confirmado, igual ao Perfil da Empresa.
- **Mapa e rota:** link para o Perfil no rodapé ou no "Quem somos" quando existir.
- **Avaliações:** pedir a clientes reais, sem incentivo escondido; nunca comprar nem inventar.

## Depois da publicação (sugestões, precisam de conta; decisão do Rafael)
- Google Merchant Center (listagens gratuitas de produtos): exige conta e feed.
- Bing Webmaster Tools: importa a propriedade do Search Console.
- Cloudflare Web Analytics: só com aprovação do Rafael (R2.2) e respeitando a LGPD.
