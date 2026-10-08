---
task: "Revisar a segurança do diff"
order: 1
input: |
  - run_plan: output/{run_id}/02-plan/vN/run-plan.md e 03-plan-approval.md (sensitive, track)
  - diff: git diff main...HEAD da branch squad/{run_id}-{run_slug}
  - threat_model: seção STRIDE-lite de output/{run_id}/09-architecture/vN/architecture.md (pode estar pulada)
  - impl_reports: relatórios dos steps 13–16
  - qa_gate: output/{run_id}/17-qa/vN/qa-gate.md
  - checklist: squads/agent-office-squad/pipeline/data/security-checklist.md
output: |
  - security_gate: relatório do step-18 (vira output/18-security/security-gate.md)
  - findings: achados SEC-n com severidade, prova e correção
  - verdict: CLEAR | CONDITIONS | BLOCK, com condições de PR quando houver
---

# Revisar a segurança do diff

Revisão orientada a ameaças das superfícies sensíveis que o diff tocou, conferindo o threat model do arquiteto contra o código implementado. Produz achados provados, com correção, e o veredito que libera ou bloqueia a publicação.

## Process

1. **Gate e escopo.** Leia run-plan e aprovação. Se o step-18 estiver `skip` (sem superfície sensível), grave a nota de pulo e pare. No track `release`, o escopo é dependências (`package.json`, lock), `electron-builder.yml`, CSP e `webPreferences`.
2. **Recortar a superfície.** `git diff --name-only main...HEAD` cruzado com a lista `sensitive_surfaces` do design: ponte e processos, `index.ts` e preload, `agents.ts`, `tickets.ts`/`delegate.ts`, `attachments.ts`, `markdown.ts`, `index.html`, dependências, empacotamento, acesso a `~/.claude`. Leia o diff completo desses arquivos.
3. **Checklist por superfície.** Electron: `webPreferences`, navegação, `openExternal`, métodos novos em `OfficeAPI` validados no main. IPC: tipos, `String()`, tamanhos, caminhos com `existsSync`/`isDirectory`. Ponte: I-03 intacto, sem rota nova sem token. Settings: I-04. Agentes: I-02, I-08, nada que auto-permita ferramenta fora de `mcp__office__*`. Injeção de prompt: texto de ticket, hook, anexo ou nome de agente indo para prompt ou para o `systemPrompt`. Renderer: I-06. Processos: `execFile` com argumentos, aspas, I-11.
4. **Conferir o threat model.** Para cada linha STRIDE-lite do step-09, marque mitigado, parcial ou ausente, citando o código. Ameaça nova não prevista vira achado.
5. **Segredos e cadeia de suprimentos.** Busque no diff padrões de segredo (`sk-ant-`, `ghp_`, `github_pat_`, `xox[bp]-`, `AKIA`, `-----BEGIN`); confirme que o token da ponte não aparece em log, output ou erro. Se dependências mudaram e há rede, rode `npm audit --omit=dev` e verifique scripts de instalação e versão fixada.
6. **Provar.** Para cada achado, um cenário concreto (quem ataca, por onde, o que obtém) e uma prova segura: requisição local na instância isolada, entrada malformada num teste, ou caminho de código com arquivo:linha. Nunca PoC destrutiva nem contra dados reais.
7. **Classificar e corrigir.** Severidade pela escala do squad e invariante relacionado; correção específica com executor (Henrique Hook, Eduardo Electron, Fernanda Front ou Vitor Voxel).
8. **Veredito.** BLOCK se há crítico/alto sem correção ou violação de I-02 a I-09 ou I-14; CONDITIONS se há médio com mitigação documentada (cada condição vai para a descrição do PR); CLEAR se nada ou só baixo. Se `office_board`, `ticket_comment` com o veredito em cada ticket afetado.

## Output Format

````markdown
# Step 18 — Security gate

**Veredito:** CLEAR | CONDITIONS | BLOCK · **Run:** {run_id} · **Escopo:** {n} arquivos sensíveis

## Superfícies revisadas
| Arquivo | Superfície | Invariantes |

