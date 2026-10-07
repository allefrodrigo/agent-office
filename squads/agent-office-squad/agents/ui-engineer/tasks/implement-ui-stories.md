---
task: "Implementar subtarefas de interface"
order: 1
input: |
  - run_plan: output/{run_id}/02-plan/vN/run-plan.md e output/{run_id}/03-plan-approval.md (track, run_slug, office_board)
  - story_selection: output/{run_id}/12-story-selection.md (stories escolhidas para esta run)
  - stories: output/{run_id}/10-stories/vN/stories.md (texto completo, subtarefas por executor)
  - ux_spec: output/{run_id}/07-ux/vN/ux-spec.md (pode ser nota de pulo)
  - upstream_reports: relatórios dos steps 13–15 (contratos novos de evento, IPC e Game)
  - fix_list: correções do executor ui no qa-gate (step-17) ou security-gate (step-18), só em loop
output: |
  - impl_report: relatório consolidado com Dev Agent Record por story (vira output/16-ui/impl-report.md)
  - commits: commits locais na branch squad/{run_id}-{run_slug}
  - board_updates: checks e comentários nos tickets AO, quando office_board estiver ativo
---

# Implementar subtarefas de interface

Implementa, na ordem das dependências, as subtarefas `(ui)` das stories selecionadas, reaproveitando os padrões de `src/renderer/src/ui/*`. Entrega código acessível, sanitizado e verificado em instância isolada, com o Dev Agent Record que a Tânia Teste vai auditar.

## Process

1. **Gate e escopo.** Leia o run-plan e a aprovação; se o step-16 estiver `skip`, ou se nenhuma story selecionada tiver subtarefa `(ui)`, grave a nota de pulo (run-conventions §3) e pare. Em loop, o escopo é só a lista de correções do executor `ui`.
2. **Terreno limpo.** Rode `git status --porcelain`: se houver mudanças que não são da run, registre o bloqueio e pare (sem stash, sem descarte). Confirme ou crie a branch: `git switch squad/{run_id}-{run_slug}` ou `git switch -c squad/{run_id}-{run_slug}`.
3. **Contratos antes de consumir.** Para cada evento, campo ou método citado nas notas técnicas, confirme que existe em `src/shared/types.ts` e em `src/preload/index.ts` (entregues nos steps 13–14). Se faltar, registre "bloqueado por contrato ausente" e não invente tipo.
4. **Captura do antes.** Se a story muda algo visível, capture o estado atual em instância isolada antes de editar: zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-ui AGENT_OFFICE_DEMO=1 AGENT_OFFICE_SHOTS="out/ui-antes:4000,9000" npm run dev`; PowerShell `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-ui"; $env:AGENT_OFFICE_DEMO=1; $env:AGENT_OFFICE_SHOTS="out/ui-antes:4000,9000"; npm run dev`. Use `AGENT_OFFICE_EVAL` para abrir o painel certo (ex.: `__panel.open([...__state.agents.keys()][0])`).
5. **Implementar por camada da interface.** Primeiro `State.apply` (novo `case`, `changed()` só quando a tela muda; logs via `onLog`), depois o componente (`h()`, classes no padrão de `styles.css`), por último o wiring em `main.ts`. Eventos frequentes ganham método direcionado no estilo de `renderSystem`, nunca trabalho extra em `state.onChange`.
6. **Acessibilidade.** Todo controle novo com papel e nome (`aria-label` quando não há texto), estado (`aria-expanded`, `aria-pressed`, `aria-selected`), foco visível, ordem de Tab coerente; overlays recebem foco ao abrir e devolvem ao fechar com Esc; toasts e contadores em região `aria-live="polite"`; status com texto ou ícone além da cor.
7. **Segurança.** Texto de agente, ticket ou hook entra por `textContent` ou `renderMarkdown`; links abrem por `window.office.openExternal`. Antes do commit rode `git diff -U0 | grep -nE "innerHTML|outerHTML|insertAdjacentHTML"` (PowerShell: `git diff -U0 | Select-String "innerHTML|outerHTML|insertAdjacentHTML"`) e justifique qualquer ocorrência.
8. **Verificar.** `npm run typecheck` e `npm run build` verdes. Capture o depois com o mesmo comando do passo 4 (prefixo `out/ui-depois`). Para volume, injete agentes sintéticos no renderer via `AGENT_OFFICE_EVAL` com `__state.apply({ type: 'agent:upsert', agent: {...} })` e confira a lista com 18+ itens.
9. **Commits e quadro.** Um commit por story: `Adiciona lista de subagentes no painel do agente (S-3, interface)`. Se `office_board`, `ticket_check` nos critérios cumpridos, `ticket_comment` com o resumo e, sendo o último executor da story, `ticket_update` para `review`. Nunca `done`, nunca push.
10. **Relatório.** Consolide o Dev Agent Record (run-conventions §6), a lista de strings para a Lívia e as plataformas verificadas e não verificadas.

## Output Format

