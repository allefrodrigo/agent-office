---
task: "Triagem do intake e plano da run"
order: 1
input: |
  - intake: output/{run_id}/01-intake.md — pedido, tipo de trabalho, referências, ticket AO citado e escolha sobre o quadro do escritório
  - design: _build/design.yaml — superfícies sensíveis, executores e track_matrix
  - framework: pipeline/data/domain-framework.md — matriz de tracks e regras de complexidade
  - history: _memory/runs.md — runs anteriores parecidas (opcional)
output: |
  - run_plan: output/02-plan/run-plan.md — resumo, evidência, tabela de steps 04–24, riscos, orçamento, perguntas e o bloco YAML run_plan (run-conventions §4)
---

# Triagem do intake e plano da run

Transforma o pedido do usuário num plano de execução auditável: track, complexidade, superfícies, steps que rodam ou pulam, executores, riscos e orçamento. É a única fonte que os steps 04–24 consultam no Gate do track, então precisa ser explícito a ponto de dispensar interpretação.

## Process

1. Ler o intake inteiro. Extrair o objetivo numa frase, o tipo declarado (feature, story pronta, bug, release, estratégia), a chave `AO-n` citada, as referências e a escolha sobre `office_board`.
2. Mapear a evidência: listar arquivos e módulos prováveis pelo mapa camada → executor. Se o intake descreve um comportamento, localizar o código com Grep (ex.: `handle(` em `src/main/agents.ts`, `dispatch(` em `src/main/bridge.ts`, `goBoss` em `src/renderer/src/game.ts`) e anotar o motivo de cada arquivo.
3. Escolher o track pelo tipo do intake e corrigir se a evidência contradiz: "bug" que pede capacidade nova vira `iniciativa`; story já escrita vira `entrega`; `discovery` só quando nenhuma mudança de código foi pedida.
4. Classificar a complexidade: **SIMPLE** = 1 story ≤ 3 pts numa camada com padrão existente; **STANDARD** = 2–5 stories, até 3 camadas ou contrato novo em `src/shared/types.ts`; **COMPLEX** = épico, superfície ou infraestrutura nova, dependência nova, API experimental do SDK, formato interno do Claude Code ou as 4 camadas.
5. Marcar `sensitive: true` se algum arquivo provável estiver na lista `sensitive_surfaces` do `design.yaml`. Registrar `risk_flags` entre `sdk-experimental-api`, `claude-internal-format`, `cross-platform`, `perf`, `security`, `data-migration`.
6. Aplicar a matriz de tracks de 04 a 24. Resolver cada condição (`cond:`) com a evidência do passo 2 e escrever o motivo numa frase. Em `release` e `discovery`, conferir que 10–16 ficam em `skip`.
7. Definir `surfaces` (executores) e orçamento: `max_subagent_steps` = número de steps `subagent` com status `run`; `max_review_cycles` = 3 (2 em SIMPLE); `usd_ceiling` só se o usuário informou um teto.
8. Gerar o `run_slug` (kebab-case, até 4 palavras, sem acento) e escrever o run-plan no formato abaixo, terminando no bloco YAML do run-conventions §4.
9. Se faltar algo que muda o track ou uma condição (ex.: não dá para saber se há mudança visual), registrar em "Perguntas para o checkpoint 03" em vez de presumir.

## Output Format

````markdown
# Run-plan — {título curto}

## Resumo
- **Objetivo:** {uma frase}
- **Track:** {track} · **Complexidade:** {nível} ({motivo})
- **Superfícies:** {executores} · **Sensível:** {sim/não} ({arquivos}) · **Quadro do escritório:** {sim/não}

## Evidência
| Arquivo ou módulo | Por que entra | Executor |

## Steps
| Step | Status | Motivo |

## Riscos
- `{flag}`: {descrição} — coberto por {gate/agente}

## Orçamento
## Perguntas para o checkpoint 03

```yaml
run_plan: {esquema do run-conventions §4, um item por step de step-04 a step-24}
```
````

## Output Example

> Use como referência de qualidade, não como template rígido.

````markdown
# Run-plan — Subagentes visíveis no escritório

## Resumo
- **Objetivo:** mostrar os subagentes que um agente dispara (ferramentas `Agent`/`Task`) como estagiários ao lado da mesa e listá-los no painel.
- **Track:** iniciativa · **Complexidade:** STANDARD (3 stories previstas; contrato novo em `OfficeEvent`)
- **Superfícies:** integration, platform, world, ui · **Sensível:** sim (`agents.ts`, `bridge.ts`, `index.ts`) · **Quadro do escritório:** não

