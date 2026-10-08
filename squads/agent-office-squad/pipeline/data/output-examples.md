# Exemplos de Output — nível de qualidade esperado

Três exemplos completos, todos da mesma run fictícia: iniciativa **"Subagentes visíveis no escritório"** (`run_id` 2026-10-08-101500, track `iniciativa`, complexidade `STANDARD`). Use como referência de profundidade e formato, não como texto a copiar.

---

## Exemplo 1 — Story pronta (saída do step-10, validada no step-11)

## S-2 · Mostrar subagentes como estagiários ao lado da mesa do agente

- **Status:** Ready
- **Tipo:** feature · **Prioridade:** high · **Estimativa:** 3 pts
- **Tags:** subagentes, mundo
- **Pasta:** (raiz do repositório)
- **Ticket no quadro:** não registrado
- **Origem:** PRD FR-2, FR-3, NFR-1 · world-spec §2 · ARQ §3.2
- **Depende de:** S-1 (evento `agent:subagent`)

### Contexto
Quando um agente do escritório usa a ferramenta `Agent`/`Task`, o trabalho dos subagentes é invisível: `AgentManager.handle()` descarta mensagens com `parent_tool_use_id` e o mundo não mostra nada. O usuário não sabe que o agente "contratou ajuda" nem quanto ela custa em tempo. O Pixel Agents já mostra subagentes ligados ao agente pai [discovery §2.1].

### História
Como dev que acompanha vários agentes, quero ver os subagentes de cada agente como estagiários ao lado da mesa dele, para entender quem está trabalhando em quê sem abrir o log.

### Critérios de aceite
1. **Dado** um agente na mesa, **quando** chega `agent:subagent` com `phase: 'start'`, **então** um estagiário (avatar a 75% de escala, mesma paleta do pai) aparece em até 1 s numa casa livre adjacente à mesa e fica de pé com pose `type`.
2. **Dado** um estagiário visível, **quando** chega `phase: 'stop'` do mesmo `subagentId`, **então** ele some com a animação de saída (`vanish`) em até 1 s.
3. **Dado** 4 ou mais subagentes ativos do mesmo agente, **quando** o mundo renderiza, **então** aparecem no máximo 3 estagiários e uma etiqueta "+N" no crachá do agente pai.
4. **Dado** o agente pai indo à sua sala (permissão ou entrega), **quando** ele se levanta, **então** os estagiários continuam na mesa (não seguem o pai).
5. **Dado** 10 agentes com 3 estagiários cada no demo, **quando** a janela está em foco, **então** a taxa de quadros fica ≥ 55 fps e `renderer.info.render.calls` não cresce mais que 15% em relação a 10 agentes sem estagiários.

### Fora de escopo
- Teammates de Agent Teams na sala de reunião (story futura).
- Lista de subagentes no painel (S-3).

### Notas técnicas
- `game.ts`: novo mapa `interns: Map<agentId, Intern[]>`; atores de estagiário não entram em `desired()` (ficam presos à mesa) [ARQ §3.2].
- `world/avatar.ts`: aceitar `scale` no construtor; reaproveitar geometrias (sem alocação por frame).
- Casas candidatas: as 3 casas livres mais próximas de `DeskSlot.approach` usando `office.grid.walkable`.
- Invariantes a preservar: I-13 (nada de tokens), orçamento de frames (engineering-standards §8).
- Risco: mesas da última fileira têm menos casas livres → usar `OVERFLOW_TILES` como último recurso.

### Subtarefas por executor
- [ ] (world) Estagiário com escala 0,75 e paleta derivada de `lookFromSeed(parentSeed)`.
- [ ] (world) Posicionamento em casas adjacentes livres; limite de 3 + etiqueta "+N".
- [ ] (world) Entrada (surge com animação curta) e saída (`vanish`).
- [ ] (ui) Etiqueta "+N" no crachá do pai em `overlays.ts`, com `aria-label` "3 subagentes a mais".
- [ ] (test) Função pura `pickInternTiles(desk, grid, n)` com teste unitário (quando houver test runner) ou roteiro manual.

### Plano de testes
- Manual (demo isolado): `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa npm run demo` · PowerShell: `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-qa"; $env:AGENT_OFFICE_DEMO=1; npm run dev`; disparar eventos de subagente pelo `AGENT_OFFICE_EVAL`.
- Visual: capturas `AGENT_OFFICE_SHOTS="out/s2:3000,6000"` antes/depois.
- Plataformas: macOS sim · Windows sim.

