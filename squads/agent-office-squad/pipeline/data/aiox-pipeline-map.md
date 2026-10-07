# Mapa AIOX → Squad Agent Office

O squad adapta o Synkra AIOX (aiox-core v5.x, MIT) ao formato do opensquad. Este documento mostra de onde veio cada papel, cada fase e cada regra, e o que foi adaptado ao Agent Office.

## 1. Agentes inspirados no AIOX

| Squad Agent Office | Persona AIOX | O que herdou | O que mudou |
|---|---|---|---|
| 🎼 Otávio Orquestra | 👑 Orion (`@aiox-master`) + fase *Assess* do spec-pipeline | roteamento para o agente certo, "nunca emular outro agente", classificação SIMPLE/STANDARD/COMPLEX | também controla orçamento (Constituição art. XII) e fecha a run com retro |
| 🔭 Bruna Benchmark | 🔍 Atlas (`@analyst`) | pesquisa baseada em evidência, contexto estratégico, brownfield discovery | benchmark contínuo do mercado de "escritórios de agentes" e mapa de impacto no código |
| 🗺️ Rita Roadmap | 📋 Morgan (`@pm`) | PRD/épicos, RICE/MoSCoW, métricas, PM cria épico e SM cria stories | requisitos FR/NFR/CON numerados para o *No Invention* |
| 🎯 Priscila Prioridade | 🎯 Pax (`@po`) | checklist de 10 pontos do story-development-cycle, guardiã da coesão | vereditos READY / NEEDS_REVISION / BLOCKED_UPSTREAM |
| 🌊 Kauã Kanban | 🌊 River (`@sm`) | `create-next-story`, story autocontida para o dev, **nunca implementa** | story no formato de ticket do escritório, subtarefas por executor, registro no quadro |
| 🧭 Úrsula Usabilidade | 🎨 Uma (`@ux-design-expert`) | pesquisa → fluxos → sistema, WCAG AA, consolidação de padrões | foco em app desktop e na convivência 2D × mundo 3D |
| 🧱 Iuri Isométrico | — (especialista do domínio) | molde do `@ux-design-expert` | design de mundo, game feel e direção de arte pixel/voxel |
| ✍️ Lívia Linguagem | documentação do AIOX (docs, stories, changelog) | documentação viva junto do código | UX writing pt-BR, i18n, notas de versão |
| 🏛️ Artur Arquitetura | 🏛️ Aria (`@architect`) | visão holística, tecnologia chata, segurança em camadas, ADRs | contratos Electron (shared/IPC/preload), adaptadores para APIs instáveis do Claude Code |
| 🪝 Henrique Hook · 🖥️ Eduardo Electron · 🧊 Vitor Voxel · 🎛️ Fernanda Front | 💻 Dex (`@dev`) | `develop-story`: a story tem tudo; só preenche o Dev Agent Record; testes; commits atômicos | quatro especialistas, um por camada do código do Agent Office |
| ✅ Tânia Teste | ✅ Quinn (`@qa`) | arquitetura de testes, rastreabilidade Given/When/Then, risco = probabilidade × impacto, gate PASS/CONCERNS/FAIL/WAIVED, qa-loop | verificação visual com `AGENT_OFFICE_SHOTS` e instância isolada |
| 🛡️ Sílvia Sandbox | segurança distribuída entre Quinn/Gage + art. XII-D (varredura de injeção) | revisão de segurança antes do push | especialista dedicada: Electron, ponte local, permissões, injeção de prompt |
| 🚀 Diego Deploy | ⚡ Gage (`@devops`) | **única autoridade de push, PR, tag e release**, gates obrigatórios, semver, changelog, rollback | build mac arm64 / win x64, assinatura e notarização |
| 📣 Camila Comunidade | — (go-to-market) | — | posicionamento, lançamento, comunidade e feedback |

O AIOX também tem `@data-engineer` (Dara). O Agent Office não tem banco de dados (persistência em JSON), então esse papel foi absorvido pelo arquiteto (formato e migração dos arquivos) e pelo engenheiro de plataforma (escrita atômica).

## 2. Fases AIOX → steps do pipeline

```
AIOX planejamento (greenfield/brownfield)        AIOX Story Development Cycle            AIOX entrega
analyst → pm → ux → architect → po              sm → po → dev → qa (qa-loop)            devops (push/PR/release)
   │       │     │       │        │               │     │     │      │                      │
  04      05    07/08    09    (em 11)           10    11  13–16  17 (+18)              20 → 21 → 22
```

