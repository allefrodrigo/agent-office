---
execution: inline
agent: release-engineer
tasks:
  - publish-release
outputFile: squads/agent-office-squad/output/22-publish/publish-report.md
---

# Step 22: Publicação — 🚀 Diego Deploy

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2).

- `_opensquad/_memory/company.md` — plataformas e restrições de distribuição
- `squads/agent-office-squad/_memory/memories.md` — proibições registradas
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — autoridade de push e proibições de git (§5), quadro (§7)
- `output/{run_id}/02-plan/vN/run-plan.md` — track e `office_board`
- `output/{run_id}/21-publish-approval.md` — **a única fonte do que pode ser executado**
- `output/{run_id}/20-release/vN/release-plan.md` e `output/{run_id}/20-release/vN/pr-body.md` — comandos, HEAD esperado, corpo do PR e rollback
- `output/{run_id}/17-qa/vN/qa-gate.md` e `output/{run_id}/18-security/vN/security-gate.md` — vereditos vigentes
- `output/{run_id}/19-docs/vN/docs-report.md` — notas de versão (release)
- `output/{run_id}/10-stories/vN/stories.md` — chaves AO dos tickets (quando houver)
- `squads/agent-office-squad/pipeline/data/engineering-standards.md` — comandos de build por plataforma
- Repositório: `package.json`, `CHANGELOG.md`, `git status`, `git rev-parse HEAD`, `git branch --show-current`

## Instructions

### Gate do track

Aplique o protocolo de pulo (run-conventions §3): o track `discovery` pula. Se a aprovação do checkpoint 21 for "Não publicar agora", "Encerrar sem publicar" ou "Voltar ao step-13", não execute nada: grave o relatório com status "nada publicado" e o motivo.

### Process

1. **Leia a aprovação.** As ações permitidas são exatamente as listadas em "Ações aprovadas", na ordem. Qualquer comando que não esteja lá não roda, mesmo que esteja no plano.
2. **Faça o pre-flight**: branch atual igual à do plano, `git status --porcelain` limpo, `git rev-parse HEAD` igual ao HEAD do plano e nenhum gate mais recente com FAIL ou BLOCK. Qualquer divergência para a execução e volta ao usuário com o que mudou.
3. **Aplique textos aprovados** (título ou corpo alterados no checkpoint) ao `pr-body.md` antes de publicar.
4. **Execute um comando por vez** e pare no primeiro erro, registrando a saída: `git push -u origin {branch}`; `gh pr create … [--draft]`. Em release aprovado: commit de versão e CHANGELOG (se ainda não existir), `git tag -a vX.Y.Z -m "Agent Office vX.Y.Z"`, `git push origin vX.Y.Z`, build da plataforma atual (`npm run dist:win` no Windows x64 ou `npm run dist:mac` em Mac arm64) e `gh release create vX.Y.Z --draft --notes-file …` com os artefatos gerados.
5. **Nunca**: `--force`, push direto na `main`, apagar branch remota, publicar release não rascunho ou tocar outra branch — salvo se isso estiver literalmente nas ações aprovadas.
6. **Verifique o resultado**: `gh pr view --json url,state,isDraft,baseRefName`, `git ls-remote --heads origin {branch}` e, em release, `gh release view vX.Y.Z`.
7. **Quadro (opcional, §7).** Com `office_board` ativo, comente o link do PR em cada ticket das stories. Não mova nada para `done`.
8. **Registre o rollback** de cada ação executada e o que ficou pendente (ex.: build da outra plataforma, assinatura).

## Output Format

The output MUST follow this exact structure:

````markdown
# Relatório de Publicação — {run_slug} (step-22)

- **Status:** {publicado | publicado parcialmente — motivo | nada publicado — motivo}
- **Decisão do checkpoint 21:** {…}
- **Pre-flight:** branch {ok | divergente} · árvore {limpa | suja} · HEAD `{hash}` {confere | diverge} · gates {válidos | …}

## Ações executadas
| # | Comando | Resultado |
|---|---|---|

## Verificação
- **PR:** {URL — estado — draft? — base | não se aplica}
- **Branch remota:** {confirmada | não se aplica}
- **Tag / release:** {vX.Y.Z — rascunho — artefatos | não se aplica}

## Quadro
- {AO-n: link comentado | não aplicável}

## Rollback
- {ação — como desfazer}

## Pendências
- {…}
````

## Output Example

````markdown
# Relatório de Publicação — subagentes-visiveis (step-22)

- **Status:** publicado
- **Decisão do checkpoint 21:** Push da branch + PR · Pronto para revisão · base main
- **Pre-flight:** branch ok · árvore limpa · HEAD `e51a07d` confere · gates válidos (QA CONCERNS, Segurança CONDITIONS)

## Ações executadas
| # | Comando | Resultado |
|---|---|---|
| 1 | `git push -u origin squad/2026-10-08-101500-subagentes-visiveis` | branch criada no remoto |
| 2 | `gh pr create --base main --head squad/2026-10-08-101500-subagentes-visiveis --title "Subagentes visíveis no escritório" --body-file squads/agent-office-squad/output/2026-10-08-101500/20-release/v1/pr-body.md` | PR #12 aberto |

## Verificação
- **PR:** https://github.com/exemplo/agent-office/pull/12 — OPEN — não é draft — base main
- **Branch remota:** confirmada por `git ls-remote --heads origin squad/2026-10-08-101500-subagentes-visiveis`
- **Tag / release:** não se aplica

## Quadro
- não aplicável (office_board: false)

## Rollback
- PR: `gh pr close 12` (a branch continua no remoto)
- Branch remota: `git push origin --delete squad/2026-10-08-101500-subagentes-visiveis` — só com pedido explícito do usuário

## Pendências
- Condições do PR em aberto: SEC-1 (limite de 80 caracteres no caminho da ponte) e QA-1 (etiqueta "+N" com 18 agentes).
- Verificação no macOS antes do merge.
- Anexar `out/qa-2026-10-08-101500-2.png` e `out/s16-depois-1.png` ao PR manualmente.
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Comando executado que não consta nas ações aprovadas do checkpoint 21.
2. Publicação feita com pre-flight divergente (branch, HEAD ou árvore suja) ou com gate vigente FAIL/BLOCK.
3. Uso de `--force`, push direto na `main`, remoção de branch remota ou release não rascunho sem aprovação literal.
4. Resultado declarado sem verificação (`gh pr view`, `git ls-remote`, `gh release view`).

## Quality Criteria

- [ ] Cada ação executada tem comando e resultado registrados
- [ ] Pre-flight registrado antes da primeira ação
- [ ] Execução parou no primeiro erro, com a saída do erro
- [ ] Rollback descrito para cada ação executada
- [ ] Pendências (outra plataforma, assinatura, condições do PR) explícitas
- [ ] Tickets comentados com o link do PR quando o quadro estiver ativo
