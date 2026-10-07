# Benchmark — Mercado de "escritórios" e mesas de controle de agentes

Pesquisa feita em 2026-10-07 (pesquisa web + leitura de READMEs). Confiança: **alta** = fonte primária (README/docs oficiais); **média** = imprensa ou mais de uma fonte secundária; **baixa** = uma fonte secundária ou listagem. Bruna Benchmark propõe atualizações a cada run de discovery; mudanças entram neste arquivo pela Lívia no step-19.

## 1. Mapa do mercado

| Categoria | Produtos | O que entregam | Relação com o Agent Office |
|---|---|---|---|
| **A. Escritórios visuais de agentes** | Pixel Agents, Atlassian roving-office, Claude-Office (W17ant e forks), Cubicle, virtual-agents-office, PixelHQ, Virtual Office do opensquad, The-Office, AgentOffice (harishkotra) | personagens animados refletindo sessões de agentes | concorrência direta na metáfora; quase todos só **observam** |
| **B. GUIs e orquestradores de sessões paralelas** | app desktop oficial do Claude Code, Conductor, Nimbalyst (ex-Crystal), Vibe Kanban, Claude Squad, Opcode, AIOX Cockpit | várias sessões, worktrees, diffs, kanban | concorrência no "trabalhar com vários agentes"; sem camada espacial |
| **C. "Mission control" das plataformas** | GitHub Agent HQ, Cursor 3 Agents Window, Google Antigravity Agent Manager | painel central de agentes integrado à plataforma | define a expectativa do mercado (caixa de decisões, artefatos, PRs) |
| **D. Aprovação remota** | Greenlight, clientes móveis do Claude Code | permissões no celular | lacuna do Agent Office |
| **E. Monitores de uso e limites** | ccusage, Claude-Code-Usage-Monitor, CC Usage Bar, claude-usage (Bread-bang), cli-usage-bar, widget de barra de tarefas (CodeZeno) | consumo, janelas de 5h/semana, previsões | o Agent Office já cobre o essencial, sem credenciais |
| **F. Frameworks de squad** | Synkra AIOX, opensquad, BMAD Method, Agent Teams (experimental) do Claude Code | papéis, pipelines, checkpoints | fonte de usuários e de integração |
| **G. Referências de design** | Habbo Hotel, Gather, WorkAdventure, AI Town (a16z), Generative Agents/Smallville (Stanford) | mundos isométricos, proximidade, agentes simulados | inspiração de interação e arte |

## 2. Fichas dos concorrentes mais relevantes

### Pixel Agents — líder da categoria A
- Extensão do VS Code e modo standalone `npx pixel-agents` (Node 20+). MIT. ~9,6 mil estrelas e ~1,6 mil forks no GitHub; ~87,7 mil instalações no Marketplace (alta/média).
- Detecta atividade por **hooks** do Claude Code (SessionStart, PreToolUse, PermissionRequest, Stop) com fallback heurístico lendo os JSONL de `~/.claude/projects` (alta).
- Personagem por agente com animação por ferramenta, balões de espera/permissão, som opcional; **subagentes e Agent Teams aparecem como personagens ligados ao pai** (alta).
- **Editor de escritório** completo: pisos, paredes, móveis, carpetes com auto-tiling, pets, áreas ligadas a pastas do workspace, desfazer/refazer, import/export JSON, grade até 64×64 (alta).
- Só Claude Code hoje; interface `HookProvider` para adicionar Codex, Gemini, Cursor (roadmap) (alta).
- Roadmap declarado: "Actually a game" (barras de vida de rate limit e orçamento de tokens, pontuação, móveis interativos, um escritório por projeto) e "Expanded orchestration" (personagens orquestradores, formar times, passar trabalho entre agentes, **agentes pegando tarefas de um quadro**) (alta).
- Aprovar permissões dentro do escritório não é documentado; a Fast Company o descreve como "observador silencioso" (média).
- **Leitura**: o roadmap converge para o território do Agent Office (limites, orquestração, quadro). Janela de diferenciação estimada: meses, não anos.

### Atlassian roving-office
- "Muito alpha", Apache-2.0, three.js com estilo "soft-3D" (não pixel art), sem build (alta).
- Define um **"Agent Office Protocol"** e um receptor; adaptadores para Rovo CLI, Claude Code (terminal, desktop, SDK), Cursor, Codex e OpenClaw (alta).
- Só observação; roadmap: eventos de permissão ("esperando ser permitido"), depois subagentes como fantasmas e clique para transcrição (alta).
- **Leitura**: sinal de que empresas grandes exploram a metáfora; colisão de nome com "Agent Office".

