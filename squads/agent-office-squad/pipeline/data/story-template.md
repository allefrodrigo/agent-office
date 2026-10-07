# Template de Story (AIOX × ticket do Agent Office)

Uma story é **autocontida**: um engenheiro que nunca viu o PRD consegue implementá-la só com este texto e com os arquivos que ela aponta. O formato é compatível com o ticket do quadro do escritório (`TicketDraft` em `src/shared/types.ts`): título, tipo, prioridade, descrição em Markdown, critérios de aceite, tags, estimativa e pasta.

## Regras

- **Título** no imperativo, até 80 caracteres: "Mostrar teammates do Agent Teams na sala de reunião".
- **Tipo**: `feature` | `improvement` | `bug` | `task`. **Prioridade**: `low` | `medium` | `high` | `critical`.
- **Estimativa** em pontos (1, 2, 3, 5). Acima de 5, dividir.
- **Fatia vertical**: cada story entrega um resultado verificável pelo usuário (ou, em `task`, pelo time). A divisão por camada acontece nas **subtarefas**, cada uma marcada com o executor.
- **Critérios de aceite** em Given/When/Then, numerados, cada um verificável por teste, captura ou passo manual. Eles viram o `acceptance[]` do ticket.
- **Notas técnicas** citam a fonte de cada afirmação (`[PRD FR-3]`, `[ARQ §4.2]`, `src/main/agents.ts:handle()`).
- **Invariantes** do produto que a story pode quebrar aparecem explicitamente (lista em `architecture-map.md`).
- **Status** segue o ciclo AIOX: `Draft` (SM) → `Ready` (PO) → `InProgress` (engenheiros) → `InReview` (fim da implementação) → `Done` (QA aprova e uma pessoa fecha).

## Template

```markdown
## S-{n} · {Título no imperativo}

- **Status:** Draft
- **Tipo:** feature · **Prioridade:** high · **Estimativa:** 3 pts
- **Tags:** agent-teams, mundo, integração
- **Pasta:** (raiz do repositório)
- **Ticket no quadro:** AO-{n} | não registrado
- **Origem:** PRD FR-2, FR-3 · discovery §2.1
- **Depende de:** S-{m} | nenhuma

### Contexto
{Por que esta story existe, para quem, e qual problema resolve. 3–6 linhas, com fonte.}

### História
Como {persona}, quero {capacidade}, para {resultado}.

### Critérios de aceite
1. **Dado** {estado inicial}, **quando** {ação/evento}, **então** {resultado observável}.
2. ...

### Fora de escopo
- {o que não será feito nesta story, e onde será tratado se for o caso}

### Notas técnicas
- Arquivos: `src/...` — {o que muda e por quê} [ARQ §n]
- Contratos: {tipos/IPC/eventos novos ou alterados, com assinatura}
- Invariantes a preservar: {lista}
- Riscos: {ex.: API experimental do SDK, diferença Windows/macOS}

### Subtarefas por executor
- [ ] (integration) {subtarefa}
- [ ] (platform) {subtarefa}
- [ ] (world) {subtarefa}
- [ ] (ui) {subtarefa}
- [ ] (test) {teste automatizado a criar, de qualquer executor}

### Plano de testes
- Automático: {testes unitários/integração a criar ou rodar}
- Manual (demo isolado): {passos curtos; comando zsh e PowerShell quando diferir}
- Visual: {capturas AGENT_OFFICE_SHOTS antes/depois, se houver mudança visual}
- Plataformas: macOS {sim/não} · Windows {sim/não}

### Definition of Done
- [ ] Todos os critérios de aceite com evidência
- [ ] `npm run typecheck` e `npm run build` verdes (e `npm test`/`npm run lint` quando existirem)
- [ ] Sem regressão nos invariantes listados
- [ ] Textos novos em pt-BR revisados pela Lívia Linguagem
- [ ] Dev Agent Record preenchido por executor
- [ ] Quality gate PASS ou CONCERNS (e security gate CLEAR/CONDITIONS, se aplicável)

### Dev Agent Record
_(preenchido pelos engenheiros nos relatórios dos steps 13–16)_

### QA Results
_(preenchido pela Tânia Teste no step-17)_
```

## Exemplo curto de subtarefas bem escritas

- [ ] (integration) Em `AgentManager.handle()`, tratar mensagens com `parent_tool_use_id` de ferramentas `Agent` nomeadas como teammates e emitir `agent:teammate` com `{ parentId, name, status }`.
- [ ] (platform) Repassar o novo evento em `index.ts` (`broadcast`) e tipar em `OfficeEvent`.
- [ ] (world) Em `game.ts`, criar ator temporário para cada teammate, sentado na sala de reunião; remover quando o evento indicar fim.
- [ ] (ui) No painel do agente, listar teammates ativos com status e permitir focar a câmera em cada um.
- [ ] (test) Teste unitário do mapeamento mensagem → evento com fixtures de mensagens do SDK.

Subtarefas ruins: "ajustar o backend", "fazer a parte visual", "testar tudo".
