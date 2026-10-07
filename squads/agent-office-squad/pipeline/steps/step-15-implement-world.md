---
execution: subagent
agent: world-engineer
model_tier: powerful
tasks:
  - implement-world-stories
outputFile: squads/agent-office-squad/output/15-world/impl-report.md
---

# Step 15: Implementação — mundo 3D — 🧊 Vitor Voxel

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2).

- `_opensquad/_memory/company.md` — proposta de valor (visibilidade e prazer de uso) e restrições
- `squads/agent-office-squad/_memory/memories.md` — preferências visuais já registradas
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — pulo, branch e commits, contrato de saída, comandos e capturas (§8)
- `output/{run_id}/02-plan/vN/run-plan.md` e `output/{run_id}/03-plan-approval.md` — track, `run_slug`, `office_board`
- `output/{run_id}/12-story-selection.md` e `output/{run_id}/10-stories/vN/stories.md` — seu escopo são as subtarefas `(world)`
- `output/{run_id}/08-world/vN/world-spec.md` — comportamento, poses, props, direção de arte e orçamento (se o step-08 rodou)
- `output/{run_id}/09-architecture/vN/architecture.md` — eventos e campos de estado que o mundo consome
- `output/{run_id}/13-integration/vN/impl-report.md` e `output/{run_id}/14-platform/vN/impl-report.md` — contratos entregues e pendências para você
- Só em re-execução de loop: `output/{run_id}/17-qa/vN/qa-gate.md` e `output/{run_id}/18-security/vN/security-gate.md` (correções marcadas `world`)
- `squads/agent-office-squad/pipeline/data/architecture-map.md` — renderer, fluxo status → meta, invariantes
- `squads/agent-office-squad/pipeline/data/engineering-standards.md` — convenções e orçamento de performance (60 fps com foco, ~20 fps em segundo plano)
- Código da camada: `src/renderer/src/game.ts`, `src/renderer/src/world/engine.ts`, `layout.ts`, `office.ts`, `furniture.ts`, `avatar.ts`, `screens.ts`, `pathfinding.ts`, `overlays.ts`, `textures.ts`, `kit.ts`, `weapons.ts`, além de `src/renderer/src/state.ts` e `src/renderer/src/main.ts`

## Instructions

### Gate do track

Aplique o protocolo de pulo (run-conventions §3). Track `release` ou `discovery`: pule. Em `iniciativa`, `entrega` e `bugfix` o step roda só se as stories selecionadas tiverem subtarefa `(world)` — senão grave a nota de pulo com o motivo "sem subtarefas world nas stories selecionadas".

### Process

1. **Defina o modo.** FAIL do QA ou BLOCK de segurança mais recente que o seu último relatório = re-execução: corrija só os itens marcados `world`.
2. **Prepare a branch** `squad/{run_id}-{run_slug}` (crie se for o primeiro executor), confira `git status --porcelain` e rode `npm run typecheck`. Erro herdado dos steps 13–14 vira bloqueio registrado; não reescreva código de outra camada.
3. **Meça antes de mudar.** Em instância isolada e modo demo, gere capturas e números de base. zsh: `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa AGENT_OFFICE_SHOTS="out/s15-antes:4000,9000" AGENT_OFFICE_EVAL="JSON.stringify(__game.engine.renderer.info.render)|||JSON.stringify(__game.engine.renderer.info.memory)" npm run demo`. PowerShell: `$env:AGENT_OFFICE_DEMO=1; $env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-qa"; $env:AGENT_OFFICE_SHOTS="out/s15-antes:4000,9000"; $env:AGENT_OFFICE_EVAL="…"; npm run dev`. Os números saem no terminal como `[shot n]`; limpe as variáveis depois.
4. **Implemente conforme o world-spec.** O status do agente decide a meta em `desired()`/`reconcile()`; o mundo só reflete o `State`. Posições e vagas novas vão para `layout.ts` (nada de coordenada solta no `game.ts`). Reuse `unitBox`, `mat()` e geometrias compartilhadas; nada de alocação por frame no `update()`. Pathfinding sem caminho anda direto, como hoje.
5. **Descarte o que sai de cena.** Geometrias, materiais e texturas exclusivos recebem `dispose()`; tags e balões saem pelo `Overlays`. Confira se `renderer.info.memory` volta ao patamar depois que os atores somem.
6. **Teste a escala sem gastar tokens (I-13).** Simule 10–18 agentes só no renderer com `__state.apply({ type: 'agent:upsert', agent })` via `AGENT_OFFICE_EVAL`; nunca use `AGENT_OFFICE_SEED` (contrata agentes reais).
7. **Meça depois** com o mesmo roteiro (`out/s15-depois:4000,9000`), compare draw calls, geometrias e texturas e verifique o orçamento de frame. `npm run typecheck` e `npm run build` verdes; `npm test` se existir (funções puras como alocação de vagas).
8. **Commite localmente por story** (`git commit -m "{Verbo} {o quê} (S-n, mundo)"`), sem incluir `out/`. Quadro se `office_board` (§7); nunca `done`.
9. **Escreva o relatório** com Dev Agent Record por story, tabela antes/depois e caminhos das capturas.

## Output Format

The output MUST follow this exact structure:

````markdown
# Relatório de Implementação — Mundo 3D (step-15)

- **Run:** {run_id} · **Branch:** squad/{run_id}-{run_slug}
- **Modo:** {primeira execução | re-execução após FAIL/BLOCK} (ciclo {n}/3)
- **Stories tocadas:** {S-n, …}
- **Linha de base:** typecheck {verde | vermelho herdado: resumo}

