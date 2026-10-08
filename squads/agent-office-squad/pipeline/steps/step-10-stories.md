---
execution: inline
agent: scrum-master
tasks:
  - draft-stories
  - register-board-tickets
outputFile: squads/agent-office-squad/output/10-stories/stories.md
---

# Step 10: Stories — 🌊 Kauã Kanban

## Context Loading

Carregue antes de executar (outputs de agente: maior `vN/`, run-conventions §2):
- `squads/agent-office-squad/output/{run_id}/01-intake.md`, `.../02-plan/vN/run-plan.md` e `.../03-plan-approval.md`.
- Conforme o track: PRD e aprovação (`.../05-prd/vN/prd.md`, `.../06-prd-approval.md`), `.../07-ux/vN/ux-spec.md`, `.../08-world/vN/world-spec.md`, `.../09-architecture/vN/architecture.md` e `.../04-discovery/vN/discovery-brief.md` — os que existirem.
- `squads/agent-office-squad/pipeline/data/story-template.md` — formato obrigatório da story.
- `squads/agent-office-squad/pipeline/data/aiox-pipeline-map.md` (ciclo de vida e autoridade), `architecture-map.md` (invariantes I-01…I-14), `engineering-standards.md`, `quality-criteria.md` (rubrica de story) e `anti-patterns.md`.
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — §7 (quadro do escritório) e §8 (comandos zsh/PowerShell).
- `_opensquad/_memory/company.md` e `squads/agent-office-squad/_memory/memories.md`.
- Em loop (volta do step-11): versão anterior das stories e `.../11-validation/vN/po-validation.md`.

## Instructions

### Gate do track

1. Leia o run-plan e a aprovação do step-03 (a aprovação prevalece).
2. Este step roda nos tracks **iniciativa**, **entrega** e **bugfix**; em release e discovery o status é `skip`.
3. Se o status for `skip`, grave a nota de pulo do run-conventions §3 (título `# Step 10 — Pulado`, motivo, track e complexidade) e encerre.

### Process

1. Defina as fontes pelo track: **iniciativa** → fatia aprovada do PRD + specs + arquitetura; **entrega** → ticket do intake (com `mcp__office__ticket_get` quando disponível) ou descrição do intake, mais a arquitetura se ela rodou; **bugfix** → reprodução do intake (passos, esperado × obtido, ambiente) e leitura rápida do código suspeito, sem corrigir nada.
2. **Task `draft-stories`:** escreva fatias verticais — cada story entrega um resultado verificável — no formato do story-template, com status `Draft`.
3. Critérios de aceite em Given/When/Then, numerados e verificáveis; fora de escopo explícito; notas técnicas com fonte (`[PRD FR-n]`, `[ARQ §n]`, `arquivo:função`) e invariantes que a story pode quebrar.
4. Subtarefas marcadas por executor (`integration`, `platform`, `world`, `ui`, `test`), na ordem em que o pipeline implementa (13 → 16). Contrato compartilhado fica com o executor que precisa dele primeiro.
5. Plano de testes com automático, manual no demo isolado (comando zsh e PowerShell quando diferir), visual (capturas) e plataformas; bug exige subtarefa de teste de regressão.
6. Estimativa até 5 pts; acima disso, divida. Declare dependências entre stories.
7. Monte o índice no topo e a tabela de rastreabilidade requisito → stories; requisito sem story ou story sem requisito precisa de motivo.
8. **Task `register-board-tickets`:** com `office_board: true` e `mcp__office__ticket_create` disponível, crie cada story como ticket em `backlog` (`cwd` = raiz do repositório, `acceptance` = critérios) e anote a chave `AO-n` na story; caso contrário registre "não aplicável" com o motivo.
9. Em loop do step-11, corrija só o que a Priscila Prioridade apontou, liste as mudanças em "Mudanças nesta versão" e, se houver tickets, atualize a descrição com `ticket_update` e registre a mudança de critérios com `ticket_comment` (nunca crie ticket duplicado).
10. Nunca altere código nem rode git. Apresente o índice na conversa e grave no caminho transformado.

## Output Format

The output MUST follow this exact structure:
```markdown
# Stories — {título da iniciativa}

**Versão:** v{n} · **SM:** Kauã Kanban · **Track:** {track} · **Fontes:** {artefatos usados}

## Mudanças nesta versão
{só em loop}

## Índice
| Id | Título | Tipo | Prioridade | Pts | Executores | Depende de | Ticket |
|---|---|---|---|---|---|---|---|

## S-{n} · {título} — uma seção por story, no formato completo do story-template

## Registro no quadro
{chaves criadas | "não aplicável: {motivo}"}

## Rastreabilidade
| Requisito | Stories |

## Perguntas abertas
```

## Output Example

