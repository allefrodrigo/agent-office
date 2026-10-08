---
task: "Desenhar o comportamento do mundo"
order: 1
input: |
  - run_plan: run-plan aprovado (track, complexidade, superfícies, steps)
  - prd: PRD/épico aprovado com os FR que tocam o mundo
  - ux_spec: spec de UX do step-07 (opcional, para coerência 2D)
  - world_code: layout.ts, game.ts, avatar.ts, screens.ts, overlays.ts
output: |
  - behavior_table: estado → meta → destino → pose → prop → balão → tela
  - transitions: prioridades e transições entre estados
  - capacity_plan: comportamento com 1, 10, 15 e 20 agentes
  - edge_cases: casos-limite com comportamento esperado
  - ui_equivalents: onde cada sinal aparece na interface 2D
  - open_questions: dúvidas para arquitetura ou checkpoint
---

# Desenhar o comportamento do mundo

Transforma os requisitos que tocam o escritório em uma máquina de comportamento implementável: para cada estado do agente, para onde ele vai, como fica e o que mostra. Parte sempre do comportamento atual de `game.ts` e só cria algo novo quando o existente não comunica o estado sem ambiguidade.

## Process

1. Ler os FR do PRD que mencionam o mundo e a ux-spec (se existir); listar estados novos ou alterados (ex.: "subagente ativo", "agente aguardando teammate").
2. Ler o comportamento atual: `Game.desired()` (pendência ou `waiting` → `boss`; descansando → `desk` e, após `LOUNGE_AFTER_MS` = 3 min, `hang`), `reconcile()`, `pose()`, `bubble()`, `screenMode()`, `chat()` e as constantes de `layout.ts` (`DESKS`, `VISIT_SPOTS`, `LOUNGE_SEATS`, `OVERFLOW_TILES`, `SPAWN_TILE`).
3. Montar a tabela de comportamento: linhas = `status` de `AgentSummary` × pendências (permissão, pergunta, plano, resultado, erro) × eventos especiais (chat, nocaute, saída, novo estado do PRD); colunas = meta (`Goal`), destino (tile ou ponto nomeado), `Pose`, `Prop`, balão (texto + `BubbleKind`), tela (`ScreenMode`) e condição de saída.
4. Definir prioridades e transições: permissão > pergunta/plano > resultado com erro > resultado > trabalhando > livre; `chat` suspende `reconcile()` até `chatUntil`; agente nocauteado (`down`) ignora metas até reviver ou sair.
5. Escrever o plano de capacidade para 1, 10, 15 e 20 agentes: quem fica sem mesa (overflow em pé), fila quando os 13 `VISIT_SPOTS` acabam, regra para o lounge cheio (pontos `stand` antes de sortear), limite visual de entidades novas (ex.: no máximo 3 subagentes por agente + etiqueta "+N").
6. Listar casos-limite: agente removido no meio da caminhada; A* sem caminho (anda em linha reta, comportamento atual); app reaberto com agentes livres (já começam no lounge, `restSince = 0`); jogador fora da sala quando o agente chega; dois agentes disputando o mesmo destino; pendência resolvida no terminal antes de o avatar chegar.
7. Decidir reuso × novidade: reutilizar pose/prop/zona quando a leitura continua inequívoca em `pixelSize` 4; criar elemento novo só quando a ambiguidade persistir, registrando o custo para a direção de arte.
8. Para cada sinal novo, apontar o equivalente na interface 2D (lista de agentes, caixa de entrada, painel) e alinhar com a ux-spec.
9. Registrar perguntas abertas que dependem de dados (ex.: o SDK informa o fim de um subagente?) para o Artur Arquitetura.

## Output Format

```markdown
## Comportamento do mundo
### Estados e metas
| Estado | Meta | Destino | Pose | Prop | Balão (BubbleKind) | Tela | Sai quando |
|---|---|---|---|---|---|---|---|
### Prioridades e transições
### Capacidade (1 / 10 / 15 / 20 agentes)
### Casos-limite
### Equivalentes na interface 2D
### Perguntas abertas
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
## Comportamento do mundo — Subagentes visíveis (run 2026-10-08-101500)

### Estados e metas
| Estado | Meta | Destino | Pose | Prop | Balão (BubbleKind) | Tela | Sai quando |
|---|---|---|---|---|---|---|---|
| Agente trabalhando, 0 subagentes | desk | assento de `DESKS[n]` | type | none | atividade atual (work) | working | status muda |
| Agente trabalhando, 1–3 subagentes | desk | idem | type | none | "Delegou 2 tarefas" (work) | working | último subagente termina |
| Subagente ativo (novo) | intern | tile livre adjacente à mesa: `(x, z+2)`, `(x+1, z+2)`, `(x+2, z+2)` | type (escala 0,8) | none | descrição curta da tarefa (work) | — | evento `agent:subagent` com `ended` |
| Mais de 3 subagentes | intern | 3 visíveis + etiqueta "+N" no crachá do agente | — | — | "+2 delegados" (idle) | — | contagem ≤ 3 |
| Subagente terminou | leave | some no lugar (encolhe 0,6 s, como `vanish`) | wave | none | "✓" (done) por 1,5 s | — | animação acaba |
| Agente com permissão pendente e subagentes ativos | boss | `VISIT_SPOTS` livre | stand/wave | none | "! Preciso da sua permissão" (wait) | waiting | decisão tomada |

### Prioridades e transições
- Pendência do agente pai tem prioridade: ele vai até o usuário e os estagiários continuam na mesa, digitando.
- Subagente nunca vai à sala do usuário: permissões de subagentes aparecem no cartão do agente pai.

### Capacidade
- 10 agentes × 3 estagiários = 30 avatares extras no pior caso: limite global de 12 estagiários visíveis; acima disso só a etiqueta "+N".
- Agente em tile de overflow (sem mesa): estagiários ficam em `stand` no tile vizinho livre.

### Casos-limite
- Agente demitido com subagentes ativos: estagiários somem junto, sem animação de saída individual.
- Evento de fim perdido (app fechado): estagiário sai após 10 min sem atualização.

### Equivalentes na interface 2D
- Painel do agente lista subagentes ativos (S-3); a lista lateral mostra "· 2 delegados".

### Perguntas abertas
1. Os hooks informam o fim de cada subagente (`SubagentStop`) também para sessões do escritório, ou só o SDK?
```

## Quality Criteria

- [ ] A tabela cobre todos os `status` de `AgentSummary`, todas as pendências e os estados novos do PRD.
- [ ] Prioridades entre pendências estão explícitas e coincidem com `desired()` ou justificam a mudança.
- [ ] O plano de capacidade trata 1, 10, 15 e 20 agentes e cada recurso finito do layout.
- [ ] Cada estado novo tem equivalente na interface 2D.
- [ ] Coordenadas citadas são caminháveis e pertencem à zona certa.

## Veto Conditions

Reject and redo if ANY are true:
1. Algum estado do PRD que afeta o mundo ficou sem linha na tabela.
2. Algum comportamento depende de informação que o produto não tem e isso não aparece em "Perguntas abertas".
3. Não há regra para quando mesas, pontos de visita ou lugares do lounge acabam.
4. Algum sinal novo existe só como cor.
