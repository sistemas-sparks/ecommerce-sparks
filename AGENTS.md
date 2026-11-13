# AGENTS.md — Instruções para todas as IAs (Codex e Claude Code)

Você está trabalhando no e-commerce da **Sparks Papelaria**. Duas IAs trabalham neste repositório
ao mesmo tempo (Codex e Claude Code), coordenadas pelo Rafael. Siga este arquivo à risca.

## 1. Leitura obrigatória antes de QUALQUER tarefa
1. `docs/regras.md` — regras invioláveis
2. `docs/memoria.md` — decisões e estado atual
3. `docs/tarefas.md` — o que está livre, em andamento e feito
4. O documento da área da tarefa (`prd`, `arquitetura`, `design`, `banco-de-dados`, `frete`, `seguranca`, `seo`)
5. As **skills obrigatórias** da seção 8 (`caveman` e `security-best-practices`). `/coordenar` e `/clientes` só rodam quando o Rafael pede.

## 2. Hierarquia (se houver conflito)
`regras.md` > `prd.md` > `arquitetura.md` > `banco-de-dados.md` / `frete.md` / `seguranca.md` > `design.md` > `tarefas.md` > código existente.
Se dois documentos se contradizem: **não escolha sozinho**. Pare, descreva o conflito e pergunte ao Rafael.

## 3. Protocolo de trabalho
1. Escolha uma tarefa com status `LIVRE` cujas dependências estejam `FEITA`.
2. Marque em `docs/tarefas.md`: `EM ANDAMENTO (CLAUDE)` ou `EM ANDAMENTO (CODEX)` + data.
3. Crie a branch `claude/T-XXX-slug` ou `codex/T-XXX-slug`.
4. Trabalhe **somente** nos caminhos da "área" da tarefa. Se precisar mexer fora dela, registre e avise.
5. Commits pequenos no padrão Conventional Commits, com o ID: `feat(api): T-012 cria endpoint de cotação`.
6. Rode lint, typecheck e testes antes de concluir.
7. Atualize `docs/tarefas.md` (status `REVISÃO` ou `FEITA`) e acrescente uma entrada em `docs/memoria.md` (seção "Registro").
8. Tarefas marcadas **[REVISÃO CRUZADA]** só ficam `FEITA` depois que a outra IA revisar.

## 4. O que você NUNCA faz
- Mudar escopo, stack ou decisões marcadas como travadas em `docs/regras.md`.
- Adicionar serviço de terceiros não listado em `docs/arquitetura.md` (ex.: Frenet, e-mail transacional).
- Expor segredos, chaves `service_role` ou tokens no front-end, em logs ou em commits.
- Inventar dados da cliente (preços reais, CNPJ, endereço, textos). Use `[A DEFINIR]` e registre em "Pendências" da `memoria.md`.
- Reescrever arquivos inteiros de outra área sem necessidade. Prefira mudanças pequenas.
- Apagar ou reescrever o histórico da `memoria.md`. Ela é só de acréscimo (exceto a seção "Estado atual").

## 5. Convenções
- Código, nomes de variáveis, tabelas e colunas: **inglês**. Textos da interface e documentação: **português do Brasil**.
- TypeScript em modo `strict`. Validação de toda entrada externa com **Zod** (`packages/shared`).
- Dinheiro sempre em **centavos inteiros** (`*_cents`). Nunca `float` para dinheiro.
- Datas em UTC no banco; exibição em `America/Sao_Paulo` (confirmar fuso da loja em `memoria.md`).

## 6. Definição de pronto (DoD)
- Funciona no celular (390px) e no desktop (1280px), conforme `docs/design.md`.
- Lint, typecheck e testes passando; testes novos para regras de dinheiro, frete, cupom, estoque e webhook.
- Nenhuma regra de `docs/regras.md` violada; nenhum segredo no código.
- `docs/tarefas.md` e `docs/memoria.md` atualizados.

## 7. Comandos
Requisitos: Node `>=22.12` (recomendado 24, ver `.nvmrc`) e pnpm 10 (`corepack enable` usa a versão do `packageManager`).
Sempre rode na **raiz** do repositório.

