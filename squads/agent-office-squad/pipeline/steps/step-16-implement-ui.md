---
execution: subagent
agent: ui-engineer
model_tier: powerful
tasks:
  - implement-ui-stories
outputFile: squads/agent-office-squad/output/16-ui/impl-report.md
---

# Step 16: Implementação — interface — 🎛️ Fernanda Front

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2).

- `_opensquad/_memory/company.md` — tom de voz e restrições do produto
- `squads/agent-office-squad/_memory/memories.md` — preferências e proibições registradas
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — pulo, branch e commits, contrato de saída, quadro, comandos e capturas
- `output/{run_id}/02-plan/vN/run-plan.md` e `output/{run_id}/03-plan-approval.md` — track, `run_slug`, `office_board`
- `output/{run_id}/12-story-selection.md` e `output/{run_id}/10-stories/vN/stories.md` — seu escopo são as subtarefas `(ui)`
- `output/{run_id}/07-ux/vN/ux-spec.md` — fluxos, estados, layout, teclado, acessibilidade e microcopy de rascunho (se o step-07 rodou)
- `output/{run_id}/09-architecture/vN/architecture.md` — eventos e campos de estado
- `output/{run_id}/13-integration/vN/impl-report.md`, `14-platform/vN/impl-report.md` e `15-world/vN/impl-report.md` — contratos entregues e pendências para você
- Só em re-execução de loop: `output/{run_id}/17-qa/vN/qa-gate.md` e `output/{run_id}/18-security/vN/security-gate.md` (correções marcadas `ui`)
- `squads/agent-office-squad/pipeline/data/architecture-map.md` — State do renderer, eventos, invariantes I-05 e I-06
- `squads/agent-office-squad/pipeline/data/engineering-standards.md` — convenções do DOM puro e Definition of Done
- `squads/agent-office-squad/pipeline/data/product-voice.md` — voz, glossário e padrões de mensagem
- Código da camada: `src/renderer/src/ui/hud.ts`, `panel.ts`, `dialog.ts`, `modals.ts`, `board.ts`, `dom.ts`, `markdown.ts`, `portrait.ts`, além de `src/renderer/src/state.ts`, `src/renderer/src/main.ts`, `src/renderer/src/styles.css` e `src/renderer/index.html`

## Instructions

### Gate do track

Aplique o protocolo de pulo (run-conventions §3). Track `release` ou `discovery`: pule. Em `iniciativa`, `entrega` e `bugfix` o step roda só se as stories selecionadas tiverem subtarefa `(ui)` — senão grave a nota de pulo com o motivo "sem subtarefas ui nas stories selecionadas".

### Process

