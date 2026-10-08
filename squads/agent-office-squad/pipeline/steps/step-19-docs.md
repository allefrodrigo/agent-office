---
execution: inline
agent: content-designer
tasks:
  - review-copy-and-i18n
  - write-docs-and-notes
outputFile: squads/agent-office-squad/output/19-docs/docs-report.md
---

# Step 19: Docs, i18n e notas de versão — ✍️ Lívia Linguagem

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2).

- `_opensquad/_memory/company.md` — tom de voz do produto e público
- `squads/agent-office-squad/_memory/memories.md` — preferências de escrita e proibições
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — pulo, commits e promoção de documentos (§5)
- `output/{run_id}/02-plan/vN/run-plan.md` e `output/{run_id}/03-plan-approval.md` — track e condição do step
- `output/{run_id}/06-prd-approval.md` e `output/{run_id}/05-prd/vN/prd.md` — o que foi aprovado (se existirem)
- `output/{run_id}/09-architecture/vN/architecture.md` — ADRs aceitos (se existir)
- `output/{run_id}/10-stories/vN/stories.md` e `output/{run_id}/12-story-selection.md` — o que entrou na run
- `output/{run_id}/13-integration/…`, `14-platform/…`, `15-world/…`, `16-ui/vN/impl-report.md` — textos novos listados pelos engenheiros
- `output/{run_id}/17-qa/vN/qa-gate.md` e `output/{run_id}/18-security/vN/security-gate.md` — limitações conhecidas (CONCERNS, CONDITIONS)
- `squads/agent-office-squad/pipeline/data/product-voice.md` — voz, glossário, padrões de erro e regras de i18n
- `squads/agent-office-squad/pipeline/data/engineering-standards.md` — estado do i18n e convenções de texto no código
- Documentos do repositório: `README.md`, `COMO-RODAR.md`, `CHANGELOG.md` (se existir), `docs/` (se existir)
- Código: `git diff main...HEAD -- src/` (strings em pt-BR na UI, em `src/shared/describe.ts`, mensagens de erro do main e notificações do `index.ts`)

## Instructions

### Gate do track

Aplique o protocolo de pulo (run-conventions §3). `discovery`: pule. `iniciativa`: roda. `entrega` e `bugfix`: rodam só se a run muda algo visível ao usuário (texto, comportamento, comando ou requisito). `release`: roda para as notas de versão e o CHANGELOG.

### Process

1. **Levante os textos novos ou alterados** no diff e nas tabelas "Textos novos" dos relatórios; inclua mensagens de erro lançadas pelo main que chegam ao usuário.
2. **Revise cada texto** contra o product-voice: diz o que aconteceu e o que fazer, usa o termo do glossário (contratar, chamar, demitir, quadro, ticket, sessão), acentuação correta, sem "Ops!" ou "Algo deu errado". Corrija só o texto; se a correção exigir lógica, registre como pendência para o executor.
3. **Prepare para i18n.** Sem catálogo de traduções (estado atual), garanta que cada texto novo é uma frase inteira (sem concatenar pedaços), com variáveis nomeadas e plural tratado, e registre a dívida. Com catálogo, crie as chaves com pt-BR como fonte e marque en/es como pendentes.
4. **Atualize a documentação**: bullet em "O que faz" do `README.md`; passos de uso no `COMO-RODAR.md` quando houver ação nova; `CHANGELOG.md` na seção "Não lançado" (crie o arquivo no formato Keep a Changelog em pt-BR — Adicionado, Alterado, Corrigido, Segurança — se não existir).
5. **Escreva as notas de versão** para usuários: benefício primeiro, como usar, requisitos e limitações conhecidas (plataforma não verificada, CONCERNS e CONDITIONS em aberto). Nada de lista de commits.
6. **Promova documentos duráveis**: ADR aceito → `docs/adr/NNNN-titulo.md`; resumo do PRD aprovado no step-06 → `docs/prd/{run_slug}.md`.
7. **Verifique e commite.** Se algum texto mudou no código, rode `npm run typecheck` e `npm run build`. Commit local: `Atualiza documentação de {tema} (docs)`. Nunca push.
8. **Escreva o relatório** com a tabela de textos, o estado do i18n, os arquivos de documentação tocados e as notas de versão.