## Resumo
{2–4 linhas}

## Medições (instância isolada, modo demo)
| Cenário | render.calls | memory.geometries | memory.textures | fps com foco |
|---|---|---|---|---|
| Antes — {n} agentes | {…} | {…} | {…} | {…} |
| Depois — {n} agentes | {…} | {…} | {…} | {…} |
| Depois — {n} agentes simulados | {…} | {…} | {…} | {…} |

Capturas: `out/s15-antes-1.png`, `out/s15-depois-1.png`, …

## Dev Agent Record — S-{n} · {título}
- **Subtarefas:** [x] (world) {feita} · [ ] (world) {pendente — motivo}
- **Arquivos alterados:** `{caminho}` — {resumo}
- **Comandos:** `npm run typecheck` → {…} · `npm run build` → {…} · `npm test` → {… | não existe}
- **Decisões e desvios em relação ao world-spec:** {… | nenhum}
- **Invariantes verificados:** {I-13 e demais tocados — como}
- **Como testar manualmente:** {passos com zsh e PowerShell}
- **Plataformas:** macOS {…} · Windows {…}
- **Commit:** `{hash}` {mensagem}
- **Quadro:** {… | não aplicável}

## Pendências e riscos para os próximos executores
- {…}
````

## Output Example

````markdown
# Relatório de Implementação — Mundo 3D (step-15)

- **Run:** 2026-10-08-101500 · **Branch:** squad/2026-10-08-101500-subagentes-visiveis (reutilizada)
- **Modo:** primeira execução (ciclo 1/3)
- **Stories tocadas:** S-2
- **Linha de base:** typecheck verde

## Resumo
Subagentes aparecem como estagiários de pé ao lado da mesa do agente que delegou, com o crachá menor e o balão da atividade. Até 3 estagiários por mesa; além disso, uma etiqueta "+N". Quando o subagente termina, o estagiário acena e some em 0,6 s, como os agentes que saem.

## Medições (instância isolada, modo demo)
| Cenário | render.calls | memory.geometries | memory.textures | fps com foco |
|---|---|---|---|---|
| Antes — 6 agentes | 1.184 | 96 | 41 | 60 |
| Depois — 6 agentes + 4 estagiários | 1.231 | 97 | 41 | 60 |
| Depois — 18 agentes simulados + 9 estagiários | 1.902 | 97 | 43 | 57–60 |

Capturas: `out/s15-antes-1.png`, `out/s15-depois-1.png`, `out/s15-depois-2.png` (18 agentes)

## Dev Agent Record — S-2 · Mostrar subagentes como estagiários ao lado da mesa do agente
- **Subtarefas:** [x] (world) vagas `INTERN_SPOTS` por mesa em `layout.ts` · [x] (world) ator leve de estagiário com escala 0,8 e `setProp('paper')` · [x] (world) etiqueta "+N" além de 3 · [x] (world) saída com aceno e `vanish()`
- **Arquivos alterados:** `src/renderer/src/world/layout.ts` — 3 vagas por mesa, ao lado da cadeira · `src/renderer/src/world/avatar.ts` — opção `scale` no construtor, sem material novo · `src/renderer/src/game.ts` — `syncInterns()` a partir de `state.subagents`
- **Comandos:** `npm run typecheck` → verde · `npm run build` → verde · `npm test` → não existe
- **Decisões e desvios em relação ao world-spec:** estagiários não usam pathfinding (surgem na vaga com o efeito do elevador); o spec previa caminhada, mas 9 rotas simultâneas criavam fila no corredor.
- **Invariantes verificados:** I-13 — escala testada com `__state.apply`, sem contratar agentes · geometria do estagiário compartilhada (memory.geometries +1)
- **Como testar manualmente:** zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa npm run demo` · PowerShell `$env:AGENT_OFFICE_DEMO=1; $env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-qa"; npm run dev`; no console, `__state.apply({ type: 'agent:subagent', … })` com 4 subagentes para a Ada e confira 3 estagiários + "+1".
- **Plataformas:** Windows verificado · macOS não verificado
- **Commit:** `9be20c4` Mostra subagentes como estagiários ao lado da mesa (S-2, mundo)
- **Quadro:** não aplicável (office_board: false)

## Pendências e riscos para os próximos executores
- Fernanda (step-16): o foco da câmera no estagiário pode reutilizar `__game.focusAgent(parentId)`.
- Risco: com 18 agentes a etiqueta "+N" fica perto do crachá na fileira de trás — vale checar no QA.
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Falta o Dev Agent Record, a tabela de medições antes/depois ou os caminhos das capturas.
2. `npm run typecheck` ou `npm run build` vermelho no fim do step sem bloqueio herdado registrado.
3. Alocação por frame no `update()`, objeto removido sem `dispose()` ou queda abaixo do orçamento de frame sem registro e justificativa.
4. Teste de escala que contrata agentes reais (gasto de tokens, I-13) ou que usa os dados reais do usuário em vez de `AGENT_OFFICE_DATA_DIR`.
5. Regra de status do produto alterada sem estar na story, ou `git push`/PR/tag/force push.

## Quality Criteria

- [ ] Comportamento implementado bate com o world-spec ou o desvio está justificado
- [ ] Posições e vagas novas definidas em `layout.ts`, não soltas no código
- [ ] Geometrias e materiais compartilhados; memória volta ao patamar após saídas
- [ ] Escala de 10–18 agentes verificada com capturas
- [ ] Capturas antes/depois salvas em `out/` e fora dos commits
- [ ] Passos de teste manual com comando zsh e PowerShell
- [ ] Riscos visuais apontados para o QA
