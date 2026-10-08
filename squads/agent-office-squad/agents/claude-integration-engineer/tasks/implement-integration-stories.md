---
task: "Implementar as subtarefas de integração"
order: 1
input: |
  - story_selection: output/{run_id}/12-story-selection.md (stories escolhidas)
  - stories: stories.md com subtarefas marcadas (integration)
  - run_plan: run_slug, office_board, risk_flags
  - fix_list: correções do executor integration vindas do QA ou da segurança (só em loop)
output: |
  - code_changes: commits locais na branch squad/{run_id}-{run_slug}
  - compatibility_check: versões do SDK e do Claude Code e comportamento degradado
  - dev_agent_record: registro por story (run-conventions §6)
  - impl_report: documento final do step-13
---

# Implementar as subtarefas de integração

Executa, em ordem de dependência, as subtarefas `integration` das stories selecionadas, com checagem de compatibilidade antes de codar e validação depois. Em re-execução após FAIL/BLOCK, trata só a lista de correções do executor `integration`.

## Process

1. Ler a seleção do step-12 e filtrar as subtarefas `(integration)`; se não houver nenhuma (nem itens na lista de correções), gravar a nota de pulo de `run-conventions.md` §3 e encerrar.
2. Preparar a branch: `git status --porcelain` limpo (se houver alteração alheia, parar e registrar bloqueio); `git switch squad/{run_id}-{run_slug}` ou `git switch -c` a partir do HEAD atual.
3. Checar compatibilidade: versão de `@anthropic-ai/claude-agent-sdk` em `package.json`; conferir em `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (rodar `npm install` se ausente) os tipos usados (`SDKMessage`, `PermissionResult`, `Query`, opções de `query()`); `claude --version` para o Claude Code; para hooks, o esquema do evento usado. Registrar o que não existe na versão instalada.
4. Se `office_board: true` e houver `mcp__office__*`: `ticket_update` do ticket da story para `doing` ao começar.
5. Implementar cada subtarefa respeitando os pontos de extensão atuais: mensagens novas em `AgentManager.handle()` (subagentes via `parent_tool_use_id`, `system/*`), decisões só por `requestDecision()` → `respond()`/`cancelRequest()` (cancelar em interrupção, demissão e fim de sessão), novos hooks em `Bridge.dispatch()` + `Bridge.install()` (resposta rápida com `reply(200)`; `PermissionRequest` segura até decidir), ferramentas MCP em `TicketBoard.toolsFor()` com `zod` e `run()` que devolve `isError`, regras de `TicketDesk.delegate()` intactas.
6. Toda API experimental ou formato interno novo entra num adaptador com guarda (`typeof fn === 'function'`), timeout (padrão de `withTimeout` em `usage.ts`) e mensagem pt-BR de degradação; nada que gere turno pago.
7. Escrever teste automatizado para lógica pura quando houver test runner (`npm test`); sem runner, extrair a lógica para função pura e descrever o teste manual equivalente.
8. Validar: `npm run typecheck`, `npm run build` (e `npm test`/`npm run lint` se existirem); verificação manual no demo isolado (`AGENT_OFFICE_DATA_DIR`) quando a story afetar fluxo visível; nunca instalar/desinstalar a ponte do usuário sem pedido.
9. Commit local por story: `Adiciona eventos de subagentes no processo principal (S-1, integração)`; com quadro ativo, `ticket_check` nos critérios cumpridos, `ticket_comment` com decisões e `ticket_update` → `review` se for o último executor da story.
10. Escrever o relatório com o Dev Agent Record de cada story e, em loop, cada item da lista de correções como resolvido ou não resolvido.

## Output Format

```markdown
# Implementação — integração Claude Code
## Compatibilidade
- SDK: {versão} · Claude Code: {versão} · Recursos ausentes: {lista}
## Dev Agent Record — S-{n} · {título}
- [x]/[ ] (integration) {subtarefa}
- Arquivos: `{caminho}` — {resumo}
- Comandos: `{comando}` → {resultado}
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
# Implementação — integração Claude Code (run 2026-10-08-101500)

## Compatibilidade
- SDK: 0.3.292 · Claude Code: 2.1.230 · Recursos ausentes: nenhum (hook `SubagentStop` presente)

## Dev Agent Record — S-1 · Emitir eventos de subagentes a partir do SDK e dos hooks
- [x] (integration) `AgentManager.handle()`: registrar `tool_use` de `Agent`/`Task` e emitir `agent:subagent`
- [x] (integration) `Bridge.dispatch()`: `PreToolUse` de `Agent` emite início; `SubagentStop` emite fim
- [x] (integration) `Bridge.install()`: adiciona `SubagentStop`; `isInstalled()` detecta ponte antiga
- [ ] (platform) repasse em `index.ts` — executor platform (step-14)
- Arquivos:
  - `src/main/subagents.ts` — novo; `subagentEventsFrom(msg)` puro, mapeia blocos em eventos
  - `src/main/agents.ts` — `handle()` chama o mapeador antes do retorno de `parent_tool_use_id`
  - `src/main/bridge.ts` — dois casos novos em `dispatch()`; hook novo no instalador
- Comandos: `npm run typecheck` → ok · `npm run build` → ok · `npm test` → script inexistente
- Decisões e desvios: limite de 50 subagentes rastreados por sessão (ameaça DoS do ADR-run-1);
  ponte antiga mostra aviso "Reconecte a ponte para ver subagentes do terminal".
- Como testar: zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa npm run dev` · PowerShell
  `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-qa"; npm run dev`; contratar agente e pedir
  "use um subagente para listar os arquivos de src/main".
- Plataformas: macOS não verificado · Windows verificado

## Commits locais
- 9b1e3d2 Adiciona eventos de subagentes no processo principal (S-1, integração)

## Bloqueios e pendências
- Nenhum.
```

## Quality Criteria

- [ ] Cada subtarefa `integration` selecionada aparece marcada como feita ou pendente com motivo.
- [ ] A seção de compatibilidade registra versões reais obtidas dos comandos.
- [ ] Typecheck e build verdes, com a saída resumida no relatório.
- [ ] Nenhum caminho novo de permissão contorna `requestDecision()`.
- [ ] Em loop, todos os itens da lista de correções do executor têm status.

## Veto Conditions

Reject and redo if ANY are true:
1. Falta Dev Agent Record para alguma story tocada.
2. Typecheck ou build falharam e o relatório não registra bloqueio.
3. Foi feito push, PR, tag ou commit em arquivo fora das subtarefas do executor.
4. Alguma mudança auto-permite ferramenta fora de `mcp__office__*`, relaxa a ponte ou permite ticket em bypass.