### Claude-Office (W17ant) e cópias
- Hooks PreToolUse/PostToolUse → Express + WebSocket → React; escritório isométrico pixel art com eventos aleatórios (simulado de incêndio, impressora travada) (média).
- Muitos forks/cópias com a mesma descrição; um fork adiciona hooks do Codex (média).
- **Leitura**: a barreira de entrada da visualização pura é baixa — a categoria está lotada de clones.

### Virtual Office do opensquad
- Dashboard Phaser em pixel art que lê `squads/*/state.json` (atualizado pelo runner a cada step) via plugin do Vite + WebSocket; mostra agentes do squad, status e handoffs (alta — código lido).
- Só observação; os checkpoints acontecem na IDE (alta).
- **Leitura**: integração natural — o Agent Office poderia ler o mesmo `state.json` e transformar checkpoints em cartões.

### AIOX Cockpit (SynkraAI)
- App desktop em beta (macOS/Windows): canvas com painéis de sessões Claude, daemon em segundo plano, "companions" (média — inferido do rastreador público de issues).
- Issues públicas relatam: painéis do Windows truncando histórico, ferramentas de Agent Teams ausentes no Windows, daemon matando painéis, painéis pretos após Modern Standby, e um bootstrap automático que custa ~US$ 0,25 por abertura (média).
- **Leitura**: o ecossistema AIOX quer um cockpit; qualidade no Windows e custo zero na abertura são diferenciais reais.

### App desktop oficial do Claude Code
- Redesenho em meados de abril/2026: barra lateral de sessões paralelas, layout arrastável, terminal e editor integrados, **isolamento por worktree** (média — imprensa e blogs; detalhes como worktree automático vs. opcional divergem).
- Incluso nos planos Pro/Max/Team/Enterprise; só modelos Claude (média).
- **Leitura**: maior risco de plataforma; o Agent Office não deve competir em "abas de sessão" e sim em governança espacial, quadro operado por agentes e ponte com terminal.

### Conductor (Mac)
- Cada workspace com sua worktree e branch; roda Claude Code, Codex e Cursor lado a lado; visualizador de diff; gratuito, usa o login existente; v0.63.0 (jun/2026) trouxe Cursor e "Dispatcher"; `.worktreeinclude` para arquivos não versionados (média).
- Só macOS (média).

### Nimbalyst (sucessor do Crystal)
- Kanban + diffs inline + worktrees; Crystal descontinuado em fev/2026 apontando para o Nimbalyst (média).

### Vibe Kanban
- Kanban para agentes de código, worktree por tarefa, suporta Claude Code, Codex, Gemini CLI, Cursor CLI e outros (alta).
- A empresa (Bloop) encerrou em abril/2026; o projeto (~26 mil estrelas) segue mantido pela comunidade, sem serviços hospedados (média).
- **Leitura**: popularidade não garante sustentabilidade — planejar modelo de negócio cedo.

### Claude Squad
- TUI sobre tmux, AGPL-3.0, worktree por agente, suporta Claude Code, Codex, Aider, Gemini; Windows só via WSL (média).

### GitHub Agent HQ · Cursor 3 · Google Antigravity
- **Agent HQ** (anunciado em 28/10/2025): "mission control" para atribuir, guiar e acompanhar agentes no GitHub, VS Code, celular e CLI; Claude e Codex em preview desde 04/02/2026 para Copilot Pro+/Enterprise (média).
- **Cursor 3 "Glass"** (02/04/2026): Agents Window substitui o Composer; agentes locais, na nuvem e via SSH; worktrees; revisão no app (média).
- **Google Antigravity** (20/11/2025): Editor + Manager ("mission control"); **caixa de entrada de decisões pendentes** e artefatos (planos, diffs, capturas, gravações de navegador); macOS/Windows/Linux; gratuito para indivíduos; modelos Gemini, Claude e GPT-OSS (média).
- **Leitura**: a "caixa de entrada de decisões" virou padrão de mercado — o Agent Office a materializa no espaço (agentes vêm até você), o que é mais memorável, mas precisa de paridade em artefatos (diff, plano, capturas).

