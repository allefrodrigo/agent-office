# Agent Office

Escritório isométrico em pixel art onde agentes do Claude Code trabalham. Cada agente tem uma mesa e um computador, e a tela mostra o que ele está fazendo. Quando precisa de permissão, tem uma pergunta ou termina a tarefa, ele levanta e vai até a sua sala.

Inspirado no Habbo Hotel (visual isométrico) e no Gather (escritório virtual).

## O que faz

- **Novo agente** (botão principal da barra, tecla `N`, ou a etiqueta "Novo agente" no seu computador): um diálogo com abas que lembra a última usada. Num andar de empresa a pasta é a do andar e não muda; a escolha livre fica no térreo.
  - **Conversar**: escolha só a pasta, sem tarefa. O agente chega e o painel abre para você digitar, como abrir o `claude` no terminal.
  - **Com tarefa**: escolha também nome e tarefa (⌘/Ctrl+Enter contrata). O agente sobe pelo elevador, senta numa mesa livre e já começa.
  - **Squad**: só num andar com squads; contrata o orquestrador com o squad.
- **Andares por projeto** (botão "Andar de projeto" no elevador, ou Configurações → "Andares por projeto"): cada andar é uma pasta de projeto. Quem você contrata ou chama num andar trabalha na pasta dele, sem escolher pasta. Agentes de tickets, da central de resume ou do terminal cuja pasta fica dentro do projeto também sobem para lá. Quando há algo para você, eles pegam o elevador até onde você estiver. Se a pasta tiver squads do Opensquad (`squads/<code>/squad.yaml`), o quadro da Diretoria contrata um orquestrador com o squad inteiro, que roda o pipeline só com a equipe dele; o orquestrador é opcional. Tirar um andar não dispensa ninguém: os agentes descem para o térreo. A pasta de squads das versões anteriores vira o primeiro andar.
- **Andar = empresa** (Configurações → "Andares por projeto"): cada andar aceita um logo (PNG, JPG, WebP ou GIF, reduzido a 256 px) e uma cor; sem cor escolhida, vale a cor mais forte do logo. A placa da Diretoria mostra o logo e o nome, e o tapete dela ganha a cor da empresa. Marque "Agentes com a farda da empresa" para os agentes do andar usarem camisa na cor da empresa com o logo no peito; eles mantêm a farda quando descem até você.
- **Painel de gasto**: cada andar tem um painel na parede com quanto os agentes dele gastaram nesta sessão (no térreo, o escritório inteiro). O valor sobe rolando a cada mudança, os maiores gastos passam embaixo, e a etiqueta acima mostra o valor exato (passe o mouse para ver por agente).
- **Alarme de limite**: quando uma conta bate o limite do plano, o giroflex vermelho acima do painel acende e gira nos andares que usam essa conta (no térreo, com qualquer conta), com a etiqueta "Conta X no limite · volta 15:00".
- **Mesas e áreas**: cada mesa tem um setup (um monitor, dois, ultrawide, notebook com monitor, monitor vertical) em mesas brancas, de madeira ou escuras. O térreo tem uma copa; nos andares de empresa, as salas da frente sem setor viram lounge, copa, jogos e canto de pufes.
- **Conta sobre a cabeça**: cada agente do escritório tem um diamante girando sobre a cabeça, como no The Sims, na cor da conta em que está rodando. Com duas ou mais contas, a etiqueta do nome mostra também o nome da conta.
- **Contexto do agente**: o painel mostra quanto da janela de contexto a conversa ocupa (os mesmos números do `/context`), e a lista de agentes tem uma barrinha. **Compactar** resume a conversa (`/compact`); **Limpar** começa uma conversa nova com o mesmo agente (`/clear`), sem dispensar.
- **Limites do plano**: no canto de cima, as janelas de 5h, da semana e por modelo (ex.: Fable), como no `/usage`, com o horário em que renovam. Atualiza a cada 3 minutos e depois de cada tarefa, sem gastar tokens.
- **Conversa entre sessões**: quando uma sessão do terminal manda mensagem para outra (`SendMessage`), o agente dela anda até a mesa do destinatário e mostra a primeira linha num balão. O nome de cada sessão vem de `~/.claude/sessions/*.json` (formato interno do Claude Code; se mudar, só some a animação).
- **Várias contas do Claude** (Configurações → Contas, ou o ícone de pessoas no card de limites): cada conta extra tem a própria pasta `~/.claude-<nome>`, com login próprio (`CLAUDE_CONFIG_DIR`). Skills, configurações, sessões e memória ficam no `~/.claude` e chegam a ela por links. Cada andar escolhe a conta dos agentes dele; marque duas ou mais para revezar: o agente começa na conta menos usada na janela de 5h e, se ela bater o limite no meio da tarefa, continua a mesma conversa na outra. O card de limites mostra cada conta, e o painel mostra em qual conta o agente está. No terminal, `CLAUDE_CONFIG_DIR=~/.claude-<nome> claude` abre a mesma conta.
- **Sistema**: abaixo dos limites do plano, CPU e RAM do Mac (RAM contada como no Monitor de Atividade), quanto o próprio escritório usa e a soma de todos os processos `claude` (agentes e sessões do terminal). Atualiza a cada 3 segundos.
- **Permissões**: no modo "Pedir permissão", antes de editar arquivos ou rodar comandos o agente vai até você. O cartão mostra o comando ou o diff, com os botões Permitir, Sempre permitir e Negar (negar aceita uma instrução do que fazer em vez disso).
- **Perguntas e planos**: o `AskUserQuestion` vira um cartão com opções; o `ExitPlanMode` mostra o plano para aprovar ou pedir mudanças.
- **Resultados**: ao terminar, o agente leva o relatório até você. Depois de "Recebido", ele vai relaxar no lounge.
- **Quadro de tickets** (botão do quadro ou tecla `T`): kanban com Backlog, A fazer, Fazendo, Revisão e Feito. Cada ticket traz pasta do projeto, contexto, critérios de aceite, tags, pontos e prazo. "Delegar" entrega o ticket a um agente livre ou contrata um novo: ele recebe o ticket completo (o painel mostra "O que o agente lê"), marca os critérios, comenta e, ao terminar, o relatório vira comentário e o ticket vai para Revisão. Você aprova ou pede ajustes. Os agentes do escritório também usam o quadro sozinhos (ferramentas `mcp__office__*`): basta pedir "abra um ticket para isso" ou "liste os tickets em aberto". Só pessoas movem para Feito, e tickets nunca rodam no modo "Sem pedir nada". **Fechar**: os tickets de Feito fecham sozinhos depois de 7 dias (ajuste em "Fechados", ou desligue), ou na hora, pelo ícone de arquivo da coluna Feito ou por "Fechar agora" no ticket. Fechados saem do quadro e vão para `userData/tickets-closed.json`, lido só quando alguém consulta: o botão "Fechados" busca, mostra o contexto e os últimos comentários, e reabre em A fazer. Os agentes só leem fechados quando pedem (`tickets_list` com `closed`, ou `ticket_get` pela chave). O quadro fica em `userData/tickets.json`.
- **Central de resume** (botão do relógio): lista as sessões recentes do Claude Code nesta máquina, do terminal ou do escritório, com busca. "Chamar" traz a sessão de volta como agente, com o histórico e o mesmo modelo; ele espera no lounge até receber a próxima instrução. Também abre a sessão no Terminal (Mac) ou copia o `claude --resume <id>`.
- **Lounge**: agentes livres sentam nos sofás e pufes ou jogam pebolim, fliperama e pingue-pongue.
- **Conversar**: clique no agente para abrir o painel com o log ao vivo e mandar novas instruções. A sessão continua de onde parou, inclusive depois de reiniciar o app.
- **Caveira**: no armário ao lado da sua sala. Clique nela, escolha um agente na lista e confirme. A câmera vai até ele, em qualquer andar, a caveira o derruba e a sessão é encerrada: um agente contratado sai do escritório; o `claude` de um agente do terminal fecha (a conversa fica salva para `claude --resume`).
- **Sessões do terminal**: em Configurações → "Conectar", cada `claude` aberto no terminal também aparece no escritório, e os pedidos de permissão dele chegam até você no app. Se a ponte parar, um ponto âmbar aparece na engrenagem, que abre Configurações direto nessa seção.

