# Sparks Papelaria — Loja virtual

Workspace do e-commerce da **Sparks Papelaria** (cliente: Varlene, dona da Sparks).
Desenvolvimento: Rafael Fernandes, com apoio de **Claude Code** e **Codex** trabalhando em conjunto.

> Status: planejamento concluído e monorepo inicial revisado (T-001). A loja funcional está em desenvolvimento; acompanhe `docs/tarefas.md`.

## Estrutura

```
sparks-ecommerce/
├── AGENTS.md            ← instruções para TODAS as IAs (Codex lê este arquivo)
├── CLAUDE.md            ← ponte para o Claude Code (importa o AGENTS.md)
├── docs/                ← a "constituição" do projeto
│   ├── prd.md           ← o que construir (escopo fechado com a cliente)
│   ├── arquitetura.md   ← como construir (stack, camadas, API, deploy)
│   ├── regras.md        ← regras que NUNCA podem ser quebradas
│   ├── design.md        ← identidade visual, tokens e componentes
│   ├── tarefas.md       ← backlog, quem faz o quê e status
│   ├── memoria.md       ← memória compartilhada: decisões, fatos, registro diário
│   ├── banco-de-dados.md← tabelas, RLS e funções do Postgres
│   ├── frete.md         ← motor de frete próprio (sem terceiros)
│   ├── seguranca.md     ← plano de segurança (planos gratuitos)
│   └── seo.md           ← estratégia de SEO e checklist do Google
├── apps/
│   ├── web/             ← site + painel (Next.js, export estático)
│   └── api/             ← API (Cloudflare Worker + Hono)
├── packages/shared/     ← tipos, validações (Zod), regras de dinheiro e frete
├── supabase/            ← migrations SQL, seeds e testes de RLS
├── seo/                 ← robots, sitemap, JSON-LD, ícones, manifest, imagem social
├── marca/               ← briefing, essência, logos, fontes, fotos de referência
├── comercial/           ← orçamento aprovado, resumo do acordo, mensagens
└── referencias/
    └── prototipo/       ← protótipo aprovado (HTML estático) = referência visual
```

## Ordem de leitura

1. `docs/regras.md` → 2. `docs/memoria.md` → 3. `docs/prd.md` → 4. `docs/arquitetura.md` → 5. `docs/tarefas.md`
Depois, o documento específico da tarefa (design, frete, banco, segurança, SEO).

## Como as duas IAs trabalham juntas

- **Uma tarefa por IA por vez**, registrada em `docs/tarefas.md` (dono + status).
- **Branches separadas**: `claude/T-XXX-descricao` e `codex/T-XXX-descricao`.
- **Nunca editam a mesma área ao mesmo tempo** (ver "área" de cada tarefa).
- **Revisão cruzada obrigatória** em pagamento, autenticação, RLS, frete e cupom.
- **Ao terminar**: atualizar `docs/tarefas.md` e registrar em `docs/memoria.md`.
- Dúvida de escopo ou conflito entre documentos → **parar e perguntar ao Rafael**.

## Abrir no VS Code

1. Descompacte e abra a pasta `sparks-ecommerce` no VS Code.
2. Instale as extensões recomendadas (o VS Code sugere automaticamente) e as extensões do Claude Code e do Codex.
3. Use Node `>=22.12` (recomendado 24) e pnpm 10; execute `pnpm install` na raiz.
4. A partir de `.env.example`, crie `apps/web/.env.local` apenas com `NEXT_PUBLIC_*` e `apps/api/.dev.vars` com as variáveis do Worker (nunca faça commit de segredos).
5. Execute `pnpm dev`: site em http://localhost:3000 e API em http://localhost:8787. No PowerShell, se a política bloquear `pnpm.ps1`, use `pnpm.cmd`.
6. Consulte `docs/tarefas.md` antes de iniciar uma tarefa. O repositório Git e a identidade correta ainda devem ser configurados pelo Rafael; não execute `git init`, `git commit` ou `git push` até lá.
