---
task: "Publicar o que foi aprovado"
order: 2
input: |
  - approval: output/{run_id}/21-publish-approval.md (ações aprovadas, por número)
  - release_plan: output/{run_id}/20-release/vN/release-plan.md (comandos, pré-condições, HEAD aprovado)
  - pr_body: output/{run_id}/20-release/vN/pr-body.md
  - run_plan: office_board e chaves AO das stories
output: |
  - publish_report: relatório do step-22 com ações executadas, verificação e rollback (vira output/22-publish/publish-report.md)
  - remote_changes: branch enviada, PR, tag e release criados conforme aprovado
  - board_comments: link do PR nos tickets AO (se office_board)
---

# Publicar o que foi aprovado

Executa, na ordem, somente as ações aprovadas no checkpoint 21, verifica cada uma no remoto e deixa o caminho de volta escrito. Qualquer divergência entre o que foi aprovado e o estado atual interrompe a publicação.

## Process

1. **Ler a aprovação.** Abra `output/{run_id}/21-publish-approval.md`. Sem arquivo, sem aprovação ou com "não publicar": grave o relatório "Nada publicado" com o motivo e pare. Monte a lista de ações aprovadas (ex.: A1, A2) e ignore as demais.
2. **Pré-voo.** `git status --porcelain` limpo; `git branch --show-current` igual à branch do plano; `git rev-parse --short HEAD` igual ao HEAD aprovado. Se o HEAD mudou, pare: commit novo exige nova aprovação. Revalide a pré-condição de cada ação (ex.: A3 exige PR mesclado — confira com `gh pr view <n> --json state,mergeCommit`).
3. **Executar em ordem.** Rode cada comando aprovado exatamente como está no plano. Pare na primeira falha, registre a saída e não tente variações (sem `--force`, sem `--no-verify`, sem trocar de branch para contornar).
4. **Verificar.** Branch: `git ls-remote origin squad/{run_id}-{run_slug}` mostra o hash aprovado. PR: `gh pr view --json number,url,state,headRefOid,baseRefName`. Tag: `git ls-remote --tags origin vX.Y.Z`. Release: `gh release view vX.Y.Z --json url,isDraft,assets`.
5. **Quadro.** Se `office_board` e as ferramentas `mcp__office__*` existirem, `ticket_comment` em cada ticket das stories com o link do PR (e da release, se houver). Não altere status — o ticket fica em `review` até uma pessoa fechar.
6. **Ações pendentes.** Ações aprovadas cuja pré-condição ainda não vale (ex.: tag antes do merge) ficam listadas como pendentes, com o que precisa acontecer e quem faz.
7. **Relatório.** Para cada ação: comando, resultado, verificação, horário e rollback pronto para copiar.

## Output Format

````markdown
# Step 22 — Publicação

**Aprovado no checkpoint 21:** A1, A2, ... · **HEAD conferido:** {hash} · **Resultado:** publicado | parcial | nada publicado

## Ações executadas
| # | Comando | Resultado | Verificação | Horário |

## Links
- PR: ...
- Release: ...

## Pendentes
| # | Ação | Falta | Responsável |

## Rollback
| # | Como desfazer |

## Quadro do escritório
````

## Output Example

> Use como referência de qualidade, não como template rígido.

````markdown
# Step 22 — Publicação

**Aprovado no checkpoint 21:** A1, A2 · **HEAD conferido:** 9b7d2e1 · **Resultado:** publicado (A3 e A4 ficam para depois do merge)

## Ações executadas
| # | Comando | Resultado | Verificação | Horário |
|---|---|---|---|---|
| A1 | `git push -u origin squad/2026-10-08-101500-subagentes-visiveis` | ok — branch nova no remoto | `git ls-remote origin squad/2026-10-08-101500-subagentes-visiveis` → 9b7d2e1 | 16:42 |
| A2 | `gh pr create --base main --title "Subagentes visíveis no escritório (v0.3.0)" --body-file output/2026-10-08-101500/20-release/v1/pr-body.md` | ok — PR #12 aberto | `gh pr view 12 --json state,headRefOid` → OPEN, 9b7d2e1 | 16:43 |

## Links
- PR: https://github.com/<dono>/agent-office/pull/12
- Release: ainda não criada (A4 pendente)

## Pendentes
| # | Ação | Falta | Responsável |
|---|---|---|---|
| A3 | Tag `v0.3.0` no merge | uma pessoa revisar e mesclar o PR #12 | sócios |
| A4 | Release em rascunho com o instalador Windows | A3 + `npm run dist:win` nesta máquina; build Mac no Mac do autor | Diego Deploy em nova run (track release) |

## Rollback
| # | Como desfazer |
|---|---|
| A1 | `git push origin --delete squad/2026-10-08-101500-subagentes-visiveis` (só se o PR for fechado) |
| A2 | `gh pr close 12 --comment "Cancelado pelo squad"` |

## Quadro do escritório
Comentado o link do PR #12 em AO-31, AO-32 e AO-33. Status mantido em `review`.
````

## Quality Criteria

- [ ] Somente ações aprovadas foram executadas, na ordem do plano.
- [ ] HEAD e pré-condições conferidos antes de cada ação.
- [ ] Cada ação executada tem verificação no remoto e rollback.
- [ ] Ações aprovadas mas ainda impossíveis aparecem como pendentes com responsável.

## Veto Conditions

Rejeite e refaça se QUALQUER uma for verdadeira:
1. Alguma ação não aprovada foi executada, ou foi usado `--force`/`--no-verify`.
2. A publicação seguiu com HEAD diferente do aprovado.
3. Falta verificação ou rollback de alguma ação executada.
4. Algum ticket teve o status alterado para `done`.
