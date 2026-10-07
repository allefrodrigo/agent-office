---
execution: inline
agent: world-designer
tasks:
  - design-world-behavior
  - write-art-direction
outputFile: squads/agent-office-squad/output/08-world/world-spec.md
---

# Step 08: Especificação do mundo — 🧱 Iuri Isométrico

## Context Loading

Carregue antes de executar (outputs de agente: maior `vN/`, run-conventions §2):
- `squads/agent-office-squad/output/{run_id}/02-plan/vN/run-plan.md` e `squads/agent-office-squad/output/{run_id}/03-plan-approval.md`.
- `squads/agent-office-squad/output/{run_id}/05-prd/vN/prd.md` e `squads/agent-office-squad/output/{run_id}/06-prd-approval.md` — requisitos, fatia e ajustes obrigatórios.
- `squads/agent-office-squad/output/{run_id}/07-ux/vN/ux-spec.md`, se existir — para o mundo e a interface 2D contarem a mesma história.
- `squads/agent-office-squad/output/{run_id}/04-discovery/vN/discovery-brief.md` — referências visuais dos concorrentes.
- `_opensquad/_memory/company.md` e `squads/agent-office-squad/_memory/memories.md`.
- `squads/agent-office-squad/pipeline/data/product-dossier.md`, `architecture-map.md` (módulos do mundo), `engineering-standards.md` (orçamento de performance), `quality-criteria.md` (rubrica do mundo) e `anti-patterns.md`.
- Código: `src/renderer/src/game.ts` (`Goal`, `desired()`, `reconcile()`, `pose()`, `bubble()`), `world/layout.ts` (`ZONES`, `DESKS`, `VISIT_SPOTS`, `LOUNGE_SEATS`), `world/avatar.ts` (`Pose`, `Prop`), `world/screens.ts`, `world/overlays.ts`, `world/furniture.ts`, `world/kit.ts`, `world/engine.ts` (`ZOOMS`, pixelSize).
- Em re-execução: versão anterior do world-spec e o feedback que motivou a volta.

## Instructions

### Gate do track

1. Leia o run-plan e a aprovação do step-03 (a aprovação prevalece).
2. Este step roda quando o **mundo 3D muda**: no track iniciativa, sempre que algum requisito da fatia aprovada toca personagens, móveis, zonas, telas ou balões; no track entrega, só se além disso a complexidade for STANDARD ou COMPLEX. Nos demais tracks o status é `skip`.
3. Se o status for `skip`, grave a nota de pulo do run-conventions §3 (título `# Step 08 — Pulado`, motivo, track e complexidade) e encerre.

### Process

1. Liste os requisitos da fatia aprovada que tocam o mundo e confira a coerência com o ux-spec (ex.: clicar numa linha do painel foca o personagem certo).
2. **Task `design-world-behavior`:** monte a tabela estado/evento → meta → posição → pose → prop → balão → tela. Todo comportamento corresponde a um estado real do agente — nada de animação sem significado.
3. Defina a ocupação: tiles candidatos, reservas, filas e o que fazer sem espaço livre. Nunca use `VISIT_SPOTS` nem bloqueie a rota até a sala do usuário.
4. Cubra os casos-limite: 10 mesas ocupadas e agentes em overflow, agente demitido ou derrubado pelo airsoft, sessão do terminal, reinício do app, muitos eventos em sequência.
5. **Task `write-art-direction`:** silhueta legível em pixelSize 2–5 e em todos os níveis de zoom, paleta derivada das cores existentes (`describe.ts`), escala, animações procedurais no estilo do `avatar.ts`.
6. Assets novos: primitivas do `kit.ts`/`furniture.ts`, dimensões em tiles e cores; prefira reaproveitar (ex.: `laptop()` já existe).
7. Orçamento de performance: meshes e draw calls extras, geometria e materiais compartilhados, nenhuma alocação por frame; o contrato continua 60 fps com foco e ~20 fps em segundo plano.
8. Ética do lúdico: delight nunca esconde balão de permissão ou resultado e nunca torna fácil uma ação destrutiva sem confirmação.
9. Plano de capturas (`AGENT_OFFICE_SHOTS` + `AGENT_OFFICE_EVAL` no demo isolado), critérios de aceite sugeridos e perguntas abertas.
10. Em re-execução, abra com "Mudanças nesta versão"; apresente um resumo de 4 linhas e grave no caminho transformado.

## Output Format