### Greenlight e monitores de uso
- **Greenlight** envia pedidos de permissão para o celular (Claude Code, Copilot CLI, Cursor CLI, Codex CLI) (baixa/média).
- **ccusage** (lê JSONL, blocos de 5h, `--live`), **Claude-Code-Usage-Monitor** (Python, previsões), **CC Usage Bar** (abre sessão temporária e lê `/usage`, mesma abordagem sem credenciais do Agent Office), **claude-usage** (Bread-bang, usa token do Keychain) (média).

### Agent Teams e mensagens entre sessões (Claude Code)
- Agent Teams: experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, v2.1.32+; líder + teammates com contexto próprio, mensagens diretas (`SendMessage`); relatos de que `TeamCreate` saiu na v2.1.178 e teammates nascem pela ferramenta `Agent` (média/baixa — não confirmado no changelog).
- Mensagens entre sessões independentes: v2.1.224 (07/08/2026), macOS e Linux; Windows só via WSL 2; descoberta por `ListAgents` (alta — documentação oficial).
- **Leitura**: a animação de conversa entre sessões do Agent Office não aparece no Windows nativo; subagentes/teammates ainda não são visualizados.

## 3. Matriz de capacidades

Legenda: ✅ tem · ◐ parcial · ✗ não tem · ? não documentado.

| Capacidade | Agent Office | Pixel Agents | roving-office | Virtual Office (opensquad) | App oficial Claude Code | Conductor | Vibe Kanban | Agent HQ | Antigravity Manager |
|---|---|---|---|---|---|---|---|---|---|
| Mundo visual com personagens | ✅ | ✅ | ✅ | ✅ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Decidir permissão/pergunta/plano no app | ✅ | ? | ✗ | ✗ | ✅ | ✅ | ◐ | ◐ | ✅ |
| Conversar/mandar instruções | ✅ | ◐ (terminal embutido no modo CLI) | ✗ | ✗ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Kanban/tickets | ✅ | ✗ (roadmap) | ✗ | ✗ | ✗ | ✗ | ✅ | ✅ | ✗ |
| Agentes operam o quadro (MCP) | ✅ | ✗ (roadmap) | ✗ | ✗ | ✗ | ✗ | ◐ | ✅ | ✗ |
| Ponte para sessões do terminal | ✅ | ✅ | ✅ | ✗ | — | ✗ | ✗ | ✗ | ✗ |
| Worktree por agente | ✗ | ✗ | ✗ | ✗ | ✅ | ✅ | ✅ | ✅ | ◐ |
| Revisão de diff / PR | ◐ (diff no cartão) | ✗ | ✗ | ✗ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Vários provedores | ✗ | ✗ (roadmap) | ✅ | ✅ (por IDE) | ✗ | ✅ | ✅ | ✅ | ✅ |
| Limites do plano + contexto + custo | ✅ | ✗ (roadmap) | ✗ | ✗ | ◐ | ? | ✗ | ◐ | ? |
| Subagentes / teams visíveis | ◐ (só conversa entre sessões) | ✅ | ✗ (roadmap) | ✗ | ◐ | ? | ✗ | ✗ | ? |
| Editor/customização do escritório | ✗ | ✅ | ? | ✗ | — | — | — | — | — |
| Remoto/celular | ✗ | ◐ (navegador) | ◐ (web) | ✗ | ◐ | ✗ | ◐ | ✅ | ✗ |
| Plataformas | macOS arm64, Windows (porte) | VS Code (Win/Mac/Linux), navegador | web/Node | web local | macOS, Windows | macOS | web local | web, VS Code, CLI, celular | macOS, Windows, Linux |
| Licença / preço | MIT (privado) | MIT, grátis | Apache-2.0 | MIT | incluso no plano | grátis | open source (comunidade) | Copilot pago | grátis (indivíduos) |

## 4. Conclusões estratégicas

