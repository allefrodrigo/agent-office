# Dossiê do Produto — Agent Office

Análise detalhada do produto feita na criação do squad (2026-10-07), a partir da leitura integral do repositório (v0.2.0, commit `78249be`, ~12,2 mil linhas de TypeScript/CSS) e do benchmark de mercado (`benchmark-landscape.md`). Atualizar a cada release.

## 1. Resumo executivo

O Agent Office é um app desktop (Electron) que transforma sessões do Claude Code em personagens de um escritório isométrico em pixel art. O valor central é **governança espacial**: em vez de vigiar vários terminais, o usuário vê o escritório e os agentes **vêm até ele** quando precisam de permissão, têm uma pergunta, trazem um plano ou entregam um resultado.

Em dois commits o produto já reúne o que nenhum concorrente junta num só lugar: visualização viva, decisões interativas (permissão, pergunta, plano), kanban operado pelos próprios agentes via MCP, ponte para sessões do terminal e telemetria de contexto, limites do plano, custo e sistema. Os maiores riscos são de **fundação** (zero testes, sem CI, sem assinatura/auto-update, porte Windows incompleto, UI só em pt-BR, dependência de APIs experimentais) e de **plataforma** (o app oficial do Claude Code ganhou sessões paralelas e worktrees em abril/2026, e a extensão Pixel Agents já tem ~87 mil instalações com a mesma metáfora visual).

Recomendação: consolidar a fundação na v0.3 (testes, CI mac+win, Windows completo, i18n en-US, base de acessibilidade) e, em seguida, dobrar a aposta no diferencial que ninguém tem — o escritório como **mesa de controle de times de agentes** (worktrees + revisão de diff + subagentes/Agent Teams visíveis + squads opensquad/AIOX) — antes de pensar em modo time/nuvem.

## 2. Proposta e metáfora

- **Metáfora**: escritório com mesas (agentes trabalhando), a sua sala (decisões e entregas), sala de reunião (airsoft), lounge (agentes ociosos), elevador (chegada e saída).
- **Promessa**: "Seus agentes trabalham; quando precisam de você, vêm até você."
- **Por que funciona**: o status vira posição e pose (trabalhando na mesa, na fila da sua sala, relaxando no lounge), legível de longe e sem ler texto. A camada lúdica (Habbo, pebolim, airsoft) cria afeição e compartilhamento.

## 3. Personas e trabalhos a fazer

| Persona | Contexto | Trabalho a fazer (JTBD) | Dor atual |
|---|---|---|---|
| **Dev multi-sessão** (primária) | 2–6 sessões do Claude Code em paralelo, plano Pro/Max, Mac ou Windows | "Quando estou com vários agentes rodando, quero saber quem precisa de mim e decidir rápido, para não travar trabalho nem aprovar algo perigoso sem ver." | alternar terminais, prompts de permissão perdidos, contexto e limites invisíveis |
| **Tech lead / dono de produto técnico** | organiza trabalho em tickets e delega | "Quero quebrar o trabalho em tickets bem escritos e entregá-los a agentes, revisando o que voltar." | tickets fora do contexto dos agentes, revisão manual dispersa |
| **Criador de conteúdo dev** | demonstra fluxos com IA | "Quero mostrar trabalho com agentes de um jeito que as pessoas entendam e queiram compartilhar." | terminais não são visuais |
| **Usuário de squads** (emergente) | usa opensquad/AIOX com vários papéis | "Quero ver meu squad trabalhando e aprovar os checkpoints sem ler logs." | dashboards de squad são só observação |

## 4. Inventário de funcionalidades (v0.2.0)