The output MUST follow this exact structure:
```markdown
# World spec — {título da iniciativa}

**Versão:** v{n} · **Designer:** Iuri Isométrico · **Requisitos cobertos:** {FR-…}

## Mudanças nesta versão
## Tabela de comportamento
| Estado / evento | Meta | Posição | Pose | Prop | Balão | Tela |
## Ocupação e caminhos
## Casos-limite
## Direção de arte
## Assets novos
| Nome | Primitiva | Dimensão | Cores |
## Orçamento de performance
## Plano de capturas
## Critérios de aceite sugeridos
## Perguntas abertas
```

## Output Example

```markdown
# World spec — Subagentes visíveis no escritório

**Versão:** v1 · **Designer:** Iuri Isométrico · **Requisitos cobertos:** FR-3, CON-2, NFR-1

## Tabela de comportamento
| Estado / evento | Meta | Posição | Pose | Prop | Balão | Tela |
|---|---|---|---|---|---|---|
| `agent:subagent` start | aparecer | tile livre ao lado da mesa do pai | stand → type | laptop | nenhum (só no hover) | — |
| subagente trabalhando | ficar | mesmo tile | type | laptop | nenhum | — |
| `agent:subagent` end | sair | — | wave curto (0,4 s) | — | "✓" por 1 s | — |
| pai indo à sua sala | ficar | mesmo tile | stand | laptop | nenhum | — |
| pai demitido ou fora do escritório | sair junto | — | — | — | — | — |

## Ocupação e caminhos
- Candidatos: tiles walkable a até 1 tile da `approach` da mesa do pai, fora de `VISIT_SPOTS` e do corredor central.
- Sem tile livre: o estagiário não aparece e o crachá do pai mostra "+N".
- Sem pathfinding: surge com escala 0 → 0,75 em 0,3 s e sai pelo `vanish()` existente (sem trânsito pelo elevador).

## Casos-limite
- 10 agentes com 3 estagiários cada: 40 atores, dentro do orçamento abaixo.
- Agente em overflow (sem mesa): estagiários em volta do tile de overflow do pai.
- Airsoft: estagiários não são alvo; o clique com a arma passa por eles.
- Reinício do app: estagiários não são persistidos e somem até o próximo evento.

## Direção de arte
- Silhueta: avatar existente em escala 0,75 + crachá amarelo `#f2d34f` no peito, legível em pixelSize 2 a 5.
- Paleta: camisa com a cor do pai um tom mais clara (`shadeHex(+0.15)`), para ler "pertence a quem".
- Animação: a pose `type` atual, com frequência 20% maior.

## Assets novos
| Nome | Primitiva | Dimensão | Cores |
|---|---|---|---|
| prop `laptop` no avatar | reuso de `laptop()` de `furniture.ts` | 0,35 × 0,02 × 0,25 | `#c7ccd6`, tela `#82aaff` |
| crachá | caixa do `kit.ts` | 0,08 × 0,10 × 0,01 | `#f2d34f` |

## Orçamento de performance
- No máximo 8 meshes por estagiário, com geometria e materiais compartilhados.
- Meta: ≥ 55 fps com 40 atores no M1; nenhuma alocação por frame; `dispose` ao sair.

## Plano de capturas
- `AGENT_OFFICE_SHOTS="out/world-sub:4000"` com `AGENT_OFFICE_EVAL` criando 3 subagentes simulados no demo isolado e focando a mesa 0.

## Critérios de aceite sugeridos
1. Dado um agente com 4 subagentes ativos, quando o mundo atualiza, então 3 estagiários aparecem ao lado da mesa e o crachá do pai mostra "+1".

## Perguntas abertas
- O estagiário acompanha o pai até a sala do usuário? Proposta: não, para evitar ruído.
```

## Veto Conditions

As condições abaixo não se aplicam à nota de pulo. Reject and redo if ANY are true:
1. Comportamento do mundo sem estado real do agente correspondente.
2. Mais de 3 estagiários visíveis por agente sem agregação "+N" (ou outro limite aprovado no PRD).
3. Asset novo sem dimensões, cores ou impacto no orçamento de performance.
4. Animação ou posição que esconde balão de permissão/resultado ou ocupa `VISIT_SPOTS`.

## Quality Criteria

- [ ] Tabela de comportamento cobre início, trabalho, fim e saída forçada
- [ ] Casos-limite com 10+ agentes e overflow tratados
- [ ] Legibilidade verificável em pixelSize 2 e 5
- [ ] Orçamento de performance com números
- [ ] Plano de capturas reproduzível no demo isolado
- [ ] Coerência com o ux-spec quando ele existe
