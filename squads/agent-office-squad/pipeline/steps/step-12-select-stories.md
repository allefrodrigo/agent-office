---
type: checkpoint
outputFile: squads/agent-office-squad/output/12-story-selection.md
---

# 🛑 Checkpoint 12: Seleção das stories da run

## Para o Pipeline Runner

- Último ponto antes de mudar código: nenhuma implementação (steps 13–16) roda sem esta seleção.
- Roda só nos tracks **iniciativa**, **entrega** e **bugfix**. Se o plano aprovado marcar este checkpoint como `skip`, diga em uma linha "O checkpoint 12 não se aplica ao track {track} — seguindo." e continue sem esperar resposta.
- Mostre os arquivos a revisar, com caminho (maior `vN`):
  - `squads/agent-office-squad/output/{run_id}/10-stories/vN/stories.md`;
  - `squads/agent-office-squad/output/{run_id}/11-validation/vN/po-validation.md`.
- Antes das perguntas, mostre uma tabela: id, título, veredito do PO, pontos e executores. Stories **NEEDS_REVISION** aparecem na tabela, mas não podem ser selecionadas.
- Se o `po-validation.md` registrar escalada do 3º ciclo, diga isso primeiro: as stories ainda NEEDS_REVISION ficam fora desta run.
- Se `architecture.md` ou `po-validation.md` tiverem perguntas abertas, inclua até 2 delas como perguntas extras (header curto, opções com a recomendação do autor primeiro), respeitando o limite de 4 perguntas por chamada.

## Perguntas ao usuário

**1. header `Stories` — "Quais stories vamos implementar nesta run?"**
- Com até 4 stories READY: **multiSelect** com uma opção por story — rótulo "S-n · título curto", descrição com pontos e executores.
- Com mais de 4:
  - **Todas as READY (Recomendado)** — na ordem do PO.
  - **Só alta e crítica** — as de prioridade `high` e `critical`.
  - **Escolher pelos ids** — digite no "Outro", ex.: "S-1, S-3".
  - **Nenhuma — parar no planejamento** — a run fecha com os artefatos de planejamento.

**2. header `Bloqueadas` — só se houver BLOCKED_UPSTREAM — "Há stories bloqueadas por defeito no PRD ou na arquitetura. O que fazer?"**
- **Voltar ao step indicado pela PO (Recomendado)** — step-05 (PRD) ou step-09 (arquitetura), com o feedback da validação.
- **Seguir sem as bloqueadas** — implementa só as READY selecionadas; as bloqueadas ficam para outra run.

**3. header `Ordem` — "Em que ordem implementar?"**
- **Seguir a ordem do PO (Recomendado)** — dependências primeiro, depois risco e valor.
- **Definir outra** — digite a ordem no "Outro", ex.: "S-3, S-1, S-2"; dependências continuam valendo.

## Ação do Pipeline Runner

1. Recuse seleção que inclua story NEEDS_REVISION ou que quebre dependência (ex.: S-2 sem S-1): explique em uma linha e pergunte de novo.
2. Calcule os executores envolvidos: a união dos executores das subtarefas das stories selecionadas. Steps 13–16 de executores fora dessa lista vão gravar nota de pulo.
3. **Voltar ao step indicado** → grave a decisão e volte ao step-05 ou ao step-09 com o feedback (conta como ciclo de revisão; máx. 3). Depois a run refaz os steps seguintes até este checkpoint.
4. **Nenhuma — parar no planejamento** → grave a decisão; os steps 13–23 viram `skip` com motivo "run parou no planejamento" e a run segue para o step-24.
5. Com seleção válida, grave o arquivo e siga para o step-13. Se o run-plan tiver o risco `working-tree-dirty`, confirme antes que o usuário commitou ou guardou as alterações.
6. Respostas às perguntas abertas extras viram decisões obrigatórias para os engenheiros e entram no arquivo.

## Formato de Salvamento

```markdown
# Seleção das stories da run

**Data:** YYYY-MM-DD
**Stories avaliadas:** output/{run_id}/10-stories/vN/stories.md · validação vN
**Stories selecionadas (em ordem):** S-1, S-3, S-2 | nenhuma
**Executores envolvidos:** integration, platform, world, ui
**Stories não selecionadas:** S-n — {motivo}
**Bloqueadas a montante:** nenhuma | S-n → {voltar ao step-05 | voltar ao step-09 | seguir sem}
**Ordem:** do PO | definida pelo usuário
**Decisões sobre perguntas abertas:**
- {pergunta} → {resposta}
**Árvore de trabalho:** limpa | confirmada pelo usuário
**Ciclo de revisão:** {n} de 3
**Próximo step:** step-13 | step-05 | step-09 | step-24
```
