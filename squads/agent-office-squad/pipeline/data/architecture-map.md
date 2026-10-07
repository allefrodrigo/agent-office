# Mapa de Arquitetura — Agent Office v0.2.0

Referência técnica para todos os agentes. Base: commit `78249be`. Quando o código mudar, o Artur Arquitetura atualiza este mapa (proposta no step-09, promoção pela Lívia no step-19).

## 1. Visão em camadas

```
┌──────────────────────── Renderer (Chromium, sandbox) ───────────────────────┐
│ main.ts (boot, wiring)  state.ts (espelho do estado, listeners)              │
│ game.ts (status → comportamento)   world/* (three.js)   ui/* (DOM puro)      │
└──────────────▲───────────────────────────────────────────┬───────────────────┘
               │ 'office:event' (OfficeEvent)               │ ipcRenderer.invoke('office:*')
┌──────────────┴──────────── Preload (CJS, contextBridge) ──▼───────────────────┐
│ window.office: OfficeAPI (tipada em src/shared/types.ts)                     │
└──────────────▲───────────────────────────────────────────┬───────────────────┘
               │ webContents.send                           │ ipcMain.handle
┌──────────────┴──────────────── Main (Node/Electron) ──────▼───────────────────┐
│ index.ts (janela, IPC, notificações, badge)                                  │
│ AgentManager (agents.ts) ── Claude Agent SDK query() ── processo `claude`    │
│ Bridge (bridge.ts) ── HTTP 127.0.0.1:47821 ◄── hooks das sessões do terminal │
│ TicketBoard (tickets.ts) + TicketDesk (delegate.ts) + servidor MCP "office"  │
│ UsageMonitor (usage.ts) · SystemMonitor (system.ts) · Store (store.ts)       │
│ sessions.ts · peers.ts · session-process.ts · claude-path.ts · env.ts        │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 2. Módulos e donos no squad

| Arquivo | Responsabilidade | Dono (executor) |
|---|---|---|
| `src/main/agents.ts` | `AgentManager`: hire/summon/recall, `InputQueue` (streaming input), `run()` com `query()` do SDK, `consume()/handle()` (mensagens → status/atividade/log/contexto/custo), `askPlayer()` (canUseTool), `requestDecision/respond/cancelRequest`, `deliver()` (resultados), agentes do terminal (`terminalAgent/Update/Result/Ended/Kill/Chat`), persistência de agentes e logs | Henrique Hook (integration) |
| `src/main/bridge.ts` | `Bridge`: servidor HTTP local dos hooks, autenticação, `dispatch()` por evento, `permission()` segura a requisição até a decisão, `install/uninstall` dos hooks em `~/.claude/settings.json`, `closeSession()` | Henrique Hook |
| `src/main/tickets.ts` | `TicketBoard`: CRUD, mover, comentar, critérios, atividade, persistência em `tickets.json`, `toolsFor()` (servidor MCP in-process com `tickets_list`, `ticket_get`, `ticket_create`, `ticket_update`, `ticket_check`, `ticket_comment`), `cleanDraft()` | Henrique Hook |
| `src/main/delegate.ts` | `TicketDesk`: delegar ticket a agente existente ou novo, regras (sem bypass, sem terminal, pasta compatível), relatório vira comentário e ticket vai para revisão | Henrique Hook |
| `src/main/sessions.ts` | central de resume (`listSessions`, `getSessionInfo`, `getSessionMessages`), `transcript()`, `openInTerminal()` (macOS), `cwdFromTranscript()` | Henrique Hook |
| `src/main/usage.ts` | `UsageMonitor`: limites do plano via API experimental do SDK, a cada 3 min e 5 s após cada turno, sem gastar tokens | Henrique Hook |
| `src/main/peers.ts` | nome da sessão → sessionId via `~/.claude/sessions/*.json` (formato interno) | Henrique Hook |
| `src/main/attachments.ts` | anexos → blocos (imagem/PDF base64, texto inline, outros como caminho), detecção por bytes, limites | Henrique Hook |
| `src/main/index.ts` | `createWindow()` (webPreferences seguras), handlers `ipcMain.handle('office:*')`, `notify()`, `updateBadge()`, wiring dos monitores, helpers de dev (`captureShots`, `seedAgents`) | Eduardo Electron (platform) |
| `src/preload/index.ts`, `src/preload/api.d.ts` | `window.office` via `contextBridge` | Eduardo Electron |
| `src/main/store.ts` | `Store`: `office.json` (settings, agents, results), escrita atômica com debounce de 800 ms | Eduardo Electron |
| `src/main/system.ts` | `SystemMonitor`: CPU/RAM da máquina, do app e dos processos `claude` a cada 3 s (`vm_stat` no Mac, `tasklist` no Windows) | Eduardo Electron |
| `src/main/session-process.ts` | PID do `claude` por porta de cliente (`lsof`/`netstat`), `terminate()` com SIGTERM → SIGHUP | Eduardo Electron |
| `src/main/claude-path.ts` | localizar o executável `claude` | Eduardo Electron |
| `src/main/env.ts` | PATH do shell de login (macOS/Linux) | Eduardo Electron |
| `src/main/demo.ts` | agentes simulados (`AGENT_OFFICE_DEMO=1`) | Eduardo Electron |
| `src/shared/types.ts` | todos os tipos compartilhados, `OfficeEvent`, `OfficeAPI` | Artur Arquitetura decide; quem implementa a story altera |
| `src/shared/tickets.ts` | rótulos e `ticketBrief()` (o texto que o agente lê) | Henrique Hook |
| `src/shared/describe.ts` | `describeTool()`, `describePermission()`, paletas, `lookFromSeed()`, `AGENT_NAMES` | Henrique (textos de ferramenta) / Iuri (paletas) |
| `src/shared/attachments.ts` | limites e mensagens de anexos | Henrique Hook |
| `src/renderer/src/world/engine.ts` | câmera ortográfica 2:1 (azimute 45°, elevação 30°), zoom em degraus, luzes, sombras PCF 2048, `RenderPixelatedPass`, raycast | Vitor Voxel (world) |
| `src/renderer/src/world/layout.ts` | planta 32×24: zonas, divisórias, 10 mesas, sala do usuário, pontos de visita, lounge | Vitor Voxel |
| `src/renderer/src/world/office.ts` | monta o escritório e a grade de colisão | Vitor Voxel |
| `src/renderer/src/world/furniture.ts`, `kit.ts`, `textures.ts` | móveis em voxel, geometria compartilhada, texturas pixel | Vitor Voxel |
| `src/renderer/src/world/avatar.ts` | personagens estilo Habbo, poses (`stand/sit/type/wave/talk/relax/play`), props (`paper/redPaper/mug/gun`), caminhada | Vitor Voxel |
| `src/renderer/src/world/pathfinding.ts` | A* em 8 direções com paredes finas | Vitor Voxel |
| `src/renderer/src/world/screens.ts` | telas 40×24 em canvas que refletem o status (`ScreenMode`) | Vitor Voxel |
| `src/renderer/src/world/overlays.ts` | crachás e balões em HTML sobre o canvas | Vitor Voxel / Fernanda Front |
| `src/renderer/src/world/weapons.ts` | airsoft: modelo, BBs, efeitos, sons | Vitor Voxel |
| `src/renderer/src/game.ts` | `Game`: atores, `desired()` (desk/boss/hang/leave/chat), `reconcile()`, `goDesk/goBoss/goHang`, `pose()`, `bubble()`, airsoft, input, câmera | Vitor Voxel |
| `src/renderer/src/state.ts` | `State`: espelho do main, `apply(e)`, `onChange`, `onLog`, `itemsFor()`, `ticketFor()` | Fernanda Front (ui) |
| `src/renderer/src/main.ts` | boot, wiring de Game/Hud/Panel/Dialog/Board, atalho T, loop de frames (~20 fps sem foco) | Fernanda Front |
| `src/renderer/src/ui/*` | `hud.ts` (barra, lista, inbox, limites, sistema, toasts), `panel.ts` (log, composer, anexos, contexto), `dialog.ts` (cartões de permissão/pergunta/plano/resultado), `modals.ts` (contratar, chamar, configurações, resume), `board.ts` (kanban), `markdown.ts`, `dom.ts` (`h()`, `icon()`), `portrait.ts` | Fernanda Front |
| `src/renderer/src/styles.css` | todo o CSS (~2.600 linhas) | Fernanda Front |
| `src/renderer/index.html` | casca e CSP | Fernanda Front (CSP: revisão da Sílvia) |
| `electron-builder.yml`, `electron.vite.config.ts`, `package.json` | build, empacotamento, scripts | Eduardo Electron (release: Diego Deploy) |

## 3. Canais IPC (renderer → main)

Todos via `ipcRenderer.invoke('office:<nome>')`, tipados em `OfficeAPI`:

`getState` · `getLog` · `hire` · `summon` · `send` · `interrupt` · `compact` · `clearContext` · `refreshUsage` · `fire` · `listSessions` · `recall` · `openInTerminal` · `closeTerminal` · `respond` · `ackResult` · `pickFolder` · `installBridge` · `uninstallBridge` · `saveSettings` · `createTicket` · `updateTicket` · `moveTicket` · `commentTicket` · `deleteTicket` · `assignTicket` · `delegateTicket` · `openExternal` · `revealPath`. Mais `pathForFile` (local no preload, `webUtils.getPathForFile`).

Regra: todo handler trata os argumentos como não confiáveis (`String()`, checagem de tipo, existência de pasta, listas de valores permitidos). Exemplo: `office:delegateTicket` reconstrói o alvo e só aceita os modos `default | acceptEdits | auto | plan`.

## 4. Eventos (main → renderer, canal `office:event`)

`agent:upsert` · `agent:removed` · `agent:log` · `agent:chat` · `permission:new` · `permission:resolved` · `result:new` · `result:acked` · `bridge:status` · `settings` · `usage` · `system` · `ticket:upsert` · `ticket:removed`.

`State.apply()` aplica e chama os listeners; `system` (a cada 3 s) atualiza só o card de sistema (`hud.renderSystem()`); `agent:chat` vai direto para `game.chat()`.

## 5. Dados persistidos

| Onde | O quê | Escrita |
|---|---|---|
| `userData/office.json` | `settings`, `agents` (summary + últimos 150 logs), `results` pendentes | `Store`, tmp + rename, debounce 800 ms |
| `userData/tickets.json` | `{ seq, tickets[] }` | `TicketBoard`, tmp + rename, debounce 500 ms |
| `userData/bridge-token` | token da ponte (48 hex), modo 0600 | uma vez |
| `~/.claude/settings.json` | hooks HTTP do app (marcador `agent-office/hook`) | `Bridge.writeHooks`: backup `.agent-office.bak`, tmp + rename, 0600 |
| `~/.claude/projects/**/<session>.jsonl` | transcrições (só leitura, via SDK e varredura de `cwd`) | — |
| `~/.claude/sessions/*.json` | nome ↔ sessionId das sessões vivas (formato interno, só leitura) | — |

`userData`: macOS `~/Library/Application Support/agent-office/`, Windows `%APPDATA%\agent-office\`. `AGENT_OFFICE_DATA_DIR` troca a pasta (instância isolada).

Os arquivos não têm campo de versão de formato: qualquer mudança de esquema precisa de migração tolerante (campos novos opcionais com padrão) — ver `Store.load()` que mescla com `DEFAULT_SETTINGS`.

## 6. Fluxos principais

**Pedido de permissão (agente do escritório)**: SDK chama `canUseTool` → `AgentManager.askPlayer()` (auto-permite só `mcp__office__*`) → `requestDecision()` emite `permission:new` e põe o agente em `waiting` → `Game.desired()` manda o avatar para a sala do usuário (`boss`) → `onNear` abre o cartão (`Dialog`) → `window.office.respond()` → `AgentManager.respond()` resolve a promessa (allow / allow_always com `updatedPermissions` / deny com mensagem) → agente volta a `working`. Se o SDK abortar, `cancelRequest()` nega com "Cancelado.".

**Sessão do terminal**: hooks HTTP (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `Stop`, `StopFailure`) → `Bridge.dispatch()` → `terminalAgent()` cria o agente com `source: 'terminal'` → `PermissionRequest` fica pendurado até a decisão (timeout 600 s); se o terminal responder antes, `res.on('close')` cancela o cartão. `PreToolUse` de `SendMessage` vira `agent:chat`.

**Delegar ticket**: `office:delegateTicket` → `TicketDesk.delegate()` (valida status, agente livre, pasta, modo) → `ticketBrief()` vira a mensagem → ticket vai para `doing` com responsável → no `result:new` do agente, o relatório vira comentário e o ticket vai para `review` (nunca `done`).

**Limites do plano**: `UsageMonitor.refresh()` inicia um `query()` com prompt que nunca envia mensagem, chama `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })` com timeout de 20 s, mapeia `five_hour`, `seven_day` e `model_scoped`; em erro mantém os últimos números marcados como desatualizados.

**Ciclo de frames**: `requestAnimationFrame` sempre; sem foco, atualiza no máximo a cada 50 ms (~20 fps); `dt` limitado a 0,05 s.

## 7. Invariantes (não quebrar sem ADR aprovado)

| Código | Invariante | Onde vive |
|---|---|---|
| I-01 | Só pessoas movem ticket para `done`; ferramentas de agente aceitam só `backlog`, `todo`, `doing`, `review` | `tickets.ts` (`agentStatus`), `delegate.ts` |
| I-02 | Tickets nunca rodam em `bypassPermissions` (delegar para agente nesse modo é recusado; agente novo de ticket cai para `default`) | `delegate.ts`, `index.ts` (`DELEGATE_MODES`) |
| I-03 | Ponte só em `127.0.0.1`, token comparado com `timingSafeEqual`, recusa requisição com `Origin`, corpo ≤ 2 MB, `PermissionRequest` com timeout de 600 s | `bridge.ts` |
| I-04 | `~/.claude/settings.json`: nunca sobrescrever arquivo ilegível (JSON inválido lança), backup antes de escrever, escrita atômica, desinstalar remove só entradas com o marcador do app | `bridge.ts` (`readSettings`, `writeHooks`) |
| I-05 | Renderer isolado: `contextIsolation`, `sandbox`, sem `nodeIntegration`, CSP sem script inline, sem navegação nem janelas novas, `openExternal` só `http(s)`, `revealPath` só caminho existente | `index.ts`, `index.html` |
| I-06 | Saída de agente renderizada só por `renderMarkdown` (HTML escapado + DOMPurify); nenhum `innerHTML` com dado externo | `ui/markdown.ts`, `ui/*` |
| I-07 | Sessões criadas pelo escritório são ignoradas pela ponte (`AGENT_OFFICE_MANAGED=1` + `isOfficeSession`) | `agents.ts`, `bridge.ts`, `usage.ts` |
| I-08 | Só ferramentas `mcp__office__*` são auto-permitidas; todo o resto passa por `canUseTool` e pela decisão do usuário (ou pelo modo que o usuário escolheu) | `agents.ts` (`askPlayer`) |
| I-09 | Anexos: tipo decidido pelos bytes, não pela extensão; limites de imagem (≈3,75 MB), PDF (24 MB), texto inline (1 MB), total (24 MB) e quantidade (10); formato desconhecido vai como caminho | `main/attachments.ts`, `shared/attachments.ts` |
| I-10 | Persistência atômica (tmp + rename) com debounce; `office.json` e `tickets.json` separados | `store.ts`, `tickets.ts` |
| I-11 | Sessão do terminal nunca recebe SIGKILL (SIGTERM, depois SIGHUP; checagem de PID com nome `claude` contra reuso) | `session-process.ts` |
| I-12 | Leitura de limites do plano não gasta tokens; a API experimental fica atrás de guarda com mensagem clara se sumir | `usage.ts` |
| I-13 | O app não gasta tokens sem ação explícita do usuário (nada roda sozinho na abertura; agentes restaurados voltam ociosos) | `agents.ts` (construtor), `index.ts` |
| I-14 | O main valida toda entrada do renderer e de agentes (tipos, tamanhos, listas permitidas, caminhos existentes, ids UUID) | `index.ts`, `tickets.ts` (`cleanDraft`), `sessions.ts` (`isSessionId`) |

## 8. Dependências instáveis (isolar atrás de adaptador)

| Dependência | Risco | Tratamento atual |
|---|---|---|
| `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` do SDK | pode mudar ou sumir | guarda com erro "Esta versão do SDK não informa os limites do plano." |
| `~/.claude/sessions/*.json` | formato interno | se mudar, só some a animação de conversa |
| Esquema dos hooks do Claude Code | campos podem mudar entre versões | campos opcionais no `HookInput` |
| `@anthropic-ai/claude-agent-sdk` 0.3.x | API ainda em evolução (minor pode quebrar) | versão com `^`; testar a cada atualização |
| Mensagens entre sessões (`SendMessage` cross-session) | oficial só em macOS/Linux (Windows via WSL 2) | animação simplesmente não aparece no Windows nativo |
| `lsof` / `netstat` / `tasklist` / `vm_stat` | ferramentas do SO | `run()` com timeout e resultado vazio em erro |

## 9. Pontos de extensão naturais

- **Novo tipo de evento**: tipar em `OfficeEvent`, emitir no main (`send`/`emitEvent`), tratar em `State.apply()` e consumir em `Game`/`ui`.
- **Novo canal IPC**: adicionar em `OfficeAPI`, no preload e em `ipcMain.handle` com validação.
- **Nova ferramenta MCP do quadro**: `TicketBoard.toolsFor()` com zod e `readOnlyHint` quando couber; respeitar I-01.
- **Novo provedor de agente** (Codex, Gemini): hoje não há interface de provedor — criar uma exige ADR (o Pixel Agents usa uma interface `HookProvider` por provedor; ver benchmark).
- **Armazenamento compartilhado do quadro**: `TicketBoard` já vive em arquivo próprio "para que um quadro online possa substituí-lo" (comentário no código).
