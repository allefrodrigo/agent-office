# Critérios de Qualidade — rubricas e regras de gate

Fonte única das regras usadas pelos revisores do squad. Baseado nas best practices de revisão do opensquad (`_opensquad/core/best-practices/review.md`) e no gate do AIOX (`@qa`: PASS/CONCERNS/FAIL/WAIVED).

## 1. Regras gerais de revisão

- Avaliar contra critérios definidos, nunca por gosto. Critério não definido → "não pontuado", não inventado.
- Toda nota tem justificativa com local exato; todo problema tem correção proposta.
- Separar **bloqueante** de **sugestão**.
- Nota de 1 a 10 por critério; **aprovado** se média ≥ 7 e nenhum critério < 4. Qualquer critério < 4 reprova sozinho.
- Máximo de 3 ciclos de revisão sobre o mesmo artefato; depois, decisão do usuário.
- Reconhecer pelo menos um ponto forte, mesmo em reprovação.

## 2. Rubricas por artefato

### Run-plan (Otávio, step-02)
| Critério | 10 = |
|---|---|
| Classificação | track e complexidade justificados com arquivos/superfícies prováveis |
| Economia | todo `skip` e `cond` tem motivo; nada roda sem necessidade |
| Riscos | superfícies sensíveis e flags de risco identificadas |
| Orçamento | limites declarados e realistas |
| Formato | bloco `run_plan` válido no esquema do run-conventions |

### Discovery-brief (Bruna, step-04)
| Critério | 10 = |
|---|---|
| Foco | responde à pergunta da iniciativa, sem levantamento genérico |
| Evidência | toda afirmação com fonte, data de acesso e confiança |
| Benchmark | como ≥ 3 concorrentes relevantes resolvem o problema, com espaço vazio claro |
| Impacto no código | módulos, contratos e invariantes afetados citados por arquivo/função |
| Acionável | recomendações que o PRD consegue usar diretamente |

### PRD (Rita, step-05)
| Critério | 10 = |
|---|---|
| Problema e evidência | problema concreto, persona, JTBD, ligado ao discovery |
| Métricas | métrica norte + guardas, com forma de medir compatível com a política de privacidade |
| Escopo | dentro/fora explícitos; primeira fatia entrega valor sozinha |
| Requisitos | FR/NFR/CON numerados, verificáveis, sem solução técnica disfarçada |
| Riscos e dependências | listados com mitigação |

### UX-spec (Úrsula, step-07)
| Critério | 10 = |
|---|---|
| Fluxos | caminho feliz e de recuperação descritos |
| Estados | vazio, carregando, erro, sucesso, bloqueado para cada tela/componente |
| Acessibilidade | itens WCAG 2.2 AA aplicados (foco, teclado, contraste, nome/papel, nada só por cor, alvo ≥ 24 px, movimento reduzido) |
| Consistência | reusa padrões/classes existentes; novos padrões justificados |
| Microcopy | rascunhos em pt-BR alinhados ao `product-voice.md` |

### World-spec (Iuri, step-08)
| Critério | 10 = |
|---|---|
| Mapeamento de status | todo comportamento ligado a um estado real (`AgentStatus`, itens pendentes) |
| Legibilidade | status lido sem texto; silhuetas testadas em pixelSize 2–5 |
| Escala | comportamento definido para 1, 10 e 20 agentes |
| Performance | orçamento de draw calls/triângulos e estratégia de reuso |
| Ética do delight | nada lúdico esconde status ou banaliza ação destrutiva |

### Architecture (Artur, step-09)
| Critério | 10 = |
|---|---|
| Contratos | assinaturas TypeScript de tipos, eventos e IPC novos/alterados |
| Invariantes | cada invariante tocado citado com como é preservado |
| Compatibilidade | SDK, versões do Claude Code, macOS e Windows tratados |
| Testabilidade | estratégia de testes por camada |
| Decisões e ameaças | ADRs com alternativas; STRIDE-lite das superfícies tocadas |

### Stories (Kauã, step-10) — validadas pela Priscila no step-11
Checklist de 10 pontos (AIOX) + específicos do Agent Office:

