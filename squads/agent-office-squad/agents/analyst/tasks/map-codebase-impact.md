---
task: "Mapa de impacto no código e discovery-brief"
order: 2
input: |
  - competitive_scan: saída da task scan-competitors
  - architecture_map: pipeline/data/architecture-map.md — módulos, IPC, eventos, dados e invariantes I-01…I-14
  - codebase: src/ (main, preload, shared, renderer)
  - run_plan: output/{run_id}/02-plan/vN/run-plan.md e output/{run_id}/03-plan-approval.md
output: |
  - discovery_brief: output/04-discovery/discovery-brief.md — documento final do step-04, consolidando scan competitivo, evidência de usuários, impacto no código, recomendações para o PRD, lacunas, fontes e proposta de atualização do benchmark
---

# Mapa de impacto no código e discovery-brief

Lê o código e o architecture-map para dizer o que a iniciativa toca no Agent Office — módulos, contratos, invariantes e riscos — e consolida tudo, junto com o scan competitivo, no discovery-brief. É a última task do step-04: o arquivo dela é o output do step.

## Process

1. Partir das superfícies do run-plan e confirmar no código. Para cada camada, abrir os arquivos e localizar as funções envolvidas (ex.: `AgentManager.handle()` e `askPlayer()` em `src/main/agents.ts`; `Bridge.dispatch()` em `src/main/bridge.ts`; `Game.desired()`/`reconcile()` em `src/renderer/src/game.ts`; `AgentPanel` em `src/renderer/src/ui/panel.ts`).
2. Listar contratos afetados: tipos em `src/shared/types.ts` (`OfficeEvent`, `AgentSummary`, `OfficeAPI`), canais IPC `office:*` em `src/main/index.ts` e `src/preload/index.ts`, eventos de hook instalados por `Bridge.install()`, ferramentas MCP de `TicketBoard.toolsFor()`.
3. Cruzar com os invariantes I-01…I-14 e marcar quais a mudança pode quebrar e por quê.
4. Identificar dependências frágeis tocadas: API experimental de uso do SDK, formato interno de `~/.claude/sessions/*.json`, esquema de hooks, comportamento diferente em Windows (`process.platform === 'win32'`).
5. Registrar evidência de usuários quando houver (issues, discussões, pedidos no intake); sem evidência, dizer "sem evidência direta" e sugerir como obtê-la.
6. Consolidar o discovery-brief: pergunta, achados (com confiança), concorrentes, espaço vazio, evidência de usuários, impacto no código, recomendações para o PRD (numeradas, ligadas a achados), lacunas e perguntas, fontes e proposta de atualização do `benchmark-landscape.md`.
7. Revisar: cada recomendação cita um achado (F-n) ou um ponto do código; nada de requisito inventado.

## Output Format

```markdown
# Discovery — {iniciativa}
## Pergunta
## Achados (fato · confiança · fontes)
## Como os concorrentes resolvem
| Produto | Abordagem | {critério 1} | {critério 2} | Fontes |
## Paridade, diferencial e espaço vazio
## Evidência de usuários
## Impacto no código
| Camada | Arquivo · função | Mudança provável | Invariantes em risco |
### Contratos afetados
### Dependências frágeis
## Recomendações para o PRD
## Lacunas e perguntas para o checkpoint 06
## Fontes
## Proposta de atualização do benchmark-landscape.md
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# Discovery — Subagentes visíveis no escritório

## Pergunta
Como mostrar subagentes de forma útil — não só decorativa — e o que isso toca no Agent Office?

## Achados (fato · confiança · fontes)
- F1 · Pixel Agents mostra subagentes e Agent Teams como personagens ligados ao agente pai · média · S1, S5
- F2 · roving-office deixa subagentes ("ghost rendering") para depois · baixa · S2
- F3 · Agent Teams do Claude Code é experimental e depende de flag · média · S6, S7

## Paridade, diferencial e espaço vazio
- Paridade: indicar que um subagente existe e a quem pertence.
- Diferencial: permissão pedida por subagente chega pelo mesmo `canUseTool` do pai — o agente pai pode ir até o usuário dizendo qual estagiário pediu.
- Espaço vazio: agir sobre subagentes (ver o que fazem, interromper) a partir do escritório.

## Evidência de usuários
Sem evidência direta (não há issues públicas). Sugestão: perguntar no lançamento da v0.3 e acompanhar no quadro.

## Impacto no código
| Camada | Arquivo · função | Mudança provável | Invariantes em risco |
|---|---|---|---|
| integration | `agents.ts` · `handle()` | parar de descartar mensagens com `parent_tool_use_id` e derivar eventos | I-08, I-13 |
| integration | `bridge.ts` · `dispatch()` / `install()` | tratar PreToolUse de `Agent`/`Task` e instalar `SubagentStop` | I-03, I-04, I-14 |
| platform | `shared/types.ts`, `index.ts` | `OfficeEvent` `agent:subagent` e repasse | I-14 |
| world | `game.ts`, `world/avatar.ts` | ator temporário ao lado da mesa, máx. 3 + "+N" | — |
| ui | `ui/panel.ts` | seção "Subagentes" acessível por teclado | I-06 |

### Contratos afetados
- `OfficeEvent` ganha `{ type: 'agent:subagent'; agentId; subagent: { id; description; status } }`.
### Dependências frágeis
- Esquema do hook `SubagentStop` e do campo de descrição da ferramenta `Agent`/`Task` pode mudar entre versões do Claude Code.

## Recomendações para o PRD
1. Escopo inicial com agentes do escritório e sessões do terminal (F1: paridade exige os dois).
2. Diferenciar pela governança: permissão de subagente identifica quem pediu (F1, código de `askPlayer`).
3. Limitar a visualização a 3 subagentes por agente (+N) para não poluir o mundo com 10 agentes.

## Lacunas e perguntas para o checkpoint 06
- Subagentes devem poder ser interrompidos individualmente? O SDK expõe isso? (não verificado)

## Fontes
- S1 https://github.com/pixel-agents-hq/pixel-agents (2026-10-08, primária)
- S2 https://github.com/atlassian-labs/roving-office (2026-10-08, primária)

## Proposta de atualização do benchmark-landscape.md
- Pixel Agents: acrescentar "Agent Teams com papéis e ciclo de vida" à linha de visualização (S1, 2026-10-08).
```

## Quality Criteria

- [ ] Todo arquivo citado existe e a função citada está nele.
- [ ] Cada linha de impacto aponta invariantes em risco ou "—" justificado.
- [ ] Cada recomendação para o PRD referencia um achado (F-n) ou trecho de código.
- [ ] Seções obrigatórias presentes, inclusive lacunas e proposta de atualização do benchmark.
- [ ] Dependências frágeis e diferenças de plataforma registradas quando aplicável.

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Impacto no código sem arquivo e função reais (estimativa sem leitura).
2. Recomendação que não deriva de achado, evidência de usuário ou código (invenção).
3. Superfície sensível tocada sem citar os invariantes correspondentes.
4. Discovery-brief sem as seções de fontes ou de lacunas.
