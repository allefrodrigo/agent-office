---
execution: inline
agent: release-engineer
tasks:
  - prepare-release
outputFile: squads/agent-office-squad/output/20-release/release-plan.md
---

# Step 20: Preparação do release / PR — 🚀 Diego Deploy

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2).

- `_opensquad/_memory/company.md` — estágio do produto, plataformas e restrições de distribuição
- `squads/agent-office-squad/_memory/memories.md` — proibições registradas
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — branch, commits e autoridade de push (§5)
- `output/{run_id}/02-plan/vN/run-plan.md` e `output/{run_id}/03-plan-approval.md` — track, `run_slug`, base do PR
- `output/{run_id}/12-story-selection.md` e `output/{run_id}/10-stories/vN/stories.md` — o que entra no PR
- `output/{run_id}/13-integration/…`, `14-platform/…`, `15-world/…`, `16-ui/vN/impl-report.md` — commits, testes e plataformas
- `output/{run_id}/17-qa/vN/qa-gate.md` e `output/{run_id}/18-security/vN/security-gate.md` — vereditos, CONCERNS e CONDITIONS
- `output/{run_id}/19-docs/vN/docs-report.md` — notas de versão e documentação
- `squads/agent-office-squad/pipeline/data/engineering-standards.md` — gates locais e Definition of Done
- `squads/agent-office-squad/pipeline/data/quality-criteria.md` — critérios de release
- Repositório: `package.json` (versão e scripts), `CHANGELOG.md`, `electron-builder.yml`, `.github/workflows/` (se existir), `git status`, `git log --oneline main..HEAD`, `git remote -v`

## Instructions

### Gate do track

Aplique o protocolo de pulo (run-conventions §3). Só o track `discovery` pula. Nos demais, este step prepara tudo e **não executa nada no remoto**.

### Process

1. **Confira os vereditos.** QA precisa ser PASS, CONCERNS ou WAIVED; segurança CLEAR, CONDITIONS ou pulada com justificativa. FAIL ou BLOCK → plano com status "bloqueado", recomendação de voltar ao step-13 e nenhuma ação de publicação proposta.
2. **Rode os gates finais localmente** e registre as saídas: `npm run typecheck`, `npm run build` (e `npm test`/`npm run lint` se existirem). `git status --porcelain` precisa estar limpo; arquivos soltos (`out/`, capturas, `.env`) não entram.
3. **Revise os commits** da branch: mensagens no padrão do repositório, um propósito por commit, nenhum segredo (varredura rápida de `sk-ant-`, `ghp_`, `-----BEGIN`). Problema encontrado vira pendência para o usuário decidir; não reescreva histórico sem aprovação.
4. **Cheque a base.** `git fetch origin` (leitura) e `git log --oneline HEAD..origin/main`: se a base avançou, registre o risco de conflito e a recomendação (merge pela UI do PR ou atualização local aprovada).
5. **Defina a versão (semver).** No PR, a versão não muda. Em release: MAJOR para quebra, MINOR para feature, PATCH só para correção (antes da 1.0, feature = MINOR). Mostre o bump proposto e o bloco do CHANGELOG que muda de "Não lançado" para `[X.Y.Z] - AAAA-MM-DD`.
6. **Escreva o corpo do PR** em `pr-body.md` na mesma pasta `vN/` deste output: resumo, stories e critérios, vereditos (CONCERNS e CONDITIONS como checklist), como testar (zsh e PowerShell), plataformas verificadas, capturas a anexar manualmente, riscos e rollback.
7. **Release completo (track release ou se o usuário pedir):** matriz de build (`npm run dist:mac` só em Mac arm64; `npm run dist:win` só em Windows x64), tag `vX.Y.Z`, release do GitHub como rascunho com as notas do step-19 e checklist de assinatura/notarização como pendência declarada (hoje: mac ad-hoc, NSIS sem assinatura).
8. **Confira o acesso sem alterar nada:** `git remote -v` e `gh auth status`. Sem remoto ou sem login → registre, e a publicação fica restrita ao que for possível.
9. **Gere a lista exata de comandos** para o checkpoint 21, na ordem de execução, e o plano de rollback de cada um.

## Output Format

The output MUST follow this exact structure:

````markdown
# Plano de Release — {run_slug} (step-20)

