---
execution: subagent
agent: desktop-engineer
model_tier: powerful
tasks:
  - implement-platform-stories
outputFile: squads/agent-office-squad/output/14-platform/impl-report.md
---

# Step 14: Implementação — plataforma desktop — 🖥️ Eduardo Electron

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2).

- `_opensquad/_memory/company.md` — restrições: segurança, cross-platform, pt-BR
- `squads/agent-office-squad/_memory/memories.md` — preferências e proibições registradas
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — pulo, branch e commits, contrato de saída, quadro, comandos zsh/PowerShell
- `output/{run_id}/02-plan/vN/run-plan.md` e `output/{run_id}/03-plan-approval.md` — track, `run_slug`, `office_board`, riscos
- `output/{run_id}/12-story-selection.md` e `output/{run_id}/10-stories/vN/stories.md` — seu escopo são as subtarefas `(platform)`
- `output/{run_id}/11-validation/vN/po-validation.md` — ressalvas do PO
- `output/{run_id}/09-architecture/vN/architecture.md` — contratos de IPC, tipos, persistência e migração (se existir)
- `output/{run_id}/13-integration/vN/impl-report.md` — o que a integração entregou e as pendências para você
- Só em re-execução de loop: `output/{run_id}/17-qa/vN/qa-gate.md` e `output/{run_id}/18-security/vN/security-gate.md` (correções marcadas `platform`)
- `squads/agent-office-squad/pipeline/data/architecture-map.md` — canais IPC, eventos, arquivos de dados, invariantes I-01…I-14
- `squads/agent-office-squad/pipeline/data/engineering-standards.md` — convenções, comandos, Definition of Done
- `squads/agent-office-squad/pipeline/data/security-checklist.md` — itens de Electron, IPC e processos
- Código da camada: `src/main/index.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/main/store.ts`, `src/main/system.ts`, `src/main/session-process.ts`, `src/main/claude-path.ts`, `src/main/env.ts`, `src/shared/types.ts`, `electron-builder.yml`, `electron.vite.config.ts`, `package.json`

## Instructions

### Gate do track

Aplique o protocolo de pulo (run-conventions §3). Track `release` ou `discovery`: pule. Em `iniciativa`, `entrega` e `bugfix` o step roda só se as stories selecionadas tiverem subtarefa `(platform)` — senão grave a nota de pulo com o motivo "sem subtarefas platform nas stories selecionadas".

### Process

1. **Defina o modo.** FAIL do QA ou BLOCK de segurança mais recente que o seu último relatório = re-execução: corrija só os itens marcados `platform`.
2. **Prepare a branch.** `git status --porcelain` (alteração alheia à run = bloqueio registrado). Mude para `squad/{run_id}-{run_slug}`, criando-a se você for o primeiro executor a rodar. Rode `npm run typecheck`: se o step-13 deixou erro, registre como bloqueio herdado e não reescreva código de integração fora da sua story (só o ajuste mínimo de tipo combinado na story).
3. **Leia as pendências** do relatório do step-13 e as subtarefas `(platform)` na ordem do step-12.
4. **IPC (I-14).** Todo `ipcMain.handle` novo valida os argumentos no main (tipo, enum, tamanho, `String()`) antes de chamar qualquer manager. Canal novo só com o método tipado em `OfficeAPI` (`src/shared/types.ts`) e exposto em `src/preload/index.ts`; nenhuma API do Node chega ao renderer. Estado inicial novo entra no `office:getState`.
5. **Paridade macOS/Windows.** Ramos de `process.platform` explícitos para `darwin` e `win32` (Linux com fallback). Use os equivalentes do Windows (overlay de ícone em vez de badge do Dock, `tasklist`/`netstat`, sem SIGHUP). Scripts npm novos funcionam no PowerShell (nada de `VAR=1 comando` inline; dependência nova como `cross-env` só com ADR).
6. **Persistência e segurança.** Escrita atômica (tmp + rename) com debounce (I-10); mudança de formato com migração versionada no `load()` e fallback para os padrões. Mantenha I-05 (`contextIsolation`, `sandbox`, sem `nodeIntegration`, navegação negada, `openExternal` só http(s)) e I-11 (sem SIGKILL).
7. **Verifique.** `npm run typecheck` e `npm run build` verdes; `npm test` se existir. Mexeu em empacotamento: `npm run dist:win` só no Windows x64, `npm run dist:mac` só em Mac arm64; a outra plataforma fica "não verificada".
8. **Commite localmente por story** (`git commit -m "{Verbo} {o quê} (S-n, plataforma)"`) e atualize o quadro se `office_board` (§7): `doing`, `ticket_check`, `ticket_comment`; nunca `done`.
9. **Escreva o relatório** com um Dev Agent Record por story e as pendências para Vitor (step-15) e Fernanda (step-16).

## Output Format

The output MUST follow this exact structure:

````markdown
# Relatório de Implementação — Plataforma Desktop (step-14)