Controles: clique no chão para andar, WASD ou setas, arraste com o botão direito para mover a câmera, roda do mouse para zoom. O botão da casinha leva você de volta à sua cadeira.

## Rodar

Passo a passo completo, com uso e solução de problemas: [COMO-RODAR.md](COMO-RODAR.md).

Requisitos: Node 20+, e o Claude Code instalado e logado (`claude` funcionando no terminal).

```bash
npm install
npm run dev        # abre o app
npm run demo       # abre com agentes simulados, sem gastar tokens
```

Se aparecer `Error: Electron uninstall`, o binário do Electron não baixou no install:

```bash
node node_modules/electron/install.js
```

Checar tipos: `npm run typecheck`.

## Gerar o app

```bash
npm run dist:mac   # dist/Agent Office-<versão>-arm64.dmg e .zip
npm run dist:win   # rodar no Windows: instalador NSIS
```

O pacote não embute o Claude Code (são ~220 MB). Ele usa o `claude` instalado na máquina, procurado nesta ordem: variável `AGENT_OFFICE_CLAUDE`, binário do SDK em `node_modules` (só em dev), `PATH` e pastas comuns (`~/.local/bin`, `/opt/homebrew/bin`, ...). Veja `src/main/claude-path.ts`.

O build de Mac usa assinatura ad-hoc: roda na sua máquina, mas para distribuir para outras pessoas é preciso um Developer ID e notarização (`electron-builder.yml`).