- **Status:** {pronto para aprovação | bloqueado — motivo}
- **Branch:** squad/{run_id}-{run_slug} · **HEAD:** `{hash}` · **Base:** {main}
- **Vereditos:** QA {…} · Segurança {… | pulado — motivo}
- **Tipo de entrega proposta:** {PR | release completo}

## Gates finais (local)
| Comando | Resultado |
|---|---|

## Commits que serão publicados
| Hash | Mensagem | Story |
|---|---|---|

## Versão e changelog
- **Versão:** {inalterada no PR | X.Y.Z → X.Y.Z (motivo)}
- **CHANGELOG:** {trecho que entra}

## Pull request
- **Título:** {…}
- **Corpo:** `output/{run_id}/20-release/vN/pr-body.md`
- **Condições abertas:** {CONCERNS/CONDITIONS como checklist | nenhuma}

## Release (se aplicável)
- {matriz de build, tag, release rascunho, assinatura/notarização}

## Comandos para aprovação no checkpoint 21 (nada foi executado)
1. `{comando}`

## Rollback
- {como desfazer cada ação}

## Riscos e pendências
- {…}
````

## Output Example

````markdown
# Plano de Release — subagentes-visiveis (step-20)

- **Status:** pronto para aprovação
- **Branch:** squad/2026-10-08-101500-subagentes-visiveis · **HEAD:** `e51a07d` · **Base:** main
- **Vereditos:** QA CONCERNS · Segurança CONDITIONS
- **Tipo de entrega proposta:** PR

## Gates finais (local)
| Comando | Resultado |
|---|---|
| `npm run typecheck` | verde |
| `npm run build` | verde |
| `git status --porcelain` | limpo |

## Commits que serão publicados
| Hash | Mensagem | Story |
|---|---|---|
| `a41c9e2` | Emite eventos de subagentes a partir do SDK e dos hooks (S-1, integração) | S-1 |
| `5d0b7f1` | Inclui subagentes no estado inicial do escritório (S-1, plataforma) | S-1 |
| `9be20c4` | Mostra subagentes como estagiários ao lado da mesa (S-2, mundo) | S-2 |
| `c93e4aa` | Lista subagentes ativos no painel do agente (S-3, interface) | S-3 |
| `e51a07d` | Atualiza documentação de subagentes visíveis (docs) | — |

## Versão e changelog
- **Versão:** inalterada no PR (0.2.0); o bump para 0.3.0 fica para o release
- **CHANGELOG:** "Não lançado → Adicionado: subagentes aparecem como estagiários ao lado da mesa e no painel do agente."

## Pull request
- **Título:** Subagentes visíveis no escritório
- **Corpo:** `output/2026-10-08-101500/20-release/v1/pr-body.md`
- **Condições abertas:** [ ] SEC-1 — limitar a descrição a 80 caracteres no caminho da ponte · [ ] QA-1 — etiqueta "+N" com 18 agentes · [ ] macOS não verificado

## Release (se aplicável)
- Não se aplica neste PR.

## Comandos para aprovação no checkpoint 21 (nada foi executado)
1. `git push -u origin squad/2026-10-08-101500-subagentes-visiveis`
2. `gh pr create --base main --head squad/2026-10-08-101500-subagentes-visiveis --title "Subagentes visíveis no escritório" --body-file squads/agent-office-squad/output/2026-10-08-101500/20-release/v1/pr-body.md --draft`

## Rollback
- PR: `gh pr close <número>` (mantém a branch). Branch remota: apagar só com pedido explícito do usuário.

## Riscos e pendências
- `origin/main` não avançou desde a criação da branch; risco de conflito baixo.
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Qualquer comando executado no remoto neste step (push, PR, tag, release).
2. Plano marcado como pronto com QA FAIL, segurança BLOCK, gates locais vermelhos ou árvore de trabalho suja.
3. Lista de comandos ausente, fora de ordem ou sem o caminho real do `pr-body.md`.
4. Bump de versão que contradiz o semver ou CHANGELOG ausente num release.

## Quality Criteria

- [ ] Saída de cada gate local registrada
- [ ] Todo commit publicado ligado a uma story ou a docs
- [ ] CONCERNS e CONDITIONS viram checklist no corpo do PR
- [ ] Instruções de teste com zsh e PowerShell no corpo do PR
- [ ] Rollback descrito para cada ação proposta
- [ ] Assinatura e notarização declaradas como pendência quando houver release
