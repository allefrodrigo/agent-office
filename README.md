# Agent Office

Escritório isométrico em pixel art onde agentes do Claude Code trabalham. Cada agente tem uma mesa e um computador, e a tela mostra o que ele está fazendo. Quando precisa de permissão, tem uma pergunta ou termina a tarefa, ele levanta e vai até a sua sala.

Inspirado no Habbo Hotel (visual isométrico) e no Gather (escritório virtual).

## O que faz

- **Contratar agente**: escolha nome, pasta do projeto, tarefa, modelo e modo de permissão. O agente sobe pelo elevador, senta numa mesa livre e começa.
- **Chamar agente** (botão `>_` ou a etiqueta "Chamar agente" no seu computador): escolha só a pasta, sem tarefa nem formulário. O agente chega e o painel abre para você digitar, como abrir o `claude` no terminal. Usa o modelo e o modo de permissão padrão das Configurações.
- **Contexto do agente**: o painel mostra quanto da janela de contexto a conversa ocupa (os mesmos números do `/context`), e a lista de agentes tem uma barrinha. **Compactar** resume a conversa (`/compact`); **Limpar** começa uma conversa nova com o mesmo agente (`/clear`), sem demitir.
- **Limites do plano**: no canto de cima, as janelas de 5h, da semana e por modelo (ex.: Fable), como no `/usage`, com o horário em que renovam. Atualiza a cada 3 minutos e depois de cada tarefa, sem gastar tokens.
- **Conversa entre sessões**: quando uma sessão do terminal manda mensagem para outra (`SendMessage`), o agente dela anda até a mesa do destinatário e mostra a primeira linha num balão. O nome de cada sessão vem de `~/.claude/sessions/*.json` (formato interno do Claude Code; se mudar, só some a animação). No Windows nativo, o Claude Code troca mensagens entre sessões desde a versão 2.1.234; a animação ainda não foi conferida lá.
- **Sistema**: abaixo dos limites do plano, CPU e RAM do computador (no Mac, RAM contada como no Monitor de Atividade; no Windows, como no Gerenciador de Tarefas), quanto o próprio escritório usa e a soma dos processos do Claude Code (agentes e sessões do terminal). No Windows, o app Claude Desktop fica fora da conta, e a CPU dos agentes aparece depois de duas amostras (de 15 a 60 segundos, conforme o número de núcleos). Atualiza a cada 3 segundos.
- **Avisos fora da janela**: no Mac, o ícone do Dock mostra quantas pendências (permissões e resultados) esperam por você e pula quando chega um pedido de permissão. No Windows, o ícone na barra de tarefas ganha um número (de 1 a "9+", lido pelo Narrador como "N pendências no Agent Office") e pisca quando chega permissão ou resultado com o app sem foco.
- **Permissões**: no modo "Pedir permissão", antes de editar arquivos ou rodar comandos o agente vai até você. O cartão mostra o comando ou o diff, com os botões Permitir, Sempre permitir e Negar (negar aceita uma instrução do que fazer em vez disso).
- **Perguntas e planos**: o `AskUserQuestion` vira um cartão com opções; o `ExitPlanMode` mostra o plano para aprovar ou pedir mudanças.
- **Resultados**: ao terminar, o agente leva o relatório até você. Depois de "Recebido", ele vai relaxar no lounge.
- **Quadro de tickets** (botão do quadro ou tecla `T`): kanban com Backlog, A fazer, Fazendo, Revisão e Feito. Cada ticket traz pasta do projeto, contexto, critérios de aceite, tags, pontos e prazo. "Delegar" entrega o ticket a um agente livre ou contrata um novo: ele recebe o ticket completo (o painel mostra "O que o agente lê"), marca os critérios, comenta e, ao terminar, o relatório vira comentário e o ticket vai para Revisão. Você aprova ou pede ajustes. Os agentes do escritório também usam o quadro sozinhos (ferramentas `mcp__office__*`): basta pedir "abra um ticket para isso" ou "liste os tickets em aberto". Só pessoas movem para Feito, e tickets nunca rodam no modo "Sem pedir nada". Os tickets ficam em `userData/tickets.json`.
- **Central de resume** (botão do relógio): lista as sessões recentes do Claude Code nesta máquina, do terminal ou do escritório, com busca. "Chamar" traz a sessão de volta como agente, com o histórico e o mesmo modelo; ele espera no lounge até receber a próxima instrução. Também abre a sessão num terminal já rodando `claude --resume <id>` (no Mac, o Terminal; no Windows, uma aba nova do Windows Terminal ou, sem ele, uma janela de console própria) ou copia o comando no formato do shell do sistema (zsh no Mac; PowerShell no Windows).
- **Lounge**: agentes livres sentam nos sofás e pufes ou jogam pebolim, fliperama e pingue-pongue.
- **Conversar**: clique no agente para abrir o painel com o log ao vivo e mandar novas instruções. A sessão continua de onde parou, inclusive depois de reiniciar o app.
- **Airsoft**: na mesa da sala de reunião. Pegue (clique ou E), mire e clique num agente. No terceiro tiro, um agente contratado sai do escritório e a sessão é encerrada; um agente do terminal desmaia e o app pergunta se deve fechar aquela sessão. Q larga a arma.
- **Sessões do terminal**: em Configurações → "Conectar", cada `claude` aberto no terminal também aparece no escritório, e os pedidos de permissão dele chegam até você no app. "Fechar sessão" encerra o `claude` daquele terminal: no Mac, como se você fechasse a aba; no Windows, **na hora** (o Windows não tem fechamento suave), e a confirmação avisa isso. Nos dois, a conversa fica salva para `claude --resume`.

