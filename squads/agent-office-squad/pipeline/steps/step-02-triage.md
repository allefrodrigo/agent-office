---
execution: inline
agent: orchestrator
tasks:
  - triage-intake
inputFile: squads/agent-office-squad/output/01-intake.md
outputFile: squads/agent-office-squad/output/02-plan/run-plan.md
---

# Step 02: Triagem e plano da run — 🎼 Otávio Orquestra

## Context Loading

Carregue antes de executar:
- `squads/agent-office-squad/output/{run_id}/01-intake.md` — track, descrição, referências e `office_board` (checkpoint, sem `vN/`).
- `_opensquad/_memory/company.md` — produto, restrições inegociáveis e lacunas conhecidas.
- `squads/agent-office-squad/_memory/memories.md` e `squads/agent-office-squad/_memory/runs.md` — preferências do usuário e runs anteriores.
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — esquema `run_plan` (§4), pulo (§3), branch (§5) e orçamento (§9).
- `squads/agent-office-squad/pipeline/data/domain-framework.md` — matriz de tracks e regras de complexidade.
- `squads/agent-office-squad/pipeline/data/aiox-pipeline-map.md` — fases e matriz de autoridade.
- `squads/agent-office-squad/pipeline/data/architecture-map.md` — módulos por camada e invariantes I-01…I-14.
- `squads/agent-office-squad/_build/design.yaml` — `track_matrix` e `sensitive_surfaces`.
- Referências do intake: ticket via `mcp__office__ticket_get` (se disponível) ou arquivo local citado.
- Estado do repositório: `git status --porcelain`, `git branch --show-current`, `git log --oneline -5`.
- Em re-execução (volta do step-03): `squads/agent-office-squad/output/{run_id}/03-plan-approval.md` com o feedback.

## Instructions

Este step não tem Gate do track: é ele que cria o plano que os demais seguem. Aplique a task `triage-intake`.

### Process

1. Leia o intake e as referências. Para ticket `AO-n` com `mcp__office__ticket_get` disponível, leia o ticket inteiro; sem a ferramenta, registre "ticket não lido (fora do Agent Office)". Links externos ficam para a Bruna Benchmark, se o discovery rodar.
2. Confirme o track: aceite o do usuário quando ele bate com o pedido; se não bate (ex.: "entrega" que exige pesquisa de mercado), recomende outro **com motivo**. Quem decide é o usuário no step-03.
3. Mapeie as superfícies: liste arquivos e funções prováveis (architecture-map + buscas rápidas com Grep) e traduza para executores `integration`, `platform`, `world`, `ui`.
4. Compare os arquivos prováveis com `sensitive_surfaces`; qualquer coincidência vira `sensitive: true`, citando o arquivo que acionou.
5. Classifique a complexidade: **SIMPLE** (1 story ≤ 3 pts em padrão existente), **STANDARD** (2–5 stories ou alguma pesquisa), **COMPLEX** (épico, nova superfície ou infraestrutura, múltiplas iterações — registre as flags "revisão arquitetural" e "considerar dividir").
6. Liste riscos com etiqueta e uma linha cada: `sdk-experimental-api`, `cross-platform`, `perf`, `a11y`, `i18n`, `security`, `data-migration`, `working-tree-dirty`.
7. Resolva cada step de 04 a 24 em `run` ou `skip` pela matriz: toda condição `cond:` vira decisão com motivo concreto. Steps 13–16 rodam se a superfície do executor foi mapeada (eles conferem as subtarefas de novo depois do step-12).
8. Declare o orçamento: conte os steps em subagente que rodam (`max_subagent_steps`), `max_review_cycles: 3` e `usd_ceiling: null`, salvo valor dado pelo usuário.
9. Se `git status` mostrar alterações não commitadas, registre `working-tree-dirty` e inclua a pergunta para o step-03 (commitar ou guardar antes da implementação).
10. Em re-execução, aplique o feedback do step-03 e abra o arquivo com "Mudanças nesta versão". Apresente o resumo na conversa e grave no caminho transformado.

## Output Format

The output MUST follow this exact structure:
````markdown
# Run-plan — {título curto da iniciativa}

## Mudanças nesta versão
{só em re-execução}

## Resumo
{2–4 frases: o que será feito, por quê e até onde a run vai}

## Classificação
| Campo | Valor | Evidência |
|---|---|---|
| Track pedido | ... | intake |
| Track recomendado | ... | {motivo, se diferente} |
| Complexidade | SIMPLE / STANDARD / COMPLEX | {critério atendido} |
| Superfícies | {executores} | {arquivos} |
| Sensível | sim / não | {arquivo que acionou} |
| Riscos | {etiquetas} | {uma linha cada} |

## Steps da run
| Step | Agente | Status | Motivo |
|---|---|---|---|
| step-04 … step-24 | ... | run / skip | ... |

## Orçamento
{steps em subagente, ciclos de revisão, teto}

## Para decidir no step-03
- {pergunta objetiva, se houver}

```yaml
run_plan:
  {esquema completo do run-conventions §4, com um item por step de 04 a 24}
```
````

## Output Example

````markdown
# Run-plan — Subagentes visíveis no escritório

