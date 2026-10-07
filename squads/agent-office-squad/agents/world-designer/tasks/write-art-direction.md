---
task: "Escrever a direção de arte e consolidar o world-spec"
order: 2
input: |
  - behavior_spec: saída da task design-world-behavior
  - visual_code: describe.ts (paletas e looks), furniture.ts, kit.ts, textures.ts, engine.ts, avatar.ts
  - perf_budget: orçamento de engineering-standards.md
output: |
  - art_direction: paleta, formas, proporções, animações e legibilidade
  - asset_list: assets novos/alterados com custo estimado e critério visual
  - delight_review: elementos lúdicos avaliados quanto a clareza e risco
  - world_spec: documento final do step-08 (comportamento + arte + aceite visual)
---

# Escrever a direção de arte e consolidar o world-spec

Define como os elementos novos parecem e se movem dentro da linguagem pixel/voxel isométrica existente, com custo de performance estimado, e junta tudo no `world-spec.md` que o Vitor Voxel implementa. A direção de arte nasce do que já está no código, não de referências externas soltas.

## Process

1. Inventariar a paleta existente antes de propor cor nova: `SKIN_TONES`, `HAIR_COLORS`, `SHIRT_COLORS`, `PANTS_COLORS`, `SHOE_COLORS` (`describe.ts`), `WOOD #c8925e`, `WOOD_DARK #8a5a3b`, `METAL #4b4f63`, `DARK #2b2d3a` (`furniture.ts`), fundo `#1c1d2e`, luz hemisférica `#f4f1ff` e sol `#fff1dc` (`engine.ts`). Cor nova só com justificativa de legibilidade.
2. Definir regras de forma: tudo montado com `box`/`blob`/`cylinder` de `kit.ts` sobre a geometria compartilhada `unitBox`, alinhado ao tile; personagens novos mantêm as proporções Habbo do `Avatar` (quadril 0,46, ombro 0,8, cabeça 1,04) e mudam escala em vez de proporção (ex.: estagiário a 0,8).
3. Checar legibilidade nos extremos: `pixelSize` 2, 3 (padrão), 4 e 5 e zoom 0,55 e 1,8 da `Engine` (câmera ortográfica 2:1, azimute 45°, elevação 30°, `RenderPixelatedPass` com bordas de normal 0,35 e profundidade 0,55). A silhueta deve ser distinguível sem cor.
4. Especificar animações procedurais com duração e curva: entrada e saída (referência: `vanish` encolhe em 0,6 s), ondas (`wave` dura 1,6 s ao chegar), nada de loop chamativo para estados de descanso; em segundo plano o app roda a ~20 fps, então nada pode depender de quadros exatos.
5. Estimar custo por asset: meshes, materiais (reutilizar materiais iguais), sombras (`castShadow` só no que aparece no chão), canvas/texture nova; meta de no máximo +30 draw calls no cenário de 20 agentes e nenhuma alocação por quadro.
6. Revisar o delight: listar elementos lúdicos tocados (lounge, jogos, airsoft, balões de reação) e garantir que não escondem status, não banalizam ações destrutivas (o terceiro tiro demite de verdade; agente do terminal só fecha após confirmação) e não incentivam gastar tokens.
7. Montar a lista de assets com critério de aceite visual: descrição, custo, captura de referência esperada (`AGENT_OFFICE_SHOTS` com câmera posicionada via `AGENT_OFFICE_EVAL`).
8. Consolidar o `world-spec.md`: resumo, comportamento (task 1), direção de arte, assets, capacidade, critérios de aceite visual, riscos e perguntas abertas.

## Output Format

```markdown
# World Spec — {iniciativa}
## Resumo (3–5 linhas)
## Comportamento do mundo        (da task 1)
## Direção de arte
### Paleta e materiais
### Formas e proporções
### Animações (nome · gatilho · duração · curva)
### Legibilidade (pixelSize 2–5, zoom 0,55–1,8)
## Assets novos ou alterados
| Asset | Descrição | Meshes/materiais | Draw calls (20 agentes) | Captura de aceite |
## Revisão de delight
## Critérios de aceite visual
## Riscos e perguntas abertas
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# World Spec — Subagentes visíveis no escritório

## Resumo
Subagentes aparecem como "estagiários" sentados em pufes ao lado da mesa do agente que os chamou.
Até 3 por agente; acima disso, etiqueta "+N" no crachá. Eles surgem e somem com animação curta
e nunca vão até a sala do usuário.

## Direção de arte
### Paleta e materiais
- Estagiário usa o mesmo `lookFromSeed` com semente `parentId + índice`; camisa sempre de `SHIRT_COLORS`.
- Pufe reaproveita `beanBag()` do lounge, em `#a29bfe` (já usado no lounge), sem material novo.
### Formas e proporções
- Avatar em escala 0,8; cabeça e crachá na mesma proporção. Sem prop.
### Animações
| Nome | Gatilho | Duração | Curva |
|---|---|---|---|
| surgir | subagente começa | 0,4 s | escala 0 → 1, ease-out |
| sumir | subagente termina | 0,6 s | igual a `vanish` |
### Legibilidade
- Em `pixelSize` 5 o estagiário vira 3 blocos; a diferença de altura em relação ao agente basta.

## Assets novos ou alterados
| Asset | Descrição | Meshes/materiais | Draw calls (20 agentes) | Captura de aceite |
|---|---|---|---|---|
| Estagiário | Avatar escala 0,8 | reusa Avatar | +12 (limite global) | `qa-1.png`: mesa 3 com 2 estagiários |
| Etiqueta "+N" | texto no crachá HTML | 0 | 0 | `qa-2.png`: agente com 5 subagentes |

## Revisão de delight
- Estagiários não reagem ao airsoft (não são agentes demissíveis); o tiro atravessa.

## Critérios de aceite visual
1. Em `pixelSize` 3 e zoom 1, dá para contar os estagiários de cada mesa.
2. Com 20 agentes e 12 estagiários, o demo mantém 60 fps com a janela em foco.
```

## Quality Criteria

- [ ] Nenhuma cor nova sem justificativa; a paleta reaproveita constantes existentes.
- [ ] Cada animação tem gatilho, duração e curva, e nenhuma depende de taxa de quadros exata.
- [ ] Cada asset tem custo estimado e critério de aceite visual verificável por captura.
- [ ] A revisão de delight cobre todo elemento lúdico tocado pela iniciativa.
- [ ] O world-spec final contém o comportamento da task 1 sem perder linhas da tabela.

## Veto Conditions

Reject and redo if ANY are true:
1. Algum asset novo não tem estimativa de custo ou estoura a meta de draw calls sem justificativa registrada.
2. A legibilidade em `pixelSize` 5 ou zoom 0,55 não foi avaliada.
3. Algum elemento lúdico esconde status ou torna uma ação destrutiva mais fácil do que hoje.
4. O world-spec omite critérios de aceite visual.