## Evidência
| Arquivo ou módulo | Por que entra | Executor |
|---|---|---|
| `src/main/agents.ts` — `handle()` | hoje descarta mensagens com `parent_tool_use_id` | integration |
| `src/main/bridge.ts` — `dispatch()` | PreToolUse de `Agent`/`Task` e hook `SubagentStop` nas sessões do terminal | integration |
| `src/shared/types.ts`, `src/main/index.ts` | evento novo `agent:subagent` e repasse no `broadcast` | platform |
| `src/renderer/src/game.ts`, `world/avatar.ts` | ator temporário ao lado da mesa | world |
| `src/renderer/src/ui/panel.ts` | lista de subagentes ativos | ui |

## Steps
| Step | Status | Motivo |
|---|---|---|
| 04 Discovery | run | Pixel Agents já mostra subagentes; falta o recorte de diferencial |
| 05–06 PRD e aprovação | run | feature nova com métrica a definir (Gate 1) |
| 07 UX | run | o painel ganha uma seção nova |
| 08 Mundo | run | novo tipo de ator e regra de ocupação perto das mesas |
| 09 Arquitetura | run | contrato novo em `OfficeEvent` e hook novo na ponte |
| 10–12 Stories | run | ciclo de stories obrigatório com código |
| 13–16 Implementação | run | há subtarefas das 4 camadas |
| 17 QA · 18 Segurança | run | obrigatório · toca `bridge.ts` e `agents.ts` |
| 19 Docs | run | feature visível ao usuário |
| 20–22 Release | run | entrega via PR |
| 23 Lançamento | run | demo visual com potencial de divulgação |
| 24 Encerramento | run | obrigatório |

## Riscos
- `cross-platform`: hooks de subagente precisam de verificação no Windows — Tânia declara se não testou.
- `perf`: até 10 agentes × 3 subagentes visíveis — Vitor mede draw calls.
- `security`: campos vindos de hook são não confiáveis (I-14) — step-18.

## Orçamento
- Subagentes: 8 (04, 09, 13, 14, 15, 16, 17, 18) · ciclos de revisão: até 3 · teto em USD: não informado

## Perguntas para o checkpoint 03
- Subagentes das sessões do terminal entram nesta run ou só os dos agentes do escritório?

```yaml
run_plan:
  run_slug: "subagentes-visiveis"
  track: iniciativa
  complexity: STANDARD
  office_board: false
  surfaces: [integration, platform, world, ui]
  sensitive: true
  risk_flags: [cross-platform, perf, security]
  budget: { max_subagent_steps: 8, max_review_cycles: 3, usd_ceiling: null }
  steps:
    step-04: { status: run, reason: "recorte de diferencial frente ao Pixel Agents" }
    step-05: { status: run, reason: "feature nova" }
    step-06: { status: run, reason: "Gate 1 do AIOX" }
    step-07: { status: run, reason: "seção nova no painel" }
    step-08: { status: run, reason: "novo ator no mundo" }
    step-09: { status: run, reason: "contrato novo e hook novo" }
    step-10: { status: run, reason: "ciclo de stories" }
    step-11: { status: run, reason: "ciclo de stories" }
    step-12: { status: run, reason: "ciclo de stories" }
    step-13: { status: run, reason: "S-1 integration" }
    step-14: { status: run, reason: "S-1 platform" }
    step-15: { status: run, reason: "S-2 world" }
    step-16: { status: run, reason: "S-3 ui" }
    step-17: { status: run, reason: "obrigatório" }
    step-18: { status: run, reason: "superfície sensível" }
    step-19: { status: run, reason: "visível ao usuário" }
    step-20: { status: run, reason: "PR" }
    step-21: { status: run, reason: "aprovação de publicação" }
    step-22: { status: run, reason: "PR" }
    step-23: { status: run, reason: "demo visual" }
    step-24: { status: run, reason: "obrigatório" }
```
````

## Quality Criteria

- [ ] Track e complexidade justificados por arquivos ou módulos citados na tabela de evidência.
- [ ] Um item por step de 04 a 24 no YAML, cada um com `status` (`run`|`skip`) e `reason`.
- [ ] `sensitive` coerente com a lista de superfícies sensíveis; step-18 em `run` quando `sensitive: true`.
- [ ] `max_subagent_steps` igual ao número de steps `subagent` com status `run`.
- [ ] Dúvidas que mudam o plano estão em "Perguntas para o checkpoint 03", não presumidas.

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Bloco YAML ausente, inválido ou sem algum step de 04 a 24.
2. Arquivo de superfície sensível na evidência com `sensitive: false` ou step-18 em `skip`.
3. Track `discovery` ou `release` com step de implementação (13–16) em `run`, ou track com código e steps 10–12 em `skip`.
4. Qualquer step pulado sem motivo.
