---
execution: inline
agent: orchestrator
tasks:
  - close-run
outputFile: squads/agent-office-squad/output/24-close/run-summary.md
---

# Step 24: Encerramento e retrospectiva — 🎼 Otávio Orquestra

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2); conte as versões `vN/` de cada pasta para saber quantas vezes o step rodou.

- `_opensquad/_memory/company.md` — objetivos do produto para avaliar o resultado
- `squads/agent-office-squad/_memory/memories.md` — para não propor memória duplicada
- `squads/agent-office-squad/_memory/runs.md` — histórico (somente leitura; quem grava é o runner)
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — orçamento (§9) e protocolo de pulo
- `output/{run_id}/01-intake.md`, `03-plan-approval.md`, `06-prd-approval.md`, `12-story-selection.md`, `21-publish-approval.md` — decisões e falas do usuário nos checkpoints
- `output/{run_id}/02-plan/vN/run-plan.md` — track, complexidade e orçamento previsto
- Outputs de agente da run, todas as versões: `04-discovery/`, `05-prd/`, `07-ux/`, `08-world/`, `09-architecture/`, `10-stories/`, `11-validation/`, `13-integration/`, `14-platform/`, `15-world/`, `16-ui/`, `17-qa/`, `18-security/`, `19-docs/`, `20-release/`, `22-publish/`, `23-launch/`
- `squads/agent-office-squad/pipeline/data/benchmark-landscape.md` — para propor atualizações vindas do discovery
- `squads/agent-office-squad/pipeline/data/quality-criteria.md` — para avaliar os vereditos

## Instructions

### Gate do track

Este step **sempre roda**, em todos os tracks, inclusive em runs canceladas ou abortadas no meio: nesse caso, resuma até onde a run chegou e por quê parou.

### Process

1. **Inventarie a run**: cada step com status (executado, pulado com motivo, falhou, não alcançado), número de versões `vN/` e caminho do output principal.
2. **Liste o que foi entregue**: stories e status final (InReview, Done), commits, PR, tag ou release, documentos promovidos para `docs/`, kit de lançamento.
3. **Consolide vereditos e ciclos**: PO, QA e segurança com o veredito final de cada um e quantos ciclos cada loop consumiu (máximo 3).
4. **Compare orçamento previsto × usado**: steps de subagente executados, ciclos de revisão, buscas na web, custo em USD se o usuário informou ou se o Agent Office mostrou (senão, "não medido").
5. **Registre desvios**: steps adicionados ou pulados fora do plano, decisões que contrariaram a arquitetura ou o spec, CONCERNS e CONDITIONS ainda abertos, plataformas não verificadas.
6. **Extraia aprendizados** de processo (o que acelerou, o que travou, onde houve retrabalho) e técnicos (bugs, limites de API, diferenças de plataforma) — com evidência.
7. **Proponha candidatos a memória** apenas a partir de feedback explícito do usuário nos checkpoints, citando a fala; classifique na seção certa de `memories.md`. Nunca grave `memories.md` ou `runs.md`: o runner faz isso depois; proponha também a linha de `runs.md`.
8. **Sugira as 3 próximas iniciativas** com track e complexidade, priorizadas por valor e risco, e as atualizações propostas ao benchmark.

## Output Format

The output MUST follow this exact structure:

````markdown
# Encerramento da Run — {run_slug} (step-24)

- **Run:** {run_id} · **Track:** {…} · **Complexidade:** {…}
- **Resultado:** {Aprovado | Publicado | Rejeitado | Abortado} — {uma linha}

## Inventário de steps
| Step | Status | Versões | Output |
|---|---|---|---|

## Entregas
- {…}

## Vereditos e ciclos
| Gate | Veredito final | Ciclos |
|---|---|---|

## Orçamento
| Item | Previsto | Usado |
|---|---|---|

## Desvios e itens abertos
- {…}

## Aprendizados
- **Processo:** {…}
- **Técnicos:** {…}

## Candidatos a memória (só feedback explícito)
| Seção de memories.md | Item | Fala do usuário |
|---|---|---|

## Linha proposta para runs.md
| Data | Run ID | Tema | Output | Resultado |
|---|---|---|---|---|

## Próximas iniciativas
1. {título} — track {…} · {complexidade} — {por quê}

