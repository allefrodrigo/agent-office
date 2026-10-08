---
execution: inline
agent: product-owner
tasks:
  - validate-stories
outputFile: squads/agent-office-squad/output/11-validation/po-validation.md
on_reject: step-10
---

# Step 11: Validação das stories (PO) — 🎯 Priscila Prioridade

## Context Loading

Carregue antes de executar (outputs de agente: maior `vN/`, run-conventions §2):
- `squads/agent-office-squad/output/{run_id}/10-stories/vN/stories.md` — stories a validar (sempre a maior versão).
- `squads/agent-office-squad/output/{run_id}/02-plan/vN/run-plan.md` e `.../03-plan-approval.md`.
- `squads/agent-office-squad/output/{run_id}/05-prd/vN/prd.md` e `.../06-prd-approval.md` — fatia aprovada e ajustes obrigatórios.
- `squads/agent-office-squad/output/{run_id}/07-ux/vN/ux-spec.md`, `.../08-world/vN/world-spec.md` e `.../09-architecture/vN/architecture.md`, se existirem.
- Versões anteriores de `.../11-validation/vN/po-validation.md` — para contar o ciclo de revisão.
- `squads/agent-office-squad/pipeline/data/story-template.md`, `aiox-pipeline-map.md` (vereditos e autoridade), `architecture-map.md` (invariantes I-01…I-14), `quality-criteria.md` (rubrica de story) e `anti-patterns.md`.
- `_opensquad/_memory/company.md` e `squads/agent-office-squad/_memory/memories.md`.

## Instructions

### Gate do track

1. Leia o run-plan e a aprovação do step-03 (a aprovação prevalece).
2. Este step roda nos tracks **iniciativa**, **entrega** e **bugfix**; em release e discovery o status é `skip`.
3. Se o status for `skip`, grave a nota de pulo do run-conventions §3 (título `# Step 11 — Pulado`, motivo, track e complexidade) e encerre.

### Process

1. Conte o ciclo: número de versões anteriores deste arquivo + 1 (máximo 3).
2. **Task `validate-stories`:** aplique a cada story os 10 checks do AIOX — (1) título claro no imperativo; (2) problema descrito; (3) critérios testáveis em Given/When/Then; (4) escopo dentro e fora; (5) dependências mapeadas; (6) estimativa até 5 pts; (7) valor identificado; (8) riscos documentados; (9) Definition of Done clara; (10) alinhada à fatia aprovada.
3. Aplique os checks específicos do Agent Office: (A) toda subtarefa tem executor; (B) plano de testes cobre macOS e Windows ou declara o limite; (C) arquivo sensível tocado → invariantes citados; (D) fontes citadas, nada inventado; (E) texto novo de interface prevê revisão da Lívia Linguagem.
4. Verifique a coesão: todo requisito da fatia tem story, nenhuma story passa do escopo aprovado, e nomes de contratos e eventos batem com a arquitetura.
5. Dê o veredito por story: **READY** (todos os checks passam), **NEEDS_REVISION** (falha corrigível na própria story) ou **BLOCKED_UPSTREAM** (o defeito está no PRD, numa spec ou na arquitetura).
6. Para cada falha, escreva o local exato (story, seção, item) e a correção proposta — nunca "melhorar a story".
7. Veredito geral: com qualquer NEEDS_REVISION, a run volta ao step-10 com a lista de correções (`on_reject`); no 3º ciclo não há nova volta: registre a escalada para o usuário no checkpoint 12. BLOCKED_UPSTREAM não volta ao step-10 — vai ao checkpoint 12 com a recomendação (step-05 ou step-09).
8. Ordene o backlog da run: dependências primeiro, depois maior risco com valor, depois maior valor.
9. Com `office_board: true` e as ferramentas disponíveis: mova as stories READY para `todo` (`ticket_update`) e comente o veredito em todas (`ticket_comment`). Nunca edite o texto das stories — isso é do Kauã Kanban.
10. Apresente na conversa a tabela de vereditos e grave no caminho transformado.

## Output Format

The output MUST follow this exact structure:
```markdown
# Validação do PO — {título da iniciativa}

**Ciclo:** {n} de 3 · **Stories avaliadas:** stories.md v{n} · **Veredito geral:** READY | NEEDS_REVISION | BLOCKED_UPSTREAM

## Vereditos
| Story | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A | B | C | D | E | Veredito |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Detalhes por story
### S-{n} — {veredito}
- Check {x}: {o que falhou} → **Correção:** {o que escrever e onde}

## Coesão dos artefatos
| Requisito | Story | Situação |

## Ordem do backlog
1. S-{n} — {motivo}

## Instruções para o step-10
{lista de correções, só se NEEDS_REVISION}

## Para o checkpoint 12
{bloqueios a montante e recomendação, ou escalada do 3º ciclo}
```

## Output Example

```markdown
# Validação do PO — Subagentes visíveis no escritório

**Ciclo:** 1 de 3 · **Stories avaliadas:** stories.md v1 · **Veredito geral:** NEEDS_REVISION

## Vereditos
| Story | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A | B | C | D | E | Veredito |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S-1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | READY |
| S-2 | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | NEEDS_REVISION |
| S-3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | READY |

## Detalhes por story
### S-2 — NEEDS_REVISION
- Check 3: o critério 2 diz "os estagiários aparecem de forma agradável", que não é verificável → **Correção:** "Dado um subagente que termina, quando chega `phase: 'end'`, então o estagiário encolhe até sumir em até 0,6 s e o tile fica livre."
- Check B: o plano de testes não cita Windows → **Correção:** incluir o demo no PowerShell (`$env:AGENT_OFFICE_DEMO=1; npm run dev`) e a captura nas duas plataformas.

### S-1 — READY
- Observação não bloqueante: anotar no Dev Agent Record a versão do Claude Code usada para validar o `SubagentStop`.

## Coesão dos artefatos
| Requisito | Story | Situação |
|---|---|---|
| FR-1, FR-2, NFR-3 | S-1 | coberto |
| FR-3, CON-2, NFR-1 | S-2 | coberto (após correção) |
| FR-4 | S-3 | coberto |

## Ordem do backlog
1. S-1 — contrato do qual S-2 e S-3 dependem.
2. S-2 — maior risco de performance (NFR-1).
3. S-3 — menor risco.

## Instruções para o step-10
- S-2, critério 2: reescrever conforme a correção acima.
- S-2, plano de testes: incluir Windows.

## Para o checkpoint 12
Nada bloqueado a montante.
```

## Veto Conditions

As condições abaixo não se aplicam à nota de pulo. Reject and redo if ANY are true:
1. Check marcado como falho sem local e correção, ou veredito incoerente com os checks.
2. Story com NEEDS_REVISION sem instrução correspondente para o step-10.
3. Quarto ciclo de volta ao step-10 (o limite é 3; depois disso escala para o usuário).
4. Texto de story editado pela PO neste step.

## Quality Criteria

- [ ] Os 15 checks (10 AIOX + 5 específicos) avaliados em toda story
- [ ] Coesão verificada requisito a requisito
- [ ] Defeito a montante classificado como BLOCKED_UPSTREAM, não como revisão da story
- [ ] Ordem do backlog justificada por dependência, risco e valor
- [ ] Observações não bloqueantes separadas das falhas
- [ ] Atualização do quadro feita somente quando `office_board: true`
