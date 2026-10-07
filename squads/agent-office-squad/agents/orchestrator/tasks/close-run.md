---
task: "Encerramento e retrospectiva da run"
order: 2
input: |
  - run_outputs: output/{run_id}/ — a maior vN de cada pasta de step (ou a nota de pulo)
  - run_plan: output/{run_id}/02-plan/vN/run-plan.md e output/{run_id}/03-plan-approval.md
  - checkpoints: respostas do usuário em 01, 03, 06, 12 e 21
  - git: branch squad/{run_id}-{run_slug} (git log --oneline)
  - memory: _memory/memories.md e _memory/runs.md
output: |
  - run_summary: output/24-close/run-summary.md — resultado, linha do tempo, entregas, vereditos, orçamento previsto × usado, desvios, aprendizados, candidatos a memória, próximas iniciativas e atualizações propostas ao benchmark
---

# Encerramento e retrospectiva da run

Fecha a run como um delivery lead fecha uma sprint: o que foi entregue e onde está, o que os gates disseram, quanto custou frente ao plano, o que aprendemos e o que vem a seguir. Esta é a última task do step-24: ela consolida tudo no arquivo do step, que alimenta a próxima triagem.

## Process

1. Abrir `output/{run_id}/` e, para cada step de 04 a 23, ler o arquivo da maior `vN` ou a nota de pulo. Montar a linha do tempo: status (executado, pulado, repetido), versão final e observação.
2. Levantar as entregas concretas: stories e status final (Draft → Done), branch `squad/{run_id}-{run_slug}`, commits (`git log --oneline main..HEAD` na branch), PR/tag/release do `22-publish`, documentos promovidos para `docs/` no `19-docs`, chaves `AO-n` se o quadro foi usado.
3. Consolidar os vereditos com o número de ciclos de cada loop: PO (por story), QA (PASS/CONCERNS/FAIL/WAIVED e achados abertos), segurança (CLEAR/CONDITIONS/BLOCK e condições que precisam ir no PR).
4. Comparar orçamento previsto × usado: subagentes executados contando repetições, ciclos de revisão por loop, teto em USD se existia. Explicar cada desvio em uma frase.
5. Listar desvios do plano: steps acrescentados ou pulados depois do step-03, mudanças de escopo aprovadas, bloqueios e quem decidiu.
6. Registrar aprendizados de processo com evidência (ex.: "a story S-2 voltou do PO por falta de plataforma no plano de testes"). Falar de processo, nunca de culpa.
7. Separar candidatos a memória: SOMENTE feedback explícito do usuário ("prefiro…", "não quero…", rejeição com motivo), com a seção do `memories.md` e a fonte. Não escrever no `memories.md` — o runner aplica as regras de deduplicação do opensquad.
8. Propor 3 próximas iniciativas, cada uma ligada a uma evidência (achado de gate, lacuna do benchmark, item do roadmap ou CONCERNS aberto), com track e complexidade sugeridos.
9. Propor atualizações ao `pipeline/data/benchmark-landscape.md` quando o discovery trouxe fatos novos (com fonte e data). Escrever o resumo consolidado no arquivo do step.

## Output Format

```markdown
# Encerramento — {run_slug} ({run_id})
## Resultado em uma frase
## Linha do tempo
| Step | Status | Versão final | Observação |
## Entregas
## Vereditos
| Gate | Veredito | Ciclos | Pendências |
## Orçamento
| Item | Previsto | Usado | Desvio |
## Desvios do plano
## Aprendizados
## Candidatos a memória (só feedback explícito)
| Seção do memories.md | Item | Fonte |
## Próximas iniciativas
| # | Iniciativa | Evidência | Track · Complexidade |
## Atualizações propostas ao benchmark
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# Encerramento — subagentes-visiveis (2026-10-08-101500)

## Resultado em uma frase
Subagentes agora aparecem como estagiários ao lado da mesa do agente e no painel; PR #12 aberto com QA CONCERNS e segurança CONDITIONS.

## Linha do tempo
| Step | Status | Versão final | Observação |
|---|---|---|---|
| 04–09 | executados | v1 | — |
| 10 Stories | repetido | v2 | voltou do PO: S-2 sem plataforma no plano de testes |
| 13–16 | executados | v2 | 13 e 15 refeitos após FAIL do QA |
| 17 QA | repetido | v2 | v1 FAIL (AC-3 da S-2 sem evidência); v2 CONCERNS |
| 18–23 | executados | v1 | — |

## Entregas
- S-1, S-2 e S-3 em InReview; branch `squad/2026-10-08-101500-subagentes-visiveis`, 7 commits.
- PR #12 aberto por Diego Deploy após aprovação no checkpoint 21. ADR-0003 promovido para `docs/adr/`.

## Vereditos
| Gate | Veredito | Ciclos | Pendências |
|---|---|---|---|
| PO | READY (3/3) | 2 | — |
| QA | CONCERNS | 2 | Windows não testado; `mapSubagentEvent` sem teste automatizado (não há test runner) |
| Segurança | CONDITIONS | 1 | limitar `description` vinda de hook a 140 caracteres (registrado no PR) |

## Orçamento
| Item | Previsto | Usado | Desvio |
|---|---|---|---|
| Subagentes | 8 | 11 | +3: loop do QA refez 13, 15 e 17 |
| Ciclos de revisão | 3 | 2 (PO) · 2 (QA) | dentro do limite |

## Desvios do plano
- O usuário incluiu subagentes das sessões do terminal no checkpoint 03 (estava como pergunta aberta).

## Aprendizados
- Stories com subtarefa `world` precisam de captura `AGENT_OFFICE_SHOTS` no plano de testes desde o rascunho.

## Candidatos a memória (só feedback explícito)
| Seção do memories.md | Item | Fonte |
|---|---|---|
| Técnico (específico do squad) | "Subagentes nunca ocupam mesas; ficam em pé ao lado do agente pai." | checkpoint 06 |

## Próximas iniciativas
| # | Iniciativa | Evidência | Track · Complexidade |
|---|---|---|---|
| 1 | Configurar test runner (Vitest) e primeiros testes do main | CONCERNS recorrente do QA | entrega · STANDARD |
| 2 | Validar hooks de subagente no Windows | plataforma não testada | bugfix · SIMPLE |
| 3 | Visualizar Agent Teams (teammates) na sala de reunião | roadmap do Pixel Agents e discovery §3 | iniciativa · COMPLEX |

## Atualizações propostas ao benchmark
- Pixel Agents: confirmar no README atual se subagentes e Agent Teams continuam como personagens separados (acesso em 2026-10-08).
```

## Quality Criteria

- [ ] Todo step de 04 a 23 aparece na linha do tempo com status e versão final.
- [ ] Vereditos de todos os gates que rodaram, com ciclos e pendências.
- [ ] Orçamento previsto × usado com desvio explicado.
- [ ] Candidatos a memória citam a fonte (checkpoint ou fala do usuário).
- [ ] Três próximas iniciativas, cada uma com evidência, track e complexidade.

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Candidato a memória sem fonte explícita do usuário (inferência do orquestrador).
2. Veredito FAIL ou BLOCK omitido ou suavizado no resumo.
3. Entrega declarada (PR, tag, commit) sem referência verificável no `22-publish` ou no git.
4. Ausência de próximas iniciativas ou de comparação de orçamento.