- **Run:** {run_id} · **Branch:** squad/{run_id}-{run_slug}
- **Modo:** {primeira execução | re-execução após FAIL/BLOCK} (ciclo {n}/3)
- **Stories tocadas:** {S-n, …}
- **Linha de base:** typecheck {verde | vermelho herdado do step-13: resumo}
- **Plataforma da execução:** {Windows 11 x64 | macOS arm64}

## Resumo
{2–4 linhas}

## Dev Agent Record — S-{n} · {título}
- **Subtarefas:** [x] (platform) {feita} · [ ] (platform) {pendente — motivo}
- **Arquivos alterados:** `{caminho}` — {resumo}
- **Canais IPC / estado inicial:** {novo/alterado — validação aplicada | nenhum}
- **Comandos:** `npm run typecheck` → {…} · `npm run build` → {…} · `npm test` → {… | não existe}
- **Decisões e desvios:** {… | nenhum}
- **Invariantes verificados:** {I-05, I-10, I-11, I-14 — como}
- **Como testar manualmente:** {passos com zsh e PowerShell}
- **Plataformas:** macOS {…} · Windows {…}
- **Commit:** `{hash}` {mensagem}
- **Quadro:** {AO-n … | não aplicável}

## Correções do loop (só em re-execução)
| Id | Origem | Correção feita | Arquivo | Status |
|---|---|---|---|---|

## Pendências e riscos para os próximos executores
- {…}
````

## Output Example

````markdown
# Relatório de Implementação — Plataforma Desktop (step-14)

- **Run:** 2026-10-08-101500 · **Branch:** squad/2026-10-08-101500-subagentes-visiveis (reutilizada)
- **Modo:** primeira execução (ciclo 1/3)
- **Stories tocadas:** S-1
- **Linha de base:** typecheck verde (o step-13 entregou o tipo `agent:subagent` declarado)
- **Plataforma da execução:** Windows 11 x64

## Resumo
O evento `agent:subagent` já chegava ao renderer pelo `broadcast` genérico. Faltava quem abre o app no meio de uma run: o `office:getState` agora inclui os subagentes ativos, e pendências do badge continuam contando só permissões e resultados.

## Dev Agent Record — S-1 · Emitir eventos de subagentes a partir do SDK e dos hooks
- **Subtarefas:** [x] (platform) `OfficeState.subagents` preenchido no `office:getState` · [x] (platform) badge e notificações ignoram `agent:subagent` · [x] (platform) payload repassado sem campos extras
- **Arquivos alterados:** `src/main/index.ts` — `subagents: manager.subagents()` no estado inicial e filtro no `updateBadge` · `src/shared/types.ts` — campo `subagents: SubagentInfo[]` em `OfficeState`
- **Canais IPC / estado inicial:** nenhum canal novo; `office:getState` serializa só campos tipados de `SubagentInfo`
- **Comandos:** `npm run typecheck` → verde · `npm run build` → verde · `npm test` → não existe
- **Decisões e desvios:** sem notificação de sistema para subagentes — seria ruído a cada delegação [UX §2.4].
- **Invariantes verificados:** I-05 — `webPreferences` e CSP intocadas · I-10 — nenhum formato persistido mudou (subagentes não são salvos) · I-14 — nada novo entra pelo IPC
- **Como testar manualmente:** PowerShell `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-qa"; npm run dev` · zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa npm run dev`; no DevTools, `(await window.office.getState()).subagents` retorna `[]` sem agentes e a lista ativa enquanto um agente delega.
- **Plataformas:** Windows verificado · macOS não verificado (badge do Dock não exercitado)
- **Commit:** `5d0b7f1` Inclui subagentes no estado inicial do escritório (S-1, plataforma)
- **Quadro:** não aplicável (office_board: false)

## Pendências e riscos para os próximos executores
- Vitor (step-15) e Fernanda (step-16): `State` precisa ler `initial.subagents` e aplicar `agent:subagent`.
- Risco: `setBadgeCount` não tem efeito no Windows (dívida conhecida do porte; fora desta story).
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Falta o Dev Agent Record de alguma story tocada, ou ele não traz arquivos, comandos com resultado e passos de teste.
2. `npm run typecheck` ou `npm run build` vermelho no fim do step sem bloqueio herdado registrado.
3. Handler IPC novo sem validação no main, canal sem tipo em `OfficeAPI` ou API do Node exposta ao renderer (I-14, I-05).
4. `webPreferences`, CSP ou regras de navegação afrouxadas, escrita não atômica ou uso de SIGKILL (I-05, I-10, I-11).
5. Mudança que só funciona numa plataforma sem o limite declarado, ou `git push`/PR/tag/force push.

## Quality Criteria

- [ ] Paridade macOS/Windows tratada ou limite declarado em cada mudança
- [ ] Todo argumento novo do renderer validado no main com mensagem de erro em pt-BR
- [ ] Mudança de formato persistido acompanhada de migração e fallback
- [ ] Scripts e comandos documentados funcionam no PowerShell e no zsh
- [ ] Commits locais por story no padrão do histórico do repositório
- [ ] Pendências para os steps 15 e 16 explícitas (campos de estado, eventos)
- [ ] Plataformas verificadas e não verificadas declaradas