| # | Check |
|---|---|
| 1 | Título claro, no imperativo |
| 2 | Contexto completo do problema/necessidade, com origem |
| 3 | Critérios de aceite testáveis em Given/When/Then |
| 4 | Escopo dentro e fora definidos |
| 5 | Dependências mapeadas |
| 6 | Estimativa adequada (≤ 5 pts) |
| 7 | Valor identificado (para quem e por quê) |
| 8 | Riscos documentados |
| 9 | Definition of Done clara |
| 10 | Alinhada ao PRD/épico (ou ao ticket/bug de origem) |
| A | Invariantes que pode quebrar listados |
| B | Subtarefas por executor (`integration`/`platform`/`world`/`ui`/`test`) concretas |
| C | Plano de testes com macOS e Windows |

**Vereditos**: `READY` (todos ok) · `NEEDS_REVISION` (falha corrigível na própria story → volta ao step-10) · `BLOCKED_UPSTREAM` (defeito nasce no PRD/UX/mundo/arquitetura → decisão do usuário no step-12).

### Relatório de implementação (steps 13–16)
- Dev Agent Record completo por story (`run-conventions.md` §6).
- `npm run typecheck` e `npm run build` executados e verdes (e testes/lint quando existirem).
- Só subtarefas do próprio executor alteradas; desvios justificados.
- Commits locais por story; nenhum push.

## 3. Quality gate (Tânia, step-17)

**Severidade dos achados**: crítico (perda de dados, execução sem consentimento, app não abre) · alto (quebra de invariante, bug que impede fluxo principal, AC não atendido) · médio (degrada fluxo com contorno) · baixo (cosmético, melhoria).

| Veredito | Quando |
|---|---|
| **FAIL** | qualquer check automático falha (typecheck, build, testes, lint quando existir) · AC no escopo sem evidência ou não atendido · achado crítico ou alto · invariante quebrado |
| **CONCERNS** | só achados médios/baixos · plataforma não testada declarada · lógica nova sem teste automatizado **enquanto o repositório não tiver test runner** |
| **PASS** | todos os AC com evidência, checks verdes, nada acima de baixo, plataformas cobertas ou declaradas com risco baixo |
| **WAIVED** | nunca dado pela QA; registrado pelo runner quando o usuário dispensa explicitamente o gate ao atingir o limite de 3 ciclos |

Depois que a infraestrutura de testes existir, lógica nova sem teste automatizado passa a ser **FAIL**.

Evidências aceitas: teste automatizado (nome + resultado), captura `AGENT_OFFICE_SHOTS` (caminho), passo manual reproduzível em instância isolada (comando + resultado observado), leitura de código apenas para itens não observáveis (com justificativa).

## 4. Security gate (Sílvia, step-18)

| Veredito | Quando |
|---|---|
| **BLOCK** | achado crítico/alto sem correção · violação de I-02…I-09 ou I-14 · segredo no diff |
| **CONDITIONS** | achado médio com mitigação documentada (vira condição no corpo do PR) |
| **CLEAR** | nenhum achado ou só baixos |

## 5. Preparação e publicação (Diego, steps 20–22)

- Nada é publicado com FAIL ou BLOCK; CONCERNS e CONDITIONS aparecem no corpo do PR.
- Gates finais re-executados no estado final da branch (typecheck, build, testes/lint quando existirem).
- PR com: resumo, stories, vereditos, condições, como testar (zsh e PowerShell), riscos, rollback.
- Release: semver correto, CHANGELOG atualizado, tag `vX.Y.Z`, builds por plataforma, pendências de assinatura declaradas.
- O step-22 executa só as ações aprovadas no checkpoint 21 e registra a verificação (URL do PR, hash, tag).

## 6. Documentação e textos (Lívia, step-19)

| Critério | 10 = |
|---|---|
| Voz | todo texto novo segue `product-voice.md` (glossário, erro acionável, sem "Ops!") |
| Cobertura | README/COMO-RODAR/CHANGELOG atualizados quando o comportamento visível muda |
| i18n | strings novas sem concatenação, prontas para catálogo |
| Notas de versão | benefício primeiro, linguagem do usuário, requisitos e limites |

## 7. Kit de lançamento (Camila, step-23)

| Critério | 10 = |
|---|---|
| Mensagem | diferencial claro frente ao benchmark, sem superlativo vazio |
| Demonstração | roteiro de demo de 60 s com cenas reproduzíveis no modo demo |
| Honestidade | requisitos e limitações explícitos |
| Medição | métricas e janela de acompanhamento definidas |
| Segurança de marca | nada publicado pelo agente; promessas só do roadmap aprovado |
