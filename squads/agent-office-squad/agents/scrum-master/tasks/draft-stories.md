---
task: "Redigir stories autocontidas"
order: 1
input: |
  - sources: PRD (05), aprovação do PRD (06), UX (07), mundo (08) e arquitetura (09) da run, os que existirem
  - intake: output/{run_id}/01-intake.md (único insumo de requisito nos tracks entrega e bugfix)
  - po_feedback: output/{run_id}/11-validation/vN/po-validation.md (quando é uma volta do loop)
  - template: pipeline/data/story-template.md
output: |
  - stories_draft: índice + stories completas no story-template, status Draft (entrada da task register-board-tickets)
---

# Redigir stories autocontidas

Transforma os artefatos da run em stories verticais que um engenheiro executa sem perguntar nada, com subtarefas por executor, invariantes, plano de testes e DoD. Em volta de loop, aplica exatamente as correções do PO.

## Process

1. Identificar as fontes da run: PRD e specs (iniciativa) ou o intake com o ticket/bug (entrega, bugfix). No bugfix, extrair passos de reprodução, comportamento esperado e observado e o arquivo suspeito.
2. Se for volta de loop, ler o `po-validation.md` e listar as correções por story antes de editar; mudar só o que foi apontado e registrar "Revisão {n}" no topo.
3. Quebrar o trabalho em fatias verticais. Cada story precisa de um resultado verificável pelo usuário (ou pelo time, se `task`). Acima de 5 pontos, dividir e criar dependência.
4. Para cada story, preencher o template: título no imperativo (≤ 80 caracteres), tipo, prioridade, estimativa, tags minúsculas, origem (FR-n, seção da arquitetura, intake), contexto, história, critérios de aceite em Given/When/Then, fora de escopo.
5. Escrever notas técnicas com fonte para cada afirmação: arquivos e funções, contratos (tipos, eventos `OfficeEvent`, canais `office:*`), invariantes I-xx em risco e riscos (API experimental, diferença Windows/macOS).
6. Escrever subtarefas com executor (`integration`, `platform`, `world`, `ui`, `test`), verbo no infinitivo e arquivo ou função; conferir o executor pelo mapa de camadas.
7. Escrever o plano de testes: automático (enquanto não houver test runner no repo, propor a subtarefa `test` que o cria ou declarar a ausência), manual no demo isolado com comandos zsh e PowerShell, captura `AGENT_OFFICE_SHOTS` quando houver mudança visual, plataformas.
8. Montar o índice e a matriz FR → story; FR sem story precisa constar do escopo fora do PRD. Entregar para a task register-board-tickets.

## Output Format

```markdown
# Stories — {run_slug} {(Revisão n)}
## Índice
| Story | Título | Tipo | Prioridade | Pts | Executores | Depende de | Ticket |
## Cobertura FR → story
## S-1 · {título}
{seções completas do story-template.md}
## S-2 · ...
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# Stories — subagentes-visiveis

## Índice
| Story | Título | Tipo | Prioridade | Pts | Executores | Depende de | Ticket |
|---|---|---|---|---|---|---|---|
| S-1 | Emitir eventos de subagentes a partir do SDK e dos hooks | feature | high | 3 | integration, platform, test | — | não registrado |
| S-2 | Mostrar subagentes como estagiários ao lado da mesa do agente | feature | high | 3 | world | S-1 | não registrado |
| S-3 | Listar subagentes ativos no painel do agente | improvement | medium | 2 | ui | S-1 | não registrado |

## S-1 · Emitir eventos de subagentes a partir do SDK e dos hooks
- **Status:** Draft
- **Tipo:** feature · **Prioridade:** high · **Estimativa:** 3 pts
- **Tags:** subagentes, integracao · **Origem:** PRD FR-1, FR-5 · ARQ §3.2 · **Depende de:** nenhuma

### Contexto
`AgentManager.handle()` descarta mensagens com `parent_tool_use_id` [agents.ts:handle], então o escritório não sabe que subagentes existem. Sessões do terminal também não informam subagentes à ponte [bridge.ts:dispatch].

### História
Como dev com várias sessões, quero que o escritório saiba quando um agente dispara subagentes, para vê-los trabalhando.

### Critérios de aceite
1. **Dado** um agente do escritório, **quando** ele usa a ferramenta `Agent` ou `Task`, **então** o main emite `agent:subagent` com `status: running` e a descrição limitada a 140 caracteres.
2. **Dado** um subagente em execução, **quando** o resultado da ferramenta volta, **então** o main emite `agent:subagent` com `status: done`.
3. **Dado** uma sessão do terminal conectada, **quando** chega o hook `SubagentStop`, **então** o subagente correspondente é marcado `done`.

### Notas técnicas
- Contrato: `{ type: 'agent:subagent'; agentId: string; subagent: { id: string; description: string; status: 'running' | 'done' } }` em `OfficeEvent` [ARQ §3.2].
- Invariantes: I-03 e I-04 (instalar o hook novo preserva backup e marcador), I-13 (nenhum token extra), I-14 (descrição vinda de hook é não confiável).

### Subtarefas por executor
- [ ] (integration) Em `handle()`, mapear `tool_use` de `Agent`/`Task` e o `tool_result` correspondente para eventos de subagente.
- [ ] (integration) Em `Bridge.install()`, acrescentar `SubagentStop`; em `dispatch()`, tratar o evento.
- [ ] (platform) Tipar o evento em `src/shared/types.ts` e repassá-lo no `broadcast` de `src/main/index.ts`.
- [ ] (test) Criar fixture de mensagens do SDK e teste do mapeamento (ou registrar a ausência de test runner).

### Plano de testes
- Manual: `npm run demo` (zsh) ou `$env:AGENT_OFFICE_DEMO=1; npm run dev` (PowerShell) com `AGENT_OFFICE_DATA_DIR` temporário; pedir a um agente uma tarefa que use subagente.
- Plataformas: macOS sim · Windows sim (hooks são HTTP e multiplataforma).

### Definition of Done
- [ ] AC 1–3 com evidência · [ ] typecheck e build verdes · [ ] I-03, I-04, I-13, I-14 preservados · [ ] Dev Agent Record preenchido
```

## Quality Criteria

- [ ] Todas as seções do template preenchidas em todas as stories.
- [ ] Critérios de aceite em Given/When/Then, numerados e verificáveis.
- [ ] Subtarefas com executor, verbo no infinitivo e arquivo ou função.
- [ ] Índice e cobertura FR → story completos; nenhuma story acima de 5 pontos.
- [ ] Em volta de loop, todas as correções do PO aplicadas e marcadas.

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Story sem critério de aceite verificável ou sem subtarefas com executor.
2. Requisito sem fonte (não está no PRD, no intake nem na arquitetura).
3. Story que toca superfície sensível sem invariantes listados.
4. Qualquer alteração em arquivo de código do repositório durante a task.