1. **Defina o modo.** FAIL do QA ou BLOCK de segurança mais recente que o seu último relatório = re-execução: corrija só os itens marcados `ui`.
2. **Prepare a branch** `squad/{run_id}-{run_slug}` (crie se for o primeiro executor), confira `git status --porcelain` e rode `npm run typecheck`. Erro herdado dos steps 13–15 vira bloqueio registrado; não reescreva código de outra camada.
3. **Ligue o estado.** Eventos novos entram em `State.apply()` e campos novos do `OfficeState` no construtor. Evento frequente ganha caminho de render próprio (como `system` → `hud.renderSystem()`) em vez de redesenhar o HUD inteiro.
4. **Construa com `h()` e `icon()`**, seguindo o ux-spec e os padrões existentes de `styles.css`. Ações são `button` nativos; botão só com ícone recebe `aria-label`; listas dinâmicas ganham nome acessível; mudanças relevantes usam `aria-live="polite"` com parcimônia; foco visível e ordem de Tab coerente; Esc continua fechando painel e cartões.
5. **Segurança do conteúdo.** Nada de `innerHTML` com dado externo; Markdown de agente só por `renderMarkdown()` (I-06); links só por `window.office.openExternal` (I-05). A CSP do `index.html` não muda.
6. **Implemente todos os estados** pedidos no ux-spec (vazio, carregando, erro, desabilitado), com textos em pt-BR seguindo o product-voice; a revisão final é da Lívia (step-19).
7. **Verifique.** `npm run typecheck` e `npm run build` verdes; `npm test` se existir. Percorra a feature só com teclado em instância isolada e gere capturas: zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa AGENT_OFFICE_SHOTS="out/s16-depois:5000" AGENT_OFFICE_EVAL="__panel.open([...__state.agents.keys()][0])" npm run demo`; PowerShell com as mesmas variáveis via `$env:` e `npm run dev`.
8. **Commite localmente por story** (`git commit -m "{Verbo} {o quê} (S-n, interface)"`), sem `out/`. Quadro se `office_board` (§7): se você for o último executor da story, `ticket_update` → `review`; nunca `done`.
9. **Escreva o relatório** com Dev Agent Record por story, checklist de acessibilidade e textos novos listados para a Lívia.

## Output Format

The output MUST follow this exact structure:

````markdown
# Relatório de Implementação — Interface (step-16)

- **Run:** {run_id} · **Branch:** squad/{run_id}-{run_slug}
- **Modo:** {primeira execução | re-execução após FAIL/BLOCK} (ciclo {n}/3)
- **Stories tocadas:** {S-n, …}
- **Linha de base:** typecheck {verde | vermelho herdado: resumo}

## Resumo
{2–4 linhas}

## Dev Agent Record — S-{n} · {título}
- **Subtarefas:** [x] (ui) {feita} · [ ] (ui) {pendente — motivo}
- **Arquivos alterados:** `{caminho}` — {resumo}
- **Estados implementados:** {vazio | carregando | erro | …}
- **Acessibilidade:** {papéis e nomes, teclado, foco visível, aria-live — o que foi feito}
- **Comandos:** `npm run typecheck` → {…} · `npm run build` → {…} · `npm test` → {… | não existe}
- **Decisões e desvios em relação ao ux-spec:** {… | nenhum}
- **Invariantes verificados:** {I-05, I-06 — como}
- **Como testar manualmente:** {passos com zsh e PowerShell, incluindo o roteiro só com teclado}
- **Capturas:** {caminhos em out/}
- **Plataformas:** macOS {…} · Windows {…}
- **Commit:** `{hash}` {mensagem}
- **Quadro:** {AO-n → review | não aplicável}

## Textos novos para revisão da Lívia
| Onde | Texto | Observação |
|---|---|---|

## Pendências e riscos
- {…}
````

## Output Example

````markdown
# Relatório de Implementação — Interface (step-16)

- **Run:** 2026-10-08-101500 · **Branch:** squad/2026-10-08-101500-subagentes-visiveis (reutilizada)
- **Modo:** primeira execução (ciclo 1/3)
- **Stories tocadas:** S-3
- **Linha de base:** typecheck verde

## Resumo
O painel do agente ganhou a seção "Subagentes" com cada subagente ativo, a atividade atual e há quanto tempo está rodando. Cada item é um botão: Enter foca a câmera na mesa do agente. A seção só re-renderiza quando chega `agent:subagent` daquele agente.

## Dev Agent Record — S-3 · Listar subagentes ativos no painel do agente
- **Subtarefas:** [x] (ui) `State.apply` trata `agent:subagent` e lê `initial.subagents` · [x] (ui) seção "Subagentes" no `panel.ts` · [x] (ui) foco de câmera por teclado
- **Arquivos alterados:** `src/renderer/src/state.ts` — mapa `subagents` por agente e `subagentsFor(id)` · `src/renderer/src/ui/panel.ts` — `renderSubagents()` chamado só pelo evento do agente aberto · `src/renderer/src/styles.css` — `.panel-subagents` e `:focus-visible` nos itens
- **Estados implementados:** vazio ("Nenhum subagente agora.") e lista; sem estado de erro (o evento não tem falha própria)
- **Acessibilidade:** lista com `aria-label="Subagentes de Ada"`; itens `button` com status em texto além da bolinha colorida; contagem em `aria-live="polite"` só quando muda; Tab percorre os itens e Esc fecha o painel como antes
- **Comandos:** `npm run typecheck` → verde · `npm run build` → verde · `npm test` → não existe
- **Decisões e desvios em relação ao ux-spec:** o spec pedia ordenar por início; ordenei por atividade mais recente, que é o que o usuário procura ao abrir o painel.
- **Invariantes verificados:** I-06 — descrição e atividade entram como texto pelo `h()`, sem Markdown · I-05 — nenhum link novo
- **Como testar manualmente:** PowerShell `$env:AGENT_OFFICE_DEMO=1; $env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-qa"; npm run dev` · zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa npm run demo`; abra a Ada, injete 2 subagentes com `__state.apply`, use só Tab/Enter/Esc.
- **Capturas:** `out/s16-depois-1.png` (painel com 2 subagentes)
- **Plataformas:** Windows verificado · macOS não verificado
- **Commit:** `c93e4aa` Lista subagentes ativos no painel do agente (S-3, interface)
- **Quadro:** não aplicável (office_board: false)

## Textos novos para revisão da Lívia
| Onde | Texto | Observação |
|---|---|---|
| Título da seção | Subagentes | termo novo no glossário? |
| Estado vazio | Nenhum subagente agora. | — |
| Tempo | há 2 min | reusa `timeAgo()` |

## Pendências e riscos
- Leitores de tela no macOS (VoiceOver) não testados.
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Falta o Dev Agent Record, a seção de acessibilidade ou a lista de textos novos.
2. `npm run typecheck` ou `npm run build` vermelho no fim do step sem bloqueio herdado registrado.
3. `innerHTML` com dado externo, Markdown fora do `renderMarkdown()`, link fora do `openExternal` ou CSP alterada (I-05, I-06).
4. Ação nova sem acesso por teclado ou sem nome acessível, ou estado pedido no ux-spec sem implementação.
5. Código fora das subtarefas `(ui)` selecionadas, ou `git push`/PR/tag/force push.

## Quality Criteria

- [ ] Re-render restrito ao trecho afetado pelo evento
- [ ] Roteiro só com teclado executado e descrito
- [ ] Status nunca comunicado só por cor
- [ ] Textos em pt-BR seguindo o product-voice e listados para revisão
- [ ] Capturas salvas em `out/` e fora dos commits
- [ ] Passos de teste manual com comando zsh e PowerShell
- [ ] Última story da run movida para `review` no quadro quando `office_board` estiver ativo
