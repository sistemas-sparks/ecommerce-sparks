---
name: visibilidade
description: Audita e melhora a visibilidade orgânica da loja Sparks (SEO técnico, conteúdo, dados estruturados, GEO/AEO e SEO local), com auditoria local e relatório. Só quando o Rafael digitar /visibilidade ou $visibilidade, ou quando o brief de uma tarefa (T-022, T-032) mandar ler.
disable-model-invocation: true
---

# /visibilidade

Objetivo: a Sparks ser **encontrada, entendida e confiável** em buscas (Google, Bing), em mapas e em respostas de IA, sem truques. Melhore o que está fraco e **preserve o que já funciona**. Nenhuma posição, indexação ou citação por IA é garantida (R6). Adaptada da skill "visibilidade-maxima" v1.0.0 enviada pelo Rafael.

Uso: `/visibilidade auditar` (padrão: lê, mede e escreve o relatório, **sem editar**) · `/visibilidade corrigir` (audita, corrige dentro da área permitida e confere de novo).

## Fluxo
1. **Fatos do projeto:** leia `references/projeto.md`. Não pergunte o que ele já responde. Lacuna de dado da cliente vira `[A DEFINIR]` e Pendência na `memoria.md`; nunca invente endereço, CNPJ, avaliação, preço ou texto.
2. **Build:** sem `apps/web/out/` atual, rode `pnpm --filter @sparks/web build`.
3. **Baseline (mecânico, barato):** `pnpm --filter @sparks/web seo:audit` (opcional `-- --site-url https://dominio`). Ele confere título, description, canonical, H1, Open Graph, JSON-LD, imagens sem alt, links quebrados, robots, sitemap e noindex, e grava `.coordenacao/seo/auditoria.json`. Não repita à mão o que o script já cobre.
4. **O que o script não vê:** siga `references/checklist.md` (conteúdo, fidelidade do JSON-LD ao texto visível, desempenho no celular, acessibilidade, GEO e local; para GEO e local, `references/geo-e-local.md`). Marque cada item como `CONFIRMADO`, `HIPÓTESE`, `SEM ACESSO` (precisa de conta ou domínio) ou `NÃO SE APLICA`. Sem evidência, não afirme.
5. **Priorize:** P0 = site ou página importante fora do Google por engano, regressão; P1 = modelos de página, páginas de venda, identidade da marca; P2 = conteúdo, distribuição e experimentos.
6. **Corrigir (só no modo `corrigir`):**
   - **Já existe? Preserve e só ajuste.** Falta? **Crie.**
   - Edite apenas a área da tarefa (T-022: `apps/web/src/seo/`, `apps/web/public/` e o `metadata` das páginas de `(site)/`). Os modelos prontos estão em `seo/` na raiz. Nunca edite `apps/web/out/`.
   - Depois de cada grupo de mudanças: build, auditoria de novo, lint e typecheck do `@sparks/web`.
7. **Relatório:** `docs/relatorios/visibilidade-AAAA-MM-DD.md`, no formato de `references/relatorio.md`: antes e depois do script, o que mudou, o que ficou `SEM ACESSO` e as ações do Rafael ou da cliente.

## Limites (as regras do projeto vencem esta skill)
- **Nada de serviço novo** (R2, `arquitetura.md` §12): sem Google Analytics, Tag Manager, pixels, IndexNow, API de Indexação nem ferramenta paga. Medição = Google Search Console (já previsto) e, só se o Rafael aprovar, o Cloudflare Web Analytics.
- Nada que dependa de conta ou domínio é feito aqui. Vira lista para a **T-025/T-031**: Search Console, Perfil da Empresa no Google, Bing Webmaster, prévia no WhatsApp, Lighthouse no domínio real, bloqueio de bots no Cloudflare.
- Nunca: texto escondido, palavras-chave em excesso, páginas-fachada por cidade ou bairro, avaliação ou nota falsa, dado estruturado que não bate com o texto visível, backlink comprado, `noindex` errado em página pública.
- Não faça deploy nem cadastre perfis externos. Isso é do Rafael e da cliente.
- Não crie `llms.txt` nem schema "para IA": o Google diz que não precisam (confirmar na fonte oficial antes de mudar de ideia).

## Economia
- O script faz o trabalho mecânico; leia só as referências de que precisa.
- Via `/coordenar`, o `executor` não tem a ferramenta Skill: o brief deve mandá-lo **ler** `.claude/skills/visibilidade/SKILL.md` e as referências indicadas.
- Relatório curto, com evidência em `arquivo:linha` ou `rota`, sem copiar o HTML.
