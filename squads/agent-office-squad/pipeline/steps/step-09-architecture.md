---
execution: subagent
agent: architect
model_tier: powerful
tasks:
  - design-architecture
  - record-decisions-and-threats
outputFile: squads/agent-office-squad/output/09-architecture/architecture.md
---

# Step 09: Arquitetura e plano técnico — 🏛️ Artur Arquitetura

## Context Loading

A pasta da run é a do caminho de saída que o runner passou; para outputs de agente use a maior `vN/` (run-conventions §2). Carregue:
- `squads/agent-office-squad/output/{run_id}/01-intake.md`, `.../02-plan/vN/run-plan.md` e `.../03-plan-approval.md`.
- `squads/agent-office-squad/output/{run_id}/05-prd/vN/prd.md` e `.../06-prd-approval.md` — requisitos FR/NFR/CON da fatia aprovada e ajustes obrigatórios.
- `squads/agent-office-squad/output/{run_id}/07-ux/vN/ux-spec.md` e `.../08-world/vN/world-spec.md`, se existirem.
- `squads/agent-office-squad/output/{run_id}/04-discovery/vN/discovery-brief.md` — impacto no código já mapeado.
- `_opensquad/_memory/company.md` e `squads/agent-office-squad/_memory/memories.md`.
- `squads/agent-office-squad/pipeline/data/architecture-map.md` (módulos, IPC, eventos, fluxos, invariantes I-01…I-14), `engineering-standards.md`, `security-checklist.md`, `quality-criteria.md` (rubrica de arquitetura) e `anti-patterns.md`.
- Código: `src/shared/types.ts`, `src/preload/index.ts`, `src/main/index.ts` e os módulos das superfícies; `package.json`; tipos do SDK em `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` quando a solução depende de mensagens ou opções do SDK.
- Documentação oficial do Claude Code (hooks, SDK) via `web_fetch`, só para confirmar comportamento que o código não mostra.
- Em re-execução (volta do checkpoint 12 por BLOCKED_UPSTREAM): versão anterior e `squads/agent-office-squad/output/{run_id}/12-story-selection.md`.

## Instructions

### Gate do track

1. Leia o run-plan e a aprovação do step-03 (a aprovação prevalece).
2. Este step roda sempre no track **iniciativa**; no **entrega**, se a complexidade for STANDARD ou COMPLEX; no **bugfix**, só se for COMPLEX. Nos tracks release e discovery o status é `skip`.
3. Se o status for `skip`, grave a nota de pulo do run-conventions §3 (título `# Step 09 — Pulado`, motivo, track e complexidade) e encerre.

### Process

1. Liste os requisitos da fatia aprovada e leia o código atual de cada módulo tocado antes de propor qualquer mudança.
2. **Task `design-architecture`:** escreva os contratos primeiro — tipos em `src/shared/types.ts`, novos `OfficeEvent`, métodos do `OfficeAPI`/preload e canais IPC — com assinatura TypeScript completa.
3. Detalhe as mudanças por camada e por executor (`integration`, `platform`, `world`, `ui`): arquivo, função e o que muda. Contrato de que outro executor depende entra no executor que implementa primeiro (ordem 13 → 16).
4. Dados e migração: mudanças em `office.json`, `tickets.json`, `bridge-token` ou `~/.claude/settings.json`, com compatibilidade para frente e para trás e escrita atômica.
5. Performance (taxa de eventos, limites, throttling), compatibilidade (versão do SDK e do Claude Code, macOS × Windows) e modos de falha (API experimental ausente, hook não instalado, processo morto).
6. Confira cada invariante I-01…I-14 tocado e diga como é preservado; mudar um invariante exige ADR.
7. Estratégia de testes: unitários com fixtures, verificação manual no demo isolado, capturas; se não houver infraestrutura de testes, diga isso e proponha a story de infraestrutura.
8. **Task `record-decisions-and-threats`:** ADRs (contexto, decisão, alternativas, consequências) e modelo de ameaças STRIDE-lite para cada superfície sensível tocada, citando itens do security-checklist.
9. Como subagente você não pergunta ao usuário: registre perguntas abertas com opções e recomendação; elas vão ao checkpoint 12.
10. Grave no caminho transformado e devolva um resumo de 3 linhas.

## Output Format

The output MUST follow this exact structure:
````markdown
# Arquitetura — {título da iniciativa}

**Versão:** v{n} · **Arquiteto:** Artur Arquitetura · **Cobre:** {FR/NFR/CON}

## Mudanças nesta versão
## Resumo da solução
## Contratos
```ts
{tipos, eventos e métodos com assinatura completa}
```
## Mudanças por camada
| Executor | Arquivo | Mudança |
## Fluxo
## Dados e migração
## Performance
## Compatibilidade
## Modos de falha
## Invariantes
| Invariante | Como é preservado |
## Estratégia de testes
## ADRs
## Modelo de ameaças (STRIDE-lite)
| Ameaça | Superfície | Mitigação | Item do checklist |
## Perguntas abertas
````

