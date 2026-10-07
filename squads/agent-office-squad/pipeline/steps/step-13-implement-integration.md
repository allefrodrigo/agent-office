---
execution: subagent
agent: claude-integration-engineer
model_tier: powerful
tasks:
  - implement-integration-stories
outputFile: squads/agent-office-squad/output/13-integration/impl-report.md
---

# Step 13: Implementação — integração Claude Code — 🪝 Henrique Hook

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2). O `{run_id}` vem do caminho de saída que o runner passou.

- `_opensquad/_memory/company.md` — perfil do produto e restrições inegociáveis
- `squads/agent-office-squad/_memory/memories.md` — preferências e proibições já registradas
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — pulo (§3), run_plan (§4), branch e commits (§5), contrato de saída (§6), quadro (§7), comandos (§8)
- `output/{run_id}/02-plan/vN/run-plan.md` e `output/{run_id}/03-plan-approval.md` — track, `run_slug`, `office_board`, superfícies (a aprovação prevalece)
- `output/{run_id}/12-story-selection.md` — stories selecionadas e ordem de implementação
- `output/{run_id}/10-stories/vN/stories.md` — stories completas; seu escopo são as subtarefas `(integration)`
- `output/{run_id}/11-validation/vN/po-validation.md` — ressalvas do PO por story
- `output/{run_id}/09-architecture/vN/architecture.md` — contratos, ADRs e ameaças (se o step-09 rodou)
- Só em re-execução de loop: `output/{run_id}/17-qa/vN/qa-gate.md` e `output/{run_id}/18-security/vN/security-gate.md` (correções marcadas `integration`)
- `squads/agent-office-squad/pipeline/data/architecture-map.md` — módulos, fluxos e invariantes I-01…I-14
- `squads/agent-office-squad/pipeline/data/engineering-standards.md` — convenções, comandos e Definition of Done
- `squads/agent-office-squad/pipeline/data/security-checklist.md` — ponte, permissões e entrada não confiável
- Código da camada: `src/main/agents.ts`, `src/main/bridge.ts`, `src/main/tickets.ts`, `src/main/delegate.ts`, `src/main/sessions.ts`, `src/main/usage.ts`, `src/main/peers.ts`, `src/main/attachments.ts`, `src/shared/types.ts`, `src/shared/describe.ts`
- Tipos do SDK instalado: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` e `package.json` do pacote

## Instructions

### Gate do track

Aplique o protocolo de pulo (run-conventions §3). Track `release` ou `discovery`: pule. Nos tracks `iniciativa`, `entrega` e `bugfix` o step roda só se as stories selecionadas no step-12 tiverem ao menos uma subtarefa `(integration)` — senão grave a nota de pulo com o motivo "sem subtarefas integration nas stories selecionadas".

### Process

1. **Defina o modo.** Se houver `qa-gate.md` com FAIL ou `security-gate.md` com BLOCK mais recente que o seu último relatório, é re-execução: o escopo passa a ser só a lista de correções marcadas `integration` (FIX-n, SEC-n). Não reabra subtarefas já aprovadas.
2. **Prepare a branch.** Rode `git status --porcelain`; alterações que não são da run viram bloqueio registrado (sem stash, sem descartar). Se `squad/{run_id}-{run_slug}` não existir, crie com `git switch -c` (você é o primeiro executor); se existir, `git switch`. Rode `npm run typecheck` como linha de base e anote o resultado.
3. **Leia antes de editar.** Para cada story, na ordem do step-12, liste as subtarefas `(integration)` e os critérios de aceite que dependem delas; abra os arquivos citados nas notas técnicas.
4. **Cheque compatibilidade.** Anote a versão do SDK e a saída de `claude --version`. Confirme no `sdk.d.ts` cada campo usado (ex.: `parent_tool_use_id`, subtipos de `system`) e, nos hooks, o nome do evento e os campos do payload. Campo ausente na versão instalada → implemente com guarda e fallback silencioso e registre. API experimental só atrás de guarda (I-12).
5. **Implemente subtarefa por subtarefa** seguindo engineering-standards (TypeScript strict, comentário curto de porquê, mensagens em pt-BR). Preserve I-03 (ponte), I-07 (sessões do escritório ignoradas pela ponte), I-08 (só `mcp__office__*` auto-permitido), I-12, I-13 e I-14: dado vindo do SDK ou de hook é tipado e limitado no main antes de virar evento. Se a story depende de um tipo em `src/shared/types.ts`, declare-o exatamente como na story/arquitetura (ajuste mínimo combinado) e deixe a fiação de IPC para o step-14.
6. **Teste.** Com `npm test` disponível, crie ou atualize testes das funções puras tocadas. Sem test runner, isole a lógica em função pura exportada e registre "teste pendente: sem test runner". `npm run typecheck` e `npm run build` precisam terminar verdes.
7. **Commite localmente por story**, só com os arquivos da subtarefa: `git commit -m "{Verbo} {o quê} (S-n, integração)"`. Nunca push.
8. **Quadro (opcional, §7).** Com `office_board: true` e ferramentas `mcp__office__*` disponíveis: `ticket_update` → `doing` ao iniciar a story, `ticket_check` nos critérios cumpridos, `ticket_comment` com o resumo. Nunca `done`.
9. **Escreva o relatório** com um Dev Agent Record por story (contrato §6) e as pendências para os próximos executores.

## Output Format

The output MUST follow this exact structure:

````markdown
# Relatório de Implementação — Integração Claude Code (step-13)

- **Run:** {run_id} · **Branch:** squad/{run_id}-{run_slug} ({criada neste step | reutilizada})
- **Modo:** {primeira execução | re-execução após FAIL do QA | re-execução após BLOCK de segurança} (ciclo {n}/3)
- **Stories tocadas:** {S-n, …}
- **Linha de base:** typecheck {verde | vermelho herdado: resumo}
- **Compatibilidade:** SDK {versão} · Claude Code {versão} · eventos/campos usados: {lista}

## Resumo
{2–4 linhas: o que mudou e por quê}

## Dev Agent Record — S-{n} · {título}
- **Subtarefas:** [x] (integration) {feita} · [ ] (integration) {pendente — motivo}
- **Arquivos alterados:** `{caminho}` — {resumo de uma linha}
- **Comandos:** `npm run typecheck` → {resultado} · `npm run build` → {resultado} · `npm test` → {resultado | não existe}
- **Decisões e desvios:** {decisão + motivo + fonte | nenhum}
- **Invariantes verificados:** {I-xx — como}
- **Como testar manualmente:** {passos; comando zsh e PowerShell}
- **Plataformas:** macOS {verificado | não verificado} · Windows {verificado | não verificado}
- **Commit:** `{hash}` {mensagem}
- **Quadro:** {AO-n: backlog → doing | não aplicável}

## Correções do loop (só em re-execução)
| Id | Origem | Correção feita | Arquivo | Status |
|---|---|---|---|---|

## Pendências e riscos para os próximos executores
- {executor/step — o que fica com ele}
````

## Output Example

````markdown
# Relatório de Implementação — Integração Claude Code (step-13)

- **Run:** 2026-10-08-101500 · **Branch:** squad/2026-10-08-101500-subagentes-visiveis (criada neste step)
- **Modo:** primeira execução (ciclo 1/3)
- **Stories tocadas:** S-1
- **Linha de base:** typecheck verde antes das mudanças
- **Compatibilidade:** SDK 0.3.292 · Claude Code 2.1.231 · `parent_tool_use_id`, tool_use `Agent`/`Task`, hooks `PreToolUse` e `SubagentStop`

## Resumo
O AgentManager deixa de descartar em silêncio as mensagens de subagentes: tool_use `Agent`/`Task` abre um subagente, mensagens com `parent_tool_use_id` atualizam a atividade e o `tool_result` do pai encerra. A ponte faz o mesmo para sessões do terminal via `PreToolUse` e `SubagentStop`. Tudo sai como evento `agent:subagent`.

## Dev Agent Record — S-1 · Emitir eventos de subagentes a partir do SDK e dos hooks
- **Subtarefas:** [x] (integration) início/fim por tool_use no `agents.ts` (descrição truncada em 80 caracteres) · [x] (integration) atividade via `parent_tool_use_id` · [x] (integration) `PreToolUse` `Agent`/`Task` e `SubagentStop` no `bridge.ts` · [x] (integration) função pura `subagentFromToolUse()`
- **Arquivos alterados:** `src/main/agents.ts` — rastreia subagentes por agente e emite `agent:subagent` · `src/main/bridge.ts` — trata `PreToolUse` de `Agent`/`Task` e `SubagentStop` · `src/main/subagents.ts` — novo, mapeamento puro tool_use → `SubagentInfo` · `src/shared/types.ts` — `SubagentInfo` e o evento `agent:subagent` exatamente como em [ARQ §3.1]
- **Comandos:** `npm run typecheck` → verde · `npm run build` → verde · `npm test` → não existe (teste pendente registrado)
- **Decisões e desvios:** sessões antigas do Claude Code sem `SubagentStop` expiram o subagente após 10 min sem atividade [ADR-007].
- **Invariantes verificados:** I-07 — `isOfficeSession` continua antes de qualquer tratamento novo · I-08 — nenhuma permissão nova auto-concedida · I-13 — nada chama o modelo · I-14 — no caminho do SDK a descrição é tipada e truncada no main
- **Como testar manualmente:** zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa npm run dev` · PowerShell `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-qa"; npm run dev`; chame um agente numa pasta de teste e peça "use um subagente para listar os arquivos .ts"; no console do DevTools rode `window.office.onEvent(e => e.type === 'agent:subagent' && console.log(e))` e confira início, atividade e fim.
- **Plataformas:** macOS não verificado · Windows verificado
- **Commit:** `a41c9e2` Emite eventos de subagentes a partir do SDK e dos hooks (S-1, integração)
- **Quadro:** não aplicável (office_board: false)