### Definition of Done
- [ ] AC 1–5 com evidência · [ ] typecheck/build verdes · [ ] sem regressão de frames · [ ] Dev Agent Record · [ ] QA PASS/CONCERNS

---

## Exemplo 2 — Quality gate (saída do step-17)

# Quality Gate — Subagentes visíveis no escritório

**Veredito: CONCERNS** · Run `2026-10-08-101500` · Ciclo 1 de 3 · Branch `squad/2026-10-08-101500-subagentes-visiveis`

## Checagens automáticas
| Comando | Resultado | Observação |
|---|---|---|
| `npm run typecheck` | ✅ passou | 0 erros nos dois projetos |
| `npm run build` | ✅ passou | 41 s |
| `npm test` | — | não existe test runner no repositório |
| `npm run lint` | — | não existe lint no repositório |

## Rastreabilidade
| Story | AC | Evidência | Resultado |
|---|---|---|---|
| S-1 | 1–4 | roteiro manual + log do evento no console (`[renderer]`) | ✅ |
| S-2 | 1–4 | capturas `out/qa/s2-1.png`, `s2-2.png` | ✅ |
| S-2 | 5 | 58 fps com 10 agentes × 3 estagiários; calls +11% | ✅ |
| S-3 | 1–3 | navegação por teclado no painel (Tab/Enter/Esc) | ✅ |

## Invariantes tocados
I-07 (sessões do escritório ignoradas pela ponte) ✅ · I-13 ✅ · I-14 ✅ (descrição do subagente cortada em 80 caracteres no main).

## Plataformas
macOS (arm64) ✅ testado · Windows ⚠️ não testado nesta máquina — risco baixo (sem código específico de SO).

## Achados
| Id | Severidade | Executor | Achado | Correção proposta |
|---|---|---|---|---|
| QA-1 | médio | world | Com 18 agentes no demo, a etiqueta "+N" sobrepõe o crachá do vizinho da direita | deslocar a etiqueta para cima do crachá do pai e reduzir para 10 px |
| QA-2 | baixo | test | Lógica nova sem teste automatizado (sem test runner) | priorizar a story de infraestrutura de testes |

## Por que CONCERNS
Nenhum achado alto ou crítico; um médio com contorno, Windows declarado e ausência de testes automatizados enquanto não há runner.

---

## Exemplo 3 — Resumo da run (saída do step-24)

# Run 2026-10-08-101500 — Subagentes visíveis no escritório

**Resultado:** PR #12 aberto como draft para `main` com S-1, S-2 e S-3. QA CONCERNS (1 médio), segurança CONDITIONS (1 médio mitigado).

## Entregas
| Story | Status | Commits |
|---|---|---|
| S-1 Emitir eventos de subagentes a partir do SDK e dos hooks | InReview | 2 |
| S-2 Mostrar subagentes como estagiários ao lado da mesa | InReview | 2 |
| S-3 Listar subagentes ativos no painel | InReview | 1 |

## Gates e ciclos
- PO: READY no ciclo 2 (S-2 voltou por AC 5 sem métrica).
- QA: CONCERNS no ciclo 1 · Segurança: CONDITIONS (SEC-1: limitar descrição a 80 caracteres — aplicado).

## Orçamento
| Item | Previsto | Usado |
|---|---|---|
| Steps em subagente | 8 | 7 (step-14 pulado) |
| Ciclos de revisão | 3 | 1 (PO) |

## Desvios
- Eduardo Electron (step-14) não precisou rodar: o repasse do evento coube na subtarefa de integração, combinado na S-1.

## Aprendizados
- Hooks `SubagentStop` não trazem a descrição; o nome vem do `PreToolUse` da ferramenta `Agent`.
- Medir `renderer.info` antes/depois evitou discussão subjetiva de performance.

## Candidatos a memória (feedback explícito do usuário)
- "Prefiro PR como draft até eu testar no Windows." → Técnico (específico do squad)

## Próximas iniciativas
1. **Infraestrutura de testes, lint e CI** — destrava o gate (CONCERNS recorrente).
2. **Teammates do Agent Teams na sala de reunião** — continuação natural; paridade com o Pixel Agents.
3. **Windows de primeira classe** — Windows ficou sem teste nesta run.

## Benchmark
- Propor atualização: o roving-office ainda não mostra subagentes (roadmap "later"); o Pixel Agents já mostra.