Controles: clique no chão para andar, WASD ou setas, arraste com o botão direito para mover a câmera, roda do mouse para zoom. O botão da casinha leva você de volta à sua cadeira.

## Rodar

Passo a passo completo, com uso e solução de problemas: [COMO-RODAR.md](COMO-RODAR.md).

Requisitos: Node 20+ (para `npm test`, Node 22.18+), e o Claude Code instalado e logado (`claude` funcionando no terminal).

Os comandos são os mesmos no zsh, no PowerShell e no CMD:

```bash
npm install
npm run dev        # abre o app
npm run demo       # abre com agentes simulados, sem gastar tokens
npm test           # testes das funções puras (node:test, Node 22.18+)
```

Se aparecer `Error: Electron uninstall`, o binário do Electron não baixou no install:

```bash
node node_modules/electron/install.js
```

Checar tipos: `npm run typecheck`.

## Gerar o app

```bash
npm run dist:mac   # dist/Agent Office-<versão>-arm64.dmg e .zip
npm run dist:win   # rodar no Windows: um instalador NSIS por arquitetura (x64 e arm64)
```

O pacote não embute o Claude Code (são ~220 MB). Ele usa o `claude` instalado na máquina, procurado nesta ordem: variável `AGENT_OFFICE_CLAUDE`, binário do SDK em `node_modules` (só em dev), `PATH` e pastas comuns. No Mac: `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`. No Windows, sempre um `claude.exe`: `%USERPROFILE%\.local\bin` (instalador nativo), `%USERPROFILE%\.claude\local`, `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin` (npm global), a mesma pasta sob `%NVM_SYMLINK%`, `%LOCALAPPDATA%\Microsoft\WinGet\Links` (WinGet) e `%LOCALAPPDATA%\Programs\claude`. Se não achar, procura de novo na próxima tentativa: dá para instalar o Claude Code com o app aberto. Veja `src/main/claude-path.ts`.