## Pendências e riscos para os próximos executores
- Eduardo (step-14): o `broadcast` do `index.ts` já repassa o evento; falta o estado inicial no `office:getState` e conferir badge/notificações.
- Teste unitário de `subagentFromToolUse()` aguarda test runner (subtarefa `(test)` da S-1).
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Falta o Dev Agent Record de alguma story tocada, ou ele não traz arquivos, comandos com resultado e passos de teste.
2. `npm run typecheck` ou `npm run build` vermelho no fim do step sem bloqueio herdado registrado.
3. Código alterado fora das subtarefas `(integration)` selecionadas, além do ajuste mínimo de tipo combinado na story.
4. Algum dos invariantes I-03, I-07, I-08, I-12, I-13 ou I-14 enfraquecido, ou API experimental do SDK usada sem guarda.
5. `git push`, PR, tag, force push, stash ou descarte de alterações do usuário.

## Quality Criteria

- [ ] Versões do SDK e do Claude Code e campos/eventos usados registrados
- [ ] Cada subtarefa marcada como feita ou com o motivo da pendência
- [ ] Lógica nova isolada em função pura testável (ou testada, se houver runner)
- [ ] Mensagens de erro novas em pt-BR, humanas e acionáveis
- [ ] Commits locais por story no padrão do histórico do repositório
- [ ] Passos de teste manual com comando zsh e PowerShell
- [ ] Pendências endereçadas ao executor seguinte pelo nome
