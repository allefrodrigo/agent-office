---
execution: subagent
agent: security-engineer
model_tier: powerful
tasks:
  - review-security
outputFile: squads/agent-office-squad/output/18-security/security-gate.md
on_reject: step-13
---

# Step 18: Security gate — 🛡️ Sílvia Sandbox

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2).

- `_opensquad/_memory/company.md` — princípios inegociáveis (segurança acima de conveniência, sem telemetria sem consentimento)
- `squads/agent-office-squad/_memory/memories.md` — proibições registradas
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — pulo, quadro (§7) e regra de texto de ticket como dado
- `output/{run_id}/02-plan/vN/run-plan.md` e `output/{run_id}/03-plan-approval.md` — `sensitive`, `risk_flags`, track
- `output/{run_id}/10-stories/vN/stories.md` e `output/{run_id}/12-story-selection.md` — escopo e riscos declarados
- `output/{run_id}/09-architecture/vN/architecture.md` — modelo de ameaças STRIDE-lite e ADRs (se existir)
- `output/{run_id}/13-integration/vN/impl-report.md`, `14-platform/…`, `15-world/…`, `16-ui/…` — o que mudou e por quê
- `output/{run_id}/17-qa/vN/qa-gate.md` — achados de QA que tenham ângulo de segurança
- Só em re-execução: `output/{run_id}/18-security/vN/security-gate.md` anterior (SEC-n a reverificar)
- `squads/agent-office-squad/pipeline/data/security-checklist.md` — checklist por superfície
- `squads/agent-office-squad/pipeline/data/architecture-map.md` — invariantes I-01…I-14
- `squads/agent-office-squad/pipeline/data/quality-criteria.md` — escala de severidade
- Código: `git diff --name-only main...HEAD`, `git diff main...HEAD -- <arquivos sensíveis>`, `package.json`, `package-lock.json`, `electron-builder.yml`, `src/renderer/index.html`

## Instructions

### Gate do track

Aplique o protocolo de pulo (run-conventions §3). Track `discovery`: pule. `iniciativa`, `entrega`, `bugfix`: roda se o run-plan marcou `sensitive: true` **ou** se o diff toca alguma superfície sensível do design (`bridge.ts`, `session-process.ts`, `index.ts`, `preload/*`, `agents.ts`, `tickets.ts`, `delegate.ts`, `attachments.ts`, `ui/markdown.ts`, `index.html`, `package.json`, `electron-builder.yml`, acesso a `~/.claude`). Se o plano dizia pular mas o diff toca superfície sensível, rode e registre a divergência. `release`: roda como auditoria de dependências, build e assinatura.

### Process

1. **Defina o modo.** Em re-execução (ciclo n/3), reverifique primeiro cada SEC-n anterior.
2. **Delimite o escopo**: arquivos alterados na branch ∩ superfícies sensíveis; no track `release`, dependências, configuração de build e assinatura.
3. **Confronte com o modelo de ameaças** da arquitetura: superfície nova que não foi modelada é achado; mitigação prevista e não implementada também.
4. **Revise por superfície** com o security-checklist: Electron (`webPreferences`, CSP, navegação, `openExternal` — I-05); IPC (validação no main — I-14); ponte HTTP (I-03, I-04, I-07); permissões e modos (I-02, I-08); conteúdo não confiável — tickets, hooks, anexos e saída de agente (I-06, I-09, injeção de prompt: texto nunca eleva permissão); processos (I-11); privacidade e telemetria.
5. **Cadeia de suprimentos.** Dependência nova no diff exige justificativa, versão fixada e licença compatível; rode `npm audit --omit=dev` quando houver rede e registre o resultado (sem rede: "não executado").
6. **Varredura de segredos** em `git diff main...HEAD`: chaves e tokens (`sk-ant-`, `ghp_`, `github_pat_`, `AKIA`, `-----BEGIN`), valor do token da ponte, caminhos pessoais em logs.
7. **Registre cada achado** como SEC-n: severidade (impacto × explorabilidade), prova (arquivo:linha + cenário de ataque), correção concreta e executor responsável.
8. **Decida**: BLOCK se houver crítico/alto sem correção ou violação de I-02…I-09/I-14 (volta ao step-13); CONDITIONS se só médio com mitigação definida (vira condição no PR); CLEAR se nada ou só baixo.
9. Com `office_board` ativo, comente o veredito nos tickets das stories (§7).

