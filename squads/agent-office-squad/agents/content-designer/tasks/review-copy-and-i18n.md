---
task: "Revisar textos e preparar i18n"
order: 1
input: |
  - diff: saída de `git diff main...HEAD` na branch da run
  - stories: stories selecionadas (para saber o que é visível ao usuário)
  - voice_guide: pipeline/data/product-voice.md
  - impl_reports: relatórios dos steps 13–16 (textos citados pelos engenheiros)
output: |
  - string_inventory: todas as strings novas ou alteradas, com arquivo e público (pessoa ou agente)
  - copy_fixes: correções aplicadas (antes → depois → regra)
  - behavior_findings: problemas que exigem mudança de comportamento (não corrigidos aqui)
  - i18n_notes: chaves propostas, riscos de tradução e plano (sem implementar fora de story)
---

# Revisar textos e preparar i18n

Audita toda string que entrou ou mudou na run, corrige o que é só texto e deixa registrado o que depende de comportamento. Como o Agent Office ainda não tem infraestrutura de i18n, propõe chaves e aponta riscos de tradução, mas não cria a estrutura fora de uma story.

## Process

1. Gerar o diff da run: `git diff main...HEAD -- src/` (e `README.md`/`COMO-RODAR.md` se tocados). Se a branch base não for `main`, usar a base registrada no run-plan.
2. Extrair as strings novas ou alteradas: literais em `h(...)`, `toast(...)`, `throw new Error(...)`, `confirmDialog({...})`, `setBubble(...)`, `describeTool`/`describePermission`, rótulos de `STATUSES`/`TYPES`/`PRIORITIES`, `ticketBrief` e instruções de ferramentas MCP em `tickets.ts`.
3. Classificar o público de cada string: **pessoa** (UI, erros, diálogos) ou **agente** (`ticketBrief`, descrições de ferramentas MCP, mensagens de negação enviadas ao modelo, `systemPrompt.append`). Strings para agente só mudam com nota de impacto para o Henrique Hook.
4. Avaliar cada string contra o `product-voice.md`: termo do glossário, clareza, erro acionável, tamanho (balão ≤ 32 caracteres, toast ≤ 120), tom (sem "Ops!", sem exclamação em mensagem de sistema), acentuação e concordância.
5. Corrigir apenas texto, preservando placeholders e variáveis; se a correção exigir nova condição, novo estado ou novo botão, registrar em `behavior_findings` e não editar a lógica.
6. Verificar riscos de i18n: concatenação com variáveis, plural manual (`critério(s)`), gênero, datas e números fora de `Intl`/`toLocale*`, texto embutido em canvas (`screens.ts`) ou em imagens, atalhos de teclado citados no texto.
7. Propor chaves de i18n no padrão `area.componente.mensagem` (ex.: `board.delegate.busyAgent`) para cada string nova, sem criar arquivos de catálogo; se a run tiver story de i18n, seguir a estrutura definida no ADR dela.
8. Rodar `npm run typecheck` depois das correções e registrar o resultado; fazer commit local "Revisa textos da interface (run {run_id})" só se houver correção.

## Output Format

```markdown
## Revisão de textos e i18n
### Inventário (N strings)
| Arquivo:linha | Público | Texto | Situação |
### Correções aplicadas
| Antes | Depois | Regra (product-voice.md) |
### Achados de comportamento (não corrigidos)
### Notas de i18n
| String | Chave proposta | Risco de tradução |
### Verificação
- npm run typecheck: {resultado}
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
## Revisão de textos e i18n — run 2026-10-08-101500

### Inventário (7 strings)
| Arquivo:linha | Público | Texto | Situação |
|---|---|---|---|
| ui/panel.ts:212 | pessoa | "Subagentes ativos" | ok |
| ui/panel.ts:230 | pessoa | "Nenhum sub-agente rodando agora!" | corrigido |
| game.ts:388 | pessoa | `+${n} delegados` | ok, risco de plural |
| main/agents.ts:301 | agente | "Subagent finished" (log) | ok (não visível) |
| shared/describe.ts:46 | pessoa | "Delegando: {descrição}" | ok |
| main/bridge.ts:198 | pessoa | "Subagente encerrou com erro" | corrigido |
| ui/panel.ts:241 | pessoa | "Clique aqui para focar" | corrigido |

### Correções aplicadas
| Antes | Depois | Regra (product-voice.md) |
|---|---|---|
| "Nenhum sub-agente rodando agora!" | "Nenhum subagente trabalhando agora." | glossário: "subagente"; sem exclamação |
| "Subagente encerrou com erro" | "Um subagente parou com erro. Veja o log do agente." | erro acionável |
| "Clique aqui para focar" | "Mostrar no escritório" | sem "clique aqui"; verbo no início |

### Achados de comportamento (não corrigidos)
- O painel não mostra estado de carregamento enquanto a lista de subagentes chega: precisa de estado vazio distinto de "carregando" (Fernanda Front).

### Notas de i18n
| String | Chave proposta | Risco de tradução |
|---|---|---|
| `+${n} delegados` | `world.badge.delegatedCount` | plural: usar Intl.PluralRules |
| "Subagentes ativos" | `panel.subagents.title` | nenhum |

### Verificação
- npm run typecheck: ok (0 erros)
```

## Quality Criteria

- [ ] Toda string nova ou alterada do diff está no inventário com público definido.
- [ ] Cada correção cita a regra do `product-voice.md` que a motivou.
- [ ] Nenhuma correção alterou lógica, condição ou estrutura de componente.
- [ ] Riscos de i18n (plural, concatenação, formatação) foram apontados com chave proposta.
- [ ] Strings lidas por agentes alteradas têm nota de impacto.

## Veto Conditions

Reject and redo if ANY are true:
1. O inventário foi montado sem ler o diff completo de `src/`.
2. Alguma correção mudou comportamento de código além do texto.
3. Uma string lida por agente mudou sem nota de impacto.
4. O typecheck falhou depois das correções e isso não foi resolvido ou registrado.
