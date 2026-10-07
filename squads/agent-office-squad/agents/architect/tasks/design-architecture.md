---
task: "Desenhar a arquitetura da iniciativa"
order: 1
input: |
  - prd: PRD aprovado com FR/NFR/CON
  - specs: ux-spec.md e world-spec.md (quando existirem)
  - discovery: discovery-brief.md com o mapa de impacto no código
  - codebase: src/shared, src/main, src/preload, src/renderer, package.json
output: |
  - layer_plan: mudanças por camada com arquivos, funções e assinaturas TypeScript
  - contracts: tipos novos ou alterados em src/shared/types.ts e OfficeAPI
  - data_plan: campos persistidos, padrões e migração
  - compatibility: SDK/Claude Code, macOS/Windows, degradação
  - performance: impacto estimado e limites
  - test_strategy: o que testar e como, por camada
  - rollout: ordem de implementação e plano de reversão
---

# Desenhar a arquitetura da iniciativa

Converte PRD e specs em um plano técnico por camada, começando pelos contratos compartilhados e terminando na estratégia de testes e no rollout. Lê o código atual antes de propor, para que cada mudança seja um diff plausível sobre o que existe.

## Process

1. Rastrear requisitos: listar cada FR/NFR/CON do PRD e marcar a camada que o atende (shared, main, preload, renderer-mundo, renderer-UI); requisito sem camada vira pergunta.
2. Ler o código afetado começando pelo mapa de impacto do discovery: `src/shared/types.ts`, os handlers `ipcMain.handle('office:*')` em `src/main/index.ts`, `src/preload/index.ts`, o módulo do main envolvido (`agents.ts`, `bridge.ts`, `tickets.ts`, `delegate.ts`, `usage.ts`...) e o consumo no renderer (`State.apply()`, `Game.reconcile()`, `ui/*`).
3. Definir os contratos primeiro: tipos de domínio, novos membros da união `OfficeEvent`, métodos novos em `OfficeAPI` com assinatura completa, e o par handler/preload correspondente com a validação que o main fará (formato de `cleanDraft`).
4. Planejar o main: onde o evento nasce, quem o emite (`EventEmitter` do módulo → `broadcast` em `index.ts`), o que é persistido e com que debounce; manter `AgentManager`, `TicketBoard` e `Bridge` com responsabilidades separadas.
5. Planejar o renderer: como `State.apply()` incorpora o evento, que listeners re-renderizam (evitar re-render global quando um parcial basta, como `renderSystem`), o que muda em `Game` e em `ui/*`.
6. Planejar dados: campo, tipo, valor padrão, leitura tolerante em `Store.load()`/`TicketBoard.load()`, escrita atômica (I-10) e o que acontece ao abrir um `office.json` antigo e ao voltar para a versão anterior.
7. Avaliar compatibilidade: versão do SDK em `package.json` (`^0.3.x`), funções e mensagens usadas (conferir `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`; rodar `npm install` se a pasta não existir), eventos de hook do Claude Code, recursos que só existem em macOS/Linux; desenhar adaptador com guarda e mensagem de degradação para cada dependência instável (I-12).
8. Estimar performance: eventos por segundo, custo de render no renderer, objetos novos no mundo; definir limites (ex.: no máximo N entidades, throttle de eventos).
9. Escrever a estratégia de testes: lógica pura testável sem Electron (funções de mapeamento, validações), verificação manual no demo isolado, capturas para mudanças visuais; se propuser test runner novo (Vitest, Playwright para Electron), registrar como ADR na task seguinte.
10. Definir rollout: ordem de implementação (shared → main → preload/IPC → mundo → UI), pontos de verificação entre camadas e como reverter.

## Output Format

```markdown
## Plano técnico
### Rastreabilidade (FR/NFR/CON → camada)
### Contratos (src/shared)
### Main
### Preload e IPC
### Renderer — mundo
### Renderer — interface
### Dados e migração
### Compatibilidade e degradação
### Performance
### Estratégia de testes
### Rollout e reversão
### Premissas e perguntas abertas
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
## Plano técnico — Subagentes visíveis (run 2026-10-08-101500)

### Rastreabilidade
| Requisito | Camada |
|---|---|
| FR-1 detectar início e fim de subagentes | main (agents.ts, bridge.ts) |
| FR-2 mostrar até 3 estagiários por agente | renderer-mundo (game.ts) |
| FR-3 listar subagentes no painel | renderer-UI (panel.ts) |
| NFR-1 sem custo de tokens extra | main (só observa mensagens existentes) |

### Contratos (src/shared/types.ts)
```ts
export interface SubagentInfo { id: string; parentId: string; description: string; startedAt: number }
export type OfficeEvent =
  | ...
  | { type: 'agent:subagent'; parentId: string; subagent: SubagentInfo; ended: boolean }
```
`AgentSummary` ganha `subagents?: number` (contagem; a lista vem por evento).

### Main
- `AgentManager.handle()`: hoje retorna cedo se `msg.parent_tool_use_id`. Passa a registrar o `tool_use` da ferramenta `Agent`/`Task` (id → descrição) e a emitir `agent:subagent` no `tool_result` correspondente com `ended: true`.
- `Bridge.dispatch()`: `PreToolUse` com `tool_name` `Agent`/`Task` emite início; o hook `SubagentStop` emite fim. Instalar o novo hook exige reinstalar a ponte (detectar e avisar).

### Dados e migração
- Nada persistido: subagentes são efêmeros. Ao reabrir o app, `subagents` volta a 0.

### Compatibilidade e degradação
- Se a versão do Claude Code não enviar `SubagentStop`, o fim é inferido pelo `Stop` da sessão; estagiário sai no máximo 10 min depois sem atualização.

### Estratégia de testes
- Função pura `subagentEventsFrom(msg)` testável com fixtures de mensagens do SDK (ADR-0002 propõe Vitest).
- Demo isolado + `AGENT_OFFICE_SHOTS` para conferir 3 estagiários e a etiqueta "+N".

### Rollout
1. shared/types → 2. agents.ts e bridge.ts → 3. broadcast em index.ts → 4. game.ts → 5. panel.ts.
```

## Quality Criteria

- [ ] Todo FR/NFR/CON tem camada responsável ou aparece como pergunta aberta.
- [ ] Contratos novos têm assinatura TypeScript completa e validação no main descrita.
- [ ] Cada dependência instável tem guarda e comportamento degradado.
- [ ] O plano de dados diz o que acontece com arquivos antigos e no downgrade.
- [ ] A ordem de rollout permite verificar cada camada antes da próxima.

## Veto Conditions

Reject and redo if ANY are true:
1. Algum contrato que atravessa processos não aparece em `src/shared/types.ts`/`OfficeAPI`.
2. O plano expõe ao renderer algo além do que passa por `contextBridge` (quebra I-05).
3. Um campo persistido novo não tem valor padrão nem migração.
4. Uma afirmação sobre o SDK ou o Claude Code não foi conferida no código, nos tipos ou na documentação e não está marcada como premissa.
