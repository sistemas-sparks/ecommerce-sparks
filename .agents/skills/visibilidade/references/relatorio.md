# Formato do relatório de visibilidade

Arquivo: `docs/relatorios/visibilidade-AAAA-MM-DD.md`. Português do Brasil, curto, com evidência.

```markdown
# Visibilidade — AAAA-MM-DD

**Modo:** auditar | corrigir · **Build:** data do `out/` · **Site-url:** domínio ou "sem domínio"

## Resumo (3 linhas)
Maior risco, o que mudou, o que falta.

## Auditoria automática (antes → depois)
| | Antes | Depois |
|---|---|---|
| Páginas / indexáveis | | |
| P0 / P1 / P2 | | |

## Achados
| Prioridade | Rota ou arquivo | Problema | Evidência | Status (CONFIRMADO / HIPÓTESE / SEM ACESSO) | Ação |
|---|---|---|---|---|---|

## O que foi alterado (modo corrigir)
- `caminho:linha`: o quê e por quê. Foi criado ou ajustado?

## Fora do alcance agora
- Precisa de conta, domínio ou dado da cliente: item → quem faz → tarefa (T-025/T-031) ou Pendência.

## Decisões para o Rafael
- Ex.: `/busca` com noindex? Bloquear ou não rastreadores de treinamento de IA? Entrar políticas no sitemap?

## Próximos experimentos (30/60/90 dias, depois da publicação)
- Hipótese → o que medir no Search Console → critério de sucesso. Sem prometer posição.
```

Regras: não invente métrica; sem Search Console, a linha de tráfego é `SEM ACESSO`. Não cole HTML inteiro.
