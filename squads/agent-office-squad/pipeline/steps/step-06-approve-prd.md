---
type: checkpoint
outputFile: squads/agent-office-squad/output/06-prd-approval.md
---

# 🛑 Checkpoint 06: Aprovação do PRD e do escopo

## Para o Pipeline Runner

- Equivale ao Gate 1 do AIOX: nada de UX, mundo, arquitetura ou stories sem PRD aprovado.
- Roda só nos tracks **iniciativa** e **discovery**. Se o plano aprovado (run-plan + `03-plan-approval.md`) marcar este checkpoint como `skip`, diga em uma linha "O checkpoint 06 não se aplica ao track {track} — seguindo." e continue sem esperar resposta.
- Mostre os arquivos a revisar, com caminho:
  - `squads/agent-office-squad/output/{run_id}/05-prd/vN/prd.md` (maior `vN`);
  - `squads/agent-office-squad/output/{run_id}/04-discovery/vN/discovery-brief.md`, se existir.
- Antes das perguntas, resuma em até 6 linhas: problema, métrica norte, RICE e decisão, fatias, escopo fora e perguntas abertas do PRD.
- No track **discovery** o arquivo é um memo de recomendação: faça só a pergunta 1.

## Perguntas ao usuário

**1. header `PRD` — "O PRD está aprovado?"**
- **Aprovar (Recomendado)** — o PRD vira a referência para UX, mundo, arquitetura e stories.
- **Aprovar com ajustes de escopo** — aprova e registra mudanças obrigatórias. Ex.: "tirar o FR-2 desta run", "meta de FPS 50 em vez de 55".
- **Refazer o PRD** — volta ao step-05 com o seu feedback. Ex.: "faltou a persona tech lead".
- **Encerrar aqui** — a run vira discovery: nenhum step de construção roda e a run fecha no step-24.

**2. header `Fatia` — "Até onde vamos nesta run?"**
- **Só a fatia 1 (Recomendado)** — o menor incremento que entrega valor sozinho.
- **Fatias 1 e 2** — mais escopo, mais custo e mais risco nesta run.
- **Épico inteiro** — todas as fatias; recomendado só para complexidade SIMPLE ou STANDARD.

## Ação do Pipeline Runner

1. **Aprovar** → grave a decisão e a fatia; siga para o step-07.
2. **Aprovar com ajustes de escopo** → pergunte os ajustes (AskUserQuestion, header `Ajustes`, com 2–3 exemplos tirados do PRD como opções; o texto real vem no "Outro"). Os ajustes gravados aqui são **obrigatórios** para os steps 07–11, que leem este arquivo junto com o PRD.
3. **Refazer o PRD** → grave o feedback e volte ao step-05 (conta como ciclo de revisão; máx. 3 — no terceiro, ofereça apenas Aprovar, Aprovar com ajustes ou Encerrar).
4. **Encerrar aqui** → grave `encerrar`; os steps 07–23 viram `skip` com motivo "run encerrada no checkpoint 06" e a run segue direto para o step-24.
5. Track **discovery** + **Aprovar** → o memo está aceito; os steps 07–23 já estão como `skip` no plano e a run segue para o step-24.
6. A fatia escolhida limita o que o Kauã Kanban pode transformar em stories no step-10.

## Formato de Salvamento

```markdown
# Aprovação do PRD e do escopo

**Data:** YYYY-MM-DD
**PRD avaliado:** output/{run_id}/05-prd/vN/prd.md
**Decisão:** aprovado | aprovado com ajustes | refazer | encerrar
**Fatia desta run:** fatia 1 | fatias 1 e 2 | épico inteiro | n/a (discovery)
**Requisitos dentro desta run:** FR-…, NFR-…, CON-…
**Ajustes de escopo obrigatórios:**
- {ajuste} — afeta {FR/NFR/CON}
**Feedback para refação:** {se houver}
**Ciclo de revisão do PRD:** {n} de 3
**Próximo step:** step-07 | step-05 | step-24
```