## Arquitetura

```
src/
  main/                 processo principal (Node)
    agents.ts           AgentManager: roda agentes com o Claude Agent SDK (query em streaming),
                        traduz mensagens em status/atividade/log, segura permissões (canUseTool)
                        até você decidir, guarda resultados
    bridge.ts           servidor HTTP local para os hooks do Claude Code (sessões do terminal)
                        e instalador dos hooks em ~/.claude/settings.json
    sessions.ts         central de resume: lista sessões (listSessions do SDK), importa o histórico,
                        abre no Terminal
    peers.ts            acha a sessão pelo nome usado no SendMessage (~/.claude/sessions)
    system.ts           CPU e memória do Mac, do app e dos processos claude
    usage.ts            limites do plano (5h, semana, por modelo) de cada conta, pelo SDK, sem mandar prompt
    accounts.ts         contas do Claude (CLAUDE_CONFIG_DIR + links para ~/.claude), conta de cada execução,
                        revezamento quando uma bate o limite, login pelo Terminal
    claude-path.ts      encontra o executável do Claude Code
    session-process.ts  descobre o PID do claude de cada sessão do terminal (pela conexão do hook) e o encerra
    squads.ts           squads do Opensquad: lê squad.yaml e o pipeline, monta o orquestrador e fecha a equipe
    store.ts            persistência (userData/office.json)
    env.ts              carrega o PATH do shell de login (apps abertos pelo Finder não têm)
    demo.ts             agentes simulados (npm run demo)
    index.ts            janela, IPC, notificações, badge do Dock
  preload/index.ts      expõe window.office (API tipada em shared/types.ts)
  shared/               tipos e textos compartilhados
  renderer/src/
    world/              three.js
      engine.ts         câmera ortográfica 2:1, luz, sombras, RenderPixelatedPass (o visual pixel art)
      layout.ts         planta do térreo (zonas, mesas, lounge) e dos andares de projeto
      office.ts         monta o térreo e a grade de colisão
      upper-floor.ts    monta um andar de projeto: Diretoria, salas do time e setores dos squads
      furniture.ts      móveis em voxel (mesa, monitor, cadeira, plantas, sofá, elevador...)
      avatar.ts         personagens estilo Habbo com animação procedural
      screens.ts        telas dos computadores (canvas pixel art que reflete o status)
      pathfinding.ts    A* em 8 direções com paredes finas
      overlays.ts       crachás com nome e balões de fala (HTML sobre o canvas)
      skull.ts          caveira em voxel (a do armário e a que cai sobre o agente)
      effects.ts        golpe da caveira, fumaça, faíscas, fantasma e efeitos sonoros
    game.ts             comportamento: status do agente -> onde ele vai e o que faz
    ui/                 HUD, painel do agente, cartões de permissão/resultado, modais
```

