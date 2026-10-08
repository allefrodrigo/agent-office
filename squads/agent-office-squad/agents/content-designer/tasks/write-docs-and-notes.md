---
task: "Atualizar documentação e escrever notas de versão"
order: 2
input: |
  - copy_review: saída da task review-copy-and-i18n
  - stories: stories selecionadas com critérios de aceite
  - gates: qa-gate.md e security-gate.md (vereditos e limites conhecidos)
  - architecture: architecture.md (ADRs aceitos)
  - prd: prd.md aprovado (para o resumo durável)
output: |
  - docs_changes: arquivos de documentação alterados no repositório
  - changelog_entry: entrada na seção "Não lançado" do CHANGELOG.md
  - release_notes: notas de versão para usuários (pt-BR)
  - promoted_docs: ADRs e resumo de PRD promovidos para docs/
  - docs_report: documento final do step-19
---

# Atualizar documentação e escrever notas de versão

Faz a documentação do repositório acompanhar o que foi entregue e transforma a run em texto para quem usa o produto. Promove para `docs/` apenas o que foi aceito (ADR com status aceito, PRD aprovado) e consolida o relatório do step-19.

## Process

1. Listar o que mudou para o usuário a partir das stories selecionadas e dos vereditos: funcionalidades novas, mudanças de comportamento, limites conhecidos (CONCERNS do QA, CONDITIONS de segurança, plataformas não verificadas).
2. Atualizar o `README.md`: item na seção "O que faz" (mesmo estilo dos itens atuais: negrito no nome, frase direta), controles novos e, se a arquitetura mudou, a árvore da seção "Arquitetura".
3. Atualizar o `COMO-RODAR.md` quando houver passo novo, comando novo (sempre com equivalente PowerShell) ou problema comum novo na tabela de solução de problemas.
4. Atualizar o `CHANGELOG.md`: se não existir, criar no formato Keep a Changelog em pt-BR com a seção `## [Não lançado]`; adicionar itens em "Adicionado", "Alterado", "Corrigido" ou "Segurança", cada um com a story (`S-n`) e o ticket (`AO-n`) quando houver.
5. Escrever as notas de versão para usuários: benefício primeiro, depois como usar, requisitos (versão do Claude Code, plataforma) e limites; sem jargão interno do squad.
6. Promover documentos duráveis: cada ADR aceito em `architecture.md` vira `docs/adr/NNNN-titulo-em-kebab.md` (numeração sequencial a partir do maior existente; status, data e contexto preservados); o resumo do PRD aprovado vira `docs/prd/{run_slug}.md` (problema, métricas, escopo dentro/fora, decisões).
7. Conferir links relativos e comandos citados (os comandos existem em `package.json`; caminhos existem no repositório).
8. Fazer commit local "Atualiza documentação ({run_slug})" com os arquivos de documentação; nunca fazer push.
9. Consolidar o `docs-report.md` com a revisão de textos (task 1), os arquivos alterados, a entrada do changelog, as notas de versão e os documentos promovidos.

## Output Format

```markdown
# Docs Report — {iniciativa}
## Revisão de textos e i18n        (da task 1)
## Documentação atualizada
| Arquivo | O que mudou |
## Entrada do CHANGELOG
## Notas de versão (para usuários)
## Documentos promovidos para docs/
## Commit local
- {hash} Atualiza documentação ({run_slug})
## Pendências
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# Docs Report — Subagentes visíveis no escritório

## Documentação atualizada
| Arquivo | O que mudou |
|---|---|
| README.md | Novo item "Subagentes" em "O que faz"; árvore de arquitetura cita o evento `agent:subagent` |
| COMO-RODAR.md | Seção "Conversar com um agente" explica a lista de subagentes no painel |
| CHANGELOG.md | Criado com a seção [Não lançado] |
| docs/adr/0001-eventos-de-subagentes.md | ADR promovido (status: aceito) |
| docs/prd/subagentes-visiveis.md | Resumo do PRD aprovado |

## Entrada do CHANGELOG
### Adicionado
- Subagentes aparecem como estagiários ao lado da mesa do agente que os chamou (S-2).
- Painel do agente lista os subagentes ativos e permite focar cada um no escritório (S-3).
### Alterado
- O processo principal passa a emitir o evento `agent:subagent` para sessões do escritório e do terminal (S-1).

## Notas de versão (para usuários)
**Veja quem está ajudando seus agentes.** Quando um agente delega uma tarefa a um subagente,
um estagiário senta ao lado da mesa dele e mostra o que está fazendo. Até três aparecem no
escritório; os demais são contados no crachá ("+2"). No painel do agente, a lista "Subagentes
ativos" mostra cada um e leva a câmera até ele.

Requisitos: Claude Code com suporte a subagentes (ferramenta Agent). Limites: no Windows, sessões
do terminal só mostram subagentes depois que a ponte for reconectada (Configurações → Conectar).

## Commit local
- 4f2a9c1 Atualiza documentação (subagentes-visiveis)

## Pendências
- Capturas para o README dependem do kit da Camila Comunidade (step-23).
```

## Quality Criteria

- [ ] README, COMO-RODAR e CHANGELOG refletem todas as stories entregues e seus limites.
- [ ] Todo comando citado existe e tem equivalente PowerShell quando a sintaxe difere.
- [ ] As notas de versão começam pelo benefício e citam requisitos e limites.
- [ ] Só ADRs aceitos e PRD aprovado foram promovidos para `docs/`, com numeração correta.
- [ ] O commit local contém apenas arquivos de documentação e textos revisados.

## Veto Conditions

Reject and redo if ANY are true:
1. Uma funcionalidade entregue não aparece no README nem no CHANGELOG.
2. As notas de versão prometem algo que o QA marcou como não verificado ou fora de escopo.
3. Foi feito push ou o commit inclui código fora de strings e documentação.
4. Um ADR com status diferente de aceito foi promovido.
