---
name: clientes
description: Manda um painel de clientes simulados (personas) testar, usar e tentar comprar na loja da Sparks; eles dão as desculpas para não comprar e o relatório vira melhorias. Só quando o Rafael digitar /clientes ou $clientes.
disable-model-invocation: true
---

# /clientes

Você é o **coordenador** do painel. Não edita código. Quem fala são as personas.

Uso: `/clientes [alvo] [quantidade] [modo]`
- **alvo:** `prototipo` (padrão enquanto o catálogo real estiver vazio: `referencias/prototipo/index.html`) · `local` (build em `apps/web/out/`) · uma URL de teste.
- **quantidade:** 5 (padrão), de 3 a 8.
- **modo:** `texto` (padrão, barato) · `misto` (texto + navegador só nos pontos de atrito) · `navegador` (compra inteira no navegador).

## Agentes e modelos
| Agente | Claude Code | Codex | Papel |
|---|---|---|---|
| `cliente` | haiku | effort low | coletor do dossiê e personas no modo texto |
| `cliente-navegador` | sonnet | effort medium | persona no navegador |
| `sintetizador` | sonnet | effort medium | relatório |

Sempre com o `model` explícito no despacho (Claude Code: ferramenta Agent com `subagent_type`).

## Fluxo
1. **Dossiê (uma vez):**
   - Despache um `cliente` no papel COLETOR com a lista de páginas do alvo: home, categoria, produto, sacola/checkout, frete, políticas, "Quem somos". Ele grava o texto em `.coordenacao/clientes/dossie.md` (até cerca de 2 mil palavras).
   - Se o dossiê já existe e o alvo não mudou, reaproveite.
2. **Painel.** Escolha as personas em `references/personas.md`. Precisa ter:
   - pelo menos 1 que **não** compra;
   - 1 cética;
   - 1 de orçamento apertado;
   - 1 sensível a frete;
   - objeções diferentes entre si.
3. **Modo texto:**
   - Despache um `cliente` (papel PERSONA) por persona, até 3 por vez, cada um com o cartão da persona e o caminho do dossiê.
   - Junte as respostas, sem comentar, em `.coordenacao/clientes/respostas.md`.
4. **Modo misto:** depois do texto, pegue os **2 ou 3 pontos de atrito mais citados** e despache um `cliente-navegador` por ponto, com a persona que mais reclamou dele e a URL.
5. **Modo navegador:** um `cliente-navegador` por persona, **um de cada vez**, com o fluxo "achar um produto, pôr na sacola, calcular frete, ir até a tela de pagamento". Teste celular (390px) em pelo menos uma persona.
6. **Síntese:** despache o `sintetizador` com `respostas.md`. Ele escreve `docs/relatorios/clientes-AAAA-MM-DD.md`.
7. **Entregar ao Rafael**, em até 10 linhas: quantas compraram, as 5 melhorias principais e o caminho do relatório.
   - Pergunte quais viram tarefa. **Não crie tarefas nem mude código sem o OK dele.**
   - Itens fora do escopo vão para as Pendências da `memoria.md` só com o OK dele (R1).

## Navegador
- Use a ferramenta de navegador da sessão. No VS Code, o Playwright MCP do projeto (`.mcp.json`).
- Para o alvo local, sirva a pasta com um servidor estático temporário e **desligue-o no fim**.
- **Nunca pagar**, nunca digitar cartão, nunca usar dados pessoais reais.
- Prefira o snapshot em texto às capturas de tela.

## Regras
- Personas são **hipóteses** para achar objeções, não clientes reais nem validação.
- Nada daqui vira depoimento, avaliação, nota ou dado estruturado (R6). Nada de dados pessoais reais.
- Melhorias respeitam o escopo do `prd.md` (R1) e o design aprovado (R5).
- Personas e relatório em português do Brasil.

## Economia
- O dossiê é lido por todas as personas: nenhuma página é lida duas vezes.
- O texto vem antes do navegador, e o navegador vai só onde há atrito.
- Respostas em formato fixo e curto.
- Apague `.coordenacao/clientes/` quando o relatório estiver pronto, exceto o dossiê, se o Rafael for rodar de novo.
