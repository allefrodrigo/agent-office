---
task: "Preparar o release ou o PR"
order: 1
input: |
  - run_plan: output/{run_id}/02-plan/vN/run-plan.md e 03-plan-approval.md (track, run_slug, pedido de versão)
  - qa_gate: output/{run_id}/17-qa/vN/qa-gate.md (veredito)
  - security_gate: output/{run_id}/18-security/vN/security-gate.md (veredito e condições; pode estar pulado)
  - docs_report: output/{run_id}/19-docs/vN/docs-report.md (CHANGELOG e notas de versão)
  - repo_state: git status, branch atual, log main..HEAD, remotos, gh auth status
output: |
  - release_plan: plano do step-20 com estado, gates, versão, PR e ações numeradas (vira output/20-release/release-plan.md)
  - pr_body: corpo do PR em pt-BR salvo na mesma pasta (pr-body.md)
  - release_notes: seção da versão extraída do CHANGELOG (release-notes.md), só quando há release
  - version_bump: alteração em package.json e cabeçalho do CHANGELOG, só quando há release
---

# Preparar o release ou o PR

Monta tudo o que precisa existir para publicar com segurança e para o usuário aprovar com clareza: estado do repositório, vereditos, versão, CHANGELOG, PR e a lista exata de comandos. Nada é enviado ao remoto nesta task.

## Process

1. **Gate do track.** Se o step-20 estiver `skip`, grave a nota de pulo e pare. Tracks `iniciativa`, `entrega` e `bugfix` preparam PR; `release` (ou pedido explícito de versão no intake) prepara também bump, tag, builds e release em rascunho.
2. **Vereditos.** Leia a maior versão do qa-gate e do security-gate. FAIL ou BLOCK: o plano declara "Bloqueado", lista o motivo e não propõe nenhuma ação de publicação. CONCERNS e CONDITIONS seguem, e os itens vão para o corpo do PR.
3. **Estado do repositório.** `git status --porcelain` (precisa estar limpo), `git branch --show-current` (precisa ser `squad/{run_id}-{run_slug}`), `git log --oneline main..HEAD`, `git remote -v` e `gh auth status`. Sem remoto ou sem login: registre o bloqueio e proponha a ação possível (configurar remoto, `gh auth login` pelo usuário).
4. **Gates de novo.** `npm run typecheck` e `npm run build` (e `npm test`/`npm run lint` se existirem). Falhou: plano "Bloqueado", sem ações.
5. **Versão.** Só com release: classifique as mudanças (pré-1.0: feature → MINOR, correção → PATCH), atualize `version` em `package.json`, troque o cabeçalho "Não publicado" do CHANGELOG escrito pela Lívia por `## [X.Y.Z] - AAAA-MM-DD` e faça um commit `Prepara a versão X.Y.Z`. Sem release, não toque na versão.
6. **PR.** Título em pt-BR no imperativo; corpo em `pr-body.md` com: resumo, stories (S-n e chaves AO), vereditos (QA e segurança) e condições, como testar (zsh e PowerShell), plataformas verificadas e não verificadas, riscos e rollback, checklist do revisor.
7. **Matriz de build e assinatura (release).** Tabela por plataforma: máquina, comando (`npm run dist:mac` no Mac arm64; `npm run dist:win` no Windows x64), artefatos esperados e pendências (Developer ID e notarização; certificado Windows / SmartScreen). Extraia a seção da versão do CHANGELOG para `release-notes.md` na pasta deste step. Release do GitHub sempre como rascunho, e a tag sempre no commit de merge em `origin/main`.
8. **Rollback.** Para cada ação: como desfazer (fechar PR, `git revert -m 1 <merge>` via novo PR, apagar release em rascunho; tag publicada não se apaga — corrige-se com versão PATCH).
9. **Ações para aprovação.** Lista numerada A1…An com comando exato, pré-condição e marcação reversível/irreversível, registrando o hash do HEAD aprovado. Nada é executado.

## Output Format

````markdown
# Step 20 — Preparação do release / PR

**Track:** ... · **Branch:** ... · **HEAD:** {hash} · **Situação:** pronto para aprovação | bloqueado

## Estado e gates
| Item | Resultado |

