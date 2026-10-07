# Research Brief — criação do Squad Agent Office

Compilação da pesquisa feita na criação do squad (2026-10-07). Fontes datadas no fim. Detalhes do mercado em `benchmark-landscape.md`; análise do produto em `product-dossier.md`.

## 1. Pergunta de pesquisa

Quais funções, métodos e referências um time precisa para desenvolver e evoluir um produto como o Agent Office — app desktop que visualiza e governa agentes de código — e como organizar esse time como squad do opensquad seguindo o pipeline do AIOX?

## 2. Achados principais

| # | Achado | Fonte | Confiança |
|---|---|---|---|
| 1 | O produto já combina visualização, decisões interativas, quadro operado por agentes (MCP), ponte com terminal e telemetria de limites/contexto; nenhum concorrente analisado junta tudo | leitura do código; benchmark | alta |
| 2 | A base técnica não tem testes, lint, CI, assinatura de distribuição nem auto-update; o porte Windows está incompleto | `package.json`, `electron-builder.yml`, README | alta |
| 3 | A categoria "escritório visual de agentes" está lotada de projetos de observação; o líder (Pixel Agents, ~9,6 mil estrelas, ~87 mil instalações) tem roadmap de limites, orquestração e quadro | README do Pixel Agents; Marketplace | alta/média |
| 4 | As plataformas transformaram "várias sessões + worktree + diff + caixa de decisões" em expectativa padrão (app oficial do Claude Code, Cursor 3, Agent HQ, Antigravity) | imprensa e docs | média |
| 5 | O ecossistema brasileiro de squads (AIOX, opensquad) busca cockpits/escritórios; o Virtual Office do opensquad lê `state.json`; o AIOX Cockpit está em beta com problemas no Windows | código do opensquad; issues públicas do Cockpit | alta/média |
| 6 | O AIOX organiza o trabalho em agentes com autoridade exclusiva (só o devops publica), story-driven development, No Invention, quality gates e ciclo sm → po → dev → qa com loop | `aiox-core` (constituição, agentes, workflows) | alta |
| 7 | O opensquad organiza squads em agentes com tasks, pipeline com checkpoints, vetos, loops `on_reject`, pastas de run versionadas e memória do squad | `opensquad` 0.1.15 (prompts e runner) | alta |
| 8 | Mensagens entre sessões oficiais do Claude Code funcionam só em macOS/Linux (Windows via WSL 2); Agent Teams é experimental | docs oficiais do Claude Code | alta/média |
| 9 | Produtos populares do segmento morreram ou pararam (Vibe Kanban perdeu a empresa; Opcode parou; Crystal foi descontinuado) | blog do Vibe Kanban; comparativos | média |

## 3. Frameworks adotados

- **AIOX (Synkra)**: papéis analyst, pm, ux-design-expert, architect, po, sm, dev, qa, devops e aiox-master; Constituição (CLI First, Agent Authority, Story-Driven, No Invention, Quality First, Squad-First Portability, Model Governance); workflows `story-development-cycle`, `spec-pipeline` (SIMPLE/STANDARD/COMPLEX), `qa-loop`, `brownfield-discovery`. Mapeamento completo em `aiox-pipeline-map.md`.
- **opensquad**: formato `.agent.md` + tasks, pipeline com `checkpoint`/`agent`, `execution: inline|subagent`, `model_tier`, `on_reject`, `outputFile` sob `output/` com `run_id` e versões, memória `memories.md`/`runs.md`.
- **Revisão por rubrica** (best practice `review.md` do opensquad): nota 1–10 por critério, aprovado com média ≥ 7 e nenhum critério < 4, máximo de 3 ciclos.
- **Pesquisa** (best practice `researching.md`): fonte primária, data de acesso, confiança por corroboração, contradições expostas, foco (5 boas fontes > 15 rasas).
- **Estratégia** (best practice `strategist.md`): público primeiro, diferenciação, metas mensuráveis, ciclo de revisão, plano realista.
- **Escrita técnica** (best practice `technical-writing.md`): para documentação e notas de versão.
- **Produto**: JTBD, RICE, MoSCoW, métrica norte + métricas de guarda, fatiamento de MVP.
- **Qualidade**: rastreabilidade Given/When/Then, risco = probabilidade × impacto, gate PASS/CONCERNS/FAIL/WAIVED.
- **Segurança**: checklist de segurança do Electron, STRIDE-lite, mínimo privilégio, tratamento de injeção de prompt (Constituição AIOX XII-D).
- **Acessibilidade**: WCAG 2.2 AA.

## 4. Vocabulário do domínio

**Use**: agente, sessão do terminal, ponte, hook, permissão, modo de permissão, `canUseTool`, contexto, compactar, limites do plano, ticket, critérios de aceite, quadro, delegar, story, Ready, quality gate, veredito, invariante, ADR, contrato, IPC, preload, renderer, main, worktree, diff, PR, semver, changelog, notarização, track, complexidade, run-plan, executor, Dev Agent Record.

**Sinais de amadorismo a evitar**: "deve funcionar", "testei de cabeça", "intuitivo", "revolucionário", "game changer", "só um hack rápido", "a gente refatora depois", "roda na minha máquina", "Ops! Algo deu errado".

## 5. Lacunas da pesquisa

- Números de uso reais do Agent Office (não há telemetria): decisões de produto dependem de feedback direto até existir medição opt-in.
- Detalhes do app oficial do Claude Code vieram de imprensa/blogs; conferir na documentação oficial antes de decisões que dependam deles.
- Licença e modelo de negócio do Agent Office ainda não decididos (perguntas abertas no dossiê).

## 6. Fontes (acesso em 2026-10-07)

- Repositório do Agent Office (v0.2.0, commit `78249be`) — leitura integral.
- opensquad 0.1.15 — https://github.com/renatoasse/opensquad (`_opensquad/core/*`, templates, dashboard).
- Synkra AIOX 5.4.1 — https://github.com/SynkraAI/aiox-core (`.aiox-core/constitution.md`, `development/agents/*`, `development/workflows/*`) · https://github.com/SynkraAI/aiox-squads
- AIOX Cockpit (issues públicas) — https://github.com/SynkraAI/aiox-cockpit-issues
- Fontes de mercado — lista completa em `benchmark-landscape.md` §6.
