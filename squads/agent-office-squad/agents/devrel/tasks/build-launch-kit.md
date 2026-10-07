---
task: "Montar o kit de lançamento"
order: 1
input: |
  - run_plan: output/{run_id}/02-plan/vN/run-plan.md e 03-plan-approval.md (track, relevância para usuários)
  - prd: output/{run_id}/05-prd/vN/prd.md (proposta de valor, público e métricas; pode estar pulado)
  - docs_report: output/{run_id}/19-docs/vN/docs-report.md (notas de versão)
  - publish_report: output/{run_id}/22-publish/vN/publish-report.md (versão, links do PR e da release)
  - benchmark: squads/agent-office-squad/pipeline/data/benchmark-landscape.md
output: |
  - launch_kit: kit completo em rascunho (vira output/23-launch/launch-kit.md)
  - captures: capturas gravadas no modo demo isolado (out/lancamento-*.png)
  - feedback_plan: como e onde coletar retorno da comunidade para o discovery
---

# Montar o kit de lançamento

Transforma a entrega da run em peças prontas para o usuário publicar, todas ancoradas numa demo real e honestas sobre limitações. Termina com métricas e um plano para levar o retorno da comunidade de volta ao discovery.

## Process

1. **Gate e relevância.** Se o step-23 estiver `skip`, grave a nota de pulo e pare. Confirme no publish-report o que de fato foi publicado (versão, PR, release); só divulgue o que está publicado ou com data aprovada.
2. **Mensagem-chave.** Uma frase com público, benefício e diferencial. Liste três provas demonstráveis da entrega e posicione contra 2–3 concorrentes do benchmark com fatos datados (ex.: o Pixel Agents mostra os agentes; o Agent Office deixa você decidir quando eles chegam até você).
3. **Peças.** Post curto (até 280 caracteres), thread de 5 a 7 posts, post de LinkedIn e esboço de artigo para o TabNews — todas em pt-BR, no tom do `product-voice.md`, cada uma com chamada para ação e ativo visual indicado.
4. **Roteiro de demo de 60 s.** Cenas com tempo, o que aparece e como gravar: modo demo isolado (zsh `AGENT_OFFICE_DATA_DIR=/tmp/ao-demo AGENT_OFFICE_DEMO=1 npm run dev`; PowerShell `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-demo"; $env:AGENT_OFFICE_DEMO=1; npm run dev`), gravação de tela do sistema e, para capturas fixas, `AGENT_OFFICE_SHOTS="out/lancamento:4000,9000"` com `AGENT_OFFICE_EVAL` posicionando a câmera (`__game.focusAgent(id)`).
5. **Assets.** Checklist com GIF curto (até 15 s), 3 capturas, miniatura e texto alternativo de cada imagem; nada com dados reais do usuário.
6. **FAQ honesto.** Requisitos, plataformas e assinatura, idioma, custo (o app não gasta tokens sozinho; os agentes contratados usam o plano do usuário), segurança (ponte local com token, modo "Sem pedir nada" perigoso), o que ainda não existe.
7. **Comunidade.** Proponha (não crie) templates de issue, `CONTRIBUTING.md` e rótulos "boa primeira issue" como stories para o Kauã Kanban; defina onde o feedback chega (issues/discussões) e como é triado.
8. **Métricas.** Baseline do dia (estrelas, downloads da release, issues abertas), meta, fonte (`gh api repos/{owner}/{repo}` e `.../releases`) e janelas de 7 e 30 dias.
9. **Revisão final.** Nenhuma promessa fora do roadmap aprovado; limitação presente em toda peça que fala de benefício; tudo marcado como rascunho.

## Output Format

````markdown
# Step 23 — Kit de lançamento (rascunho — publicação pelo usuário)

## Mensagem-chave
## Provas e posicionamento
## Peças
### Post curto · ### Thread · ### LinkedIn · ### TabNews (esboço)
## Roteiro de demo (60 s)
| Tempo | Cena | Como gravar |
## Assets e texto alternativo
## FAQ
## Comunidade
## Métricas
| Métrica | Baseline | Meta 7 d | Meta 30 d | Fonte |
## Loop de feedback
````

## Output Example

> Use como referência de qualidade, não como template rígido.

````markdown
# Step 23 — Kit de lançamento (rascunho — publicação pelo usuário)

## Mensagem-chave
Para quem roda vários agentes do Claude Code ao mesmo tempo: no Agent Office 0.3.0 você vê também os subagentes de cada agente trabalhando — e quem precisa de você continua vindo até a sua sala.

