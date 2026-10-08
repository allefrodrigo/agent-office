---
execution: inline
agent: product-manager
tasks:
  - define-outcomes
  - write-prd
outputFile: squads/agent-office-squad/output/05-prd/prd.md
---

# Step 05: PRD / Épico — 🗺️ Rita Roadmap

## Context Loading

Carregue antes de executar (outputs de agente: maior `vN/`, run-conventions §2):
- `squads/agent-office-squad/output/{run_id}/01-intake.md` — pedido original.
- `squads/agent-office-squad/output/{run_id}/02-plan/vN/run-plan.md` e `squads/agent-office-squad/output/{run_id}/03-plan-approval.md`.
- `squads/agent-office-squad/output/{run_id}/04-discovery/vN/discovery-brief.md` — achados, impacto no código e recomendações (se o step-04 foi pulado, registre a ausência nas premissas).
- `_opensquad/_memory/company.md` (restrições inegociáveis) e `squads/agent-office-squad/_memory/memories.md`.
- `squads/agent-office-squad/pipeline/data/product-dossier.md` — personas, funcionalidades e lacunas.
- `squads/agent-office-squad/pipeline/data/benchmark-landscape.md` — posicionamento.
- `squads/agent-office-squad/pipeline/data/domain-framework.md`, `quality-criteria.md` (rubrica de PRD) e `anti-patterns.md`.
- Em refação (volta do checkpoint 06): versão anterior do PRD e `squads/agent-office-squad/output/{run_id}/06-prd-approval.md`.

## Instructions

### Gate do track

1. Leia o run-plan e a aprovação do step-03 (a aprovação prevalece).
2. Este step roda nos tracks **iniciativa** e **discovery**; nos demais o status é `skip`, salvo override.
3. Se o status for `skip`, grave a nota de pulo do run-conventions §3 (título `# Step 05 — Pulado`, motivo, track e complexidade) e encerre.

### Process

1. Releia o pedido e o discovery-brief; liste os achados que sustentam a iniciativa e os que a enfraquecem.
2. **Task `define-outcomes`:** escreva o problema com evidência, personas do product-dossier, jobs to be done, hipótese, métrica norte e métricas de guarda.
3. Métricas sem telemetria: o produto não coleta dados de uso. Para cada métrica, diga **como medir** com sinais disponíveis (roteiro de dogfooding, capturas, issues, contagem manual) ou crie um requisito explícito de telemetria **opt-in** — nunca presuma coleta.
4. Pontue com RICE (Reach, Impact, Confidence, Effort), justificando cada número, e registre a decisão: ir, não ir ou explorar mais.
5. **Task `write-prd`:** requisitos numerados `FR-n` (funcionais), `NFR-n` (não funcionais: desempenho, plataformas, custo de tokens, acessibilidade) e `CON-n` (restrições); cada um com fonte (intake, achado do discovery, company.md).
6. Declare o escopo dentro e **fora**, os riscos e dependências, e fatie em releases: a fatia 1 precisa entregar valor sozinha.
7. Confira os requisitos contra as restrições do produto (segurança, privacidade, macOS + Windows, pt-BR); requisito que fere um invariante vira `CON` com pedido de ADR para o Artur Arquitetura.
8. Track **discovery**: no mesmo arquivo, escreva um **memo de recomendação** (recomendação, opções comparadas, posição no roadmap, próximos passos) em vez do PRD completo.
9. Em refação, aplique o feedback do checkpoint 06 e abra o arquivo com "Mudanças nesta versão".
10. Apresente na conversa um resumo de 5 linhas (problema, métrica norte, RICE, fatia 1, perguntas abertas) e grave no caminho transformado.

## Output Format

The output MUST follow this exact structure:
```markdown
# PRD — {título da iniciativa}

**Versão:** v{n} · **Data:** YYYY-MM-DD · **Autora:** Rita Roadmap · **Status:** Draft
**Track:** {track} · **Fontes:** discovery-brief v{n}, intake

## Mudanças nesta versão
{só em refação}

## 1. Problema e evidência
## 2. Personas e jobs to be done
## 3. Resultado e métricas
| Tipo | Métrica | Meta | Como medir (sem telemetria) |
## 4. Priorização (RICE) e decisão
| Reach | Impact | Confidence | Effort | Score | Decisão |
## 5. Escopo
**Dentro:** ... **Fora:** ...
## 6. Requisitos
| Id | Requisito | Fonte |
## 7. Fatias de release
## 8. Riscos e dependências
## 9. Critérios de sucesso
## 10. Perguntas abertas
```

No track discovery, as seções 4–10 dão lugar a: `## Recomendação` · `## Opções comparadas` · `## Posição no roadmap` · `## Próximos passos` · `## Fontes`.

## Output Example

