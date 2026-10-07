---
type: checkpoint
outputFile: squads/agent-office-squad/output/21-publish-approval.md
---

# 🛑 Checkpoint 21: Aprovação de publicação

## Para o Pipeline Runner

Este checkpoint guarda a única porta para ações irreversíveis (push, PR, tag, release). Nada é publicado sem a resposta do usuário aqui.

- **Track `discovery`:** o checkpoint não se aplica. Informe em uma linha ("O checkpoint 21 não se aplica ao track discovery — seguindo.") e continue.
- Nos demais tracks, antes de perguntar, mostre:
  1. o caminho do plano: `squads/agent-office-squad/output/{run_id}/20-release/vN/release-plan.md` (maior `vN/`) e do corpo do PR `…/20-release/vN/pr-body.md`;
  2. os vereditos: QA (`17-qa/vN/qa-gate.md`) e segurança (`18-security/vN/security-gate.md`, ou "pulado — motivo");
  3. a lista exata de comandos da seção "Comandos para aprovação no checkpoint 21", numerada, sem resumir.
- **Se QA estiver FAIL ou segurança BLOCK** (ou o plano estiver "bloqueado"), não ofereça publicação: pergunte apenas entre "Voltar ao step-13 para corrigir" e "Encerrar sem publicar".
- Use AskUserQuestion com as três perguntas numa única chamada. No track `release`, marque "Release completo" como (Recomendado) no lugar do PR.

## Perguntas ao usuário

1. **O que publicar?** (header: "Publicação")
   - Push da branch + PR (Recomendado) — envia `squad/{run_id}-{run_slug}` e abre o PR com o corpo gerado
   - Só push da branch — envia a branch, sem abrir PR
   - Release completo (tag + builds + publicação) — bump de versão, CHANGELOG, tag `vX.Y.Z`, builds desta plataforma e release rascunho no GitHub
   - Não publicar agora — mantém tudo local; a branch continua pronta
2. **Tipo de PR?** (header: "PR") — só vale se houver PR
   - Draft — para revisão sem pedir merge
   - Pronto para revisão — pede revisão e merge
3. **Base do PR?** (header: "Base") — só vale se houver PR
   - main (Recomendado)
   - outra branch — o usuário informa qual em "Outro"

## Ação do Pipeline Runner

1. Combine as respostas com o plano: as ações aprovadas são **somente** os comandos do plano compatíveis com a escolha (ex.: "Só push" remove o `gh pr create`; "Draft" mantém `--draft`; "Pronto para revisão" remove `--draft`; base diferente troca `--base`).
2. Se o usuário pedir mudança no título ou no corpo do PR, registre o texto aprovado; o step-22 aplica antes de publicar.
3. Grave o arquivo abaixo (sem pasta `vN/`) e siga para o step-22. "Não publicar agora" e "Encerrar sem publicar" também seguem: o step-22 registra que nada foi executado.
4. "Voltar ao step-13" reinicia o loop de correção a partir do step-13, contando um ciclo de revisão.

## Formato de Salvamento

```markdown
# Aprovação de Publicação

**Data:** AAAA-MM-DD
**Gates:** QA {veredito} · Segurança {veredito | pulado}
**Decisão:** {Push da branch + PR | Só push da branch | Release completo | Não publicar agora | Voltar ao step-13 | Encerrar sem publicar}
**PR:** {Draft | Pronto para revisão | não se aplica} · **Base:** {main | outra: nome | não se aplica}

## Ações aprovadas (executar exatamente, nesta ordem)
1. `{comando}`
2. `{comando}`

## Textos aprovados
- **Título do PR:** {texto}
- **Corpo do PR:** `squads/agent-office-squad/output/{run_id}/20-release/vN/pr-body.md` {sem alterações | com as alterações: …}
- **Versão / tag:** {vX.Y.Z | não se aplica}

## Observações do usuário
{texto livre | nenhuma}
```
