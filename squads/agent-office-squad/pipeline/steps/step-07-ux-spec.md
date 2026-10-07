---
execution: inline
agent: ux-designer
tasks:
  - map-flows-and-states
  - specify-interface
outputFile: squads/agent-office-squad/output/07-ux/ux-spec.md
---

# Step 07: Especificação de UX — 🧭 Úrsula Usabilidade

## Context Loading

Carregue antes de executar (outputs de agente: maior `vN/`, run-conventions §2):
- `squads/agent-office-squad/output/{run_id}/02-plan/vN/run-plan.md` e `squads/agent-office-squad/output/{run_id}/03-plan-approval.md`.
- `squads/agent-office-squad/output/{run_id}/05-prd/vN/prd.md` e `squads/agent-office-squad/output/{run_id}/06-prd-approval.md` — requisitos, fatia e ajustes obrigatórios.
- `squads/agent-office-squad/output/{run_id}/04-discovery/vN/discovery-brief.md` — como os concorrentes resolvem a interface.
- `_opensquad/_memory/company.md` e `squads/agent-office-squad/_memory/memories.md`.
- `squads/agent-office-squad/pipeline/data/product-voice.md` — voz e microcopy em pt-BR.
- `squads/agent-office-squad/pipeline/data/architecture-map.md` (módulos da UI), `engineering-standards.md`, `quality-criteria.md` (rubrica de UX) e `anti-patterns.md`.
- Código: `src/renderer/src/ui/hud.ts`, `panel.ts`, `dialog.ts`, `board.ts`, `modals.ts`, `dom.ts` (helper `h()`, ícones), `src/renderer/src/main.ts` (atalhos T e Esc), `src/renderer/src/styles.css` (classes e cores existentes).
- Em re-execução: versão anterior do ux-spec e o feedback que motivou a volta.

## Instructions

### Gate do track

1. Leia o run-plan e a aprovação do step-03 (a aprovação prevalece).
2. Este step roda quando a **interface 2D muda**: no track iniciativa, sempre que algum requisito da fatia aprovada toca HUD, painel, cartões, modais ou quadro; no track entrega, só se além disso a complexidade for STANDARD ou COMPLEX. Nos demais tracks o status é `skip`.
3. Se o status for `skip`, grave a nota de pulo do run-conventions §3 (título `# Step 07 — Pulado`, motivo, track e complexidade) e encerre.

### Process

1. Liste os requisitos da fatia aprovada que tocam a interface 2D e aplique os ajustes obrigatórios do checkpoint 06.
2. **Task `map-flows-and-states`:** descreva os fluxos (caminho feliz e caminhos de recuperação) a partir dos pontos de entrada reais: botões do HUD, clique no avatar ou no crachá, atalhos, quadro.
3. Faça o inventário de estados de cada componente: vazio, carregando, sucesso, erro, bloqueado, desabilitado — com o que aparece e a ação disponível em cada um.
4. **Task `specify-interface`:** especifique componentes e layout reutilizando padrões existentes (seções do painel, cartões, `h()`, classes do `styles.css`); componente novo exige justificativa de por que o padrão atual não serve.
5. Teclado: ordem de Tab, Enter/Espaço, Esc fecha (padrão atual). Não use letras soltas: W, A, S, D, T, E e Q já são do jogo.
6. Acessibilidade WCAG 2.2 AA: papel e nome acessível, foco visível, contraste, `aria-live` com moderação, status nunca só por cor, alvo de clique ≥ 24 px.
7. Fricção proporcional ao risco: ações destrutivas (demitir, fechar sessão, modo "Sem pedir nada") pedem confirmação; ações de leitura, não.
8. Escreva o microcopy de rascunho em pt-BR seguindo o product-voice, com chave de i18n sugerida; a revisão final é da Lívia Linguagem.
9. Proponha critérios de aceite Given/When/Then para o Kauã Kanban e registre perguntas abertas em vez de inventar comportamento.
10. Em re-execução, abra com "Mudanças nesta versão"; apresente um resumo de 4 linhas e grave no caminho transformado.

## Output Format