```markdown
# PRD — Subagentes visíveis no escritório

**Versão:** v1 · **Data:** 2026-10-08 · **Autora:** Rita Roadmap · **Status:** Draft
**Track:** iniciativa · **Fontes:** discovery-brief v1, intake

## 1. Problema e evidência
Quando um agente delega com a ferramenta Agent/Task, o escritório mostra só "Delegando: …" no crachá: `AgentManager.handle()` descarta mensagens com `parent_tool_use_id` [discovery §Impacto]. O usuário não sabe quantos subagentes existem, há quanto tempo rodam nem se a demora vem deles. O Pixel Agents já mostra subagentes como personagens [discovery §Benchmark, alta].

## 2. Personas e jobs to be done
- **Dev com várias sessões (primária):** "Quando um agente some numa tarefa longa, quero ver se ele delegou e para quê, para decidir se espero ou interrompo."
- **Tech lead orquestrando tickets:** "Quero saber se um ticket está andando em paralelo ou parado."

## 3. Resultado e métricas
| Tipo | Métrica | Meta | Como medir (sem telemetria) |
|---|---|---|---|
| Norte | Delegações percebidas sem abrir o log | ≥ 9 em 10 | roteiro de dogfooding com 10 tarefas que usam Agent/Task |
| Guarda | FPS com 10 agentes e 3 subagentes cada | ≥ 55 fps (M1, pixelSize 3) | contador de FPS no modo demo |
| Guarda | Fluxo de permissões | sem regressão | suíte manual de permissões do QA |

## 4. Priorização (RICE) e decisão
| Reach | Impact | Confidence | Effort | Score | Decisão |
|---|---|---|---|---|---|
| 70 de 100 escritórios ativos | 2 (alto) | 70% | 2 pessoas-semana | 49 | Ir — fatia 1 nesta run |

## 5. Escopo
**Dentro:** subagentes de agentes do escritório (SDK) e de sessões do terminal (hooks); estagiários no mundo; lista no painel.
**Fora:** teammates do Agent Teams (experimental); aprovar permissões de subagente separadamente; histórico de subagentes encerrados.

## 6. Requisitos
| Id | Requisito | Fonte |
|---|---|---|
| FR-1 | Detectar início e fim de cada subagente de agentes do escritório | discovery §Impacto |
| FR-2 | Detectar subagentes de sessões do terminal pelos hooks da ponte | discovery §Recomendações |
| FR-3 | Mostrar cada subagente ativo como estagiário perto da mesa do agente pai | benchmark (paridade) |
| FR-4 | Listar subagentes ativos no painel do agente, com descrição e tempo | JTBD dev |
| FR-5 | Mostrar teammates do Agent Teams (fatia 2) | discovery §Recomendações (Poderia) |
| NFR-1 | Manter ≥ 55 fps com 10 agentes e 3 subagentes cada | guarda |
| NFR-2 | Funcionar em macOS e Windows | company.md |
| NFR-3 | Nenhum token extra para detectar subagentes | company.md |
| CON-1 | Não depender da flag experimental do Agent Teams na fatia 1 | discovery §Riscos |
| CON-2 | No máximo 3 estagiários visíveis por agente, com indicador "+N" | legibilidade |

## 7. Fatias de release
1. **Fatia 1:** FR-1 a FR-4 — valor sozinha.
2. **Fatia 2:** FR-5, depois que o Agent Teams sair do experimental.

## 8. Riscos e dependências
- Hooks variam por versão do Claude Code; o fim de subagente no terminal pode exigir casamento por ordem (média).
- Não há testes automatizados no repositório → depende de story de infraestrutura ou de verificação manual registrada.

## 9. Critérios de sucesso
- Meta norte atingida no dogfooding; guardas sem regressão; quality gate PASS.

## 10. Perguntas abertas
- O estagiário reage ao airsoft? (Iuri Isométrico)
```

## Veto Conditions

As condições abaixo não se aplicam à nota de pulo. Reject and redo if ANY are true:
1. Requisito sem identificador `FR-n`/`NFR-n`/`CON-n` ou sem fonte.
2. Métrica sem método de medição, ou que presume telemetria inexistente sem requisito opt-in.
3. Seção de escopo **fora** ausente ou vazia.
4. Requisito que contradiz invariante ou restrição do company.md sem `CON` e pedido de ADR.

## Quality Criteria

- [ ] Problema sustentado por pelo menos um achado do discovery (ou premissa declarada)
- [ ] RICE com justificativa para cada um dos quatro números
- [ ] Fatia 1 entrega valor verificável sozinha
- [ ] NFRs cobrem desempenho, plataformas e custo de tokens quando aplicável
- [ ] Perguntas abertas nomeiam quem responde
- [ ] Linguagem sem adjetivos de marketing (anti-patterns)