## Provas e posicionamento
1. Estagiários aparecem ao lado da mesa quando um agente delega uma tarefa (captura `out/lancamento-1.png`).
2. O painel lista os subagentes ativos, navegável por teclado.
3. Permissões, perguntas e planos continuam chegando em mãos, com diff e comando.
Posicionamento (benchmark de 2026-10-07): o Pixel Agents e o roving-office mostram os agentes; o Agent Office também deixa você aprovar, responder e delegar pelo escritório, com o quadro que os próprios agentes operam.

## Peças
### Post curto
Agora dá para ver quem seu agente chamou para ajudar. No Agent Office 0.3.0, subagentes viram estagiários ao lado da mesa — e as permissões continuam vindo até você. Mac e Windows, em pt-BR. [link da release]

### Thread
1/6 Rodar 5 agentes do Claude Code ao mesmo tempo é ótimo até você não saber quem está fazendo o quê. O Agent Office resolve isso com um escritório. 🧵
2/6 Cada agente tem mesa e computador; a tela mostra o que ele faz. Quando precisa de permissão, ele levanta e vai até a sua sala. [GIF]
3/6 Novo na 0.3.0: quando um agente delega, os subagentes aparecem como estagiários ao lado dele. [captura]
4/6 O quadro de tickets também é dos agentes: eles abrem, comentam e entregam para revisão. Só você fecha.
5/6 Limites: precisa do Claude Code instalado e logado; interface em pt-BR; instaladores ainda sem assinatura.
6/6 Testa e conta o que faltou: [link das issues]

## Roteiro de demo (60 s)
| Tempo | Cena | Como gravar |
|---|---|---|
| 0–8 s | Escritório cheio, câmera abrindo | modo demo isolado + gravação de tela |
| 8–25 s | Turing vai até a sala com o cartão de `npm install` | aguardar ~3 s após abrir |
| 25–40 s | Grace entrega o resultado em mãos | aguardar ~6 s |
| 40–55 s | Estagiários ao lado da mesa e lista no painel | `AGENT_OFFICE_EVAL` com `__game.focusAgent(id)` |
| 55–60 s | Logo e link | edição |

## Assets e texto alternativo
- [ ] GIF de 12 s — alt: "Agente pixel art caminha até a sala do usuário carregando um cartão de permissão."
- [ ] `out/lancamento-1.png` — alt: "Mesa de agente com dois estagiários ao lado, no escritório isométrico."

## FAQ
- **Preciso do quê?** Claude Code instalado e logado; Mac arm64 ou Windows x64.
- **Gasta meus tokens?** O app sozinho não; os agentes que você contrata usam o seu plano.
- **É seguro?** A ponte do terminal escuta só em 127.0.0.1 com token; evite o modo "Sem pedir nada".

## Comunidade
Propostas de story para o Kauã Kanban: templates de bug e de ideia; `CONTRIBUTING.md`; rótulo "boa primeira issue".

## Métricas
| Métrica | Baseline | Meta 7 d | Meta 30 d | Fonte |
|---|---|---|---|---|
| Downloads da 0.3.0 | 0 | 150 | 600 | `gh api repos/{owner}/{repo}/releases` |
| Estrelas | (medir no dia) | +40 | +150 | `gh api repos/{owner}/{repo}` |
| Issues novas com feedback | 0 | 5 | 15 | issues/discussões |

## Loop de feedback
Triagem semanal das issues novas; temas recorrentes vão para a memória do squad e para o próximo discovery da Bruna Benchmark.
````

## Quality Criteria

- [ ] Mensagem-chave com público, benefício e diferencial, e provas demonstráveis.
- [ ] Cada peça tem chamada para ação, ativo visual e pelo menos uma limitação quando fala de benefício.
- [ ] Roteiro de demo gravável sem tokens e sem dados reais, com comandos zsh e PowerShell.
- [ ] Métricas com baseline, metas, fonte e janelas de 7 e 30 dias.

## Veto Conditions

Rejeite e refaça se QUALQUER uma for verdadeira:
1. Alguma peça foi publicada ou agendada, ou o kit não está marcado como rascunho.
2. O kit anuncia funcionalidade que não está no que foi publicado ou aprovado.
3. Há captura com dados reais do usuário ou sem texto alternativo.
4. Comparação com concorrente sem fato ou data, ou depreciativa.