| Área | Funcionalidade | Onde vive |
|---|---|---|
| Agentes do escritório | Contratar (nome, pasta, tarefa, modelo, modo), Chamar (só pasta), Demitir, Interromper | `agents.ts`, `ui/modals.ts`, `index.ts` |
| Conversa | Log ao vivo, instruções com anexos (imagem, PDF, texto, arquivo por caminho), sessão continua após reiniciar | `agents.ts` (`InputQueue`, `resume`), `attachments.ts`, `ui/panel.ts` |
| Contexto | Medidor como `/context` (leitura exata ao fim do turno + estimativa ao vivo), Compactar (`/compact`), Limpar (`/clear`) | `agents.ts` (`readContext`, `compact`, `clearContext`) |
| Decisões | Permitir / Sempre permitir / Negar com instrução; diff de Edit/Write e comando de Bash no cartão; AskUserQuestion como opções; ExitPlanMode como plano | `agents.ts` (`askPlayer`), `ui/dialog.ts` |
| Entregas | Agente leva o relatório em mãos; "Recebido" manda para o lounge | `agents.ts` (`deliver`, `ackResult`), `game.ts` |
| Quadro | Kanban Backlog/A fazer/Fazendo/Revisão/Feito, critérios, tags, pontos, prazo, comentários, atividade; Delegar a agente livre ou novo; agentes usam o quadro via `mcp__office__*`; só pessoas fecham | `tickets.ts`, `delegate.ts`, `ui/board.ts` |
| Terminal | Ponte por hooks HTTP: sessões do terminal viram agentes; permissões do terminal decididas no app; fechar sessão pelo app | `bridge.ts`, `session-process.ts` |
| Resume | Central de sessões recentes (terminal e escritório), busca, Chamar como agente, abrir no Terminal (Mac), copiar comando | `sessions.ts`, `ui/modals.ts` |
| Telemetria local | Limites do plano (5h, semana, por modelo) sem gastar tokens; CPU/RAM da máquina, do app e dos processos `claude` | `usage.ts`, `system.ts`, `ui/hud.ts` |
| Mundo | Escritório isométrico 32×24 com pixelização ajustável, avatares estilo Habbo, A*, telas que refletem status, conversa entre sessões animada, lounge com jogos, airsoft que demite | `world/*`, `game.ts` |
| Notificações | Notificação do SO quando sem foco, badge no Dock, bounce | `index.ts` |
| Dev | Modo demo, capturas automáticas, instância isolada, seed de agentes | `demo.ts`, `index.ts` |

## 5. Jornadas principais

1. **Primeira abertura**: janela abre com escritório vazio e o usuário sentado na sua mesa. Não há onboarding guiado; o caminho é "Contratar agente" ou "Chamar agente". *Oportunidade*: checagem de pré-requisitos (Claude Code instalado/logado) e tour de 30 s.
2. **Contratar e trabalhar**: o agente sobe pelo elevador, senta, a tela mostra código rolando, o crachá mostra a atividade ("Editando bridge.ts").
3. **Permissão**: o agente levanta, anda até a sua sala; o cartão abre quando você está perto (ou pela caixa de entrada). Decisão volta o agente à mesa.
4. **Entrega**: o agente traz o papel (vermelho se erro); "Recebido" e ele vai ao lounge após 3 min ocioso.
5. **Delegação por ticket**: escrever ticket com contexto e critérios → Delegar → agente lê o brief, marca critérios, comenta → relatório vira comentário e o ticket vai para Revisão → você aprova ou pede ajustes.
6. **Terminal conectado**: Configurações → Conectar; cada novo `claude` no terminal aparece como agente temporário; permissões chegam ao app.
7. **Retomar**: central de resume → Chamar → agente volta com histórico e espera no lounge.

## 6. Pontos fortes (com evidência)

