# Agent Office

Escritório isométrico em pixel art onde agentes do Claude Code trabalham. Cada agente tem uma mesa e um computador, e a tela mostra o que ele está fazendo. Quando precisa de permissão, tem uma pergunta ou termina a tarefa, ele levanta e vai até a sua sala.

Inspirado no Habbo Hotel (visual isométrico) e no Gather (escritório virtual).

## O que faz

- **Contratar agente**: escolha nome, pasta do projeto, tarefa, modelo e modo de permissão. O agente sobe pelo elevador, senta numa mesa livre e começa.
- **Permissões**: no modo "Pedir permissão", antes de editar arquivos ou rodar comandos o agente vai até você. O cartão mostra o comando ou o diff, com os botões Permitir, Sempre permitir e Negar (negar aceita uma instrução do que fazer em vez disso).
- **Perguntas e planos**: o `AskUserQuestion` vira um cartão com opções; o `ExitPlanMode` mostra o plano para aprovar ou pedir mudanças.
- **Resultados**: ao terminar, o agente leva o relatório até você. Depois de "Recebido", ele vai relaxar no lounge.
- **Central de resume** (botão do relógio): lista as sessões recentes do Claude Code nesta máquina, do terminal ou do escritório, com busca. "Chamar" traz a sessão de volta como agente, com o histórico e o mesmo modelo; ele espera no lounge até receber a próxima instrução. Também abre a sessão no Terminal (Mac) ou copia o `claude --resume <id>`.
- **Lounge**: agentes livres sentam nos sofás e pufes ou jogam pebolim, fliperama e pingue-pongue.
- **Conversar**: clique no agente para abrir o painel com o log ao vivo e mandar novas instruções. A sessão continua de onde parou, inclusive depois de reiniciar o app.
- **Airsoft**: na mesa da sala de reunião. Pegue (clique ou E), mire e clique num agente. No terceiro tiro, um agente contratado sai do escritório e a sessão é encerrada; um agente do terminal desmaia e o app pergunta se deve fechar aquela sessão. Q larga a arma.
- **Sessões do terminal**: em Configurações → "Conectar", cada `claude` aberto no terminal também aparece no escritório, e os pedidos de permissão dele chegam até você no app.

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
    claude-path.ts      encontra o executável do Claude Code
    session-process.ts  descobre o PID do claude de cada sessão do terminal (pela conexão do hook) e o encerra
    store.ts            persistência (userData/office.json)
    env.ts              carrega o PATH do shell de login (apps abertos pelo Finder não têm)
    demo.ts             agentes simulados (npm run demo)
    index.ts            janela, IPC, notificações, badge do Dock
  preload/index.ts      expõe window.office (API tipada em shared/types.ts)
  shared/               tipos e textos compartilhados
  renderer/src/
    world/              three.js
      engine.ts         câmera ortográfica 2:1, luz, sombras, RenderPixelatedPass (o visual pixel art)
      layout.ts         planta do escritório: zonas, mesas, divisórias, pontos de visita e do lounge
      office.ts         monta o escritório e a grade de colisão
      furniture.ts      móveis em voxel (mesa, monitor, cadeira, plantas, sofá, elevador...)
      avatar.ts         personagens estilo Habbo com animação procedural
      screens.ts        telas dos computadores (canvas pixel art que reflete o status)
      pathfinding.ts    A* em 8 direções com paredes finas
      overlays.ts       crachás com nome e balões de fala (HTML sobre o canvas)
      weapons.ts        airsoft: modelo, BBs, faíscas, fantasma e efeitos sonoros
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
- `npm run icon` regenera `resources/icon.png` a partir do desenho em `scripts/make-icon.mjs`.
