# Framework Operacional do Squad — do intake ao lançamento

Metodologia completa que o pipeline executa. Une o ciclo do AIOX (planejamento → Story Development Cycle → entrega) com as regras do opensquad (checkpoints, vetos, loops de revisão) e as particularidades do Agent Office (quatro camadas de código, macOS + Windows, invariantes de segurança).

## 1. Ciclo em 6 fases

| Fase | Steps | Pergunta que responde | Artefato |
|---|---|---|---|
| 0. Roteamento | 01–03 | O que vamos fazer, em que track, com que custo? | intake, run-plan aprovado |
| 1. Descoberta | 04–06 | Vale a pena? Qual problema, para quem, como medir? | discovery-brief, PRD aprovado |
| 2. Especificação | 07–09 | Como funciona para o usuário, no mundo e no código? | ux-spec, world-spec, architecture (ADR + ameaças) |
| 3. Preparação | 10–12 | O que exatamente vai ser construído agora? | stories validadas e selecionadas |
| 4. Construção e verificação | 13–18 | Está feito, funciona e é seguro? | relatórios de implementação, qa-gate, security-gate |
| 5. Entrega e aprendizado | 19–24 | Está documentado, publicado, divulgado e aprendemos algo? | docs, PR/release, kit de lançamento, run-summary |

## 2. Tracks

| Track | Quando usar | Exemplo |
|---|---|---|
| `iniciativa` | feature ou épico novo, ainda sem PRD | "Subagentes visíveis no escritório" |
| `entrega` | story ou ticket já definido (ex.: `AO-12`), escopo claro | "Badge de pendências no Windows" |
| `bugfix` | defeito com reprodução | "Cartão de permissão do terminal fica preso após Esc" |
| `release` | publicar uma versão | "v0.3.0" |
| `discovery` | pergunta estratégica sem código | "Vale integrar squads do opensquad/AIOX?" |

### Matriz padrão de steps por track

`run` executa · `skip` pula com nota · `cond` executa se a condição valer (registrada no run-plan).

| Step | iniciativa | entrega | bugfix | release | discovery |
|---|---|---|---|---|---|
| 04 Discovery | run | skip | skip | skip | run |
| 05 PRD | run | skip | skip | skip | run (memo de recomendação) |
| 06 ✋ PRD | run | skip | skip | skip | run |
| 07 UX | cond: interface 2D muda | cond: interface 2D muda e ≥ STANDARD | skip | skip | skip |
| 08 Mundo | cond: mundo 3D muda | cond: mundo 3D muda e ≥ STANDARD | skip | skip | skip |
| 09 Arquitetura | run | cond: ≥ STANDARD | cond: COMPLEX | skip | skip |
| 10 Stories | run | run | run | skip | skip |
| 11 PO | run | run | run | skip | skip |
| 12 ✋ Seleção | run | run | run | skip | skip |
| 13 Integração | cond: há subtarefa `integration` | cond | cond | skip | skip |
| 14 Plataforma | cond: há subtarefa `platform` | cond | cond | skip | skip |
| 15 Mundo 3D | cond: há subtarefa `world` | cond | cond | skip | skip |
| 16 Interface | cond: há subtarefa `ui` | cond | cond | skip | skip |
| 17 QA | run | run | run | run (regressão do release candidate) | skip |
| 18 Segurança | cond: superfície sensível | cond | cond | run (dependências, build, assinatura) | skip |
| 19 Docs | run | cond: muda algo visível | cond: muda algo visível | run (notas de versão) | skip |
| 20 Preparação | run | run | run | run | skip |
| 21 ✋ Publicação | run | run | run | run | skip |
| 22 Publicação | run | run | run | run | skip |
| 23 Lançamento | cond: relevante para usuários | skip | skip | run | skip |
| 24 Retro | run | run | run | run | run |

Otávio Orquestra pode desviar da matriz com justificativa no run-plan; o usuário aprova no step-03.

## 3. Complexidade (fase Assess do spec-pipeline do AIOX)

| Classe | Sinais | Efeito |
|---|---|---|
| `SIMPLE` | 1 story ≤ 3 pts, padrão existente, uma camada, sem superfície sensível | pula UX/mundo/arquitetura no track `entrega`; QA focado |
| `STANDARD` | 2–5 stories, duas ou mais camadas, alguma pesquisa ou contrato novo | specs condicionais rodam; arquitetura obrigatória |
| `COMPLEX` | épico, superfície nova (ex.: provedor, worktree, quadro online), migração de dados, dependência nova, várias iterações | arquitetura com ADR obrigatório; recomenda dividir em várias runs; segurança roda mesmo sem superfície sensível óbvia |

