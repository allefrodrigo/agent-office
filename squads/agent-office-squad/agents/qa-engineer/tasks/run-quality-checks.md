---
task: "Executar checagens de qualidade"
order: 1
input: |
  - run_plan: output/{run_id}/02-plan/vN/run-plan.md e 03-plan-approval.md (track, complexidade, sensitive)
  - story_selection: output/{run_id}/12-story-selection.md
  - stories: output/{run_id}/10-stories/vN/stories.md (critérios de aceite e plano de testes)
  - impl_reports: relatórios dos steps 13–16 (Dev Agent Record, capturas de antes)
  - architecture: output/{run_id}/09-architecture/vN/architecture.md (estratégia de testes; pode estar pulado)
output: |
  - checks: comandos executados com exit code e trecho de erro
  - traceability: matriz story × critério → evidência e status
  - manual_log: verificações no demo isolado com capturas
  - invariants: invariantes tocados e resultado da checagem
  - platform_matrix: plataformas verificadas e declaradas
  - risk_notes: áreas de risco aprofundadas e achados brutos para a task 2
---

# Executar checagens de qualidade

Coleta toda a evidência que o veredito precisa: checagens automáticas, rastreabilidade de cada critério de aceite, verificação manual sem gastar tokens e regressão dos invariantes. Não decide o veredito — entrega os fatos e os achados brutos para a task `issue-gate-verdict`.

## Process