## Threat model (STRIDE-lite do step-09)
| Ameaça | Mitigação planejada | Status no código | Evidência |

## Achados
### SEC-{n} · {título} — {severidade}
- **Onde:** `arquivo:linha`
- **Cenário / prova:** ...
- **Impacto:** ...
- **Correção:** ... (executor)
- **Invariante:** I-xx

## Segredos e dependências
## Condições para o PR (só em CONDITIONS)
## Propostas para o security-checklist.md
````

## Output Example

> Use como referência de qualidade, não como template rígido.

````markdown
# Step 18 — Security gate

**Veredito:** CONDITIONS · **Run:** 2026-10-08-101500 · **Escopo:** 4 arquivos sensíveis

## Superfícies revisadas
| Arquivo | Superfície | Invariantes |
|---|---|---|
| `src/main/agents.ts` | eventos de subagente a partir das mensagens do SDK | I-08, I-14 |
| `src/main/bridge.ts` | `PreToolUse` de `Task` vindo dos hooks | I-03, I-07 |
| `src/main/index.ts` | repasse do evento `agent:subagent` | I-05 |
| `src/shared/types.ts` | novo `OfficeEvent` | I-14 |

## Threat model (STRIDE-lite do step-09)
| Ameaça | Mitigação planejada | Status no código | Evidência |
|---|---|---|---|
| Spoofing: hook forjado criando subagentes falsos | rota exige token e recusa `Origin` | mitigado | `bridge.ts:handle()` inalterado; `curl` sem token → 401 |
| Tampering: payload enorme em `description` | limitar tamanho no main | parcial | tipo validado, tamanho não (SEC-1) |
| Information disclosure: prompt do subagente no log | registrar só `description` | mitigado | `agents.ts:handle()` não loga `prompt` |
| DoS: centenas de subagentes por segundo | limitar atores visíveis | mitigado | máx. 3 estagiários + "+N" (S-2) |

## Achados
### SEC-1 · Nome do subagente repassado ao renderer sem limite de tamanho — médio
- **Onde:** `src/main/agents.ts:handle()` (novo ramo de `tool_use` com `name: 'Task'`)
- **Cenário / prova:** um agente (ou um ticket com injeção de prompt) gera uma chamada `Task` com `description` de 200 KB; o main repassa o texto inteiro em `agent:subagent`. O painel usa `textContent` (sem XSS), mas o evento infla o IPC, o `State` e o layout do painel. Reproduzido com uma fixture de mensagem do SDK na instância isolada.
- **Impacto:** degradação da interface e memória; sem execução de código.
- **Correção:** cortar `description` em 80 caracteres no main antes de emitir, como `describeTool` já faz com `clip()` (Henrique Hook).
- **Invariante:** relacionado a I-14 (tipo validado, tamanho não) — não é violação, porque a renderização é segura e o tipo é checado.

## Segredos e dependências
Busca por padrões de segredo no diff: nenhuma ocorrência. Dependências: sem alteração em `package.json`; `npm audit` não aplicável nesta run.

## Condições para o PR (só em CONDITIONS)
- [ ] SEC-1 corrigido (limite de 80 caracteres no main) antes do merge, ou story registrada para a próxima run com prazo.

## Propostas para o security-checklist.md
- Incluir: "todo campo textual novo vindo do SDK ou de hooks tem limite de tamanho no main antes do IPC".
````

## Quality Criteria

- [ ] Escopo lista cada arquivo sensível do diff com a superfície e os invariantes.
- [ ] Cada ameaça do STRIDE-lite tem status e evidência no código.
- [ ] Cada achado tem cenário/prova, impacto, correção com executor e invariante.
- [ ] Varredura de segredos registrada; auditoria de dependências feita ou justificada.

## Veto Conditions

Rejeite e refaça se QUALQUER uma for verdadeira:
1. Veredito CLEAR ou CONDITIONS com achado crítico/alto sem correção ou com violação de I-02 a I-09 ou I-14.
2. Achado sem local exato ou sem correção proposta.
3. O relatório expõe segredo, token ou PoC destrutiva.
4. Superfície sensível presente no diff ficou fora do escopo sem justificativa.