O build de Mac usa assinatura ad-hoc: roda na sua máquina, mas para distribuir para outras pessoas é preciso um Developer ID e notarização (`electron-builder.yml`). Os instaladores do Windows saem sem assinatura (o SmartScreen avisa na primeira execução); o bloco `azureSignOptions` está pronto e comentado no `electron-builder.yml` para quando houver certificado.

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
                        abre no terminal (Mac e Windows)
    resume-guard.ts     valida a pasta da sessão (vem de ~/.claude) e limita "Abrir no terminal" a 1 a cada 1,5 s
    terminal-launch.ts  Windows: abre a sessão no Windows Terminal (wt.exe, sem shell) ou num console próprio
    peers.ts            acha a sessão pelo nome usado no SendMessage (~/.claude/sessions)
    system.ts           CPU e memória do computador, do app e dos processos do Claude Code
    win-processes.ts    Windows: processos claude.exe por tasklist + consulta CIM amostrada (separa o
                        Claude Desktop, mede CPU, confere identidade do PID antes de fechar sessão)
    usage.ts            limites do plano (5h, semana, por modelo) pelo SDK, sem mandar prompt
    claude-path.ts      encontra o executável do Claude Code (nativo, npm e WinGet no Windows)
    claude-messages.ts  mensagem "Não encontrei o Claude Code" com o instalador do sistema
    session-process.ts  descobre o PID do claude de cada sessão do terminal (pela conexão do hook) e o encerra
    badge.ts            Windows: desenha o número do overlay da barra de tarefas (PNG gerado em código)
    window-frame.ts     moldura da janela por sistema (barra de título integrada no Windows)
    store.ts            persistência (userData/office.json)
    env.ts              carrega o PATH do shell de login (apps abertos pelo Finder não têm)
    demo.ts             agentes simulados (npm run demo)
    index.ts            janela, IPC, notificações, badge do Dock e overlay da barra de tarefas
  preload/index.ts      expõe window.office (API tipada em shared/types.ts)
  shared/               tipos e textos compartilhados (commands.ts: comando de resume por shell)
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
                        (os-text.ts: textos que citam o sistema, como Finder × Explorador)
scripts/
  demo.mjs              npm run demo em qualquer shell (define AGENT_OFFICE_DEMO só para o filho)
  make-icon.mjs         gera resources/icon.png