## Output Example

````markdown
# Arquitetura — Subagentes visíveis no escritório

**Versão:** v1 · **Arquiteto:** Artur Arquitetura · **Cobre:** FR-1 a FR-4, NFR-1 a NFR-3, CON-1, CON-2

## Resumo da solução
O main detecta subagentes nas mensagens do SDK que já recebe e nos hooks da ponte (custo zero de tokens), mantém a lista transitória em `AgentSummary.subagents` e emite `agent:subagent` para animar. O renderer cria estagiários no mundo e uma seção no painel.

## Contratos
```ts
// src/shared/types.ts
export interface SubagentInfo {
  id: string          // tool_use id do Agent/Task (ou sintético no terminal)
  description: string // input.description, até 60 caracteres
  startedAt: number
}
export interface AgentSummary { /* … */ subagents?: SubagentInfo[] }
export interface BridgeStatus { /* … */ outdated?: boolean }
export type OfficeEvent =
  /* … */ | { type: 'agent:subagent'; agentId: string; subagent: SubagentInfo; phase: 'start' | 'end' }
```

## Mudanças por camada
| Executor | Arquivo | Mudança |
|---|---|---|
| integration | `src/shared/types.ts` | contratos acima (o step-13 vem primeiro) |
| integration | `src/main/agents.ts` | em `handle()`, antes do `return` de `parent_tool_use_id`: `tool_use` de `Agent`/`Task` → início; `tool_result` com o mesmo id → fim; limpar em `fire()`, `clearContext()`, `interrupt()` e no `result` |
| integration | `src/main/bridge.ts` | PreToolUse de `Agent`/`Task` → início (id do hook quando houver); `SubagentStop` → fim do mais antigo da sessão; `install()` inclui `SubagentStop`; `status()` marca `outdated` sem essa entrada |
| platform | `src/main/demo.ts` | subagentes simulados no modo demo |
| world | `src/renderer/src/game.ts`, `world/avatar.ts` | `spawnIntern()`, `removeIntern()`, prop `laptop` |
| ui | `src/renderer/src/ui/panel.ts`, `ui/modals.ts` | seção "Subagentes ativos"; "Reconectar" quando `outdated` |

## Dados e migração
Campo transitório: `persist()` remove `subagents`; `office.json` não muda. A ponte instalada antes desta versão aparece como `outdated` até o usuário reconectar.

## Compatibilidade
- SDK 0.3.x expõe `parent_tool_use_id` e `tool_use_id`; tratar os nomes `Agent` e `Task` (o `describe.ts` já faz isso).
- Sem código específico de plataforma; o hook vale para macOS e Windows.

## Modos de falha
- Fim nunca recebido → limpeza no `result` do turno (escritório) e no `Stop`/`SessionEnd` (terminal).

## Invariantes
| Invariante | Como é preservado |
|---|---|
| Só `mcp__office__*` é auto-permitido | `canUseTool` não muda |
| Ponte: 127.0.0.1, token, sem `Origin` | só um evento a mais no `dispatch()` |

## Estratégia de testes
- Função pura `subagentDelta(msg)` com fixtures reais; sem Vitest no repo → story de infraestrutura proposta.
- Demo isolado com subagentes simulados e captura antes/depois.

## ADRs
- **ADR-001 — Lista transitória em `AgentSummary` + evento de animação.** Alternativas: só evento (perde estado ao recarregar o renderer); persistir (dados obsoletos após reinício). Consequência: `getState()` já entrega o estado; o evento só anima.

## Modelo de ameaças (STRIDE-lite)
| Ameaça | Superfície | Mitigação | Item do checklist |
|---|---|---|---|
| Tampering (injeção) | descrição vinda do agente ou do hook | corte em 60 caracteres, `textContent`, nunca `innerHTML` | renderer / dados não confiáveis |
| DoS | agente que cria centenas de subagentes | teto de 20 rastreados, 3 desenhados | ponte / limites |

## Perguntas abertas
- O `SubagentStop` da versão instalada informa qual chamada terminou? Recomendação: casar por ordem de início agora e trocar por id quando o campo existir.
````

## Veto Conditions

As condições abaixo não se aplicam à nota de pulo. Reject and redo if ANY are true:
1. Contrato novo ou alterado sem assinatura TypeScript.
2. Invariante tocado sem análise de como é preservado, ou alterado sem ADR.
3. Superfície sensível tocada sem linha no modelo de ameaças.
4. Dependência, framework ou serviço novo sem ADR.
5. Sem estratégia de testes ou sem análise de compatibilidade macOS × Windows.

## Quality Criteria

- [ ] Todo requisito da fatia aprovada aparece em "Cobre" e numa mudança por camada
- [ ] Cada mudança tem executor e arquivo
- [ ] Modos de falha cobrem APIs experimentais e hooks ausentes
- [ ] ADR com alternativas reais e consequências
- [ ] Perguntas abertas trazem opções e recomendação
- [ ] Nada inventado: o que não foi verificado no código ou na doc está marcado como hipótese