## 4. Superfícies e executores

| Executor | Camada | Arquivos típicos |
|---|---|---|
| `integration` — Henrique Hook | Claude Code / Agent SDK / hooks / MCP do quadro | `src/main/agents.ts`, `bridge.ts`, `tickets.ts`, `delegate.ts`, `sessions.ts`, `usage.ts`, `peers.ts`, `attachments.ts`, `src/shared/tickets.ts` |
| `platform` — Eduardo Electron | Electron main, IPC/preload, SO, persistência, empacotamento | `src/main/index.ts`, `src/preload/*`, `store.ts`, `system.ts`, `session-process.ts`, `claude-path.ts`, `env.ts`, `electron-builder.yml`, `package.json` |
| `world` — Vitor Voxel | three.js e comportamento | `src/renderer/src/world/*`, `game.ts` |
| `ui` — Fernanda Front | DOM, estado do renderer, CSS | `src/renderer/src/ui/*`, `state.ts`, `main.ts`, `styles.css`, `index.html` |

Ordem de implementação 13 → 14 → 15 → 16: contratos e eventos nascem no main e o renderer os consome. Mudanças em `src/shared/types.ts` são feitas por quem implementa a subtarefa que precisa delas, conforme a assinatura definida na arquitetura.

## 5. Gates e loops

| Gate | Step | Regra resumida | Loop |
|---|---|---|---|
| Plano | 03 ✋ | usuário aprova track/complexidade/steps/orçamento | refazer → step-02 |
| Escopo (Gate 1 AIOX) | 06 ✋ | usuário aprova PRD e fatia | refazer → step-05 |
| Story Ready | 11 | 10 checks + específicos | NEEDS_REVISION → step-10 |
| Seleção | 12 ✋ | só stories READY entram | BLOCKED_UPSTREAM → step-05 ou 09 (decisão do usuário) |
| Qualidade | 17 | PASS/CONCERNS seguem; FAIL volta | FAIL → step-13 |
| Segurança | 18 | CLEAR/CONDITIONS seguem; BLOCK volta | BLOCK → step-13 |
| Publicação | 21 ✋ | usuário aprova ações exatas | — |

Máximo de 3 ciclos por loop; no limite, o runner pergunta ao usuário (inclusive se quer dispensar o gate — registrado como WAIVED pelo runner).

## 6. Rastreabilidade (No Invention)

```
intake ──► discovery (fontes) ──► PRD (FR-n / NFR-n / CON-n)
                                      │
            ux-spec / world-spec ◄────┤ (cada decisão cita FR/NFR)
                                      │
            architecture (ADR-n) ◄────┤ (cada mudança cita FR/NFR/CON)
                                      ▼
                         stories S-n (Origem: FR-n, ADR-n, §)
                                      ▼
              commits "(S-n, camada)" ──► Dev Agent Record ──► QA (AC → evidência)
```

Se um agente precisa de algo que não tem fonte, ele **pergunta** (registra em "Perguntas abertas") em vez de inventar.

## 7. Decisões recorrentes

- **Dividir ou não uma story**: > 5 pts, mais de 6 critérios de aceite ou mais de duas dependências → dividir.
- **ADR obrigatório**: dependência nova, framework novo, mudança de invariante, formato de arquivo persistido, novo canal de entrada externa (rede, arquivo de outro programa), novo provedor de agente.
- **Precisa de UX/mundo?**: muda o que o usuário vê ou faz na interface 2D → UX; muda posição, pose, prop, balão, tela ou zona de algum personagem → mundo.
- **Superfície sensível?**: toca qualquer item de `sensitive_surfaces` (design.yaml) ou do `security-checklist.md` → step-18 roda.
- **Windows**: toda story declara macOS e Windows no plano de testes; se não der para testar no SO atual, fica explícito no Dev Agent Record e no QA.
- **Release**: track `release` só quando houver mudanças acumuladas aprovadas em `main`; bump semver (MAJOR quebra formato/contrato público, MINOR feature, PATCH correção).