```markdown
# Stories — Subagentes visíveis no escritório

**Versão:** v1 · **SM:** Kauã Kanban · **Track:** iniciativa · **Fontes:** PRD v1, ux-spec v1, world-spec v1, arquitetura v1

## Índice
| Id | Título | Tipo | Prioridade | Pts | Executores | Depende de | Ticket |
|---|---|---|---|---|---|---|---|
| S-1 | Emitir eventos de subagentes a partir do SDK e dos hooks | feature | high | 3 | integration, platform, test | — | não registrado |
| S-2 | Mostrar subagentes como estagiários ao lado da mesa do agente | feature | high | 3 | world | S-1 | não registrado |
| S-3 | Listar subagentes ativos no painel do agente | feature | medium | 2 | ui | S-1 | não registrado |

## S-1 · Emitir eventos de subagentes a partir do SDK e dos hooks

- **Status:** Draft
- **Tipo:** feature · **Prioridade:** high · **Estimativa:** 3 pts
- **Tags:** subagentes, integração, ponte
- **Origem:** PRD FR-1, FR-2, NFR-3 · ARQ §Contratos
- **Depende de:** nenhuma

### Contexto
Hoje `AgentManager.handle()` descarta mensagens com `parent_tool_use_id` e a ponte não instala hook de fim de subagente [ARQ §Resumo]. Sem eventos, mundo e painel não têm o que mostrar.

### História
Como dev com várias sessões, quero que o escritório saiba quando um agente delega, para ver o trabalho paralelo sem abrir o log.

### Critérios de aceite
1. **Dado** um agente do escritório, **quando** ele chama a ferramenta `Agent` ou `Task`, **então** o main emite `agent:subagent` com `phase: 'start'` e o subagente aparece em `AgentSummary.subagents`.
2. **Dado** um subagente ativo, **quando** chega o `tool_result` com o mesmo id, **então** o main emite `phase: 'end'` e o remove da lista.
3. **Dado** uma sessão do terminal com a ponte reconectada, **quando** ocorre PreToolUse de `Agent`/`Task` e depois `SubagentStop`, **então** os mesmos eventos são emitidos.
4. **Dado** a ponte instalada numa versão anterior, **quando** o app abre, **então** `BridgeStatus.outdated` é `true`.

### Fora de escopo
- Teammates do Agent Teams (fatia 2) e interface (S-2, S-3).

### Notas técnicas
- Contratos em `src/shared/types.ts` conforme ARQ §Contratos.
- Invariantes: só `mcp__office__*` é auto-permitido; ponte em 127.0.0.1 com token e sem `Origin`.
- Riscos: `SubagentStop` pode não informar a chamada → casar por ordem de início [ARQ §Perguntas].

### Subtarefas por executor
- [ ] (integration) Contratos em `src/shared/types.ts`.
- [ ] (integration) Detecção e limpeza em `src/main/agents.ts`; não persistir `subagents`.
- [ ] (integration) PreToolUse, `SubagentStop`, `install()` e `outdated` em `src/main/bridge.ts`.
- [ ] (platform) Subagentes simulados em `src/main/demo.ts`.
- [ ] (test) Fixtures de mensagens do SDK para `subagentDelta()`.

### Plano de testes
- Manual: `npm run demo` (zsh) / `$env:AGENT_OFFICE_DEMO=1; npm run dev` (PowerShell) com `AGENT_OFFICE_DATA_DIR` temporário.
- Plataformas: macOS sim · Windows sim.

## S-2 · Mostrar subagentes como estagiários ao lado da mesa do agente
- **Tipo:** feature · **Prioridade:** high · **Estimativa:** 3 pts · **Depende de:** S-1
- Critério 1: **Dado** 4 subagentes ativos, **quando** o mundo atualiza, **então** 3 estagiários aparecem e o crachá do pai mostra "+1".
- Subtarefas: (world) `spawnIntern()`/`removeIntern()` em `game.ts`; (world) prop `laptop` em `avatar.ts`.

## S-3 · Listar subagentes ativos no painel do agente
- **Tipo:** feature · **Prioridade:** medium · **Estimativa:** 2 pts · **Depende de:** S-1
- Critério 1: **Dado** 2 subagentes, **quando** o painel abre, **então** a seção mostra 2 linhas com descrição e tempo.
- Subtarefas: (ui) seção em `panel.ts`; (ui) aviso "Reconectar" em `modals.ts`.

## Registro no quadro
Não aplicável: `office_board: false` no intake.

## Rastreabilidade
| Requisito | Stories |
|---|---|
| FR-1, FR-2, NFR-3 | S-1 |
| FR-3, CON-2, NFR-1 | S-2 |
| FR-4 | S-3 |
```

## Veto Conditions

As condições abaixo não se aplicam à nota de pulo. Reject and redo if ANY are true:
1. Story sem critérios de aceite em Given/When/Then ou com critério não verificável.
2. Subtarefa sem executor, ou story acima de 5 pts.
3. Afirmação técnica sem fonte, ou story que toca arquivo sensível sem citar os invariantes.
4. Qualquer alteração de código, commit ou ticket duplicado neste step.

## Quality Criteria

- [ ] Toda story é implementável por quem nunca leu o PRD
- [ ] Fatias verticais: cada story tem resultado verificável
- [ ] Todo requisito da fatia aprovada está em alguma story
- [ ] Plano de testes cobre macOS e Windows (ou declara o limite)
- [ ] Dependências formam uma ordem possível 13 → 16
- [ ] Em loop, só o que a PO apontou mudou, e está listado