| Força | Evidência no produto | Por que importa |
|---|---|---|
| Governança interativa | `askPlayer` + `Dialog` cobrem permissão, pergunta e plano; "Negar" aceita instrução | concorrentes visuais (Pixel Agents, roving-office, Claude-Office) só observam |
| Quadro operado por agentes | servidor MCP in-process em `TicketBoard.toolsFor()`; I-01 e I-02 | ponte entre gestão de trabalho e execução; raro no mercado |
| Ponte do terminal segura | 127.0.0.1, token, sem Origin, backup e escrita atômica do settings.json | atende quem não quer largar o terminal |
| Telemetria sem custo | limites do plano via SDK sem prompt; contexto exato via `getContextUsage` | responde às dúvidas mais frequentes de quem usa Claude Code muito |
| Cuidado de segurança acima da média | sandbox, CSP, DOMPurify, validação de IPC, regra sem bypass para tickets | base boa para distribuição pública |
| Microcopy excelente em pt-BR | textos humanos e acionáveis em todo o app | diferencia na comunidade brasileira |
| Arte e delight | pixelização real (RenderPixelatedPass), avatares procedurais, telas vivas | alto potencial de compartilhamento |
| Código limpo e enxuto | classes coesas, comentários de "por quê", TS strict | velocidade para evoluir com agentes |

## 7. Lacunas e riscos

| # | Área | Achado | Evidência | Impacto | Severidade | Recomendação |
|---|---|---|---|---|---|---|
| R1 | Qualidade | Zero testes automatizados, sem lint, sem CI | só existe `npm run typecheck` | regressões silenciosas, medo de mudar | Alta | Vitest + ESLint + GitHub Actions (mac+win) na v0.3 |
| R2 | Distribuição | Mac com assinatura ad-hoc, sem notarização; Windows sem assinatura; sem auto-update | `electron-builder.yml` (`identity: '-'`) | atrito de instalação, avisos de segurança, usuários presos em versões velhas | Alta | Developer ID + notarização, certificado Windows, `electron-updater` com canal estável |
| R3 | Plataforma | Porte Windows incompleto: badge, barra de título, fechar sessão, CPU `null`, abrir no Terminal só Mac, `npm run demo` POSIX, mensagens entre sessões oficiais sem Windows nativo | README "Porte para Windows" | metade dos sócios no Windows; mercado grande | Alta | épico "Windows de primeira classe" |
| R4 | Dependências instáveis | API experimental de limites, formato interno de `~/.claude/sessions`, SDK 0.3.x | `usage.ts`, `peers.ts` | quebra a cada atualização do Claude Code | Média | adaptadores + testes de contrato + matriz de compatibilidade |
| R5 | Alcance | UI 100% pt-BR com strings fixas | todo `ui/*` e `shared/*` | limita o mercado global (concorrentes são em inglês) | Média | i18n (pt-BR fonte, en-US alvo) |
| R6 | Acessibilidade | 0 atributos `aria-*`; status muito dependente do canvas e de cor | `grep aria- src/renderer` | exclui usuários; risco reputacional | Média | base WCAG 2.2 AA no HUD, painel, cartões e quadro |
| R7 | Isolamento | agentes na mesma pasta podem colidir; sem worktree por agente | `hire()` usa a pasta direto | perda de trabalho, conflitos | Média | worktree opcional por agente (padrão do app oficial, Conductor, Claude Squad, Nimbalyst) |
| R8 | Revisão | resultado é texto; sem visão de diff consolidado nem PR | `deliver()` | revisão fica no terminal/IDE | Média | painel de diff por agente/ticket e "abrir PR" |
| R9 | Escala do mundo | 10 mesas + 8 casas de sobra; layout fixo; re-render do HUD a cada mudança | `DESK_COUNT`, `OVERFLOW_TILES` | caos visual com 12+ agentes | Média | mesas dinâmicas/andares, editor leve de layout |
| R10 | Visibilidade de subagentes/teams | mensagens de subagentes são descartadas (`parent_tool_use_id`) | `agents.ts` `handle()` | trabalho invisível; Pixel Agents já mostra | Média | subagentes e teammates como personagens |
| R11 | Aprendizado de produto | sem telemetria (bom para privacidade) e sem canal de feedback | — | decisões às cegas | Média | telemetria opt-in mínima + botão "Enviar feedback" + issues templates |
| R12 | Gamificação arriscada | airsoft demite e encerra sessão de verdade no 3º tiro | `game.ts` `onKill` | perda de trabalho por brincadeira | Baixa | confirmação/undo opcional, ou "modo seguro" que só derruba |
| R13 | Custo | nenhum orçamento por agente; só leitura de limites | `usage.ts` | surpresa no fim da janela de 5h | Baixa | alertas por limiar e teto por agente |
| R14 | Onboarding | sem checagem de pré-requisitos nem tour | primeira abertura | abandono de quem não tem `claude` logado | Baixa | diagnóstico na primeira abertura |