1. **Gate e escopo.** Leia run-plan e aprovação. Se o step-17 estiver `skip`, grave a nota de pulo e pare. No track `release`, o escopo é a regressão do release candidate: todos os invariantes de alto risco + smoke dos fluxos principais.
2. **Mapear o diff.** `git branch --show-current`, `git log --oneline main..HEAD` e `git diff --stat main...HEAD`. Cruze os arquivos tocados com o `architecture-map.md` para listar os invariantes em risco.
3. **Checagens automáticas.** Se faltar `node_modules`, rode `npm ci` (nunca `npm install`, que altera o lock). Depois `npm run typecheck` e `npm run build`; se `package.json` tiver `test`/`lint`, rode `npm test` e `npm run lint`. Registre exit code, duração e as primeiras linhas de erro.
4. **Rastreabilidade.** Para cada critério de aceite das stories selecionadas, aponte a evidência: teste automatizado (nome), captura (caminho), passo manual reproduzível ou leitura de código (só para critério não comportamental). Status: ✅ evidenciado · ❌ falhou · ⚠️ sem evidência.
5. **Verificação manual isolada.** Pasta temporária própria (zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-qa`; PowerShell `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-qa"`), modo demo e capturas com tempos que cubram a permissão (~3 s) e o resultado (~6 s): `AGENT_OFFICE_SHOTS="out/qa:4000,9000"`. Use `AGENT_OFFICE_EVAL` para posicionar o cenário (`__panel.open(id)`, `__game.focusAgent(id)`). Compare com as capturas de antes dos relatórios.
6. **Volume e borda.** Para mudanças no mundo ou em listas, injete agentes sintéticos no renderer (`__state.apply({ type: 'agent:upsert', agent: {...} })`) até 18+ e verifique sobreposição, ordenação e desempenho percebido. Teste estado vazio, erro e cancelamento previstos na story.
7. **Regressão de invariantes.** Para cada invariante em risco, uma checagem dirigida: I-03 com a ponte da instância isolada — zsh `curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:{porta}/agent-office/hook -H "Origin: http://x"`, PowerShell o mesmo com `curl.exe` e `-o NUL` — deve dar 403, e sem token 401; I-05/I-06 com `git diff main...HEAD -- src/main/index.ts src/renderer/index.html` e busca por `innerHTML`; I-11 com busca por `SIGKILL`; I-13 conferindo que nenhum `query(`/`hire(` novo roda sem ação do usuário.
8. **Plataformas.** `node -p "process.platform"` define o que foi executado. Para a outra plataforma, revise os ramos `process.platform` do diff e declare "não verificado em execução".
9. **Infraestrutura de testes.** Se não houver test runner, registre "lógica nova sem teste automatizado" para cada função nova relevante e recomende a story de infraestrutura (Vitest + testes de `cleanDraft`, `hookDecision`, `sniff`), que exige ADR do Artur Arquitetura.
10. **Achados brutos.** Liste cada problema com story, executor provável, arquivo:linha, passos, esperado e observado — sem severidade final ainda.

## Output Format

```yaml
checks:
  - { cmd: "npm run typecheck", exit: 0, duration_s: 21, excerpt: "" }
traceability:
  - { story: "S-1", ac: 1, evidence: "out/qa-1.png", type: captura, status: "✅" }
manual_log:
  - { scenario: "...", platform: "win32", command: "...", observed: "...", capture: "out/qa-2.png" }
invariants:
  - { id: "I-03", check: "...", result: "ok" }
platform_matrix: { executed: ["win32"], declared_not_verified: ["darwin"] }
risk_notes:
  - { area: "...", probability: alta, impact: médio, deep_dive: "..." }
raw_findings:
  - { story: "S-2", executor: world, where: "src/...:linha", steps: "...", expected: "...", observed: "..." }
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```yaml
checks:
  - { cmd: "npm run typecheck", exit: 0, duration_s: 19, excerpt: "" }
  - { cmd: "npm run build", exit: 0, duration_s: 13, excerpt: "" }
  - { cmd: "npm test", exit: null, duration_s: 0, excerpt: "script inexistente — sem test runner no repositório" }
traceability:
  - { story: "S-1", ac: 1, evidence: "manual: Grace delega Task no demo isolado → evento agent:subagent no console", type: manual, status: "✅" }
  - { story: "S-1", ac: 2, evidence: "src/main/bridge.ts:dispatch() trata PreToolUse com tool_name Task", type: leitura, status: "✅" }
  - { story: "S-2", ac: 1, evidence: "out/qa-1.png (estagiário ao lado da mesa 3)", type: captura, status: "✅" }
  - { story: "S-2", ac: 3, evidence: "nenhuma: subagente continua visível após demitir o pai", type: manual, status: "❌" }
  - { story: "S-3", ac: 1, evidence: "out/qa-2.png + navegação por Tab registrada", type: captura, status: "✅" }
manual_log:
  - scenario: "Demitir agente com 2 subagentes ativos"
    platform: "win32"
    command: "$env:AGENT_OFFICE_DATA_DIR=\"$env:TEMP\\ao-qa\"; $env:AGENT_OFFICE_DEMO=1; npm run dev"
    observed: "o pai sai pelo elevador, os dois estagiários ficam parados ao lado da mesa vazia"
    capture: "out/qa-3.png"
  - scenario: "18 agentes sintéticos com 3+ subagentes cada"
    platform: "win32"
    command: "AGENT_OFFICE_EVAL com 18 chamadas __state.apply(agent:upsert) + agent:subagent"
    observed: "etiquetas '+N' sobrepõem o crachá nas mesas da fileira de trás"
    capture: "out/qa-4.png"
invariants:
  - { id: "I-03", check: "curl.exe sem token → 401; com Origin → 403", result: "ok" }
  - { id: "I-06", check: "busca por innerHTML no diff", result: "ok (0 ocorrências)" }
  - { id: "I-13", check: "nenhum query()/hire() novo fora de ação do usuário", result: "ok" }
platform_matrix: { executed: ["win32"], declared_not_verified: ["darwin"] }
risk_notes:
  - { area: "ciclo de vida de atores no game.ts", probability: alta, impact: alto, deep_dive: "demitir, limpar contexto e fim de sessão com subagentes ativos" }
raw_findings:
  - { story: "S-2", executor: world, where: "src/renderer/src/game.ts:leave()", steps: "demitir pai com subagentes", expected: "estagiários saem junto", observed: "ficam órfãos" }
  - { story: "S-2", executor: world, where: "src/renderer/src/world/overlays.ts", steps: "18 agentes", expected: "+N legível", observed: "sobrepõe o crachá" }
  - { story: "S-1", executor: integration, where: "src/main/agents.ts:handle()", steps: "-", expected: "teste do mapeamento", observed: "lógica nova sem teste automatizado" }
```

## Quality Criteria

- [ ] Toda checagem automática disponível rodou e tem exit code.
- [ ] Nenhum critério de aceite das stories selecionadas ficou fora da matriz.
- [ ] Verificação manual feita em pasta temporária, com comando e captura.
- [ ] Cada invariante tocado pelo diff tem checagem dirigida registrada.

## Veto Conditions

Rejeite e refaça se QUALQUER uma for verdadeira:
1. Algum teste manual rodou contra os dados reais do usuário (sem `AGENT_OFFICE_DATA_DIR`).
2. Foi usado `AGENT_OFFICE_SEED` ou qualquer ação que gaste tokens sem pedido do usuário.
3. Critério comportamental marcado ✅ só com leitura de código.
4. A matriz de plataformas omite a plataforma não executada.