````markdown
# Step 16 — Implementação: interface

**Run:** {run_id} · **Branch:** squad/{run_id}-{run_slug} · **Modo:** primeira execução | loop {n} (FAIL/BLOCK)

## Resumo
| Story | Subtarefas ui | Status | Commit |
|---|---|---|---|

## Dev Agent Record — S-{n} · {título}
- **Subtarefas:** - [x] (ui) ... / - [ ] (ui) ... (motivo)
- **Arquivos alterados:** `caminho` — resumo de uma linha
- **Comandos:** `comando` → resultado
- **Acessibilidade:** papéis, nomes, foco e teclado implementados
- **Segurança:** busca de innerHTML → resultado
- **Decisões e desvios:** ...
- **Como testar:** zsh: ... · PowerShell: ...
- **Capturas:** antes ... · depois ...
- **Plataformas:** verificado em ... · não verificado em ...

## Strings novas para revisão (Lívia Linguagem)
| Local | Texto |
|---|---|

## Bloqueios e perguntas
````

## Output Example

> Use como referência de qualidade, não como template rígido.

````markdown
# Step 16 — Implementação: interface

**Run:** 2026-10-08-101500 · **Branch:** squad/2026-10-08-101500-subagentes-visiveis · **Modo:** primeira execução

## Resumo
| Story | Subtarefas ui | Status | Commit |
|---|---|---|---|
| S-3 · Listar subagentes ativos no painel do agente | 3/3 | InReview | 4c1e9a2 |

## Dev Agent Record — S-3 · Listar subagentes ativos no painel do agente
- **Subtarefas:**
  - [x] (ui) `State.apply` trata `agent:subagent` e guarda os subagentes por `parentId` em `state.subagents`
  - [x] (ui) Seção "Subagentes" no painel com nome, atividade e tempo desde o início
  - [x] (ui) Navegação por teclado: Tab entra na lista, Enter foca a câmera no agente pai
- **Arquivos alterados:**
  - `src/renderer/src/state.ts` — novo mapa `subagents` e `case 'agent:subagent'` (chama `changed()` só quando a lista muda)
  - `src/renderer/src/ui/panel.ts` — `renderSubagents()` chamado só quando o painel está aberto no agente pai
  - `src/renderer/src/styles.css` — `.panel-subagents` e `.subagent-row` com foco visível (`outline: 2px solid var(--accent)`)
- **Comandos:** `npm run typecheck` → ok (0 erros) · `npm run build` → ok (12,8 s)
- **Acessibilidade:** lista com `role="list"`, linhas com `role="listitem"` e `tabindex="0"`; contador em `aria-live="polite"` ("2 subagentes ativos"); estado vazio com texto, não só ícone.
- **Segurança:** `git diff -U0 | Select-String "innerHTML|outerHTML|insertAdjacentHTML"` → nenhuma ocorrência; nome do subagente via `textContent`.
- **Decisões e desvios:** a spec não define o máximo de linhas; limitei a 8 com "e mais N" (pergunta para a Úrsula registrada abaixo).
- **Como testar:** zsh: `AGENT_OFFICE_DATA_DIR=/tmp/ao-ui AGENT_OFFICE_DEMO=1 npm run dev` · PowerShell: `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-ui"; $env:AGENT_OFFICE_DEMO=1; npm run dev` → abra o painel da Grace, injete dois subagentes com `__state.apply(...)` no console e navegue por Tab.
- **Capturas:** antes `out/ui-antes-1.png` · depois `out/ui-depois-1.png`, `out/ui-depois-2.png`
- **Plataformas:** verificado no Windows 11 (PowerShell) · não verificado no macOS

## Strings novas para revisão (Lívia Linguagem)
| Local | Texto |
|---|---|
| Título da seção | Subagentes |
| Estado vazio | Nenhum subagente trabalhando agora. |
| Contador | {n} subagentes ativos |
| Overflow | e mais {n} |

## Bloqueios e perguntas
- Para a Úrsula Usabilidade: confirmar o limite de 8 linhas antes do "e mais N".
````

## Quality Criteria

- [ ] Cada subtarefa `(ui)` selecionada está marcada como feita ou tem motivo registrado.
- [ ] Typecheck e build verdes registrados com resultado.
- [ ] Busca por `innerHTML|outerHTML|insertAdjacentHTML` registrada e sem ocorrência injustificada.
- [ ] Papel, nome, foco e teclado descritos para cada controle novo.
- [ ] Como testar com comandos zsh e PowerShell e capturas antes/depois quando há mudança visual.

## Veto Conditions

Rejeite e refaça se QUALQUER uma for verdadeira:
1. Falta o Dev Agent Record de alguma story tocada (o relatório "evapora").
2. Typecheck ou build falhando ao final do step.
3. Código consome evento, campo ou método de IPC que não existe em `src/shared/types.ts`/preload.
4. Há HTML montado com dado externo, mudança na CSP sem ADR, ou ticket movido para `done`.
