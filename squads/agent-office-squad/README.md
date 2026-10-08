# Squad Agent Office

Squad do [opensquad](https://github.com/renatoasse/opensquad) (v0.1.15) que desenvolve e evolui o Agent Office de ponta a ponta, com papéis e regras inspirados no pipeline do [AIOX](https://github.com/SynkraAI/aiox-core): analyst → pm → ux → architect → sm → po → dev → qa → devops.

## Como rodar

No Claude Code, aberto na raiz deste repositório:

```
/opensquad run agent-office-squad
```

O primeiro checkpoint pergunta o tipo de trabalho, a descrição, as referências e se as stories devem ir para o quadro do Agent Office (só funciona com o squad rodando dentro do próprio Agent Office, onde existem as ferramentas `mcp__office__*`).

| Track | Para quê | O que roda |
|---|---|---|
| `iniciativa` | feature ou épico novo | ciclo completo, do discovery ao lançamento |
| `entrega` | story ou ticket `AO-n` já definido | stories → validação → implementação → gates → PR |
| `bugfix` | defeito com reprodução | story de bug → validação → correção → gates → PR |
| `release` | publicar uma versão | regressão → auditoria → notas → release → lançamento |
| `discovery` | pergunta estratégica sem código | discovery/benchmark → memo de recomendação → retro |

Steps fora do track gravam uma nota de pulo de 3 linhas. Ninguém publica nada sem o checkpoint 21, e só pessoas movem tickets para "Feito".

## Time

| Agente | Papel | Inspiração AIOX |
|---|---|---|
| 🎼 Otávio Orquestra | triagem, track, complexidade, orçamento, retro | Orion (`@aiox-master`) |
| 🔭 Bruna Benchmark | discovery, benchmark, impacto no código | Atlas (`@analyst`) |
| 🗺️ Rita Roadmap | resultados, métricas, PRD/épico | Morgan (`@pm`) |
| 🎯 Priscila Prioridade | validação de 10 pontos, Ready | Pax (`@po`) |
| 🌊 Kauã Kanban | stories autocontidas, quadro | River (`@sm`) |
| 🧭 Úrsula Usabilidade | UX/UI, acessibilidade | Uma (`@ux-design-expert`) |
| 🧱 Iuri Isométrico | mundo isométrico, game feel, arte | — (especialista do domínio) |
| ✍️ Lívia Linguagem | UX writing, i18n, docs, notas de versão | — (documentação) |
| 🏛️ Artur Arquitetura | arquitetura Electron, ADRs, ameaças | Aria (`@architect`) |
| 🪝 Henrique Hook | integração Claude Code / Agent SDK | Dex (`@dev`) |
| 🖥️ Eduardo Electron | plataforma Electron, macOS e Windows | Dex (`@dev`) |
| 🧊 Vitor Voxel | mundo three.js | Dex (`@dev`) |
| 🎛️ Fernanda Front | interface (HUD, painéis, quadro) | Dex (`@dev`) |
| ✅ Tânia Teste | quality gate | Quinn (`@qa`) |
| 🛡️ Sílvia Sandbox | security gate | — (segurança dedicada) |
| 🚀 Diego Deploy | PR, versão, release (único que publica) | Gage (`@devops`) |
| 📣 Camila Comunidade | posicionamento, lançamento, comunidade | — (go-to-market) |

## Estrutura

```
squad.yaml, squad-party.csv     definição e elenco
_build/                         discovery.yaml e design.yaml (fonte da verdade do squad)
agents/                         17 agentes (.agent.md) e 26 tasks
pipeline/pipeline.yaml          24 steps (5 checkpoints)
pipeline/steps/                 instruções de cada step
pipeline/data/                  conhecimento: dossiê do produto, benchmark, arquitetura,
                                padrões, segurança, voz, mapa AIOX, convenções de execução
_memory/                        memória do squad e histórico de runs
output/                         artefatos de cada run (ignorado pelo git)
```

Comece por `pipeline/data/product-dossier.md` (análise do produto), `pipeline/data/benchmark-landscape.md` (concorrência) e `pipeline/data/aiox-pipeline-map.md` (como o AIOX foi adaptado).

## Custo

Cada run consome tokens do seu plano. Steps de leitura pesada (discovery, arquitetura, implementação, QA, segurança) rodam como subagentes; o run-plan declara um orçamento e o runner para no limite de 3 ciclos por loop de revisão.

## Instalação do opensquad neste repositório

Foi instalado só o necessário para rodar o squad no Claude Code: `_opensquad/core/` (runner, Architect, prompts, best practices), `_opensquad/_memory/` e `.claude/skills/opensquad/`. Ficaram de fora o dashboard em Phaser, as skills de redes sociais, o `.mcp.json` com Playwright e o `CLAUDE.md` do opensquad (que os agentes do próprio Agent Office leriam ao trabalhar neste repositório). `npx opensquad init` completa a instalação sem sobrescrever arquivos existentes, mas adiciona esses itens.