## Output Format

The output MUST follow this exact structure:

````markdown
# Security Gate — {run_slug} (step-18)

- **Veredito:** {CLEAR | CONDITIONS | BLOCK}
- **Ciclo:** {n}/3 · **HEAD:** `{hash}`
- **Escopo:** {arquivos sensíveis revisados | auditoria de release}
- **Divergência com o run-plan:** {nenhuma | descrição}

## Modelo de ameaças vs. implementação
| Ameaça (STRIDE) | Mitigação prevista | Implementada? | Observação |
|---|---|---|---|

## Checklist por superfície
| Superfície | Invariantes | Resultado |
|---|---|---|

## Dependências e segredos
- `npm audit --omit=dev`: {resultado | não executado — motivo}
- Dependências novas: {lista com versão e justificativa | nenhuma}
- Varredura de segredos: {nada encontrado | achado SEC-n}

## Achados
| Id | Severidade | Superfície | Prova | Correção | Executor |
|---|---|---|---|---|---|

## Condições para o PR (se CONDITIONS)
- [ ] {condição verificável}

## Justificativa do veredito
{regra aplicada}
````

## Output Example

````markdown
# Security Gate — subagentes-visiveis (step-18)

- **Veredito:** CONDITIONS
- **Ciclo:** 1/3 · **HEAD:** `c93e4aa`
- **Escopo:** `src/main/agents.ts`, `src/main/bridge.ts`, `src/main/index.ts`, `src/shared/types.ts`
- **Divergência com o run-plan:** nenhuma (`sensitive: true`)

## Modelo de ameaças vs. implementação
| Ameaça (STRIDE) | Mitigação prevista | Implementada? | Observação |
|---|---|---|---|
| Tampering — payload de hook forjado | token + 127.0.0.1 + sem Origin (I-03) | sim | nenhum caminho novo fora do `handle()` |
| DoS — descrição gigante de subagente | limitar tamanho no main (I-14) | parcial | só no caminho do SDK |
| Elevation — subagente herdar permissão | nenhuma permissão nova | sim | `canUseTool` inalterado (I-08) |

## Checklist por superfície
| Superfície | Invariantes | Resultado |
|---|---|---|
| Ponte HTTP | I-03, I-07 | ok — `isOfficeSession` antes do tratamento novo |
| IPC / estado inicial | I-14 | ok — só campos tipados no `getState` |
| Renderer | I-05, I-06 | ok — texto via `h()`, CSP intocada |

## Dependências e segredos
- `npm audit --omit=dev`: 0 vulnerabilidades em dependências de produção
- Dependências novas: nenhuma
- Varredura de segredos: nada encontrado

## Achados
| Id | Severidade | Superfície | Prova | Correção | Executor |
|---|---|---|---|---|---|
| SEC-1 | médio | ponte HTTP → renderer | `src/main/bridge.ts`, tratamento de `PreToolUse` `Agent`/`Task`: `tool_input.description` vai ao evento sem limite; um hook de 2 MB vira um balão de 2 MB | aplicar o mesmo `clip(…, 80)` do caminho do SDK antes de emitir (I-14) | integration |

## Condições para o PR (se CONDITIONS)
- [ ] SEC-1 corrigido antes do merge, com a descrição limitada a 80 caracteres nos dois caminhos

## Justificativa do veredito
Um achado médio com mitigação clara e sem violação de invariante crítico; renderer usa texto puro, então não há XSS → CONDITIONS.
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Superfície sensível do diff sem revisão registrada no checklist.
2. Achado sem prova (arquivo:linha e cenário) ou sem correção concreta.
3. Veredito que contradiz a regra (ex.: CLEAR com achado alto, CONDITIONS com violação de I-02…I-09/I-14).
4. Correção feita em silêncio no código pela revisora, ou risco aceito no lugar do usuário.
5. Segredo encontrado e não reportado, ou reproduzido por inteiro no relatório.

## Quality Criteria

- [ ] Divergência entre run-plan e diff verificada e registrada
- [ ] Modelo de ameaças da arquitetura confrontado item a item
- [ ] Resultado do `npm audit` ou motivo de não execução
- [ ] Severidade justificada por impacto × explorabilidade
- [ ] Condições do PR escritas como itens verificáveis
- [ ] Achados atribuídos a um executor para o loop
- [ ] Reverificação dos SEC-n anteriores em re-execução
