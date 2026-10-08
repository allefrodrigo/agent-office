---
type: checkpoint
outputFile: squads/agent-office-squad/output/03-plan-approval.md
---

# 🛑 Checkpoint 03: Aprovação do plano da run

## Para o Pipeline Runner

- **Nunca é pulado.** Nada além do intake e da triagem roda sem esta aprovação.
- Mostre o caminho do plano: `squads/agent-office-squad/output/{run_id}/02-plan/vN/run-plan.md` (maior `vN`).
- Antes das perguntas, apresente um resumo de até 8 linhas:
  - track pedido e recomendado (se forem diferentes, diga isso na primeira linha) e complexidade;
  - steps que rodam e que pulam (só os ids);
  - executores acionados e se o security gate (step-18) roda;
  - orçamento: steps em subagente, ciclos de revisão, teto;
  - riscos e o item "Para decidir no step-03" do plano.
- Faça as 2 perguntas numa única chamada de AskUserQuestion.

## Perguntas ao usuário

**1. header `Plano` — "Posso seguir com este plano?"**
- **Aprovar (Recomendado)** — segue exatamente como está no run-plan.
- **Ajustar steps** — ligar ou desligar steps específicos. Ex.: "pular o step-23 (lançamento)", "rodar o step-08 (mundo)".
- **Mudar track ou complexidade** — ex.: "é bugfix, não iniciativa", "isso é COMPLEX".
- **Cancelar a run** — encerra agora e registra a run como abortada.

**2. header `Custo` — "Algum limite de custo para esta run?"**
- **Sem teto além do plano (Recomendado)** — vale o orçamento do run-plan.
- **Definir teto em US$** — ex.: US$ 5, US$ 10, US$ 20.
- **Modo econômico** — até 2 ciclos de revisão, discovery com até 5 buscas, steps condicionais em dúvida viram `skip`, e os steps 19 e 23 só rodam se o track exigir.

## Ação do Pipeline Runner

1. **Aprovar** → grave a decisão e siga para o step-04.
2. **Ajustar steps** → pergunte (AskUserQuestion, header `Steps`, multiSelect) quais steps inverter, oferecendo os 3–4 candidatos mais prováveis do plano; registre cada mudança como override com o motivo do usuário.
3. **Mudar track ou complexidade** → pergunte o novo valor (header `Track` ou `Complex.`). Mudança de track, de complexidade ou de mais de 3 steps é grande: volte ao step-02 com o feedback gravado aqui (conta como ciclo de revisão; máx. 3, depois disso pergunte ao usuário se segue com o último plano ou cancela). Mudança pequena vira override.
4. **Cancelar a run** → grave a decisão `cancelado` e vá direto ao step-24, que registra a run como "Abortado".
5. **Definir teto em US$** → pergunte o valor (header `Teto US$`, opções 5 / 10 / 20; o valor real pode vir no "Outro").
6. Os overrides deste arquivo **prevalecem** sobre o run-plan em todos os steps seguintes.
7. Se o plano tiver o risco `working-tree-dirty`, lembre o usuário de commitar ou guardar as alterações antes do step-13 e registre a resposta.

## Formato de Salvamento

```markdown
# Aprovação do plano da run

**Data:** YYYY-MM-DD
**Plano avaliado:** output/{run_id}/02-plan/vN/run-plan.md
**Decisão:** aprovado | aprovado com ajustes | refazer plano | cancelado
**Track efetivo:** iniciativa | entrega | bugfix | release | discovery
**Complexidade efetiva:** SIMPLE | STANDARD | COMPLEX
**Overrides de steps:**
- step-NN: run | skip — {motivo do usuário}
**Orçamento:** plano | teto US$ {valor} | modo econômico
**max_review_cycles:** 3 | 2
**Árvore de trabalho:** limpa | usuário vai commitar/guardar antes do step-13
**Feedback para refazer o plano:** {se houver}
**Ciclo de revisão do plano:** {n} de 3
```
