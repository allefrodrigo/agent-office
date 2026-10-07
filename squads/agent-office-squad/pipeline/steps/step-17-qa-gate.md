---
execution: subagent
agent: qa-engineer
model_tier: powerful
tasks:
  - run-quality-checks
  - issue-gate-verdict
outputFile: squads/agent-office-squad/output/17-qa/qa-gate.md
on_reject: step-13
---

# Step 17: Quality gate (QA) — ✅ Tânia Teste

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2).

- `_opensquad/_memory/company.md` — restrições do produto (segurança, cross-platform, pt-BR)
- `squads/agent-office-squad/_memory/memories.md` — proibições e preferências registradas
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — instância isolada, capturas e comandos (§8), quadro (§7)
- `output/{run_id}/02-plan/vN/run-plan.md` e `output/{run_id}/03-plan-approval.md` — track, complexidade, superfícies, base do diff
- `output/{run_id}/12-story-selection.md`, `output/{run_id}/10-stories/vN/stories.md` e `output/{run_id}/11-validation/vN/po-validation.md` — escopo, critérios de aceite e ressalvas
- `output/{run_id}/13-integration/vN/impl-report.md`, `14-platform/vN/impl-report.md`, `15-world/vN/impl-report.md`, `16-ui/vN/impl-report.md` — Dev Agent Records (ou notas de pulo)
- `output/{run_id}/07-ux/vN/ux-spec.md`, `08-world/vN/world-spec.md`, `09-architecture/vN/architecture.md` — referências de comportamento (se existirem)
- Só em re-execução: `output/{run_id}/17-qa/vN/qa-gate.md` anterior (itens FIX-n a reverificar)
- `squads/agent-office-squad/pipeline/data/quality-criteria.md` — severidades e regras do gate
- `squads/agent-office-squad/pipeline/data/engineering-standards.md` — comandos, DoD e estado dos testes (hoje sem test runner, lint ou CI)
- `squads/agent-office-squad/pipeline/data/architecture-map.md` — invariantes I-01…I-14 e mapa arquivo → invariante
- Código: `git diff --stat main...HEAD`, `git diff main...HEAD`, `git log --oneline main..HEAD` (base `main`, salvo outra no run-plan) e `package.json` (scripts disponíveis)

## Instructions

### Gate do track

Aplique o protocolo de pulo (run-conventions §3). Track `discovery`: pule. `iniciativa`, `entrega` e `bugfix`: roda sobre as stories selecionadas. `release`: roda como regressão do release candidate — sem stories, o escopo é o roteiro de fumaça do quality-criteria sobre o HEAD a ser publicado.

### Process

1. **Defina o modo.** Primeira execução ou ciclo n/3 de re-execução: reverifique primeiro cada FIX-n do gate anterior e diga se foi resolvido.
2. **Monte o escopo**: stories selecionadas, critérios de aceite, Dev Agent Records, arquivos do diff e commits da branch. Commit sem story correspondente é achado.
3. **Rode as checagens automáticas** e registre as últimas linhas de cada saída: `npm run typecheck`, `npm run build`, e `npm test` / `npm run lint` se existirem em `package.json`. Não reinstale dependências sem necessidade.
4. **Rastreie cada critério de aceite** até uma evidência: teste automatizado, captura ou passo manual que você reproduziu. Critério sem evidência é achado alto.
5. **Verifique em instância isolada** (`AGENT_OFFICE_DATA_DIR` temporário, modo demo), nunca com os dados reais do usuário. Escala com `__state.apply({ type: 'agent:upsert', … })` via `AGENT_OFFICE_EVAL` (sem tokens, I-13); capturas com `AGENT_OFFICE_SHOTS="out/qa-{run_id}:4000,9000"`; percurso só com teclado nas telas novas.
6. **Cheque regressões.** Para cada arquivo do diff, confira os invariantes associados no architecture-map; rode a fumaça sem tokens: cartão de permissão e entrega de resultado do demo, quadro (criar, mover, comentar ticket), painel, lounge.
7. **Monte a matriz de plataformas**: onde cada checagem rodou; a outra plataforma fica "não verificada", com revisão dos ramos de `process.platform` do diff.
8. **Classifique e decida** com as regras do quality-criteria: FAIL se typecheck/build/teste falha, critério do escopo sem evidência, achado crítico ou alto, ou invariante quebrado; CONCERNS se só médio/baixo, plataforma não verificada declarada, ou lógica nova sem teste automatizado enquanto não houver test runner; PASS se tudo evidenciado e nada acima de baixo. WAIVED só é registrado pelo runner quando o usuário dispensa no 3º ciclo.
9. **Escreva a lista de correções** por executor (FIX-n: story, arquivo, correção esperada, como reverificar), os QA Results por story e, com `office_board` ativo, comente o veredito nos tickets (§7) — sem mover para `done`.

## Output Format

The output MUST follow this exact structure:

````markdown
# Quality Gate — {run_slug} (step-17)

- **Veredito:** {PASS | CONCERNS | FAIL}
- **Ciclo:** {n}/3 · **Base:** {main…HEAD} · **HEAD:** `{hash}`
- **Escopo:** {stories | roteiro de regressão do release}