| Fase | AIOX | Squad |
|---|---|---|
| Seleção de workflow | aiox-master escolhe greenfield/brownfield/spec-pipeline | step-02: Otávio escolhe o **track** e a **complexidade** |
| Avaliação de complexidade | spec-pipeline *assess*: SIMPLE / STANDARD / COMPLEX | run-plan: complexidade decide se UX, mundo e arquitetura rodam |
| Pesquisa | analyst | step-04 |
| PRD / épico (Gate 1) | pm | step-05 + checkpoint step-06 |
| Front-end spec | ux-design-expert | step-07 (2D) e step-08 (mundo) |
| Arquitetura | architect | step-09 (inclui ADR e threat model) |
| Criar story | sm `create-next-story` | step-10 |
| Validar story (10 checks) | po | step-11 (loop para o step-10) |
| Implementar | dev `develop-story` | steps 13–16 (por camada) |
| Revisar | qa gate + qa-loop (máx. 5) | step-17 (loop para o step-13, máx. 3) e step-18 |
| Push / PR / release | devops | step-20 → checkpoint 21 → step-22 |
| Retro | sm (retrospectiva) | step-24 (Otávio) |

## 3. Constituição — como cada artigo vira regra aqui

| Artigo AIOX | Regra no squad |
|---|---|
| I. CLI First (dashboards observam, não controlam) | Adaptado: o Agent Office é uma UI que **controla**; por isso toda ação que muda estado passa pelo main com validação, e o CLI do Claude Code continua funcionando sem o app (ponte falha rápido se o app estiver fechado). |
| II. Agent Authority | Matriz de autoridade abaixo. |
| III. Story-Driven Development | Nenhum código sem story selecionada no step-12. Progresso em checkboxes; File List no Dev Agent Record. |
| IV. No Invention | PRD com FR/NFR/CON; specs e stories citam a fonte; o que não tem fonte vira pergunta. |
| V. Quality First | Gates: `npm run typecheck`, `npm run build`, e `npm test`/`npm run lint` quando existirem. FAIL/BLOCK impedem publicação. |
| VI. Absolute Imports | Equivalente local: imports de tipos compartilhados sempre via alias `@shared/*`. |
| XI. Squad-First Portability | Tudo do squad vive em `squads/agent-office-squad/`; `.claude/skills/opensquad` é só a projeção para o Claude Code. |
| XII. Model Governance | Orçamento no run-plan, limite de ciclos de revisão, texto de ticket/hook tratado como não confiável (XII-D). |

## 4. Matriz de autoridade

| Autoridade | Exclusiva de | Observação |
|---|---|---|
| Track, complexidade e steps da run | Otávio Orquestra | sujeito à aprovação do usuário no step-03 |
| Escopo e prioridade do produto | Rita Roadmap | aprovado no step-06 |
| Criar stories | Kauã Kanban | Priscila pode pedir revisão |
| Marcar story como Ready | Priscila Prioridade | |
| Decisões de arquitetura/tecnologia | Artur Arquitetura | ADR obrigatório para framework, dependência ou mudança de invariante |
| Alterar código de produção | engenheiros dos steps 13–16 | só subtarefas do seu executor, só em stories selecionadas |
| Veredito de qualidade | Tânia Teste | WAIVED só com aprovação explícita do usuário |
| Veto de segurança | Sílvia Sandbox | BLOCK impede publicação |
| Texto final da UI e documentação | Lívia Linguagem | |
| `git push`, PR, tag, release, CI/CD | Diego Deploy | só após o checkpoint 21 |
| Comunicação externa | Camila Comunidade | apenas rascunhos; quem publica é o usuário |
| Mover ticket para **Feito** | pessoas | regra do próprio produto |

## 5. Ciclo de vida da story ↔ colunas do quadro

| Story (AIOX) | Coluna do quadro | Quem move |
|---|---|---|
| Draft | Backlog | Kauã Kanban |
| Ready | Backlog / A fazer | Priscila Prioridade |
| InProgress | Fazendo | engenheiro que inicia |
| InReview | Revisão | último engenheiro da story |
| Done | Feito | **pessoa**, depois do gate |

## 6. Vereditos

| Gate | Vereditos | Efeito |
|---|---|---|
| PO (step-11) | READY · NEEDS_REVISION · BLOCKED_UPSTREAM | NEEDS_REVISION volta ao step-10; BLOCKED_UPSTREAM vai para o usuário no step-12 |
| QA (step-17) | PASS · CONCERNS · FAIL · WAIVED | FAIL volta ao step-13; CONCERNS segue com lista registrada |
| Segurança (step-18) | CLEAR · CONDITIONS · BLOCK | BLOCK volta ao step-13; CONDITIONS segue com condições no PR |

## 7. Lições do ecossistema AIOX aplicadas

- **Contrato de saída obrigatório**: há relato público (aiox-cockpit-issues #31) de entregas que "evaporam" quando o agente não tem formato de retorno. Aqui todo step tem Output Format e as implementações têm Dev Agent Record.
- **Custo de abertura**: há relato (#39) de bootstrap automático cobrando um turno a cada abertura do app. O squad não roda nada sem o checkpoint de intake, e o Agent Office não deve gastar tokens sem ação do usuário (a leitura de limites do plano já é gratuita — manter assim).
- **Agent Teams no Windows**: ferramentas de equipe e mensagens entre sessões têm suporte desigual entre plataformas (mensagens entre sessões oficiais exigem macOS/Linux ou WSL 2). Toda feature que dependa disso precisa de plano para Windows.