## 8. Oportunidades

**Curto prazo (v0.3 — fundação)**
- Testes, lint e CI em macOS e Windows.
- Windows de primeira classe (badge com overlay, título, scripts PowerShell, fechar sessão, CPU de processos).
- i18n com en-US.
- Base de acessibilidade.
- Diagnóstico de primeira abertura.

**Médio prazo (v0.4–v0.5 — mesa de controle)**
- Worktree por agente + painel de diff + abrir PR.
- Subagentes e Agent Teams visíveis (estagiários e sala de reunião).
- Mais de 10 agentes (mesas dinâmicas, andares por projeto) e editor leve de layout.
- Alertas de limite e orçamento por agente.
- Integração com squads: ler `state.json` do opensquad e status do AIOX e mostrar o squad trabalhando, com checkpoints virando cartões.

**Longo prazo (v0.6+ — além do solo)**
- Provedores além do Claude Code (Codex CLI, Gemini CLI) por uma interface de provedor.
- Aprovação remota (celular/web companion).
- Modo time: escritório compartilhado e quadro online (o `TicketBoard` já foi isolado para isso) — base para monetização Pro/Team.

## 9. Métricas propostas

| Tipo | Métrica | Como medir hoje (sem telemetria) | Como medir com opt-in |
|---|---|---|---|
| Norte | **Decisões de agentes resolvidas por semana** (permissões, perguntas, planos e entregas recebidas pelo app) | contagem local exibível ao usuário | agregado anônimo |
| Valor | Tempo até decisão (pedido → resposta) | local | mediana anônima |
| Adoção | Instalações, estrelas, issues abertas por usuários | GitHub/Releases | + ativação (1º agente contratado) |
| Retenção | Usuários ativos semanais, D7/D30 | — | sessões do app por semana |
| Qualidade | Taxa de entregas com erro; crashes | logs locais | crash reports opt-in |
| Guarda | Ações perigosas aprovadas sem ver detalhe; uso do modo "Sem pedir nada" | local | anônimo |

## 10. Roadmap sugerido para as primeiras runs do squad

| Ordem | Run (track) | Resultado |
|---|---|---|
| 1 | entrega: "Infraestrutura de testes, lint e CI mac+win" | Vitest + ESLint + Actions; quality gate passa a exigir testes |
| 2 | iniciativa: "Windows de primeira classe" | paridade de badge, título, scripts, sessões, sistema |
| 3 | iniciativa: "Interface em inglês (i18n)" | catálogo pt-BR/en-US e troca de idioma |
| 4 | iniciativa: "Subagentes visíveis no escritório" | paridade com Pixel Agents e base para Agent Teams |
| 5 | iniciativa: "Worktree e revisão de diff por agente" | isolamento e revisão no app |
| 6 | release: "v0.3.0" | build assinado (se possível), notas, lançamento |
| 7 | discovery: "Squads no escritório (opensquad/AIOX)" | decisão sobre a integração com squads |

## 11. Perguntas em aberto para os sócios

1. O produto será open source público (MIT) ou fechado com versão gratuita? (afeta comunidade, CI e assinatura)
2. Qual é a meta de público para os próximos 3 meses: comunidade brasileira ou global?
3. Há orçamento para Apple Developer ID e certificado de assinatura Windows?
4. Telemetria opt-in é aceitável? Quais dados, no mínimo?
5. O airsoft que demite de verdade fica como está, ganha confirmação ou vira "modo seguro" por padrão?
6. Integração com squads (opensquad/AIOX) é direção estratégica ou experimento?