## Checagens automáticas
| Comando | Resultado | Evidência |
|---|---|---|

## Rastreabilidade
| Story | Critério | Evidência | Status |
|---|---|---|---|

## Verificação manual e visual
- {passo reproduzido — resultado — captura}

## Invariantes e regressões
| Invariante / fluxo | Como verifiquei | Resultado |
|---|---|---|

## Matriz de plataformas
| Plataforma | O que rodou | Status |
|---|---|---|

## Achados
| Id | Severidade | Story | Executor | Descrição | Evidência |
|---|---|---|---|---|---|

## Correções exigidas (vão para o step-13 se FAIL)
- **FIX-n** ({executor}, S-n) `{arquivo}` — {correção esperada} · Reverificar: {como}

## QA Results por story
- **S-n:** {PASS | CONCERNS | FAIL} — {uma linha}

## Justificativa do veredito
{regra aplicada do quality-criteria e por quê}
````

## Output Example

````markdown
# Quality Gate — subagentes-visiveis (step-17)

- **Veredito:** CONCERNS
- **Ciclo:** 1/3 · **Base:** main…HEAD · **HEAD:** `c93e4aa`
- **Escopo:** S-1, S-2, S-3

## Checagens automáticas
| Comando | Resultado | Evidência |
|---|---|---|
| `npm run typecheck` | verde | 0 erros nos dois tsconfig |
| `npm run build` | verde | out/main, out/preload e out/renderer gerados |
| `npm test` / `npm run lint` | não existem | dívida registrada no engineering-standards |

## Rastreabilidade
| Story | Critério | Evidência | Status |
|---|---|---|---|
| S-1 | 1. subagente iniciado gera evento | console do DevTools com `agent:subagent` start | ok |
| S-1 | 2. fim do subagente encerra | evento end após o tool_result | ok |
| S-2 | 1. até 3 estagiários + "+N" | `out/qa-2026-10-08-101500-2.png` | ok com ressalva |
| S-3 | 1. lista no painel, operável por teclado | percurso Tab/Enter/Esc reproduzido | ok |

## Verificação manual e visual
- Demo isolado com 18 agentes simulados: estagiários aparecem e somem sem vazar geometria (memory.geometries estável em 97).

## Invariantes e regressões
| Invariante / fluxo | Como verifiquei | Resultado |
|---|---|---|
| I-07 sessões do escritório ignoradas pela ponte | leitura do diff de `bridge.ts` | preservado |
| I-13 nada gasta tokens | escala só com `__state.apply` | preservado |
| Cartão de permissão e entrega do demo | fluxo do demo aos 3 s e 6 s | sem regressão |

## Matriz de plataformas
| Plataforma | O que rodou | Status |
|---|---|---|
| Windows 11 x64 | checagens, demo, capturas | verificado |
| macOS arm64 | revisão dos ramos `darwin` do diff | não verificado |

## Achados
| Id | Severidade | Story | Executor | Descrição | Evidência |
|---|---|---|---|---|---|
| QA-1 | médio | S-2 | world | com 18 agentes no demo, a etiqueta "+N" sobrepõe o crachá na fileira de trás | `out/qa-2026-10-08-101500-2.png` |
| QA-2 | baixo | S-1 | integration | `subagentFromToolUse()` sem teste automatizado (não há test runner) | Dev Agent Record S-1 |

## Correções exigidas (vão para o step-13 se FAIL)
- Nenhuma obrigatória neste ciclo. Recomendado: **FIX-1** (world, S-2) `layout.ts` — deslocar a etiqueta "+N" 0,3 tile para a frente · Reverificar: captura com 18 agentes.

## QA Results por story
- **S-1:** CONCERNS — sem teste automatizado da função pura.
- **S-2:** CONCERNS — sobreposição da etiqueta com 18 agentes.
- **S-3:** PASS.

## Justificativa do veredito
Checagens verdes, todos os critérios com evidência e nenhum achado acima de médio; macOS não verificado e lógica nova sem teste automatizado → CONCERNS pela regra do quality-criteria.
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Veredito que contradiz as regras do quality-criteria (ex.: PASS com critério sem evidência, CONCERNS com typecheck vermelho).
2. Critério de aceite do escopo ausente da matriz de rastreabilidade.
3. Verificação manual feita com os dados reais do usuário ou contratando agentes reais (sem `AGENT_OFFICE_DATA_DIR`, gasto de tokens).
4. FAIL sem lista FIX-n por executor, arquivo e forma de reverificar.
5. Alteração em critérios de aceite, subtarefas, Dev Agent Record ou código; ticket movido para `done`.

## Quality Criteria

- [ ] Saída real (últimas linhas) de cada comando registrada
- [ ] Em re-execução, cada FIX-n anterior reverificado com resultado
- [ ] Severidade de cada achado justificada por probabilidade × impacto
- [ ] Must-fix separado de recomendação
- [ ] Capturas citadas pelo caminho em `out/`
- [ ] Plataforma não verificada declarada, nunca presumida
- [ ] QA Results com uma linha por story
