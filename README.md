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

Checar tipos: `npm run typecheck`. Lint: `npm run lint` (ESLint com typescript-eslint, `eslint.config.js`).

Formatação: o Prettier (`.prettierrc.json`) segue o estilo do código (sem ponto e vírgula, aspas simples), mas o projeto ainda não foi todo formatado. Rode só nos arquivos que você mexeu: `npm run format -- src/main/updater.ts`. Reformatar tudo, se um dia for feito, vai num commit separado.

## Gerar o app

```bash
npm run dist:mac   # dist/Agent-Office-<versão>-arm64.dmg e -x64.dmg (+ .zip para o auto-update)
npm run dist:win   # rodar no Windows: dist/Agent-Office-Setup-<versão>.exe (NSIS)
```

O pacote não embute o Claude Code (são ~220 MB). Ele usa o `claude` instalado na máquina, procurado nesta ordem: variável `AGENT_OFFICE_CLAUDE`, binário do SDK em `node_modules` (só em dev), `PATH` e pastas comuns (`~/.local/bin`, `/opt/homebrew/bin`, ...). Veja `src/main/claude-path.ts`.

O Mac sai em dois builds, Apple Silicon (`arm64`) e Intel (`x64`), não um universal. Nada nativo vai no pacote (o binário do SDK, que é por CPU, fica de fora), então os dois saem de qualquer Mac e cada download tem metade do tamanho de um universal.

### Assinatura e notarização (Mac)

Sem credenciais, `npm run dist:mac` assina ad-hoc (`scripts/dist-mac.mjs`): o app roda na sua máquina, mas o Gatekeeper bloqueia em outras e o auto-update não instala. Para distribuir:

1. Entre no Apple Developer Program e crie um certificado **Developer ID Application**. Exporte como `.p12` com senha.
2. Crie uma senha de app em appleid.apple.com (Login e segurança → Senhas de app) e anote o Team ID (developer.apple.com → Membership).
3. Gere com as credenciais só no ambiente, nunca no repositório:

   ```bash
   export CSC_LINK=~/certs/developer-id.p12      # ou base64 do .p12; ou CSC_NAME="Developer ID Application: Nome (TEAMID)" se já estiver no Keychain
   export CSC_KEY_PASSWORD='senha do .p12'
   export APPLE_ID='voce@exemplo.com'
   export APPLE_APP_SPECIFIC_PASSWORD='abcd-efgh-ijkl-mnop'
   export APPLE_TEAM_ID='ABCDE12345'
   npm run dist:mac
   ```

   Com `CSC_LINK` ou `CSC_NAME`, o build liga o hardened runtime com `resources/entitlements.mac.plist` (só o JIT do V8) e notariza quando as três `APPLE_*` existem.
4. Confira: `spctl --assess --type execute -vv "dist/mac-arm64/Agent Office.app"` deve responder `accepted, source=Notarized Developer ID`.

No CI, as mesmas variáveis vêm dos secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` e `APPLE_TEAM_ID` (veja `.github/workflows/release.yml`).

**Windows:** sem certificado, o SmartScreen avisa "editor desconhecido" nas primeiras instalações. Com um certificado de assinatura de código (OV/EV, ou Azure Trusted Signing), defina `WIN_CSC_LINK` e `WIN_CSC_KEY_PASSWORD` (secrets de mesmo nome no CI).

### Atualização automática

O app instalado procura versão nova nas Releases do GitHub (`publish` no `electron-builder.yml`) ao abrir e a cada 6 horas, baixa em segundo plano e mostra no alto da tela "Versão X pronta. Reiniciar agora?". Se houver agente trabalhando ou permissão esperando, pergunta antes. Antes de reiniciar grava `office.json` e `tickets.json`. "Depois" instala quando você fechar o app. Em Configurações → Atualizações: canal Estável ou Beta (beta recebe também tags como `v0.4.0-beta.1`) e "Verificar agora". Código em `src/main/updater.ts`.

Requisitos: as Releases precisam ser públicas (repositório público ou um repositório só de releases), e no Mac o app precisa estar assinado com Developer ID. Em dev nada é verificado; `AGENT_OFFICE_FAKE_UPDATE=0.9.0 npm run dev` simula uma versão baixada para testar o aviso e a confirmação (o "Reiniciar" só grava e fecha).

### CI e releases

- `.github/workflows/ci.yml`: em todo PR e push na `main`, roda `npm ci`, `typecheck`, `lint`, `test` e `build` no macOS e no Windows.
- `.github/workflows/release.yml`: ao subir uma tag `v*` igual à versão do `package.json`, cria a release como rascunho, gera Mac e Windows com `--publish always` e publica quando os dois terminam. Tag com sufixo (`v0.4.0-beta.1`) vira pre-release.

  ```bash
  npm version 0.3.4 -m "Versão %s" && git push --follow-tags
  ```

- **Proteção da `main`** (o dono faz no GitHub): Settings → Branches → Add branch ruleset (ou "Add rule") para `main` → marque "Require a pull request before merging" e "Require status checks to pass", adicione `check (macos-latest)` e `check (windows-latest)` (aparecem depois do primeiro CI) e, se quiser, "Require branches to be up to date before merging".

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
    updater.ts          atualização automática pelas Releases do GitHub (electron-updater)
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
- `npm run bench` com `AGENT_OFFICE_DEMO=` (vazio) mede o escritório vazio e parado; `AGENT_OFFICE_BENCH_LIVE=1` mantém o ritmo do loop (passo lento com a cena parada, limite de fps), e o `fps` do relatório vira frames desenhados por segundo. Num headless, `__loop.hidden = true` simula a janela minimizada e `__loop.draws` conta os frames desenhados.
- Só em dev: `AGENT_OFFICE_BATTERY=1` começa como se estivesse na bateria; `=flip` alterna bateria e tomada a cada 5 s, para testar a economia automática sem tirar o cabo.
- `npm run icon` regenera `resources/icon.png` a partir do desenho em `scripts/make-icon.mjs`.
