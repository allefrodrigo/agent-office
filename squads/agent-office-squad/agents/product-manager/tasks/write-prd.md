---
task: "Escrever o PRD / épico"
order: 2
input: |
  - outcomes: saída da task define-outcomes
  - discovery_brief: output/{run_id}/04-discovery/vN/discovery-brief.md (se existir)
  - run_plan: output/{run_id}/02-plan/vN/run-plan.md e output/{run_id}/03-plan-approval.md
  - quality: pipeline/data/quality-criteria.md — rubrica do PRD
output: |
  - prd: output/05-prd/prd.md — documento final do step-05 (PRD/épico ou, no track discovery, memo de recomendação)
---

# Escrever o PRD / épico

Converte os resultados em um PRD/épico que stories, especificações e arquitetura conseguem citar linha a linha. No track discovery, produz um memo de recomendação com a mesma disciplina de evidência. É a última task do step-05: o arquivo dela é o output do step.

## Process

1. Abrir com contexto e resultado: problema, persona, JTBD, hipótese e métricas vindas de `define-outcomes`, sem reescrever o que já está decidido.
2. Escrever requisitos funcionais **FR-n**: um comportamento por linha, verbo no início, verificável, com a fonte entre colchetes (`[F1]`, `[intake]`, `[agents.ts:handle]`).
3. Escrever requisitos não funcionais **NFR-n**: performance (ex.: fps com 10 agentes), acessibilidade (WCAG 2.2 AA na interface 2D), compatibilidade (macOS arm64 e Windows x64), custo (nenhum token sem ação do usuário).
4. Escrever restrições **CON-n** a partir dos invariantes e de `company.md`: I-01, I-02, I-05, I-12/I-13, pt-BR na UI, telemetria só opt-in, uso do `claude` instalado.
5. Declarar escopo dentro e **fora** (com onde o item fora será tratado, se for o caso).
6. Fatiar em releases: fatia 1 autônoma e pequena; fatias seguintes com dependências explícitas.
7. Listar riscos (probabilidade × impacto, mitigação), dependências (SDK, hooks, plataformas) e perguntas abertas para o checkpoint 06.
8. **Track discovery:** trocar FR/NFR por "Recomendação" — opções avaliadas, opção recomendada com RICE, o que validar antes de construir e iniciativas sugeridas para o roadmap.
9. Revisar contra a rubrica do PRD em `quality-criteria.md` e gravar o documento no arquivo do step.

## Output Format

```markdown
# PRD — {iniciativa}
- **Status:** proposta para o checkpoint 06 · **Track:** {track} · **Dono:** Rita Roadmap
## Contexto e problema
## Persona e JTBD
## Hipótese e métricas
| Métrica | Alvo | Prazo | Como medir |
## Requisitos funcionais
- FR-1 {comportamento verificável} [fonte]
## Requisitos não funcionais
- NFR-1 ...
## Restrições
- CON-1 ...
## Escopo
### Dentro
### Fora
## Fatias de release
| Fatia | Conteúdo | Requisitos | Depende de |
## Riscos
| Risco | Prob. | Impacto | Mitigação |
## Dependências
## Perguntas abertas para o checkpoint 06
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
# PRD — Subagentes visíveis no escritório
- **Status:** proposta para o checkpoint 06 · **Track:** iniciativa · **Dono:** Rita Roadmap

## Contexto e problema
Agentes que delegam a subagentes parecem parados: `AgentManager.handle()` descarta mensagens de subagentes [agents.ts:handle]. O Pixel Agents já mostra subagentes ligados ao pai [F1].

## Persona e JTBD
Dev com várias sessões em paralelo. "Quando delego uma tarefa grande, quero ver quem ajuda o agente, para confiar no progresso."

## Hipótese e métricas
| Métrica | Alvo | Prazo | Como medir |
|---|---|---|---|
| Sessões com subagentes em que o painel foi aberto | 60 % | 4 semanas | teste roteirizado + pesquisa |
| FPS com 10 agentes × 3 subagentes | ≥ 55 | na entrega | medição no demo |

## Requisitos funcionais
- FR-1 Mostrar cada subagente ativo como um estagiário em pé ao lado da mesa do agente pai [F1].
- FR-2 Exibir no máximo 3 estagiários por agente e uma etiqueta "+N" para os demais [discovery §Recomendações 3].
- FR-3 Listar no painel do agente os subagentes ativos com descrição curta e status [intake].
- FR-4 Indicar no cartão de permissão quando o pedido veio de um subagente [F1, agents.ts:askPlayer].
- FR-5 Funcionar para agentes do escritório e sessões do terminal [checkpoint 03].

## Requisitos não funcionais
- NFR-1 Manter ≥ 55 fps com foco no demo com 10 agentes e 3 subagentes cada.
- NFR-2 Lista do painel navegável por teclado e com nome acessível (WCAG 2.2 AA).

## Restrições
- CON-1 Nenhum token gasto para descobrir subagentes (I-13).
- CON-2 Dados vindos de hook tratados como não confiáveis e limitados em tamanho (I-14).
- CON-3 Textos em pt-BR seguindo `product-voice.md`.

## Escopo
### Dentro
FR-1 a FR-5.
### Fora
Interromper subagentes individualmente (aguarda verificação de suporte no SDK; candidato à próxima run).

## Fatias de release
| Fatia | Conteúdo | Requisitos | Depende de |
|---|---|---|---|
| 1 | Eventos + estagiários no mundo | FR-1, FR-2, FR-5 | — |
| 2 | Painel e cartão de permissão | FR-3, FR-4 | fatia 1 |

## Riscos
| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Esquema do hook de subagente muda | média | alto | adaptador isolado + teste com fixture |
| Poluição visual com muitos agentes | média | médio | limite de 3 + "+N" |

## Dependências
Claude Code com hook `SubagentStop`; SDK 0.3.x.

## Perguntas abertas para o checkpoint 06
- O estagiário deve andar até o usuário quando a permissão for dele, ou o agente pai continua indo?
```

## Quality Criteria

- [ ] Todo FR/NFR/CON numerado, verificável e com fonte entre colchetes.
- [ ] Escopo fora preenchido, com destino dos itens adiados.
- [ ] Fatia 1 entrega valor sozinha; dependências entre fatias explícitas.
- [ ] Restrições incluem os invariantes relevantes (I-xx) e cross-platform.
- [ ] Riscos com probabilidade, impacto e mitigação; perguntas abertas listadas.

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Requisito sem fonte ou que contradiz o discovery (invenção).
2. Requisito que prescreve tecnologia ou implementação em vez de comportamento.
3. Ausência de escopo fora ou de métricas com forma de medição.
4. Track discovery entregue como PRD de construção sem a seção de recomendação.
