---
type: checkpoint
outputFile: squads/agent-office-squad/output/01-intake.md
---

# 🛑 Checkpoint 01: Intake da iniciativa

## Para o Pipeline Runner

- Primeiro step de toda run. **Nunca é pulado.**
- Antes de perguntar, mostre o contexto em até 3 linhas: "Squad Agent Office — produto e engenharia do Agent Office (v0.2.0)" e quantas runs já constam em `squads/agent-office-squad/_memory/runs.md`.
- Verifique se as ferramentas `mcp__office__*` estão disponíveis nesta sessão (sinal de que o squad roda dentro do próprio Agent Office). Isso define a recomendação da pergunta 4.
- Faça as 4 perguntas numa única chamada de AskUserQuestion.

## Perguntas ao usuário

**1. header `Track` — "Que tipo de trabalho vamos fazer nesta run?"**
- **Iniciativa** — feature ou épico novo, do discovery ao lançamento. Ex.: "Subagentes visíveis no escritório".
- **Entrega** — story ou ticket já definido (ex.: `AO-12`); pula discovery e PRD. Ex.: "Implementar o AO-12 do quadro".
- **Bugfix** — defeito com reprodução. Ex.: "O badge de pendências não aparece no Windows".
- **Release** — publicar uma versão: regressão, auditoria, notas e release. Ex.: "Publicar a v0.3.0".

> Discovery (estratégia sem código) ficou fora das 4 opções: o usuário escolhe "Outro" e escreve `discovery: <tema>`. Diga isso na descrição da pergunta. Ex.: "discovery: reavaliar o posicionamento contra o Pixel Agents".

**2. header `Descrição` — "O que vamos evoluir? Descreva o resultado que você quer."**
- **Subagentes visíveis no escritório** — mostrar os subagentes (ferramenta Agent/Task) como personagens ligados ao agente que delegou.
- **Worktree isolada por agente** — cada agente contratado trabalha numa git worktree própria, sem pisar no outro.
- **Traduzir a interface para inglês** — criar a base de i18n e um catálogo `en` além do pt-BR.

> O "Outro" recebe a descrição livre. Guarde o texto exatamente como o usuário escreveu.

**3. header `Referências` — "Tem alguma referência para esta run?"**
- **Nenhuma** — o squad parte só da descrição.
- **Ticket do quadro** — uma chave `AO-n` do quadro do escritório.
- **Link ou arquivo** — issue, URL, captura de tela ou caminho no repositório.

**4. header `Quadro` — "Registrar as stories no quadro do Agent Office?"**
- **Sim** — cada story vira ticket em Backlog e os agentes atualizam o quadro durante a run. Só funciona com o squad rodando dentro do Agent Office.
- **Não** — as stories ficam só em `output/`.

> Coloque primeiro, com "(Recomendado)": **Sim** se `mcp__office__*` estiver disponível; **Não** caso contrário, avisando na descrição que "Sim" não teria efeito.

## Ação do Pipeline Runner

1. Se o usuário escolheu "Ticket do quadro" ou "Link ou arquivo" sem informar o valor, faça uma pergunta de acompanhamento (AskUserQuestion, header `Referência`) com 2–3 exemplos como opções (`AO-12`, `AO-7`, `docs/bug.png`); o valor real vem no "Outro".
2. Normalize o track para `iniciativa` | `entrega` | `bugfix` | `release` | `discovery` (texto "discovery: …" no "Outro" vira `discovery`).
3. `office_board` só é `true` se o usuário disse "Sim" **e** as ferramentas `mcp__office__*` existem; senão grave `false` e registre o motivo em Observações.
4. Grave o arquivo no formato abaixo no caminho transformado (`output/{run_id}/01-intake.md`, sem pasta de versão) e siga para o step-02.
5. Se o usuário desistir já no intake, encerre a run sem executar outros steps (não há o que consolidar no step-24).

## Formato de Salvamento

```markdown
# Intake da iniciativa

**Data:** YYYY-MM-DD
**Track escolhido:** iniciativa | entrega | bugfix | release | discovery
**Descrição (texto do usuário):** {sem resumir nem reescrever}
**Referências:** nenhuma | AO-n | {link} | {caminho}
**office_board:** true | false
**Ferramentas mcp__office__* disponíveis:** sim | não
**Observações:** {detalhes extras das respostas em "Outro"; motivo se office_board virou false}
```
