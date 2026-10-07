---
execution: subagent
agent: analyst
model_tier: powerful
tasks:
  - scan-competitors
  - map-codebase-impact
outputFile: squads/agent-office-squad/output/04-discovery/discovery-brief.md
---

# Step 04: Discovery e benchmark — 🔭 Bruna Benchmark

## Context Loading

A pasta da run é a do caminho de saída que o runner passou; para outputs de agente use a maior `vN/` (run-conventions §2). Carregue:
- `squads/agent-office-squad/output/{run_id}/01-intake.md` — pedido e referências.
- `squads/agent-office-squad/output/{run_id}/02-plan/vN/run-plan.md` e `squads/agent-office-squad/output/{run_id}/03-plan-approval.md` — track, superfícies, overrides e orçamento (a aprovação prevalece).
- `_opensquad/_memory/company.md` e `squads/agent-office-squad/_memory/memories.md`.
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — leitura de inputs e protocolo de pulo.
- `squads/agent-office-squad/pipeline/data/benchmark-landscape.md` — linha de base do mercado (atualize, não refaça).
- `squads/agent-office-squad/pipeline/data/product-dossier.md` — funcionalidades, personas e lacunas.
- `squads/agent-office-squad/pipeline/data/architecture-map.md` — módulos, contratos e invariantes I-01…I-14.
- `squads/agent-office-squad/pipeline/data/research-brief.md`, `quality-criteria.md` (rubrica de discovery) e `anti-patterns.md`.
- Código das superfícies do run-plan (ex.: `src/main/agents.ts`, `src/main/bridge.ts`, `src/renderer/src/game.ts`).
- Em re-execução: a versão anterior do brief e o feedback que motivou a volta.

## Instructions

### Gate do track

1. Leia o run-plan e a aprovação do step-03.
2. Este step roda nos tracks **iniciativa** e **discovery**; nos demais o status é `skip`, salvo override do usuário.
3. Se o status for `skip`, grave a nota de pulo do run-conventions §3 (título `# Step 04 — Pulado`, motivo, track e complexidade) e encerre.

### Process

1. Escreva de 1 a 3 perguntas de discovery a partir do intake: qual problema, para quem e o que o usuário faz hoje no lugar.
2. **Task `scan-competitors`:** parta do benchmark-landscape e use no máximo ~10 buscas (5 no modo econômico) só no que falta ou pode ter mudado. Prefira fonte primária (repositório, documentação oficial, changelog); registre data de acesso e confiança (alta = 3+ fontes independentes, média = 2, baixa = 1 ou conflito).
3. Monte a tabela de concorrentes: como cada um resolve o problema da iniciativa, se só observa ou também controla, plataformas e fonte.
4. Separe padrão de mercado (paridade esperada) de espaço vazio (o que ninguém faz e o Agent Office pode fazer com governança espacial).
5. **Task `map-codebase-impact`:** leia o architecture-map e os arquivos das superfícies; liste camada, arquivo, função, mudança provável e invariantes em risco. Cite caminho e função — nunca "o backend".
6. Consolide riscos e incógnitas, marcando cada item como fato, inferência ou hipótese.
7. Escreva recomendações para o PRD em Deve / Deveria / Poderia, cada uma ligada a um achado do brief.
8. Proponha atualizações do benchmark-landscape como lista de mudanças com fonte. **Não edite o arquivo de dados.**
9. Em re-execução, foque nas lacunas do feedback e abra o arquivo com "Mudanças nesta versão".
10. Grave no caminho transformado recebido do runner e devolva um resumo de 3 linhas.

## Output Format

The output MUST follow this exact structure:
```markdown
# Discovery — {título da iniciativa}

**Run:** {run_id} · **Analista:** Bruna Benchmark · **Buscas usadas:** {n} de {limite}

## Mudanças nesta versão
{só em re-execução}

## Pergunta de discovery
{1–3 perguntas}

## Resumo executivo
- {achado} ({confiança})

## Benchmark focado
| Produto | Como resolve | Observa ou controla | Plataformas | Fonte (acesso, confiança) |
|---|---|---|---|---|

## Padrões e espaço vazio
- Padrão: ...
- Espaço vazio: ...

## Evidências de usuários
- {issue, review, post — fonte e data} | "nenhuma encontrada"

## Impacto no código
| Camada | Arquivo / função | Mudança provável | Invariantes em risco |
|---|---|---|---|

## Riscos e incógnitas
- {fato | inferência | hipótese}: ...

## Recomendações para o PRD
- **Deve:** ... (achado)
- **Deveria:** ...
- **Poderia:** ...

## Perguntas abertas
- ...

## Proposta de atualização do benchmark-landscape
- {mudança} — {fonte}

## Fontes
1. {URL} — acesso {data} — primária | secundária
```

## Output Example