The output MUST follow this exact structure:
```markdown
# UX spec — {título da iniciativa}

**Versão:** v{n} · **Designer:** Úrsula Usabilidade · **Requisitos cobertos:** {FR-…}

## Mudanças nesta versão
## Fluxos
## Inventário de estados
| Componente | Estado | O que aparece | Ação disponível |
## Especificação de componentes
- **Local / Estrutura / Comportamento / Teclado / Acessibilidade** por componente
## Microcopy (rascunho — revisão final da Lívia Linguagem)
| Chave sugerida | Texto pt-BR | Contexto |
## Critérios de aceite sugeridos
## Riscos de usabilidade
## Perguntas abertas
```

## Output Example

```markdown
# UX spec — Subagentes visíveis no escritório

**Versão:** v1 · **Designer:** Úrsula Usabilidade · **Requisitos cobertos:** FR-4 (e o foco de câmera ligado ao FR-3)

## Fluxos
1. O crachá mostra "Delegando: Revisar testes" → o usuário clica no agente → o painel abre com a seção "Subagentes ativos (2)".
2. O usuário clica (ou dá Enter) numa linha → a câmera centraliza o estagiário e o painel continua aberto.
3. O subagente termina → a linha sai da lista; se era o último, a seção some.

## Inventário de estados
| Componente | Estado | O que aparece | Ação disponível |
|---|---|---|---|
| Seção "Subagentes ativos" | vazio | seção oculta | — |
| Seção | 1–3 itens | uma linha por subagente, com descrição e tempo | focar |
| Seção | 4 ou mais | 3 linhas + botão "e mais N" | expandir |
| Linha | trabalhando | ponto + texto "trabalhando" | focar |
| Linha | erro | ponto + texto "falhou" | focar |
| Seção (agente do terminal) | ponte desatualizada | aviso "Reconecte a ponte para ver subagentes do terminal." | abrir Configurações |

## Especificação de componentes
- **Local:** painel do agente, abaixo da barra de contexto e acima do log.
- **Estrutura:** `section.panel-subagents` > `h3` "Subagentes ativos (n)" > `ul` > `li` > `button` com descrição (até 60 caracteres) e tempo ("há 2 min").
- **Comportamento:** ordem estável por início, para a lista não pular sob o mouse.
- **Teclado:** linhas entram na ordem de Tab depois do botão "Compactar"; Enter/Espaço focam; Esc fecha o painel como hoje.
- **Acessibilidade:** `aria-label` "Subagente: Revisar testes, trabalhando há 2 minutos"; status com texto além da cor; contador em `aria-live="polite"` com no máximo um anúncio a cada 10 s.

## Microcopy (rascunho — revisão final da Lívia Linguagem)
| Chave sugerida | Texto pt-BR | Contexto |
|---|---|---|
| panel.subagents.title | Subagentes ativos ({n}) | título da seção |
| panel.subagents.more | e mais {n} | botão de expandir |
| panel.subagents.bridgeOutdated | Reconecte a ponte para ver subagentes do terminal. | aviso |

## Critérios de aceite sugeridos
1. Dado um agente com 2 subagentes ativos, quando o painel abre, então a seção mostra 2 linhas com descrição e tempo.
2. Dado o foco numa linha, quando o usuário aperta Enter, então a câmera centraliza o estagiário correspondente.

## Riscos de usabilidade
- Anúncios demais no leitor de tela com muitos subagentes → limite de 1 anúncio a cada 10 s.

## Perguntas abertas
- Mostrar por 60 s, esmaecidos, os subagentes recém-encerrados? (fora do PRD; decisão da Rita Roadmap)
```

## Veto Conditions

As condições abaixo não se aplicam à nota de pulo. Reject and redo if ANY are true:
1. Componente sem estados de vazio ou de erro especificados.
2. Interação possível só com mouse, ou atalho que colide com W, A, S, D, T, E ou Q.
3. Status comunicado só por cor.
4. Texto de interface em inglês ou fora da voz do product-voice.

## Quality Criteria

- [ ] Todo requisito de interface da fatia aprovada aparece num fluxo
- [ ] Padrões existentes reutilizados; componente novo tem justificativa
- [ ] Critérios WCAG 2.2 AA citados por componente
- [ ] Microcopy com chave de i18n sugerida
- [ ] Critérios de aceite sugeridos em Given/When/Then
- [ ] Perguntas abertas nomeiam quem decide