Fluxo de um pedido de permissão: o SDK chama `canUseTool` → `AgentManager.requestDecision` emite `permission:new` → o renderer manda o avatar até a sua sala e abre o cartão quando você está perto → `window.office.respond()` resolve a promessa → o agente volta para a mesa.

Sessões do terminal usam o mesmo caminho: o hook `PermissionRequest` (HTTP) fica pendurado até você decidir, com timeout de 10 minutos. Se o app estiver fechado, o hook falha rápido e o Claude Code pergunta no terminal como sempre.

## Segurança

- O renderer roda com `contextIsolation`, `sandbox` e CSP sem scripts inline; não navega nem abre janelas. Links só abrem se forem `http(s)`.
- Saída dos agentes é renderizada como Markdown com HTML escapado e passada pelo DOMPurify.
- A ponte do terminal escuta só em `127.0.0.1`, exige um token aleatório (salvo em `userData/bridge-token`, permissão 600) e recusa requisições com `Origin` (vindas de navegador). O token também fica em `~/.claude/settings.json`.
- Instalar a ponte faz backup em `~/.claude/settings.json.agent-office.bak`, preserva seus hooks e nunca sobrescreve um arquivo que não consegue ler. "Desconectar" remove só as entradas do app.
- O modo "Sem pedir nada" (`bypassPermissions`) deixa o agente rodar qualquer comando. O app avisa e pede confirmação; use só em pastas descartáveis.

## Porte para Windows (para o sócio)

O código é o mesmo; o que falta validar:

1. `npm install && npm run dev` no Windows. Para o demo no PowerShell: `$env:AGENT_OFFICE_DEMO=1; npm run dev`.
2. `claude-path.ts`: confirmar onde o instalador nativo coloca o `claude.exe` (hoje procura no `PATH`, `%USERPROFILE%\.local\bin`, `%LOCALAPPDATA%\Programs\claude`, `%APPDATA%\npm`).
3. Badge de pendências: `app.setBadgeCount` não funciona no Windows; usar `win.setOverlayIcon` em `index.ts` (`updateBadge`).
4. Barra de título: no Mac usamos `hiddenInset`; no Windows fica a moldura padrão. Avaliar `titleBarOverlay`.
5. `npm run dist:win` gera o instalador NSIS (precisa rodar no Windows).
6. Hooks HTTP são multiplataforma, a ponte do terminal deve funcionar sem mudanças.
7. "Fechar sessão" de um agente do terminal: no Windows o PID vem do `netstat -ano` e a checagem do `tasklist` (`session-process.ts`). Testar, porque o Windows não tem SIGHUP e o `SIGTERM` vira encerramento forçado.

## Ferramentas de desenvolvimento

- `AGENT_OFFICE_SHOTS="out/shot:3000,8000"` salva capturas da janela (escondida) nesses tempos e fecha o app. `AGENT_OFFICE_EVAL="js1|||js2"` roda um trecho antes de cada captura; em dev, `window.__game`, `__state`, `__panel` e `__dialog` ficam disponíveis.
- Log do app em `userData/logs/main-<data>.log` (gira em 5 MB, guarda 5 arquivos; sem prompts nem tokens). `AGENT_OFFICE_DEBUG=1` inclui o nível debug.
- Só em dev: `AGENT_OFFICE_CRASH=main|rejection|renderer|hang|page-error` quebra algo 6 s depois de abrir, para testar o tratamento de erros. `AGENT_OFFICE_LOG_MAX_KB=20` gira o log mais cedo.
- `npm run icon` regenera `resources/icon.png` a partir do desenho em `scripts/make-icon.mjs`.
