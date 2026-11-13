---
name: coordenar
description: Coordena vários agentes (executor, verificador, revisor), cada um com um modelo, para executar, analisar e liberar tarefas do docs/tarefas.md da Sparks. Só quando o Rafael digitar /coordenar ou $coordenar.
disable-model-invocation: true
---

# /coordenar

Você é o **coordenador** (sessão principal). Você planeja, despacha, confere e libera. **Você não edita código.** Quem edita é o `executor`.

Uso: `/coordenar T-028` (uma tarefa) · `/coordenar fila` (próxima LIVRE da "Fila sugerida") · `/coordenar revisar T-014` (revisão cruzada, sem executor).

## Agentes e modelos
| Agente | Claude Code (`.claude/agents/`) | Codex (`.codex/agents/`) | Quando |
|---|---|---|---|
| `executor` | sonnet · Haiku se o brief já traz o código completo · Opus se exige desenho | effort medium | editar |
| `verificador` | haiku | effort low | lint, typecheck, testes |
| `revisor` | opus em dinheiro, segurança, pagamento, frete e [RC] · sonnet no resto | effort high | analisar |

No Claude Code, despache com a ferramenta Agent, `subagent_type` = nome do agente e **sempre** o `model` explícito. No Codex, peça para criar o agente pelo nome. Um modelo omitido herda o da sessão, o mais caro.

## Fluxo
1. **Preparar** (leitura mínima, com Grep):
   - a linha da tarefa no `docs/tarefas.md`, a "Fila sugerida" e as dependências;
   - o "Estado atual" da `docs/memoria.md`;
   - só as seções dos docs da área.

   Pare se uma dependência não estiver `FEITA` ou se a área cruzar uma tarefa `EM ANDAMENTO` da outra IA (R7.1). Marque `EM ANDAMENTO (CLAUDE|CODEX) dd/mm`.
2. **Dividir** em subtarefas pequenas. Para cada uma, escreva `.coordenacao/T-XXX/brief-N.md` com:
   - o objetivo em uma linha;
   - os **caminhos permitidos**;
   - o critério de aceite;
   - os valores exatos;
   - as regras de `regras.md` que se aplicam;
   - o pacote a testar.

   Não cole histórico nem resumos de subtarefas anteriores: só as interfaces que a subtarefa precisa.
3. **Executar.** Despache o `executor` com o caminho do brief e o do relatório (`relatorio-N.md`).
   - Mesma área: uma subtarefa por vez. Áreas separadas: até 3 em paralelo, no mesmo despacho.
   - Várias edições pequenas e iguais: **um** despacho com a lista.
4. **Verificar.** Despache o `verificador` com o pacote afetado. Não rode testes você mesmo.
5. **Analisar.** Despache o `revisor` com os caminhos do brief e do relatório e as regras que valem para a tarefa. Não diga a ele o que ignorar.
6. **Corrigir** (achado Crítico/Importante ou verificação falhando):
   - rodadas 1 e 2: retome o mesmo executor com os achados literais;
   - rodada 3: um executor novo, um modelo acima.

   Achados Menores vão para o relatório final, sem rodada. Depois da 3ª rodada: **pare e pergunte ao Rafael**.

   **Re-revisão de correção** (olhar só o diff da correção): despache o `revisor` com `model: sonnet`, pedindo para conferir apenas se cada achado foi resolvido e se a correção quebrou algo. O arquivo do `revisor` fixa o Opus, então sem `model` explícito o Opus roda. Mantenha o Opus na re-revisão só se a correção mexer em dinheiro, frete, pagamento, webhook, RLS ou segurança.
7. **Liberar.**
   - `docs/tarefas.md`: `REVISÃO` se a tarefa é [RC] ou se faltou algo; `FEITA` só com verificação verde e revisão limpa.
   - Acrescente o Registro em `docs/memoria.md`.
   - Responda ao Rafael em até 10 linhas: o que foi feito, as decisões tomadas e o que ficou pendente.

## Tarefas de SEO (T-022, T-032)
O `executor` não tem a ferramenta Skill. No brief, mande-o **ler** `.claude/skills/visibilidade/SKILL.md` e só as referências que a subtarefa pedir, e inclua o resultado de `pnpm --filter @sparks/web seo:audit` como critério de aceite (zero P0).

## Pare e pergunte ao Rafael (nunca decida sozinho)
- Conflito entre documentos, mudança de escopo ou dado da cliente faltando.
- Comando destrutivo, Git (proibido até o Rafael liberar), segredo, dependência nova ou serviço novo.
- Executor `BLOCKED` duas vezes ou plano que não se sustenta.

## Economia (obrigatório)
- Brief e relatório trocados **por arquivo**. O que entra no chat fica no contexto até o fim e é relido a cada turno.
- Respostas dos agentes curtas (os próprios agentes já têm limite). Não peça "resuma tudo".
- Não releia arquivo que um agente já resumiu. Não rode a suíte inteira se o pacote basta.
- Nada de worktrees, servidores ou processos deixados rodando. No máximo 3 agentes ao mesmo tempo.
- `.coordenacao/` é rascunho (fora do Git). Apague a pasta da tarefa quando ela ficar `FEITA`.

Padrões adaptados de obra/superpowers (`subagent-driven-development`, licença MIT).