```

Testes: arquivos `*.test.ts` ao lado do código, rodados por `npm test` (`node --test`, sem dependência). Por isso as funções testadas moram em módulos que só importam `node:*` ou `import type`.

Fluxo de um pedido de permissão: o SDK chama `canUseTool` → `AgentManager.requestDecision` emite `permission:new` → o renderer manda o avatar até a sua sala e abre o cartão quando você está perto → `window.office.respond()` resolve a promessa → o agente volta para a mesa.

Sessões do terminal usam o mesmo caminho: o hook `PermissionRequest` (HTTP) fica pendurado até você decidir, com timeout de 10 minutos. Se o app estiver fechado, o hook falha rápido e o Claude Code pergunta no terminal como sempre.

## Segurança

- O renderer roda com `contextIsolation`, `sandbox` e CSP sem scripts inline; não navega nem abre janelas. Links só abrem se forem `http(s)`.
- Saída dos agentes é renderizada como Markdown com HTML escapado e passada pelo DOMPurify.
- A ponte do terminal escuta só em `127.0.0.1`, exige um token aleatório (salvo em `userData/bridge-token`, permissão 600; no Windows, protegido pelas permissões da pasta do seu perfil) e recusa requisições com `Origin` (vindas de navegador). O token também fica em `~/.claude/settings.json`.
- "Abrir no terminal" nunca passa por shell: no Windows, só roda um `claude.exe` (nunca `.cmd` ou `.ps1`), e uma pasta com `;` vai direto para o console próprio, sem passar pelo Windows Terminal.
- Instalar a ponte faz backup em `~/.claude/settings.json.agent-office.bak`, preserva seus hooks e nunca sobrescreve um arquivo que não consegue ler. "Desconectar" remove só as entradas do app.
- O modo "Sem pedir nada" (`bypassPermissions`) deixa o agente rodar qualquer comando. O app avisa e pede confirmação; use só em pastas descartáveis.

## Porte para Windows (para o sócio)

O código é o mesmo, com ramificações por `process.platform`. Estado na branch `windows-primeira-classe` (ainda não lançada), verificado no Windows 11 x64:

**Funciona no Windows**

- `npm run dev`, `npm run demo` e `npm test` no PowerShell, no CMD e no Git Bash. O demo virou um script Node (`scripts/demo.mjs`), sem `VAR=x` no `package.json`.
- O app encontra o `claude.exe` das instalações nativa (`irm https://claude.ai/install.ps1 | iex`), npm global e WinGet. Sem Claude Code, o agente entrega a instrução de instalação do PowerShell.
- Pendências na barra de tarefas: overlay com o número (`win.setOverlayIcon`, imagem gerada em `badge.ts`) e `flashFrame` quando chega permissão ou resultado com a janela sem foco.
- Barra de título integrada às cores do escritório (`titleBarOverlay`), com o HUD abaixo dos 32 px da barra e longe dos botões nativos.
- Central de resume: "Abrir no terminal" abre uma aba do Windows Terminal (ou um console próprio, sem `wt` ou com `;` na pasta), e "Copiar comando" gera `Set-Location -LiteralPath '<pasta>'; claude --resume <id>` para o Windows PowerShell 5.1 (não roda no CMD).
- Card Sistema: conta só o Claude Code (o app Claude Desktop, que também é `claude.exe`, fica fora) e mostra a CPU dos agentes, com uma consulta CIM a cada 15–60 s.
- Textos do sistema certo: "Mostrar no Explorador", "como no Gerenciador de Tarefas", "computador" em vez de "Mac".
- "Fechar sessão" de um agente do terminal encerra o `claude` **na hora** (`TerminateProcess`: o Windows não tem SIGHUP e o `SIGTERM` vira encerramento forçado). A confirmação avisa isso e lembra que a conversa fica salva. Antes de encerrar, o app confere que o PID ainda é aquele `claude.exe`: nome exato, caminho fora do Claude Desktop e mesmo horário de criação (exceção do I-11 registrada em [docs/adr/0005](docs/adr/0005-encerramento-imediato-de-sessao-no-windows.md)).
- Hooks HTTP são multiplataforma: a ponte do terminal funciona sem mudanças.

**Ainda pendente**

- Roteiro manual antes do merge (M-1 a M-6 do QA): overlay e piscar com o app minimizado; leitura do Narrador; aba real do Windows Terminal com uma sessão real; custo de CPU ≤ 1 ponto percentual medido no Gerenciador de Tarefas; "Fechar sessão" com a ponte conectada; `npm run dist:win`, instaladores x64/arm64 e contratar agente no app empacotado com o Claude Code instalado só via npm.
- Assinatura de código: os instaladores saem sem assinatura e o SmartScreen avisa (ver [COMO-RODAR](COMO-RODAR.md#windows)). O bloco `azureSignOptions` está comentado no `electron-builder.yml`.
- `arm64`: o instalador é gerado, mas não foi executado (não há máquina arm64 para testar).
- Windows 10: sem Windows Terminal, abre o console próprio; com "ícones pequenos" na barra de tarefas, o Windows 10 não mostra o overlay (o piscar continua). Não verificado.
- Animação de conversa entre sessões no Windows nativo (Claude Code 2.1.234+): não verificada.
- macOS: só revisão de código nesta rodada. As mudanças visíveis no Mac estão listadas no [CHANGELOG](CHANGELOG.md).

## Ferramentas de desenvolvimento

- `npm test` roda os testes das funções puras com o `node:test` nativo (exige Node 22.18+, que executa `.ts` sem configuração). Os testes importam com a extensão `.ts`.
- `AGENT_OFFICE_SHOTS="out/shot:3000,8000"` salva capturas da janela (escondida) nesses tempos e fecha o app. `AGENT_OFFICE_EVAL="js1|||js2"` roda um trecho antes de cada captura; em dev, `window.__game`, `__state`, `__panel` e `__dialog` ficam disponíveis.
- `npm run icon` regenera `resources/icon.png` a partir do desenho em `scripts/make-icon.mjs`.
