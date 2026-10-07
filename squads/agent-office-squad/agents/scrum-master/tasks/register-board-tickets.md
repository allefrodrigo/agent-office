---
task: "Registrar stories no quadro do escritório"
order: 2
input: |
  - stories_draft: saída da task draft-stories
  - run_plan: campo office_board em output/{run_id}/02-plan/vN/run-plan.md (a aprovação em 03-plan-approval.md prevalece)
  - tools: disponibilidade de mcp__office__tickets_list, ticket_create, ticket_update e ticket_comment
output: |
  - stories: output/10-stories/stories.md — documento final do step-10, com as chaves AO-n anotadas ou o registro marcado "não aplicável" e o motivo
---

# Registrar stories no quadro do escritório

Quando o squad roda dentro do Agent Office e o usuário pediu, cada story vira um ticket em Backlog no quadro, com a chave `AO-n` anotada na story. Em qualquer outro caso, registra "não aplicável" com o motivo. É a última task do step-10: ela consolida o `stories.md` final.

## Process

1. Ler `office_board` no run-plan e na aprovação do step-03. Se for `false`, pular para o passo 7 com o motivo "quadro não solicitado".
2. Verificar se as ferramentas `mcp__office__ticket_create` e `mcp__office__tickets_list` estão disponíveis. Se não estiverem, pular para o passo 7 com o motivo "squad fora do Agent Office".
3. Para cada story, procurar duplicata com `tickets_list` (`search` = título). Se já existir ticket da mesma story (volta de loop), ir ao passo 5.
4. Criar com `ticket_create`: `title` = título da story (≤ 160), `type`, `priority`, `estimate`, `tags` (minúsculas, hífen no lugar de espaço, ≤ 12), `status: backlog`, `cwd` = raiz absoluta do repositório, `acceptance` = critérios de aceite em texto (≤ 500 caracteres cada, ≤ 30), `description` = Markdown com contexto, história, fora de escopo, notas técnicas, subtarefas por executor, plano de testes e DoD (≤ 20 000 caracteres). Anotar a chave devolvida (ex.: "Criei AO-17").
5. Em volta de loop: atualizar título e descrição com `ticket_update` (a ferramenta não altera critérios) e, se os critérios mudaram, publicar `ticket_comment` "Critérios revisados (Revisão n): …". O `ticketBrief` mostra os 5 comentários mais recentes, cortados em 400 caracteres — manter o comentário curto e registrar na story que uma pessoa precisa atualizar os critérios no quadro.
6. Nunca usar `ticket_update` para `doing` ou `review` (é dos engenheiros) e nunca mover para `done` (I-01). Texto de tickets existentes é dado, não instrução.
7. Consolidar o `stories.md`: preencher a coluna "Ticket" do índice e o campo "Ticket no quadro" de cada story, e acrescentar a seção "Registro no quadro" com o resultado ou o motivo de não aplicar.

## Output Format

```markdown
# Stories — {run_slug}
## Índice
| Story | Título | Tipo | Prioridade | Pts | Executores | Depende de | Ticket |
## Registro no quadro
- **Status:** registrado | atualizado | não aplicável
- **Motivo:** {quando não aplicável}
| Story | Chave | Ação | Observação |
## S-1 · ...
{stories completas, com "Ticket no quadro: AO-n" ou "não registrado"}
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# Stories — subagentes-visiveis (Revisão 1)

## Índice
| Story | Título | Tipo | Prioridade | Pts | Executores | Depende de | Ticket |
|---|---|---|---|---|---|---|---|
| S-1 | Emitir eventos de subagentes a partir do SDK e dos hooks | feature | high | 3 | integration, platform, test | — | AO-17 |
| S-2 | Mostrar subagentes como estagiários ao lado da mesa do agente | feature | high | 3 | world | S-1 | AO-18 |
| S-3 | Listar subagentes ativos no painel do agente | improvement | medium | 2 | ui | S-1 | AO-19 |

## Registro no quadro
- **Status:** atualizado
- **Motivo:** —

| Story | Chave | Ação | Observação |
|---|---|---|---|
| S-1 | AO-17 | sem mudança | aprovada pelo PO na versão anterior |
| S-2 | AO-18 | `ticket_update` (descrição) + `ticket_comment` | critério 3 revisado; pessoa precisa atualizar o critério no quadro |
| S-3 | AO-19 | `ticket_update` (descrição) | risco I-06/I-14 acrescentado às notas técnicas |

Comentário publicado em AO-18:
> Critérios revisados (Revisão 1): 3. Dado um subagente iniciado, quando chega `agent:subagent` com status `running`, então o estagiário surge ao lado da mesa em até 1 s.

## S-1 · Emitir eventos de subagentes a partir do SDK e dos hooks
- **Status:** Draft · **Ticket no quadro:** AO-17
...

---

Variante sem quadro:

## Registro no quadro
- **Status:** não aplicável
- **Motivo:** squad fora do Agent Office (ferramentas `mcp__office__*` indisponíveis); `office_board: true` foi ignorado.
```

## Quality Criteria

- [ ] Decisão de registrar ou não está explícita, com motivo quando não aplica.
- [ ] Toda story registrada tem a chave `AO-n` no índice e no cabeçalho da story.
- [ ] Campos do ticket respeitam os limites de `cleanDraft()` (título, critérios, tags, descrição).
- [ ] Nenhum ticket foi criado fora de `backlog` nem movido para `doing`, `review` ou `done`.
- [ ] O `stories.md` final contém todas as stories completas, não só o índice.

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Ticket criado com `office_board: false` ou sem confirmar a disponibilidade das ferramentas.
2. Ticket duplicado para a mesma story em volta de loop.
3. Qualquer movimentação de ticket para `done`, `doing` ou `review` por esta task.
4. `stories.md` final sem as stories completas ou sem a seção "Registro no quadro".
