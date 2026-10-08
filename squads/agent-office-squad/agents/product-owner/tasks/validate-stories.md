---
task: "Validar stories (10 checks + coesão)"
order: 1
input: |
  - stories: output/{run_id}/10-stories/vN/stories.md — maior versão
  - artifacts: PRD (05), UX (07), mundo (08) e arquitetura (09) da run, os que existirem
  - run_plan: output/{run_id}/02-plan/vN/run-plan.md
  - rubric: pipeline/data/quality-criteria.md — regras do gate do PO
output: |
  - po_validation: output/11-validation/po-validation.md — documento final do step-11 com tabela de checks por story, coesão, cobertura FR → story, vereditos, correções e ordem do backlog
---

# Validar stories (10 checks + coesão)

Aplica a cada story o checklist de 10 pontos do AIOX e três checks específicos do Agent Office, verifica a coesão com os artefatos da run e emite vereditos com correções precisas. É a única task do step-11: o arquivo dela é o output do step.

## Process

1. Ler o índice e todas as stories da maior versão de `10-stories`. Ler os artefatos de 05, 07, 08 e 09 que existirem (os pulados não contam como falha).
2. Para cada story, aplicar os 10 checks: 1 título claro · 2 problema/contexto completo · 3 AC testáveis em Given/When/Then · 4 escopo dentro/fora · 5 dependências mapeadas · 6 estimativa ≤ 5 pts · 7 valor identificado · 8 riscos documentados · 9 DoD claro · 10 alinhamento com PRD/épico (ou intake, nos tracks sem PRD).
3. Aplicar os específicos: E1 invariantes I-xx tocados listados nas notas técnicas · E2 subtarefas marcadas com executor (`integration`, `platform`, `world`, `ui`, `test`) e coerentes com os arquivos citados · E3 plano de testes com plataformas (macOS, Windows) e captura `AGENT_OFFICE_SHOTS` quando muda mundo ou interface.
4. Verificar coesão: cada nota técnica bate com a arquitetura (contratos, nomes de eventos, arquivos); comportamento do mundo bate com o world-spec; interação bate com o ux-spec; nenhum FR contradito.
5. Montar a matriz de cobertura FR → story; FR sem story precisa estar no escopo fora do PRD.
6. Decidir o veredito por story: READY (todos os checks ok), NEEDS_REVISION (falha corrigível na própria story), BLOCKED_UPSTREAM (defeito no PRD, UX, mundo ou arquitetura). Veredito geral = pior veredito entre as stories.
7. Escrever correções com local exato (`S-2 › Plano de testes`) e a correção proposta; reconhecer um ponto forte por story.
8. Recomendar a ordem do backlog resolvendo dependências (ex.: contrato de evento antes do consumidor no mundo) e gravar no arquivo do step.

## Output Format

```markdown
# Validação do PO — {run_slug}
## Veredito geral: {READY | NEEDS_REVISION | BLOCKED_UPSTREAM}
## Checks por story
| Story | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | E1 | E2 | E3 | Veredito |
## Correções
- {S-n › seção}: {problema} → {correção proposta}
## Coesão entre artefatos
## Cobertura FR → story
| FR | Story | Observação |
## Pontos fortes
## Ordem recomendada do backlog
## Bloqueios a montante (para o checkpoint 12)
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# Validação do PO — subagentes-visiveis

## Veredito geral: NEEDS_REVISION

## Checks por story
| Story | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | E1 | E2 | E3 | Veredito |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S-1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | READY |
| S-2 | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | NEEDS_REVISION |
| S-3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | NEEDS_REVISION |

## Correções
- S-2 › Critérios de aceite › item 3: "o estagiário aparece rápido" não é verificável → "Dado um subagente iniciado, quando o evento `agent:subagent` com status `running` chega, então o estagiário surge ao lado da mesa em até 1 s".
- S-2 › Plano de testes: falta plataforma e captura → incluir macOS e Windows e `AGENT_OFFICE_SHOTS="out/qa:3000,8000"` com instância isolada.
- S-3 › Notas técnicas: risco não documentado → registrar que a descrição vem de hook (não confiável, I-14) e deve ser exibida como texto puro, sem `innerHTML` (I-06).

## Coesão entre artefatos
- S-1 usa o evento `agent:subagent`, igual à arquitetura §3.2. ✓
- S-2 limita a 3 estagiários + "+N", igual ao world-spec §2 e ao FR-2. ✓

## Cobertura FR → story
| FR | Story | Observação |
|---|---|---|
| FR-1 | S-2 | — |
| FR-2 | S-2 | — |
| FR-3 | S-3 | — |
| FR-4 | S-3 | cartão de permissão citado nas subtarefas ui |
| FR-5 | S-1 | inclui sessões do terminal via `bridge.ts` |

## Pontos fortes
- S-1 descreve o contrato do evento com assinatura completa; S-3 já prevê navegação por teclado.

## Ordem recomendada do backlog
1. S-1 (contrato e eventos) → 2. S-2 (consome o evento no mundo) → 3. S-3 (painel e cartão).

## Bloqueios a montante (para o checkpoint 12)
Nenhum.
```

## Quality Criteria

- [ ] Nenhuma célula vazia na tabela de checks.
- [ ] Veredito de cada story coerente com os checks (qualquer ✗ impede READY).
- [ ] Toda correção com local exato e proposta concreta.
- [ ] Cobertura FR → story completa, com FR descobertos apontando para o escopo fora.
- [ ] Ordem do backlog compatível com as dependências.

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Story marcada READY com algum check falho.
2. Defeito de PRD, UX, mundo ou arquitetura classificado como NEEDS_REVISION (deveria ser BLOCKED_UPSTREAM).
3. Correção sem local ou sem proposta ("melhorar os critérios").
4. Story que toca superfície sensível sem invariantes listados e mesmo assim aprovada.