1. **Visualização sozinha não é fosso.** A categoria A está lotada de clones gratuitos; o diferencial do Agent Office é **governar** (decidir no espaço) e **organizar o trabalho** (quadro operado por agentes, ponte do terminal), não só mostrar.
2. **O líder vem na nossa direção.** O roadmap do Pixel Agents inclui barras de limite, orquestração e quadro. Prioridade: consolidar o que já temos e que ele não tem (decisões no app, quadro com MCP, limites/contexto) com polimento e distribuição.
3. **Paridade mínima com as mesas de controle**: worktree por agente, revisão de diff e PR viraram expectativa (app oficial, Conductor, Vibe Kanban, Cursor, Agent HQ, Antigravity).
4. **Caixa de decisões é padrão**: Antigravity e Agent HQ têm inbox; o nosso "agente vem até você" é a versão memorável — manter também a caixa de entrada clássica eficiente (teclado, lote).
5. **Windows é diferencial**: Conductor é só Mac, Claude Squad exige WSL, o AIOX Cockpit sofre no Windows. Windows impecável é vantagem competitiva — e metade dos sócios usa Windows.
6. **Acessibilidade e i18n quase não existem nos concorrentes** — oportunidade de qualidade e de mercado (en-US abre o mercado global; pt-BR segura a comunidade local).
7. **Ecossistema brasileiro de squads** (AIOX, opensquad) quer cockpits/escritórios e ainda só observa ou é instável: integrar squads ao Agent Office (ler `state.json`, checkpoints como cartões) é uma cunha de distribuição.
8. **Sustentabilidade**: Vibe Kanban (empresa encerrada), Opcode (manutenção parada) e Crystal (descontinuado) mostram o risco de produtos populares sem modelo de negócio. Decidir cedo entre open source puro, open core ou recursos pagos de time.
9. **Nome**: "Agent Office" colide com vários repositórios (agent-office, agents-office, Agents Office v3) e com o "Agent Office Protocol" da Atlassian — risco de SEO e de marca antes de um lançamento amplo.

## 5. Posicionamento proposto

> Para devs que rodam vários agentes do Claude Code ao mesmo tempo, o **Agent Office** é o escritório onde os agentes trabalham à vista e **vêm até você para decidir** — com quadro de tickets que eles mesmos usam, sessões do terminal conectadas e limites do plano sempre à mostra. Visualizadores só observam; GUIs de sessão só organizam abas; o Agent Office governa.

Provas para comunicar: aprovar permissão/pergunta/plano no escritório; ticket delegado que volta com relatório para revisão; limites do plano sem gastar tokens; ponte segura com o terminal.

## 6. Fontes (acesso em 2026-10-07)

- Pixel Agents — https://github.com/pixel-agents-hq/pixel-agents · https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents · https://www.fastcompany.com/91497413/this-charming-pixel-art-game-solves-one-of-ai-codings-most-annoying-ux-problems
- roving-office — https://github.com/atlassian-labs/roving-office
- Claude-Office — https://github.com/W17ant/Claude-Office
- Cubicle, virtual-agents-office, The-Office, AgentOffice — https://github.com/topics/ai-office · https://github.com/IshanVats-6/virtual-agents-office · https://github.com/booya1986/The-Office · https://github.com/harishkotra/agent-office
- opensquad (inclui o dashboard Virtual Office) — https://github.com/renatoasse/opensquad
- AIOX — https://github.com/SynkraAI/aiox-core · issues do Cockpit: https://github.com/SynkraAI/aiox-cockpit-issues
- App desktop do Claude Code — https://www.thurrott.com/a-i/anthropic/334911/anthropic-redesigns-claude-app-on-desktop-for-parallel-agents · https://www.producthunt.com/products/claude-redesigned
- Conductor — https://www.conductor.build/docs/guides/git-worktrees/run-claude-code-with-git-worktrees
- Nimbalyst / Crystal — https://github.com/stravu/crystal · https://nimbalyst.com/crystal/
- Vibe Kanban — https://github.com/BloopAI/vibe-kanban · https://www.vibekanban.com/blog/shutdown
- Claude Squad — https://starlog.is/articles/ai-dev-tools/smtg-ai-claude-squad
- Opcode — https://github.com/winfunc/opcode
- GitHub Agent HQ — https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/ · https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/
- Cursor 3 Agents Window — https://cursor.com/docs/agent/agents-window · https://cursor.com/changelog/3-0
- Google Antigravity — https://antigravity.google/blog/introducing-google-antigravity/
- Greenlight — https://aigreenlight.app/
- Monitores de uso — https://github.com/ryoppippi/ccusage · https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor · https://github.com/lionhylra/cc-usage-bar · https://github.com/svenedik/cli-usage-bar
- Agent Teams e mensagens entre sessões — https://code.claude.com/docs/en/agent-teams · https://code.claude.com/docs/en/cross-session-messaging