## Atualizações propostas ao benchmark
- {… | nenhuma}
````

## Output Example

````markdown
# Encerramento da Run — subagentes-visiveis (step-24)

- **Run:** 2026-10-08-101500 · **Track:** iniciativa · **Complexidade:** STANDARD
- **Resultado:** Publicado — PR #12 aberto com S-1, S-2 e S-3; duas condições abertas.

## Inventário de steps
| Step | Status | Versões | Output |
|---|---|---|---|
| 04 Discovery | executado | 1 | 04-discovery/v1/discovery-brief.md |
| 07 UX | executado | 1 | 07-ux/v1/ux-spec.md |
| 11 Validação PO | executado | 2 | 11-validation/v2/po-validation.md |
| 13–16 Implementação | executados | 1 cada | 13-integration … 16-ui |
| 17 QA | executado | 1 | 17-qa/v1/qa-gate.md |
| 23 Lançamento | executado | 1 | 23-launch/v1/launch-kit.md |

## Entregas
- 5 commits na branch `squad/2026-10-08-101500-subagentes-visiveis`; PR #12 para main.
- `docs/adr/0007-subagentes-por-tool-use.md` e `docs/prd/subagentes-visiveis.md`; CHANGELOG criado.

## Vereditos e ciclos
| Gate | Veredito final | Ciclos |
|---|---|---|
| PO | READY | 2 (S-2 voltou por critério sem limite de "+N") |
| QA | CONCERNS | 1 |
| Segurança | CONDITIONS | 1 |

## Orçamento
| Item | Previsto | Usado |
|---|---|---|
| Steps de subagente | 8 | 8 |
| Ciclos de revisão | 3 | 1 (PO) |
| Custo | não informado | não medido |

## Desvios e itens abertos
- Estagiários sem caminhada (desvio do world-spec, justificado por fila no corredor).
- Abertos: SEC-1, QA-1 e verificação no macOS.

## Aprendizados
- **Processo:** o critério de aceite com número máximo de estagiários evitou retrabalho no mundo; vale exigir limites numéricos em toda story visual.
- **Técnicos:** sessões antigas do Claude Code não emitem `SubagentStop`; o expirar por inatividade cobre o caso.

## Candidatos a memória (só feedback explícito)
| Seção de memories.md | Item | Fala do usuário |
|---|---|---|
| Design Visual | Estagiários menores que os agentes, nunca do mesmo tamanho | "deixa os estagiários menores, senão parece contratação" (checkpoint 06) |

## Linha proposta para runs.md
| Data | Run ID | Tema | Output | Resultado |
|---|---|---|---|---|
| 2026-10-08 | 2026-10-08-101500 | Subagentes visíveis no escritório | PR #12, 3 stories | Publicado |

## Próximas iniciativas
1. Corrigir SEC-1 e QA-1 — track bugfix · SIMPLE — fecha as condições do PR #12.
2. Infraestrutura de testes (Vitest) e CI no GitHub Actions — track entrega · STANDARD — tira o CONCERNS crônico de "sem teste automatizado".
3. Visualizar Agent Teams (teammates) — track iniciativa · COMPLEX — próximo passo natural depois dos subagentes.

## Atualizações propostas ao benchmark
- Pixel Agents já mostra subagentes como personagens ligados ao pai: registrar que a paridade foi alcançada e o diferencial segue sendo a governança.
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Step da run ausente do inventário, ou status sem evidência (caminho do output ou motivo do pulo).
2. Candidato a memória sem fala explícita do usuário, ou escrita direta em `memories.md`/`runs.md`.
3. Vereditos ou entregas que não batem com os outputs da run (ex.: "publicado" sem PR no relatório do step-22).
4. Próximas iniciativas sem track, complexidade e justificativa.

## Quality Criteria

- [ ] Orçamento previsto × usado preenchido, com "não medido" quando faltar dado
- [ ] Ciclos de revisão contados pelas versões `vN/`
- [ ] Desvios citam a fonte (spec, arquitetura ou plano)
- [ ] Aprendizados separados entre processo e técnicos, com evidência
- [ ] Linha de `runs.md` no formato da tabela existente
- [ ] Próximas iniciativas priorizadas por valor e risco
