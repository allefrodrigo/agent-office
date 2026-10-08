---
task: "Registrar decisões e modelar ameaças"
order: 2
input: |
  - layer_plan: saída da task design-architecture
  - security_checklist: pipeline/data/security-checklist.md
  - invariants: lista I-01 a I-14 de pipeline/data/architecture-map.md
  - sensitive_surfaces: superfícies sensíveis do design.yaml tocadas pela run
output: |
  - adrs: decisões no formato contexto/decisão/alternativas/consequências/status
  - threat_model: STRIDE-lite por superfície tocada, com mitigação e invariante
  - architecture_doc: documento final do step-09 (plano técnico + ADRs + ameaças)
---

# Registrar decisões e modelar ameaças

Transforma as escolhas do plano técnico em ADRs auditáveis e analisa, superfície por superfície, como a mudança pode ser abusada. Termina consolidando o `architecture.md`, que é o documento que a Priscila Prioridade valida e o Kauã Kanban fatia em stories.

## Process

1. Identificar decisões que exigem ADR: dependência nova, framework ou test runner novo, mudança de invariante, padrão novo de comunicação (evento, canal IPC, formato de arquivo), escolha entre alternativas com custo relevante.
2. Escrever cada ADR com número provisório (`ADR-run-1`, `ADR-run-2`; a numeração definitiva é dada pela Lívia Linguagem ao promover): contexto com fonte, decisão, alternativas consideradas e por que foram descartadas, consequências (positivas, negativas, riscos) e status (`proposto` até o checkpoint 12; `aceito` quando aprovado).
3. Listar as superfícies sensíveis tocadas (ponte HTTP, IPC/preload, `canUseTool` e modos de permissão, ferramentas de agente e regra de bypass, anexos, sanitização de Markdown, CSP, dependências, empacotamento, leitura/escrita em `~/.claude`).
4. Para cada superfície, aplicar STRIDE-lite: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege — só as categorias aplicáveis, cada uma com cenário concreto, probabilidade e impacto (baixo/médio/alto).
5. Para cada ameaça, definir mitigação no desenho e o invariante que a protege (I-01 a I-14); se a mitigação exigir mudar invariante, abrir ADR.
6. Marcar como **entrada não confiável** todo dado vindo de agente, ticket, hook, anexo ou arquivo de `~/.claude`, e descrever onde ele é validado.
7. Listar verificações obrigatórias para a Sílvia Sandbox no step-18 e para a Tânia Teste no step-17 (ex.: "corpo de hook acima de 2 MB continua recusado").
8. Consolidar o `architecture.md`: resumo executivo (5 linhas), plano técnico (task 1), ADRs, modelo de ameaças, verificações para os gates, premissas e perguntas abertas.

## Output Format

```markdown
# Arquitetura — {iniciativa}
## Resumo executivo
## Plano técnico                (da task 1)
## ADRs
### ADR-run-{n}: {título}
- Status / Contexto / Decisão / Alternativas / Consequências
## Modelo de ameaças (STRIDE-lite)
| Superfície | Categoria | Cenário | Prob. | Impacto | Mitigação | Invariante |
## Verificações obrigatórias nos gates
## Premissas e perguntas abertas
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
## ADRs

### ADR-run-1: Eventos de subagente derivados de mensagens já recebidas
- **Status:** proposto
- **Contexto:** `AgentManager.handle()` descarta mensagens com `parent_tool_use_id` [agents.ts].
  O PRD (NFR-1) proíbe custo extra de tokens.
- **Decisão:** derivar início e fim de subagentes dos blocos `tool_use`/`tool_result` da ferramenta
  `Agent`/`Task` no fluxo do SDK e, para o terminal, dos hooks `PreToolUse` e `SubagentStop`.
- **Alternativas:** (a) consultar o transcript em disco a cada 5 s — descartada: I/O constante e
  formato interno; (b) pedir ao agente que reporte subagentes — descartada: gasta tokens (I-13).
- **Consequências:** zero custo de tokens; depende do nome da ferramenta (`Agent` hoje, `Task` em
  versões antigas) — isolado em `subagentEventsFrom()`.

### ADR-run-2: Introduzir Vitest para lógica pura do processo principal
- **Status:** proposto
- **Contexto:** o repositório não tem test runner; a função de mapeamento precisa de fixtures.
- **Decisão:** Vitest como devDependency, testes em `src/**/*.test.ts`, script `npm test`.
- **Alternativas:** `node --test` (sem TypeScript nativo nesta configuração), Jest (mais lento, ESM trabalhoso).
- **Consequências:** +1 devDependency; habilita o gate de testes do Diego Deploy.

## Modelo de ameaças (STRIDE-lite)
| Superfície | Categoria | Cenário | Prob. | Impacto | Mitigação | Invariante |
|---|---|---|---|---|---|---|
| bridge.ts (hook SubagentStop) | Spoofing | processo local envia hook falso para criar estagiários | baixa | baixo | token + recusa de Origin já valem para o novo evento | I-03 |
| bridge.ts | DoS | rajada de eventos de subagente | média | médio | limite de 50 subagentes rastreados por sessão; excedente só conta | I-03 |
| panel.ts | Information disclosure / XSS | descrição do subagente com HTML | média | alto | texto via `textContent`, nunca innerHTML | I-06 |

## Verificações obrigatórias nos gates
- Sílvia: hook sem token continua 401; descrição com `<img onerror>` aparece como texto.
- Tânia: 5 subagentes simultâneos mostram 3 estagiários + "+2"; fim inferido após `Stop`.
```

## Quality Criteria

- [ ] Toda decisão que adiciona dependência, padrão novo ou muda invariante tem ADR.
- [ ] Cada ADR tem pelo menos uma alternativa descartada com motivo.
- [ ] Toda superfície sensível tocada aparece no modelo de ameaças com mitigação e invariante.
- [ ] Entradas não confiáveis têm o ponto de validação identificado.
- [ ] Há verificações concretas para os steps 17 e 18.

## Veto Conditions

Reject and redo if ANY are true:
1. Uma superfície sensível tocada pela run ficou fora do modelo de ameaças.
2. Algum ADR não tem alternativas ou consequências.
3. Uma mitigação depende de "o usuário não vai fazer isso".
4. O documento final não inclui o plano técnico da task 1 completo.