| Comando | O que faz |
|---|---|
| `pnpm install` | Instala as dependências de todos os pacotes (use `--frozen-lockfile` no CI) |
| `pnpm dev` | Sobe o site (`next dev`, http://localhost:3000) e a API (`wrangler dev`, http://localhost:8787) em paralelo |
| `pnpm build` | Gera o site estático em `apps/web/out/` e valida o bundle do Worker (`wrangler deploy --dry-run`, saída em `apps/api/dist/`) |
| `pnpm lint` | ESLint em cada pacote (zero avisos) + `prettier --check` |
| `pnpm typecheck` | `tsc --noEmit` em cada pacote (no web, roda `next typegen` antes) |
| `pnpm test` | Vitest em todos os projetos (`packages/*`, `apps/api` e `supabase`; o banco roda em Postgres embutido, PGlite, sem Docker) |
| `pnpm format` | Formata o código com Prettier |
| `pnpm --filter @sparks/web seo:audit` | Auditoria de SEO local e somente leitura do build (`apps/web/out/`); grava `.coordenacao/seo/auditoria.json` e falha se houver P0. Rode `pnpm --filter @sparks/web build` antes |

Um pacote só: `pnpm --filter @sparks/web <script>` (também `@sparks/api`, `@sparks/shared` e `@sparks/db`).

Variáveis locais: copie `.env.example` para `apps/web/.env.local` (só `NEXT_PUBLIC_*`) e `apps/api/.dev.vars` (segredos do Worker). Os dois arquivos ficam fora do Git.

**Deploy:** ainda não configurado. A API será publicada com `pnpm --filter @sparks/api exec wrangler deploy` e os segredos com `wrangler secret put <NOME>`. O deploy do site e o deploy hook são definidos na T-010 e na T-025.

**CI** (`.github/workflows/ci.yml`): jobs `lint`, `typecheck`, `test` e `gitleaks` em todo push na `main` e em todo pull request.

## 8. Skills (decisão do Rafael em 20/10/2026)
As skills ficam no repositório, em cópias idênticas: `.claude/skills/` (Claude Code) e `.agents/skills/` (Codex). Ao atualizar uma, atualize as duas.
- **Sempre ligadas:** `caveman` (8.1) e `security-best-practices` (8.2).
- **Só por comando do Rafael:** `/coordenar` (8.3), `/clientes` (8.4) e `/visibilidade` (8.5).

### 8.1 `caveman`: economia de tokens (sempre ligada)
- Ative no início de toda sessão (`/caveman` no Claude Code, `$caveman` no Codex) e mantenha ligada. O Rafael desliga com "normal mode" ou "stop caveman".
- Vale **só para as respostas no chat**, sempre em português do Brasil. A própria skill manda escrever em prosa normal tudo o que fica salvo: código, comentários, commits, `docs/`, `memoria.md`, `tarefas.md` e textos da interface. Também usa prosa normal em avisos de segurança, ações irreversíveis e perguntas ao Rafael.
- **Hábitos que economizam mais que a voz** (obrigatórios):
  - Leia só o necessário: busque com `grep`/`rg` e leia trechos com início e limite, não arquivos inteiros. Não releia um arquivo que você acabou de ler ou editar.
  - Não cole arquivos ou saídas longas no chat: cite `caminho:linha` e mostre só o trecho que importa.
  - Filtre a saída de comandos (lint, testes, build) antes de ler: rode só o pacote afetado (`pnpm --filter`) e procure as falhas, em vez de despejar tudo.
  - Uma tarefa por vez, sem explorar áreas fora da tarefa (seção 3).

### 8.2 `security-best-practices`: segurança (OpenAI)
- **Carregue a skill antes de** escrever ou revisar código da API (`apps/api`), autenticação e painel, checkout, webhook, frete e integrações externas (Mercado Pago, Melhor Envio), banco/RLS, upload, e qualquer tela que mostre dados vindos do usuário ou do banco. Carregue também em toda revisão cruzada **[RC]**.
- Para economizar tokens, **leia só a referência da camada que você está mexendo**, em vez de todas, como a skill sugere:
  - front-end (`apps/web`): `references/javascript-typescript-react-web-frontend-security.md`;
  - API Hono no Worker e scripts de servidor: `references/javascript-typescript-nextjs-web-server-security.md`. As regras gerais de servidor valem para o Hono: entrada, CORS, SSRF, webhook com corpo bruto, logs, erros e limites. Ignore o que for exclusivo do Next no servidor (Server Actions, Proxy), porque o site é export estático.
- **Conflitos:** as regras do projeto vencem a skill (seção "Overrides" da própria skill). Exemplos: o HSTS de 2 anos da T-005 fica (a skill desaconselha HSTS por cautela genérica, mas o projeto o adota de propósito, com HTTPS obrigatório); a sessão do admin no `localStorage` segue a decisão da T-007, com a CSP da T-023 como defesa. Achou um conflito novo? Registre em `memoria.md` e pergunte ao Rafael.
- Relatório completo de segurança só quando pedido, em `docs/relatorios/` (não na raiz).

### 8.3 `/coordenar`: coordenação de agentes (só por comando)
- Roda **somente** quando o Rafael digita `/coordenar` (Claude Code) ou `$coordenar` (Codex). Nunca acione sozinho.
- A sessão principal coordena e **não edita código**. Os papéis são:
  - `executor` (Sonnet) edita;
  - `verificador` (Haiku) roda lint, typecheck e testes do pacote;
  - `revisor` (Opus em dinheiro, segurança, pagamento, frete e [RC]; Sonnet no resto) analisa.
- Briefings e relatórios ficam em `.coordenacao/` (fora do Git). O fluxo e os limites estão no `SKILL.md`.
- Segue todo este arquivo: área da tarefa, revisão cruzada, sem Git até o Rafael liberar. Em conflito, escopo, dado da cliente, dependência nova ou ação destrutiva, **para e pergunta ao Rafael**.

### 8.4 `/clientes`: clientes simulados (só por comando)
- Roda **somente** com `/clientes` ou `$clientes`.
- Um painel de personas fictícias (`references/personas.md`) testa a loja em três modos: `texto` (padrão), `misto` ou `navegador`.
- O `sintetizador` escreve o relatório em `docs/relatorios/clientes-AAAA-MM-DD.md`.
- Personas são hipóteses, não clientes reais. Nada vira depoimento, avaliação ou dado estruturado (R6).
- Melhorias fora do escopo vão para o Rafael (R1). **Nenhuma tarefa é criada sem o OK dele.**
- O modo navegador usa o **Playwright MCP** do projeto (`.mcp.json` e `.codex/config.toml`, versão fixa, sem janela, perfil só em memória) e **nunca paga** nem digita cartão.

### 8.5 `/visibilidade`: SEO, GEO e SEO local (só por comando)
- Roda **somente** com `/visibilidade` (Claude Code) ou `$visibilidade` (Codex), ou quando o brief da **T-022** ou da **T-032** mandar ler. O `executor` não tem a ferramenta Skill: o brief deve mandá-lo ler `.claude/skills/visibilidade/SKILL.md` e as referências.
- Dois modos: `auditar` (só lê e escreve o relatório) e `corrigir` (preserva o que existe, cria o que falta, dentro da área da tarefa).
- A auditoria mecânica é local, sem rede e sem dependências: `pnpm --filter @sparks/web seo:audit` (precisa do build em `apps/web/out/`). Ela grava `.coordenacao/seo/auditoria.json`.
- As regras do projeto vencem a skill: nada de serviço novo (sem Analytics, Tag Manager, pixels ou IndexNow), nada que dependa de conta ou domínio (vai para a T-025/T-031), nenhuma promessa de posição (R6), nenhum dado inventado da cliente.
- Relatório em `docs/relatorios/visibilidade-AAAA-MM-DD.md`.

### 8.6 Manter em sincronia
| Claude Code | Codex |
|---|---|
| `.claude/skills/` | `.agents/skills/` (+ `agents/openai.yaml`) |
| `.claude/agents/*.md` | `.codex/agents/*.toml` |

Ao mudar um lado, mude o outro. No Codex, o `model` de cada agente está como `[A DEFINIR]` (o esforço já difere por papel). O Rafael confirma os nomes dos modelos.

**Origem:**
- `caveman`: github.com/JuliusBrussee/caveman, commit `bad48a0` (Apache-2.0).
- `security-best-practices`: github.com/openai/skills (`skills/.curated`), commit `49f948f` (Apache-2.0), só com as referências de React e Next.js.
- `/coordenar`: escrita para o projeto, com padrões adaptados de github.com/obra/superpowers (`subagent-driven-development`, MIT).
- `/clientes`: escrita para o projeto.
- `/visibilidade`: adaptada da skill "visibilidade-maxima" v1.0.0 enviada pelo Rafael (só o `SKILL.md` foi recebido; as referências e o script de auditoria foram escritos para o projeto).
- Playwright MCP: `@playwright/mcp@0.0.83` (Microsoft, Apache-2.0).

Tudo foi lido antes da instalação. Não instale outras skills, agentes ou servidores MCP sem aprovação do Rafael.