## Output Format

The output MUST follow this exact structure:

````markdown
# Docs, i18n e Notas de Versão — {run_slug} (step-19)

## Textos revisados
| Onde | Antes | Depois | Motivo |
|---|---|---|---|

## Estado do i18n
- {textos prontos para i18n | dívidas registradas | chaves criadas}

## Documentação atualizada
- `{arquivo}` — {o que mudou}

## Documentos promovidos
- `{docs/adr/… | docs/prd/…}` — {origem}

## Notas de versão (rascunho para usuários)
{texto em pt-BR, pronto para colar no PR e no release}

## Pendências para executores
- {texto que exige mudança de lógica — executor — story | nenhuma}

## Verificação
- `npm run typecheck` → {… | não necessário} · `npm run build` → {… | não necessário}
- **Commit:** `{hash}` {mensagem}
````

## Output Example

````markdown
# Docs, i18n e Notas de Versão — subagentes-visiveis (step-19)

## Textos revisados
| Onde | Antes | Depois | Motivo |
|---|---|---|---|
| Painel, título da seção | Subagents | Subagentes | UI em pt-BR |
| Painel, estado vazio | Nenhum subagente agora. | Nenhum subagente agora. | mantido: claro e curto |
| Mundo, etiqueta "+N" | +2 | +2 (nome acessível "Mais 2 subagentes") | leitor de tela lia só "mais dois" |
| Balão do estagiário | Delegando: listar arquivos .ts | Ajudando: listar arquivos .ts | o estagiário ajuda; quem delega é o agente |

## Estado do i18n
- 4 textos novos, todos frases inteiras com variável nomeada (`{count}`); sem catálogo ainda — dívida mantida no engineering-standards.

## Documentação atualizada
- `README.md` — bullet "Subagentes visíveis" em "O que faz"
- `COMO-RODAR.md` — seção "Ver os subagentes de um agente" com o caminho pelo painel
- `CHANGELOG.md` — criado; "Não lançado → Adicionado: subagentes aparecem como estagiários ao lado da mesa e no painel do agente"

## Documentos promovidos
- `docs/adr/0007-subagentes-por-tool-use.md` — ADR-007 da arquitetura
- `docs/prd/subagentes-visiveis.md` — resumo do PRD aprovado no step-06

## Notas de versão (rascunho para usuários)
**Subagentes visíveis.** Quando um agente delega parte do trabalho, o subagente aparece como estagiário ao lado da mesa dele, com o que está fazendo no balão. No painel do agente, a seção "Subagentes" lista quem está ajudando e há quanto tempo.
Requisitos: Claude Code instalado e logado. Limitações: testado no Windows; no macOS ainda não verificado. Com muitos agentes na tela, a etiqueta "+N" pode encostar no crachá.

## Pendências para executores
- Nenhuma.

## Verificação
- `npm run typecheck` → verde · `npm run build` → verde
- **Commit:** `e51a07d` Atualiza documentação de subagentes visíveis (docs)
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Texto novo visível ao usuário fora da tabela de revisão.
2. Mudança de lógica feita a pretexto de corrigir texto, ou typecheck/build vermelho depois de alterar strings no código.
3. Notas de versão que omitem limitação conhecida (CONCERNS, CONDITIONS, plataforma não verificada) ou prometem algo fora das stories selecionadas.
4. Documento promovido para `docs/` sem aprovação correspondente (ADR não aceito, PRD não aprovado).

## Quality Criteria

- [ ] Cada texto revisado tem motivo ligado ao product-voice ou ao glossário
- [ ] Nenhuma frase montada por concatenação de pedaços
- [ ] README, COMO-RODAR e CHANGELOG coerentes entre si
- [ ] Notas de versão falam de benefício e de como usar
- [ ] Erros novos dizem o que aconteceu e o que fazer
- [ ] Commit local de docs no padrão do histórico