```markdown
# Discovery — Subagentes visíveis no escritório

**Run:** 2026-10-08-101500 · **Analista:** Bruna Benchmark · **Buscas usadas:** 7 de 10

## Pergunta de discovery
Como o usuário percebe hoje que um agente delegou trabalho, e como os concorrentes mostram subagentes?

## Resumo executivo
- O Agent Office esconde toda atividade de subagente: `AgentManager.handle()` retorna cedo quando a mensagem tem `parent_tool_use_id` (fato, alta).
- O Pixel Agents mostra subagentes e teammates do Agent Teams como personagens ligados ao agente pai (alta).
- O roving-office (Atlassian Labs) deixa "ghost rendering for subagents" para o item "Later" do roadmap (alta).
- Agent Teams segue experimental (flag `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, v2.1.32+), com relatos conflitantes sobre `TeamCreate` (média).
- Espaço vazio: nenhum concorrente encontrado liga subagentes ao fluxo de permissões e resultados (média — ausência de evidência).

## Benchmark focado
| Produto | Como resolve | Observa ou controla | Plataformas | Fonte (acesso, confiança) |
|---|---|---|---|---|
| Pixel Agents | subagente = personagem extra ligado ao pai | observa | VS Code e navegador (npx) | github.com/pixel-agents-hq/pixel-agents (2026-10-08, alta) |
| roving-office | ainda não mostra; planejado como "fantasma" | observa | navegador | github.com/atlassian-labs/roving-office (2026-10-08, alta) |
| App oficial do Claude Code | sessões paralelas na barra lateral; subagentes no transcript | controla | macOS, Windows | cobertura do redesenho de abril/2026 (média) |

## Padrões e espaço vazio
- Padrão: subagente como entidade visual subordinada ao pai — paridade esperada.
- Espaço vazio: subagente dentro da governança (permissão, resultado, ticket) e visível também para sessões do terminal.

## Evidências de usuários
- Nenhuma issue pública do Agent Office (repositório privado); usar dogfooding no PRD.

## Impacto no código
| Camada | Arquivo / função | Mudança provável | Invariantes em risco |
|---|---|---|---|
| integration | `src/main/agents.ts` → `handle()` | detectar `tool_use` de `Agent`/`Task` e o `tool_result` com o mesmo id | auto-permissão só para `mcp__office__*` |
| integration | `src/main/bridge.ts` → `dispatch()`, `install()` | tratar PreToolUse de `Agent`/`Task`; instalar o hook `SubagentStop` | token, 127.0.0.1, sem `Origin` |
| platform | `src/main/demo.ts` | simular subagentes no modo demo | — |
| world | `src/renderer/src/game.ts`, `world/avatar.ts` | ator temporário em escala menor | 60 fps / ~20 fps em segundo plano |
| ui | `src/renderer/src/ui/panel.ts` | seção "Subagentes ativos" | texto de agente nunca vira HTML |

## Riscos e incógnitas
- Fato: a ponte instala 9 hooks e nenhum deles avisa o fim de subagente.
- Hipótese: o `SubagentStop` da versão instalada não diz qual chamada terminou (média) → casar por ordem de início.

## Recomendações para o PRD
- **Deve:** mostrar subagentes de agentes do escritório sem custo extra de tokens (impacto `handle()`).
- **Deveria:** cobrir sessões do terminal pelos hooks, com reconexão guiada da ponte.
- **Poderia:** teammates do Agent Teams, atrás da verificação da flag experimental.

## Perguntas abertas
- Quantos estagiários visíveis por agente antes de agrupar em "+N"?

## Proposta de atualização do benchmark-landscape
- Pixel Agents: incluir "subagentes e Agent Teams como personagens" na linha de visualização — fonte 1.

## Fontes
1. github.com/pixel-agents-hq/pixel-agents — acesso 2026-10-08 — primária
2. github.com/atlassian-labs/roving-office — acesso 2026-10-08 — primária
3. code.claude.com/docs/en/agent-teams — acesso 2026-10-08 — primária
```

## Veto Conditions

As condições abaixo não se aplicam à nota de pulo. Reject and redo if ANY are true:
1. Afirmação sobre concorrente sem fonte, data de acesso ou nível de confiança.
2. Impacto no código sem caminho de arquivo e função.
3. Recomendação para o PRD sem ligação com um achado do brief.
4. O arquivo `pipeline/data/benchmark-landscape.md` foi editado diretamente.

## Quality Criteria

- [ ] Pelo menos 60% das fontes são primárias
- [ ] Contradições entre fontes aparecem com os dois lados
- [ ] Fato, inferência e recomendação estão separados
- [ ] Orçamento de buscas respeitado e registrado no cabeçalho
- [ ] Espaço vazio descrito em termos do que só o Agent Office faz
- [ ] Perguntas abertas são as que o PRD precisa responder