## Resumo
Mostrar os subagentes (ferramenta Agent/Task) como estagiários ao lado da mesa do agente que delegou e listá-los no painel. Hoje `AgentManager.handle()` descarta toda mensagem com `parent_tool_use_id`, então o usuário não percebe a delegação. A run vai do discovery ao PR e ao kit de lançamento.

## Classificação
| Campo | Valor | Evidência |
|---|---|---|
| Track pedido | iniciativa | intake |
| Track recomendado | iniciativa | feature nova; o Pixel Agents já mostra subagentes |
| Complexidade | STANDARD | 3 stories prováveis sobre padrões existentes (ator, evento, painel) |
| Superfícies | integration, platform, world, ui | `agents.ts`, `bridge.ts`, `demo.ts`, `game.ts`, `panel.ts` |
| Sensível | sim | `src/main/agents.ts` e `src/main/bridge.ts` estão em `sensitive_surfaces` |
| Riscos | cross-platform, perf, sdk-experimental-api | hooks variam por versão do Claude Code; até 40 atores; Agent Teams é experimental |

## Steps da run
| Step | Agente | Status | Motivo |
|---|---|---|---|
| step-04 | Bruna Benchmark | run | concorrente direto já tem a feature |
| step-05 | Rita Roadmap | run | iniciativa nova |
| step-06 | checkpoint | run | Gate 1 do AIOX |
| step-07 | Úrsula Usabilidade | run | painel do agente ganha seção nova |
| step-08 | Iuri Isométrico | run | novo tipo de personagem no mundo |
| step-09 | Artur Arquitetura | run | evento novo em `OfficeEvent` e hook novo na ponte |
| step-10 | Kauã Kanban | run | — |
| step-11 | Priscila Prioridade | run | — |
| step-12 | checkpoint | run | — |
| step-13 | Henrique Hook | run | detecção no SDK e nos hooks |
| step-14 | Eduardo Electron | run | subagentes simulados no modo demo (`demo.ts`) para QA sem tokens |
| step-15 | Vitor Voxel | run | estagiários no mundo |
| step-16 | Fernanda Front | run | lista no painel |
| step-17 | Tânia Teste | run | — |
| step-18 | Sílvia Sandbox | run | toca `agents.ts` e `bridge.ts` |
| step-19 | Lívia Linguagem | run | textos novos no painel |
| step-20 | Diego Deploy | run | PR |
| step-21 | checkpoint | run | — |
| step-22 | Diego Deploy | run | — |
| step-23 | Camila Comunidade | run | feature visual e compartilhável |
| step-24 | Otávio Orquestra | run | — |

## Orçamento
8 steps em subagente (04, 09, 13–18), até 3 ciclos de revisão, sem teto em US$.

## Para decidir no step-03
- Nada pendente: a árvore de trabalho está limpa na branch `main`.

```yaml
run_plan:
  run_slug: "subagentes-visiveis"
  track: iniciativa
  complexity: STANDARD
  office_board: false
  surfaces: [integration, platform, world, ui]
  sensitive: true
  risk_flags: [cross-platform, perf, sdk-experimental-api]
  budget: { max_subagent_steps: 8, max_review_cycles: 3, usd_ceiling: null }
  steps:
    step-04: { status: run, reason: "concorrente direto já tem a feature" }
    step-05: { status: run, reason: "iniciativa nova" }
    step-06: { status: run, reason: "Gate 1 do AIOX" }
    step-07: { status: run, reason: "seção nova no painel do agente" }
    step-08: { status: run, reason: "novo personagem no mundo" }
    step-09: { status: run, reason: "evento e hook novos" }
    step-10: { status: run, reason: "track iniciativa" }
    step-11: { status: run, reason: "track iniciativa" }
    step-12: { status: run, reason: "track iniciativa" }
    step-13: { status: run, reason: "superfície integration mapeada" }
    step-14: { status: run, reason: "demo com subagentes simulados" }
    step-15: { status: run, reason: "superfície world mapeada" }
    step-16: { status: run, reason: "superfície ui mapeada" }
    step-17: { status: run, reason: "track iniciativa" }
    step-18: { status: run, reason: "superfície sensível tocada" }
    step-19: { status: run, reason: "texto novo visível ao usuário" }
    step-20: { status: run, reason: "PR" }
    step-21: { status: run, reason: "publicação exige aprovação" }
    step-22: { status: run, reason: "PR" }
    step-23: { status: run, reason: "entrega relevante para usuários" }
    step-24: { status: run, reason: "sempre" }
```
````

## Veto Conditions

Este step nunca grava nota de pulo; as condições valem sempre. Reject and redo if ANY are true:
1. Bloco `run_plan` ausente, YAML inválido ou faltando algum step entre 04 e 24.
2. Algum step com status diferente de `run`/`skip` (condição não resolvida) ou sem motivo.
3. `sensitive: false` com arquivo provável que consta em `sensitive_surfaces`.
4. Track recomendado diferente do pedido sem motivo explícito.

## Quality Criteria

- [ ] Toda superfície tem pelo menos um arquivo como evidência
- [ ] Complexidade justificada pelo critério do domain-framework
- [ ] `max_subagent_steps` bate com os steps em subagente marcados como `run`
- [ ] Perguntas para o step-03 são objetivas e respondíveis com opções
- [ ] Runs anteriores consultadas (sem repetir discovery recente sem motivo)
- [ ] Cada risco tem etiqueta e uma linha de explicação
