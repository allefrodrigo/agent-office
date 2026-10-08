---
task: "Implementar as subtarefas de plataforma"
order: 1
input: |
  - story_selection: output/{run_id}/12-story-selection.md
  - stories: stories.md com subtarefas marcadas (platform)
  - integration_report: relatório do step-13 (contratos e eventos já criados)
  - fix_list: correções do executor platform vindas do QA ou da segurança (só em loop)
output: |
  - code_changes: commits locais na branch squad/{run_id}-{run_slug}
  - platform_matrix: comportamento e verificação em macOS e Windows
  - dev_agent_record: registro por story (run-conventions §6)
  - impl_report: documento final do step-14
---

# Implementar as subtarefas de plataforma

Executa as subtarefas `platform` das stories selecionadas — main, IPC/preload, persistência, SO e empacotamento — com paridade entre macOS e Windows. Em re-execução após FAIL/BLOCK, trata apenas os itens do executor `platform` na lista de correções.

## Process

1. Filtrar as subtarefas `(platform)` das stories selecionadas; sem nenhuma (e sem correções), gravar a nota de pulo de `run-conventions.md` §3 e encerrar.
2. Entrar na branch `squad/{run_id}-{run_slug}` (criar a partir do HEAD se não existir; parar se `git status --porcelain` mostrar alteração alheia). Ler o relatório do step-13 para reaproveitar tipos e eventos já criados.
3. Com quadro ativo (`office_board: true` e `mcp__office__*` disponível), mover o ticket para `doing` se ainda estiver antes disso.
4. Contratos: para cada método novo, alterar juntos `OfficeAPI` em `src/shared/types.ts`, `src/preload/index.ts` (`ipcRenderer.invoke('office:<nome>', ...)`) e `ipcMain.handle('office:<nome>')` em `src/main/index.ts`, validando argumentos no main (`typeof`, `existsSync`/`statSync` para pastas, listas permitidas como `DELEGATE_MODES`). Eventos novos passam por `broadcast`.
5. Persistência: campo novo em `Settings`/`Data` com valor em `DEFAULT_SETTINGS` (ou equivalente), leitura tolerante em `load()` e escrita pelo fluxo `save()` → `flush()` (tmp + rename).
6. SO: cada chamada específica protegida por `process.platform` com o comportamento do outro sistema; referências: badge (`app.dock.setBadge` no macOS; `win.setOverlayIcon` + `win.setTitle`/`flashFrame` no Windows), barra de título (`hiddenInset` × `titleBarOverlay`), `SystemMonitor` (CPU `null` no Windows), `session-process.ts` (`netstat`/`tasklist`, sem SIGHUP no Windows, nunca SIGKILL).
7. Scripts e empacotamento: script npm novo funciona no PowerShell (sem `VAR=1 cmd`; preferir lógica em Node ou script dedicado); mudanças em `electron-builder.yml` e `electron.vite.config.ts` registram impacto em tamanho e assinatura.
8. Validar: `npm run typecheck`, `npm run build` (e `npm test`/`npm run lint` se existirem); abrir o app isolado (`AGENT_OFFICE_DATA_DIR`) no sistema disponível e exercitar o fluxo; registrar o sistema não verificado.
9. Commit local por story (`Repassa eventos de subagentes ao renderer (S-1, plataforma)`); com quadro ativo, `ticket_comment` com decisões e `ticket_update` → `review` quando for o último executor da story.
10. Escrever o relatório com a matriz de plataforma e o Dev Agent Record de cada story; em loop, status de cada correção.

## Output Format

```markdown
# Implementação — plataforma desktop
## Matriz de plataforma
| Mudança | macOS | Windows | Verificado em |
## Dev Agent Record — S-{n} · {título}
- [x]/[ ] (platform) {subtarefa}
- Arquivos: `{caminho}` — {resumo}
- Validação de IPC: {argumento → regra}
- Comandos: `{comando}` → {resultado}
- Decisões e desvios: {texto}
- Como testar: zsh `{...}` · PowerShell `{...}`
## Correções do loop (se houver)
## Commits locais
## Bloqueios e pendências
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# Implementação — plataforma desktop (run 2026-10-08-101500)

## Matriz de plataforma
| Mudança | macOS | Windows | Verificado em |
|---|---|---|---|
| Evento `agent:subagent` repassado ao renderer | igual | igual | Windows |
| Badge conta subagentes com erro | `app.dock.setBadge` | `win.setOverlayIcon` com ícone numerado | Windows |

## Dev Agent Record — S-1 · Emitir eventos de subagentes a partir do SDK e dos hooks
- [x] (platform) Tipar `agent:subagent` em `OfficeEvent` e `SubagentInfo` em `src/shared/types.ts`
- [x] (platform) Repassar o evento em `manager.on('event')` → `broadcast` (`src/main/index.ts`)
- Arquivos:
  - `src/shared/types.ts` — `SubagentInfo`, membro novo da união `OfficeEvent`
  - `src/main/index.ts` — sem handler novo; o evento já passa pelo `broadcast` existente
- Validação de IPC: nenhum canal novo do renderer para o main nesta story.
- Comandos: `npm run typecheck` → ok · `npm run build` → ok
- Decisões e desvios: nenhum.
- Como testar: zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa npm run dev` · PowerShell
  `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-qa"; npm run dev`; no DevTools, `__state` recebe o evento.

## Dev Agent Record — S-4 · Badge de pendências no Windows
- [x] (platform) `updateBadge()` usa `win.setOverlayIcon` no Windows (ícone 16 × 16 gerado em canvas
  do main via `nativeImage`); limpa com `setOverlayIcon(null, '')`
- Comandos: `npm run typecheck` → ok · `npm run build` → ok
- Plataformas: Windows verificado (barra de tarefas mostra "2"); macOS não verificado, caminho inalterado.

## Commits locais
- c4d81a0 Repassa eventos de subagentes ao renderer (S-1, plataforma)
- 7aa02f5 Mostra pendências no ícone da barra de tarefas do Windows (S-4, plataforma)
```

## Quality Criteria

- [ ] Toda subtarefa `platform` selecionada está feita ou pendente com motivo.
- [ ] `OfficeAPI`, preload e handler foram alterados juntos para cada método novo.
- [ ] A matriz de plataforma cobre toda mudança dependente de SO.
- [ ] Persistência nova usa padrão, leitura tolerante e escrita atômica.
- [ ] Typecheck e build verdes, com saída registrada.

## Veto Conditions

Reject and redo if ANY are true:
1. Algum handler IPC novo aceita argumento sem validação no main.
2. `webPreferences`, CSP ou a política de navegação foram afrouxadas.
3. Falta Dev Agent Record ou a matriz de plataforma omite o Windows.
4. Foi feito push, PR, tag ou alteração fora das subtarefas `platform`.