## Versão e CHANGELOG
## Pull request (título + caminho do pr-body.md)
## Matriz de build e assinatura (só release)
## Rollback
## Ações para aprovação no checkpoint 21
| # | Ação | Comando | Pré-condição | Tipo |
````

## Output Example

> Use como referência de qualidade, não como template rígido.

````markdown
# Step 20 — Preparação do release / PR

**Track:** iniciativa (intake pediu publicar como v0.3.0) · **Branch:** squad/2026-10-08-101500-subagentes-visiveis · **HEAD:** 9b7d2e1 · **Situação:** pronto para aprovação

## Estado e gates
| Item | Resultado |
|---|---|
| `git status --porcelain` | limpo |
| Commits em `main..HEAD` | 6 (S-1 ×2, S-2 ×2, S-3, versão) |
| `npm run typecheck` / `npm run build` | ok / ok (13 s) |
| QA (ciclo 2) | CONCERNS — QA-2 e QA-3 como melhorias |
| Segurança | CONDITIONS — SEC-1 corrigido no ciclo 2; nenhuma condição pendente |
| Remoto / gh | `origin` configurado · `gh auth status` ok |

## Versão e CHANGELOG
0.2.0 → **0.3.0** (MINOR: feature nova, sem quebra). `package.json` atualizado; CHANGELOG com `## [0.3.0] - 2026-10-08` (texto da Lívia). Commit `Prepara a versão 0.3.0` (9b7d2e1).

## Pull request
**Título:** Subagentes visíveis no escritório (v0.3.0) · **Corpo:** `output/2026-10-08-101500/20-release/v1/pr-body.md`

## Matriz de build e assinatura
| Plataforma | Máquina | Comando | Artefatos | Pendência |
|---|---|---|---|---|
| macOS arm64 | Mac do autor | `npm run dist:mac` | `Agent Office-0.3.0-arm64.dmg`, `-arm64-mac.zip` | ad-hoc; sem Developer ID/notarização |
| Windows x64 | esta máquina | `npm run dist:win` | `Agent Office Setup 0.3.0.exe` | sem certificado (SmartScreen) |

## Rollback
PR: fechar sem merge. Após merge: `git revert -m 1 <hash-do-merge>` em novo PR. Release em rascunho: apagar. Tag publicada: não apagar — corrigir com 0.3.1.

## Ações para aprovação no checkpoint 21
| # | Ação | Comando | Pré-condição | Tipo |
|---|---|---|---|---|
| A1 | Enviar a branch | `git push -u origin squad/2026-10-08-101500-subagentes-visiveis` | HEAD = 9b7d2e1 | reversível |
| A2 | Abrir o PR | `gh pr create --base main --title "Subagentes visíveis no escritório (v0.3.0)" --body-file output/2026-10-08-101500/20-release/v1/pr-body.md` | A1 | reversível |
| A3 | Criar e enviar a tag no merge | `git fetch origin` + `git tag -a v0.3.0 origin/main -m "Agent Office 0.3.0"` + `git push origin v0.3.0` | PR mesclado por uma pessoa; `origin/main` contém 9b7d2e1 | irreversível |
| A4 | Release em rascunho | `gh release create v0.3.0 --draft --title "Agent Office 0.3.0" --notes-file output/2026-10-08-101500/20-release/v1/release-notes.md "dist/Agent Office Setup 0.3.0.exe"` | A3 + `npm run dist:win` concluído | reversível |
````

## Quality Criteria

- [ ] Vereditos e gates citados com versão (ciclo) e resultado.
- [ ] Versão e CHANGELOG coerentes com o track; sem bump quando não há release.
- [ ] Corpo do PR salvo e com stories, vereditos, condições, como testar e plataformas.
- [ ] Cada ação tem comando exato, pré-condição, tipo e o hash do HEAD aprovado.

## Veto Conditions

Rejeite e refaça se QUALQUER uma for verdadeira:
1. Alguma ação foi executada contra o remoto nesta task.
2. O plano propõe publicação com QA FAIL, segurança BLOCK, typecheck ou build falhando.
3. Há comando com `--force`, reescrita de histórico ou tag antes do merge.
4. Falta o rollback de alguma ação proposta.
