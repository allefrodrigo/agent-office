---
task: "Especificar a interface"
order: 2
input: |
  - flows: saída da task map-flows-and-states
  - styles: src/renderer/src/styles.css (tokens e classes) e src/renderer/src/ui/dom.ts (h, icon)
  - voice: pipeline/data/product-voice.md
  - rubric: pipeline/data/quality-criteria.md — rubrica da spec de UX
output: |
  - ux_spec: output/07-ux/ux-spec.md — documento final do step-07 com fluxos, estados, componentes, mapa de teclado e foco, checklist WCAG 2.2 AA, microcopy de rascunho e dívidas de acessibilidade encontradas
---

# Especificar a interface

Converte fluxos e estados numa especificação implementável: componentes com classes e tokens reais, comportamento de foco e teclado, critérios WCAG 2.2 AA verificáveis e microcopy de rascunho. É a última task do step-07: consolida tudo no `ux-spec.md`.

## Process

1. Para cada componente tocado, descrever estrutura e hierarquia em termos do código atual: regiões, elementos criados com `h()`, ícones com `icon()`, classes existentes (`.panel-head`, `.chip`, `.dot-working`, `.empty`, `.btn`, `.btn-small`, `.field`, `.modal-*`, `.tcard`). Componente ou classe nova precisa de justificativa.
2. Definir tokens: cores só de `--text`, `--muted`, `--accent`, `--green`, `--amber`, `--blue`, `--red`; `--dim` apenas para texto não essencial ou grande. Raios com `--radius`, código com `--mono`.
3. Especificar papéis e nomes acessíveis: `role` (`list`/`listitem`, `dialog`, `status`), `aria-label` ou texto visível, `aria-live="polite"` para mudanças de status relevantes, `aria-modal` em cartões e modais.
4. Escrever o mapa de teclado e a ordem de foco: para onde vai o foco ao abrir e ao fechar (devolver ao elemento que abriu), Tab/Shift+Tab, setas em listas, Enter/Espaço, `Esc`.
5. Preencher o checklist WCAG 2.2 AA por critério: 1.4.3 contraste de texto ≥ 4,5:1 (3:1 para texto grande) · 1.4.11 contraste de componentes ≥ 3:1 · 1.4.1 nada só por cor · 2.1.1 tudo por teclado · 2.4.7 foco visível · 2.4.11 foco não encoberto · 2.5.8 alvo ≥ 24 × 24 px · 4.1.2 nome, papel, valor · 2.3.3/`prefers-reduced-motion` para animações.
6. Escrever o microcopy de rascunho em pt-BR (rótulos, estados vazios, erros, toasts) seguindo `product-voice.md`, marcado "rascunho — revisão da Lívia".
7. Registrar dívidas de acessibilidade encontradas no caminho (ex.: `.empty-hint`/`.field-hint` em `--dim` a 11,5 px ≈ 3,4:1; `.btn-primary` branco sobre `--accent` ≈ 3,1:1), separando o que entra na story do que vira ticket futuro.
8. Consolidar o `ux-spec.md` com fluxos, estados (da task anterior), componentes, teclado e foco, checklist, microcopy e dívidas, e gravar no arquivo do step.

## Output Format

```markdown
# Spec de UX — {iniciativa}
## Fluxos
## Estados por componente
## Componentes
### {nome} — estrutura, classes, tokens, papéis e nomes acessíveis
## Teclado e foco
| Tela/Componente | Ao abrir | Tab | Setas | Enter/Espaço | Esc | Ao fechar |
## Checklist WCAG 2.2 AA
| Critério | Resultado | Como verificar |
## Microcopy (rascunho — revisão da Lívia)
| Chave sugerida | Texto pt-BR | Onde |
## Dívidas de acessibilidade encontradas
## Pontos combinados com o world-spec
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# Spec de UX — Subagentes visíveis no escritório

## Componentes
### Seção "Subagentes" do painel
- Abaixo de `.ctx` no `.panel-head`; título `h('div', { class: 'tsection-label' }, 'Subagentes (2)')`.
- Lista `role="list"` com até 8 itens; cada item `role="listitem"`, `tabindex="0"`, com `.dot` + texto de status ("trabalhando", "terminou", "terminou com problema") — a cor nunca vem sozinha.
- Descrição como texto puro (`textContent`), truncada em 140 caracteres com "…", `title` com o texto completo.
- Mudança de status anunciada por um `aria-live="polite"` invisível: "Subagente terminou: Rodar a suíte de testes".

### Linha extra no cartão de permissão
- Abaixo do `.dialog-title`: `.dialog-note` com "Pedido de um subagente: {descrição}".

## Teclado e foco
| Tela/Componente | Ao abrir | Tab | Setas | Enter/Espaço | Esc | Ao fechar |
|---|---|---|---|---|---|---|
| Lista de subagentes | foco segue no composer | entra no primeiro item | ↑/↓ entre itens | destaca o estagiário no mundo | fecha o painel | foco volta ao avatar ou à linha da lista |

## Checklist WCAG 2.2 AA
| Critério | Resultado | Como verificar |
|---|---|---|
| 1.4.3 contraste do texto | ok — status em `--muted` (≈ 6:1 sobre `--bg`) | medir no DevTools |
| 1.4.1 nada só por cor | ok — ponto + texto | inspeção visual |
| 2.4.7 foco visível | ajustar — itens precisam de anel (`box-shadow` igual ao de `.input:focus`) | Tab até a lista |
| 2.5.8 alvo ≥ 24 px | ok — altura da linha 28 px | DevTools |
| 4.1.2 nome, papel, valor | ok — `role="listitem"` + texto | leitor de tela |
| movimento reduzido | ok — destaque sem pulsar com `prefers-reduced-motion: reduce` | emular no DevTools |

## Microcopy (rascunho — revisão da Lívia)
| Chave sugerida | Texto pt-BR | Onde |
|---|---|---|
| `panel.subagents.title` | Subagentes ({n}) | título da seção |
| `panel.subagents.more` | e mais {n} | fim da lista truncada |
| `dialog.permission.fromSubagent` | Pedido de um subagente: {descricao} | cartão de permissão |

## Dívidas de acessibilidade encontradas
- `.empty-hint` e `.field-hint` usam `--dim` a 11,5 px (≈ 3,4:1): fora desta story; sugerido ticket "Ajustar contraste das dicas".
```

## Quality Criteria

- [ ] Todo componente cita classes e tokens existentes ou justifica o novo.
- [ ] Mapa de teclado com abertura, navegação, ativação, `Esc` e devolução de foco.
- [ ] Checklist WCAG 2.2 AA com resultado e forma de verificar em cada linha.
- [ ] Microcopy para todo texto novo, com chave sugerida de i18n.
- [ ] Dívidas de acessibilidade separadas em "entra na story" e "vira ticket".

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Texto vindo de agente, hook ou ticket especificado com HTML ou `innerHTML` (viola I-06).
2. Status comunicado só por cor ou componente interativo sem acesso por teclado.
3. Spec sem checklist WCAG 2.2 AA ou sem mapa de foco.
4. Texto essencial especificado em `--dim` abaixo de 18,66 px em negrito ou 24 px.
