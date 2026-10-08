---
task: "Emitir o veredito do quality gate"
order: 2
input: |
  - checks_bundle: saída da task run-quality-checks (checks, traceability, manual_log, invariants, platform_matrix, raw_findings)
  - previous_gates: versões anteriores de output/{run_id}/17-qa/vN/qa-gate.md (contagem de ciclos)
  - quality_criteria: squads/agent-office-squad/pipeline/data/quality-criteria.md (regras do gate)
  - run_plan: office_board e chaves AO das stories
output: |
  - qa_gate: relatório consolidado do step-17 (vira output/17-qa/qa-gate.md)
  - fix_list: correções must-fix por executor para o loop do step-13
  - qa_results: seção QA Results por story
  - board_comments: comentários de veredito nos tickets AO (se office_board)
---

# Emitir o veredito do quality gate

Transforma a evidência coletada em achados classificados, aplica as regras do gate sem exceção e escreve o `qa-gate.md` que o runner usa para seguir ou voltar ao step-13.

## Process

1. **Classificar achados.** Para cada achado bruto, atribua id `QA-n`, severidade (crítico: perda de dados, execução sem consentimento; alto: quebra de invariante ou bug que impede fluxo principal; médio: degrada fluxo com contorno; baixo: cosmético/melhoria), story, executor e correção proposta. Marque must-fix (crítico, alto, AC sem evidência, invariante quebrado) ou melhoria.
2. **Aplicar a regra do gate.** FAIL se typecheck/build/teste falhou, se algum AC no escopo está ❌ ou ⚠️, se há achado crítico/alto ou invariante quebrado. CONCERNS se só há médios/baixos, plataforma declarada como não verificada, ou lógica nova sem teste automatizado enquanto o repo não tiver test runner. PASS se tudo evidenciado e nada acima de baixo.
3. **Contar ciclos.** Conte as versões `vN` anteriores do qa-gate nesta run. Se este é o ciclo 3 e o veredito é FAIL, inclua a seção "Escalonamento" pedindo decisão do usuário; WAIVED nunca é escrito pela Tânia, só registrado pelo runner se o usuário dispensar.
4. **Lista de correções.** Agrupe os must-fix por executor (`integration`, `platform`, `world`, `ui`), cada item com story, arquivo:linha e critério de pronto. Melhorias vão para uma seção separada e não entram no loop.
5. **QA Results por story.** Veredito por story, critérios com evidência, riscos residuais e o que ficou não verificado.
6. **Quadro.** Se `office_board` e as ferramentas `mcp__office__*` existirem, `ticket_comment` em cada ticket com o veredito, os achados da story e o caminho do relatório. Nunca `ticket_update` para `done`; PASS deixa o ticket em `review` para uma pessoa fechar.
7. **Revisar o próprio gate.** Todo achado tem evidência e correção; o veredito bate com a regra; a matriz de plataformas está presente; nenhuma melhoria virou must-fix.

## Output Format

````markdown
# Step 17 — Quality gate

**Veredito:** PASS | CONCERNS | FAIL · **Ciclo:** {n}/3 · **Run:** {run_id} · **Branch:** {branch}

## Resumo
{2–4 linhas: o que foi testado, onde, e por que o veredito}

## Checagens automáticas
| Comando | Exit | Observação |

## Rastreabilidade
| Story | Critério | Evidência | Status |

## Achados
| Id | Severidade | Story | Executor | Onde | Problema | Correção | Must-fix |

## Correções para o loop (por executor)
### integration · platform · world · ui

## Melhorias (fora do loop)

## Invariantes verificados
## Matriz de plataformas
## QA Results por story
## Escalonamento (só no ciclo 3 com FAIL)
````

## Output Example

> Use como referência de qualidade, não como template rígido.

````markdown
# Step 17 — Quality gate

**Veredito:** FAIL · **Ciclo:** 1/3 · **Run:** 2026-10-08-101500 · **Branch:** squad/2026-10-08-101500-subagentes-visiveis

## Resumo
Typecheck e build verdes; S-1 e S-3 com todos os critérios evidenciados. S-2 falha no critério 3: ao demitir um agente, os estagiários dele ficam órfãos no escritório (achado alto). Verificado no Windows 11 em instância isolada; macOS só por leitura de código.

## Checagens automáticas
| Comando | Exit | Observação |
|---|---|---|
| `npm run typecheck` | 0 | 19 s |
| `npm run build` | 0 | 13 s |
| `npm test` | — | não existe test runner no repositório |

## Rastreabilidade
| Story | Critério | Evidência | Status |
|---|---|---|---|
| S-1 | 1 | demo isolado: evento `agent:subagent` no console | ✅ |
| S-1 | 2 | `bridge.ts:dispatch()` trata `PreToolUse` de `Task` | ✅ |
| S-2 | 1 | `out/qa-1.png` | ✅ |
| S-2 | 3 | estagiários permanecem após demitir o pai (`out/qa-3.png`) | ❌ |
| S-3 | 1–2 | `out/qa-2.png` + navegação por Tab | ✅ |

## Achados
| Id | Severidade | Story | Executor | Onde | Problema | Correção | Must-fix |
|---|---|---|---|---|---|---|---|
| QA-1 | alto | S-2 | world | `game.ts:leave()` | estagiários ficam órfãos quando o pai sai | remover atores filhos em `leave()` e em `agent:removed` | sim |
| QA-2 | médio | S-2 | world | `world/overlays.ts` | com 18 agentes, "+N" sobrepõe o crachá | deslocar a etiqueta 0,3 acima e esconder em zoom < 0,85 | não |
| QA-3 | médio | S-1 | integration | `agents.ts:handle()` | mapeamento novo sem teste automatizado | coberto pela story de infraestrutura de testes | não |

## Correções para o loop (por executor)
### world
- [ ] QA-1 (S-2): em `game.ts`, ao remover o ator pai (`leave()` e evento `agent:removed`), remover e descartar os estagiários. Pronto quando: demitir a Grace com 2 subagentes não deixa ninguém ao lado da mesa (captura).

## Melhorias (fora do loop)
- QA-2 e QA-3. Recomendo a story "Adicionar Vitest e primeiros testes do main" (exige ADR do Artur Arquitetura).

## Invariantes verificados
I-03 ok (401 sem token, 403 com Origin) · I-06 ok (0 `innerHTML` no diff) · I-13 ok.

## Matriz de plataformas
Executado: Windows 11 (win32). Não verificado em execução: macOS (darwin) — ramos `process.platform` revisados, sem mudança.

## QA Results por story
- **S-1:** PASS — critérios 1–2 evidenciados; risco residual: sem teste automatizado do mapeamento.
- **S-2:** FAIL — critério 3 falhou (QA-1); QA-2 como melhoria.
- **S-3:** PASS — acessível por teclado, contador anunciado em `aria-live`.
````

## Quality Criteria

- [ ] Todo achado tem id, severidade, executor, onde, correção e marcação de must-fix.
- [ ] O veredito segue a regra do gate e não contradiz a tabela de achados.
- [ ] A lista do loop contém só must-fix, agrupada por executor, com critério de pronto.
- [ ] QA Results presente para cada story selecionada.

## Veto Conditions

Rejeite e refaça se QUALQUER uma for verdadeira:
1. Veredito PASS ou CONCERNS com AC ❌/⚠️, achado crítico/alto ou checagem falhando.
2. O relatório contém WAIVED escrito pela própria Tânia.
3. Algum ticket foi movido para `done`.
4. Falta a matriz de plataformas ou a contagem de ciclos.
