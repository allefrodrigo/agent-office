---
task: "Implementar as subtarefas do mundo 3D"
order: 1
input: |
  - story_selection: output/{run_id}/12-story-selection.md
  - stories: stories.md com subtarefas marcadas (world)
  - world_spec: world-spec.md do step-08 (quando a story apontar)
  - upstream_reports: relatórios dos steps 13 e 14 (eventos e tipos disponíveis)
  - fix_list: correções do executor world vindas do QA ou da segurança (só em loop)
output: |
  - code_changes: commits locais na branch squad/{run_id}-{run_slug}
  - perf_measurements: draw calls, triângulos e fps antes/depois (10 e 20 agentes)
  - screenshots: capturas antes/depois em out/
  - dev_agent_record: registro por story (run-conventions §6)
  - impl_report: documento final do step-15
---

# Implementar as subtarefas do mundo 3D

Implementa as subtarefas `world` seguindo o world-spec e as stories, medindo o custo de renderização e provando a mudança com capturas automáticas em instância isolada. Em re-execução após FAIL/BLOCK, trata só os itens do executor `world` na lista de correções.

## Process

1. Filtrar as subtarefas `(world)` das stories selecionadas; sem nenhuma (e sem correções), gravar a nota de pulo de `run-conventions.md` §3 e encerrar.
2. Entrar na branch `squad/{run_id}-{run_slug}` (criar se não existir; parar se houver alteração alheia não commitada); ler os relatórios dos steps 13–14 para saber que eventos e campos já chegam ao `State`.
3. Medir a linha de base antes de mudar: abrir instância isolada com capturas (`run-conventions.md` §8) e, via `AGENT_OFFICE_EVAL`, injetar agentes falsos só no renderer (`__state.apply({ type: 'agent:upsert', agent })` com 10 e depois 20 agentes) e ler `__game.engine.renderer.info.render` (`calls`, `triangles`) com `info.autoReset = false` e `info.reset()` antes de dois quadros. Nunca usar `AGENT_OFFICE_SEED` para isso: ele contrata agentes reais e gasta tokens (I-13).
4. Com quadro ativo (`office_board: true` e `mcp__office__*`), mover o ticket da story para `doing` se ainda não estiver.
5. Implementar no ponto certo: metas e transições em `Game.desired()`/`reconcile()`/`goDesk()`/`goBoss()`/`goHang()`; aparência em `Avatar` (pose, prop, escala) e móveis em `furniture.ts` com `box`/`blob`/`cylinder` de `kit.ts`; planta em `layout.ts` + grade em `office.ts`; texto sobre o canvas só por `Tag.setBubble()`/`setName()` (texto puro, I-06); telas por `Screen.setMode()`.
6. Cuidar da memória: geometria e material compartilhados (`unitBox`, `mat()`), nenhuma alocação dentro de `update(dt)`, `dispose()` apenas de recursos exclusivos (ex.: `CanvasTexture` de uma tela nova) ao remover, e `overlays.remove()` junto de `scene.remove()`.
7. Cobrir os casos-limite do world-spec: capacidade (overflow de mesas, `VISIT_SPOTS` e `LOUNGE_SEATS` esgotados), ator removido no meio do caminho, A* sem rota, reabertura do app com agentes já livres.
8. Medir de novo com 10 e 20 agentes e comparar com a linha de base; se passar do orçamento de `engineering-standards.md`, otimizar ou registrar a exceção com proposta.
9. Gerar capturas finais nomeadas (`out/qa-{story}-{n}.png`) posicionando a câmera com `__game.focusAgent(id)` ou `__game.zoom(d)`; validar `npm run typecheck` e `npm run build`.
10. Commit local por story (`Mostra subagentes como estagiários ao lado da mesa (S-2, mundo)`); com quadro ativo, `ticket_check`, `ticket_comment` com números de performance e `ticket_update` → `review` se for o último executor da story; escrever o relatório.

## Output Format

```markdown
# Implementação — mundo 3D
## Performance (antes → depois)
| Cenário | Draw calls | Triângulos | fps com foco |
## Dev Agent Record — S-{n} · {título}
- [x]/[ ] (world) {subtarefa}
- Arquivos: `{caminho}` — {resumo}
- Comandos: `{comando}` → {resultado}
- Capturas: `out/{arquivo}.png` — {o que mostra}
- Decisões e desvios: {texto}
- Como testar: zsh `{...}` · PowerShell `{...}`
- Plataformas: macOS {verificado|não} · Windows {verificado|não}
## Correções do loop (se houver)
## Commits locais
## Bloqueios e pendências
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# Implementação — mundo 3D (run 2026-10-08-101500)

## Performance (antes → depois)
| Cenário | Draw calls | Triângulos | fps com foco |
|---|---|---|---|
| 10 agentes, 0 subagentes | 412 → 412 | 18,9 mil → 18,9 mil | 60 → 60 |
| 10 agentes, 12 estagiários | — → 471 | — → 21,7 mil | — → 60 |
| 20 agentes, 12 estagiários (limite) | 655 → 714 | 29,8 mil → 32,6 mil | 60 → 58 |

## Dev Agent Record — S-2 · Mostrar subagentes como estagiários ao lado da mesa do agente
- [x] (world) `Game`: mapa `interns` por agente; cria até 3 `Avatar` em escala 0,8 nos tiles livres ao sul da mesa
- [x] (world) Etiqueta "+N" no crachá do agente quando há mais de 3 subagentes (`Tag.setName`)
- [x] (world) Saída com a mesma animação de `vanish()`; agente demitido leva os estagiários junto
- Arquivos:
  - `src/renderer/src/game.ts` — `syncInterns()` chamado em `reconcile()`; limite global de 12
  - `src/renderer/src/world/avatar.ts` — parâmetro `scale` no construtor (padrão 1)
- Comandos: `npm run typecheck` → ok · `npm run build` → ok
- Capturas: `out/qa-S2-1.png` — mesa 3 com 2 estagiários; `out/qa-S2-2.png` — "+2" no crachá
- Decisões e desvios: estagiário de agente em tile de overflow fica em pé ao lado (world-spec §Capacidade).
- Como testar: zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa AGENT_OFFICE_SHOTS="out/qa:4000" npm run dev`
  · PowerShell `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-qa"; $env:AGENT_OFFICE_SHOTS="out/qa:4000"; npm run dev`
- Plataformas: macOS não verificado · Windows verificado

## Commits locais
- 5e77b10 Mostra subagentes como estagiários ao lado da mesa (S-2, mundo)

## Bloqueios e pendências
- Nenhum.
```

## Quality Criteria

- [ ] Toda subtarefa `world` selecionada está feita ou pendente com motivo.
- [ ] Há medição antes/depois com 10 e 20 agentes, sem gastar tokens.
- [ ] Capturas nomeadas comprovam cada mudança visual.
- [ ] Nenhum recurso compartilhado foi descartado e nenhum objeto removido deixou overlay órfão.
- [ ] Typecheck e build verdes, com saída registrada.

## Veto Conditions

Reject and redo if ANY are true:
1. O orçamento de quadro foi estourado sem exceção registrada e proposta de otimização.
2. Texto vindo de agente ou ticket entrou no DOM como HTML.
3. Falta Dev Agent Record, medição ou captura para alguma story visual.
4. A medição usou agentes reais (`AGENT_OFFICE_SEED`) ou houve push, PR ou tag.
