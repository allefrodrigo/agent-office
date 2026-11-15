# Plano de implementação — Chat dos bots

- **Spec:** [chat-de-bots.md](chat-de-bots.md)
- **Status:** rascunho de 2026-11-15. A fase 1 começa por ondas de agentes em worktrees (veja "Como os agentes dividem o trabalho").
- **Branch:** `feat/chat-bots`, a partir do `main` (0.3.9) com a `release/0.4.0-beta.4` já juntada (arte própria na vista 2D). A fase 1 sai na **0.4.0-beta.5**, com tudo junto; a 0.4.0 final fecha quando as fases 1 e 2 estiverem estáveis.
- **Estimativa:** 22 a 27 dias de dev para uma pessoa (fases 1 a 4). Com dois agentes por onda, a fase 1 cai para uns 4 dias de calendário.

## Como ler

Cada fase termina com algo que roda e pode ir para uma beta. Cada ticket (`CB-xx`) diz os arquivos, o conteúdo, os testes e o aceite.

Regras de todo ticket:

- `npm run typecheck`, `npm run lint`, `npm test` e `npm run contrast` verdes.
- Lógica nova em funções puras de `src/shared`, com teste em `test/<modulo>.test.ts` (vitest, `describe`/`it` em pt-BR). Módulos novos entram na lista de cobertura de `vitest.config.ts` (70% de linhas).
- Todo argumento de IPC passa por `validate.ts`.
- Textos da UI em pt-BR; erros dizem o que fazer ("O andar deste bot não existe mais. Edite o bot e escolha outro.").
- Logs sem conteúdo de mensagem: só contagens, durações, ids e modelo.
- Atalho novo aparece na lista do `?` (`ui/shortcuts.ts`).
- Bot nunca roda em `bypassPermissions`.

## Visão geral

| Fase | Entrega | Tickets | Dias | Depende de |
|---|---|---|---|---|
| 1 · Bots e conversa | Criar bots, conversar, aprovar no fio, memória, guarda | CB-01 a CB-11 | 9–11 | — |
| 2 · Automações | Agenda e eventos, calendário, conexões, automação por frase | CB-12 a CB-16 | 5–6 | 1 |
| 3 · Canais | Canais, roteador, `@menção`, bots conversando entre si | CB-17 a CB-20 | 5–6 | 1 (pode correr junto da 2) |
| 4 · Squads e rotinas | Squad como canal com agenda; rotinas viram bots | CB-21 a CB-23 | 3–4 | 2 e 3 |
| 5 · Depois | Webhook local, eventos de app, voz, skill gravada | CB-24+ | a estimar | 4 |

```
CB-01 ─┬─► CB-02 ─► CB-03 ─┐
       ├─► CB-04 ──────────┼─► CB-05 ─► CB-06 ─► CB-07 ──────────┐
       │                   │                                      ├─► CB-11
       └─► CB-08 ─► CB-09 ─┴─► CB-10 ─────────────────────────────┘
                                   │
            fase 2: CB-12 ─► CB-13 ─► CB-14 ─► CB-15 ─► CB-16
            fase 3: CB-17 ─► CB-18 ─► CB-19 ─► CB-20
            fase 4: CB-21 ─► CB-22 ─► CB-23
```

## Como os agentes dividem o trabalho

| Onda | Agente | Tickets | Arquivos que só ele mexe |
|---|---|---|---|
| 0 | coordenador | CB-01 (contrato) | `src/shared/types/bots.ts`, `ipc.ts`, `preload/index.ts` |
| 1 | `bots-main` | CB-02 a CB-07 | `src/shared/bots.ts`, `src/shared/bots-guard.ts`, `src/main/bots/**`, `src/main/agents/**`, `src/main/index.ts`, `src/main/validate.ts`, `src/main/backups.ts`, `src/main/data.ts`, `src/main/ipc/bots.ts`, `src/main/store.ts`, `src/main/tickets.ts` |
| 1 | `bots-ui` | CB-08 a CB-10 | `src/shared/bots-view.ts`, `src/shared/bot-templates.ts`, `src/renderer/src/ui/chat/**`, `src/renderer/src/main.ts`, `src/renderer/src/ui/shortcuts.ts` |
| 1→2 | coordenador | CB-11 (juntar, demo, Configurações) | o que sobrar |
| 2 | `bots-automacoes` | CB-12 a CB-16 | `src/main/routines/**`, `src/main/bots/triggers.ts`, `src/main/bots/automation.ts`, `ui/chat/automations/**`, `ui/routines/**` |
| 2 | `bots-canais` | CB-17 a CB-20 | `src/main/bots/channels.ts`, `src/main/bots/router.ts`, `src/main/bots/mcp.ts`, `ui/chat/channels/**` |
| 3 | `bots-squads` | CB-21 a CB-23 | `src/main/squads.ts`, `src/main/bots/squad-channel.ts`, `ui/chat/squads/**` |

Cada agente trabalha numa worktree própria, faz commits pequenos e termina com os quatro comandos verdes. O coordenador junta na `feat/chat-bots` e resolve conflitos antes da onda seguinte.

---

## Fase 1 — Bots e conversa (9–11 dias)

Entrega: criar um bot pela galeria, conversar com ele no Chat, ver a rodada com os passos, aprovar um pedido no fio, editar a memória, e ter certeza de que `git push` sempre pede o seu sim.

### CB-01 · Contrato: tipos, API e eventos

- **Arquivos:** `src/shared/types/bots.ts` (novo), `src/shared/types/index.ts`, `src/shared/types/agents.ts` (`AgentSummary.bot`), `src/shared/types/ipc.ts` (`OfficeAPI`, `OfficeEvent`), `src/preload/index.ts`.
- **Conteúdo:** `Bot`, `BotDraft`, `BotRun`, `RunTrigger`, `ThreadItem`, `Channel`, `BotEventTrigger`, `ChatSettings`, `SensitiveKind`, limites (`BOT_LIMITS`) e os rótulos. API da fase 1 (`listBots`, `saveBot`, `deleteBot`, `duplicateBot`, `setBotFlags`, `markBotRead`, `botThread`, `sendToBot`, `runBotNow`, `stopBot`, `newBotConversation`, `configureBot`, `botMemory`, `saveBotMemory`, `searchBots`). Eventos `bots`, `bot:item`, `channels`, `botTriggers`. Aprovações usam o `respond` que já existe.
- **Aceite:** `npm run typecheck` verde; nenhum comportamento muda.

### CB-02 · Funções puras do fio e do prompt

- **Arquivos:** `src/shared/bots.ts` (novo), `test/bots.test.ts`.
- **Conteúdo:**
  - `foldThread(lines)`: o fio é um JSONL só de anexar; uma linha com `id` repetido atualiza o item, que fica na posição da primeira vez. Linhas inválidas são puladas.
  - `itemsFromLog(entry, run)`: `LogEntry` → o que muda no fio. `assistant` vira candidato a balão e passo; `tool`, `thinking`, `tool_result` viram passos (no máximo 50 por rodada, texto até 300 caracteres); `user` só entra se veio do Chat (o runner marca).
  - `closeRun(run, result)`: o texto final vira o balão do bot; os textos do meio ficam nos passos; erro vira aviso vermelho.
  - `botSystemPrompt(bot, memory, floorName)`: nome, função, regras de aprovação (`askBefore`), como usar a memória e o fio, e "nunca guarde chaves ou senhas na memória". Até ~1.500 tokens além da memória.
  - `recentContext(items, n = 20)`: as últimas `n` mensagens (você e o bot) em texto curto, para a rodada agendada, até ~2.000 tokens.
  - `runHeader(trigger, at)`: "Automação "Resumo da manhã" · execução de 15/11 07:30".
  - `cleanMemory(text)`: corta em 16 KB sem quebrar uma linha no meio.
- **Testes:** dobra com atualização, ordem e linha quebrada; passos limitados e cortados; balão final igual ao texto do resultado e sem repetir; prompt com e sem memória, com cada `askBefore`; contexto respeita o limite; memória cortada.

### CB-03 · Guarda de ações sensíveis

- **Arquivos:** `src/shared/bots-guard.ts` (novo), `test/bots-guard.test.ts`, `src/main/agents/sdk.ts` (hook), `src/main/agents/decisions.ts` (sem "Sempre permitir" no sensível).
- **Conteúdo:**
  - `sensitiveKind(tool, input): SensitiveKind | null`. `Bash`: analisa o comando, inclusive encadeado (`&&`, `;`, `|`, subshell), e pega `git push`, `gh pr merge|create`, `gh release create`, `npm|pnpm|yarn publish`, `vercel|netlify|fly deploy`, `rm -r`/`rm -rf`, `git clean -f`, `git reset --hard` com remoto, `DROP|TRUNCATE`, `curl|wget` com `-X POST|PUT|DELETE|PATCH` ou `-d` para host que não é `localhost`/`127.0.0.1`, `sendmail`, `mail`. MCP (`mcp__<servidor>__<ferramenta>`): pelos verbos do nome da ferramenta (`send`, `reply`, `post_message`, `publish`, `deploy`, `delete`, `remove`, `archive`, `payment`, `charge`, `refund`, `payout`, `invoice`, `merge`). `office` nunca é sensível. Nos casos duvidosos, pede.
  - `guardHook(askBefore)`: `HookCallbackMatcher` de `PreToolUse` que devolve `permissionDecision: 'ask'` com o motivo ("Publicar: npm publish") quando o tipo está em `askBefore`.
  - Em `startQuery`, agente com `summary.bot`: junta o hook do guarda aos hooks do squad (se houver) e nunca usa `bypassPermissions`.
  - Em `askPlayer`: se o motivo veio do guarda, o pedido sai com `canAlwaysAllow: false` e o tipo sensível no `context`.
- **Testes:** corpus com 100+ casos (60 que pedem, 40 que não pedem), incluindo encadeados e aspas; `office` liberado; hook só age no tipo marcado.
- **Aceite:** no `npm run demo` com um bot, `git push` no modo Automático chega como pedido. **Antes de fechar, rodar uma vez com o CLI de verdade** para confirmar que `permissionDecision: 'ask'` chama o `canUseTool` nos modos Automático e Aceitar edições. Se não chamar, o bot passa a rodar em "Pedir permissão" e o `askPlayer` libera sozinho o que não é sensível; anotar num ADR (`docs/adr/0014-guarda-de-acoes-sensiveis.md`).

### CB-04 · Armazenamento dos bots e dos fios

- **Arquivos:** `src/main/bots/store.ts`, `src/main/bots/thread.ts` (novos), `src/main/backups.ts` (`DATA_FILES`, `DATA_SHAPES` com `bots.json`), `src/main/data.ts`, `test/bots-store.test.ts`.
- **Conteúdo:**
  - `BotStore` no molde do `RoutineStore`: `userData/bots.json` com `{ bots, channels, eventTriggers }`; gravação atômica com debounce, `flush`, `lock`, backup; `loadBot(raw)` defensivo (cor fora da paleta vira a primeira, `bypassPermissions` vira `default`, `askBefore` inválido vira todos, rodada `running`/`waiting` vira `failed` "O app fechou antes de a rodada terminar").
  - `ThreadStore`: `userData/bots/<id>/fio.jsonl` e `userData/bots/canais/<id>.jsonl`; `append(item)`, `upsert(item)` (anexa a linha nova), `page(before, limit)` lendo do fim, `compact()` quando o arquivo passa de 2× os itens vivos; corte em `BOT_LIMITS.threadItems` (5.000) mantendo os mais novos; `search(q, limit)`.
  - `memoria.md`: ler, gravar com `cleanMemory`.
  - Pastas `0700`, arquivos `0600`. Apagar um bot apaga a pasta.
  - Importar dados de outra máquina: automações chegam pausadas.
- **Testes:** cria, lê de volta, corrompido cai para o backup; `bypassPermissions` nunca carrega; fio com atualização, página, corte e compactação; busca; permissões dos arquivos; apagar remove tudo.

### CB-05 · BotRunner: do bot ao agente e do agente ao fio

- **Arquivos:** `src/main/bots/runner.ts` (novo), `src/main/agents/sdk.ts` (prompt do bot), `src/main/agents/subagents.ts` (`applyMcpOff` com as conexões do bot), `src/main/agents/office.ts` (`hire`/`recall` aceitam `bot`), `test/bots-runner.test.ts`.
- **Conteúdo:**
  - `ensureAgent(bot)`: agente do bot no escritório → usa; senão `recall(sessionId…)` com a conversa salva; senão contrata parado (como o `summon`) com `bot`, nome, look, cérebro, modo, worktree. Grava `agentId` e `sessionId`.
  - `send(botId, text, attachments, trigger)`: abre a rodada (item `run` no fio), grava o item `user`, chama `manager.sendMessage`. Bot ocupado e gatilho automático: rodada `skipped` com aviso no fio.
  - `runScheduled(botId, prompt, trigger)` (usado na fase 2): `clearContext`, manda `runHeader` + tarefa + `recentContext`.
  - Escuta `agent:log`, `agent:upsert` (atividade), `permission:new`/`resolved`, `result:new`, `agent:removed` do agente do bot e atualiza o fio e `bot.runs` (custo pela diferença de `spentUsd`, como na rotina).
  - Resultado de bot: `ackResult` na hora, a não ser que `chat.deliverInOffice` esteja ligado.
  - Prompt: `manager.botPrompt = (summary) => botSystemPrompt(...)`, chamado em `startQuery` quando `summary.bot` existe.
  - Conexões: com `apps` em lista, desliga no `init` os servidores que não estão nela (`toggleMcpServer`), nunca o `office`.
  - Saída por ociosidade: agente de bot parado há `chat.idleLeaveMin` sai do escritório (`fire` sem apagar a sessão); a próxima mensagem chama de volta.
  - Teto por dia do bot: soma do livro de custos daquele bot no dia; passou, a rodada não começa e o fio avisa.
  - Emite `bots` e `bot:item`.
- **Testes:** com um `AgentManager` falso (como em `test/routines.test.ts`): primeira mensagem contrata, segunda reaproveita, depois da caveira chama de volta com a mesma sessão; rodada abre, conta passos, fecha com balão e custo; pedido vira item e muda ao decidir; resultado reconhecido; ocupado vira `skipped`; teto do dia; ociosidade.

### CB-06 · Memória do bot pelo MCP

- **Arquivos:** `src/main/bots/mcp.ts` (novo), `src/main/tickets.ts` (o servidor `office` ganha as ferramentas quando o agente é de bot), `test/bots-mcp.test.ts`.
- **Conteúdo:** `memory_read()` e `memory_write(text, mode: 'replace' | 'append')`, só no `memoria.md` do próprio bot, com `cleanMemory`. As instruções do servidor ganham uma linha sobre a memória. Agente comum não vê essas ferramentas.
- **Testes:** escreve e lê; append respeita o limite; agente comum não recebe; um bot não alcança a memória de outro.

### CB-07 · IPC, validação e ligação no main

- **Arquivos:** `src/main/ipc/bots.ts` (novo), `src/main/ipc/context.ts`, `src/main/index.ts`, `src/main/validate.ts` (`cleanBotDraft`, `cleanThreadId`, `cleanBotFlags`, `cleanChatSettings`), `src/main/store.ts` (padrões de `settings.chat`), `src/main/demo.ts` (três bots de demonstração com fio pronto), `test/validate.test.ts`, `test/bots-ipc.test.ts`.
- **Conteúdo:** os handlers da API do CB-01; `flush` e `lock` do `BotStore` junto dos outros stores; `notice:open` para aprovação e falha de bot; no `quit`, rodadas de bot contam como trabalho em andamento.
- **Testes:** cada handler recusa argumento ruim com mensagem; `bypassPermissions` recusado; demo semeia sem gravar.

### CB-08 · Tela do Chat: moldura, tema e barra lateral

- **Arquivos:** `src/renderer/src/ui/chat/index.ts`, `chat.css`, `sidebar.ts`, `avatar.ts` (novos), `src/shared/bots-view.ts` + `test/bots-view.test.ts` (novos), `src/renderer/src/main.ts` (botão "Chat" na faixa de cima, tecla `C`, número de não lidas), `src/renderer/src/ui/shortcuts.ts`.
- **Conteúdo:**
  - Tela cheia no molde da sala de reunião (`modalA11y`, Esc fecha, abre no último fio, `OPEN_CHAT_EVENT` com `{ threadId? }`).
  - Tema próprio em `.chat-screen` (quase preto, balões grandes, pílula do composer); contraste AA verificado no `npm run contrast`.
  - Avatar: `portrait(look)` sobre um quadrado arredondado na cor do bot, com ponto de estado (trabalhando, esperando você, falhou).
  - Lateral: seletor de andar, busca, Bots, Canais (vazio até a fase 3), Automações e Conexões (desabilitados até a fase 2), Novo bot. Linha de bot com `botStatusLine` e não lidas. Arrastar reordena; menu de contexto (Fixar, Não lido, Duplicar, Esconder, Apagar com confirmação).
  - Puro em `bots-view.ts`: `botStatusLine(bot, agent, pending, nextAutomation, now)`, `unreadCount(items, lastReadAt)`, `sortBots(bots)`, `dayLabel(t, now)`, `replyIntent(text)` ("pode", "sim", "manda", "ok" → permitir; "não", "pare", "espera" → negar; o resto → pergunta).
- **Testes:** cada estado da linha na ordem da spec; ordenação com fixados; rótulos de dia; intenção da resposta com 30+ frases.

### CB-09 · O fio e a caixa de mensagem

- **Arquivos:** `src/renderer/src/ui/chat/thread.ts`, `items.ts`, `composer.ts`, `header.ts` (novos).
- **Conteúdo:**
  - Itens: balões (Markdown com `renderMarkdown`), rodada (linha com gatilho, atividade ao vivo, passos recolhidos), aprovação (Permitir, Sempre permitir só quando pode, Negar com motivo), pergunta (opções como botões, "Outra…"), plano (Aprovar, Pedir mudanças), aviso, divisor de dia. Decisões por `window.office.respond`.
  - Paginação de 200 itens ao subir; rola para o fim ao chegar item novo só se você já estava no fim (senão, pílula "1 nova ↓").
  - Composer: anexos (como em `ui/panel/composer.ts`), microfone (`MicButton`), `!comando`, Enviar/Parar, ⇧Enter; com pedido pendente, "Responder ao pedido" usa `replyIntent`. Conversa fria: `sendChecked`.
  - Cabeçalho: nome editável, seletor de modelo (`configureBot`), ⓘ, menu ⋯ (Rodar agora, Nova conversa, Ver no escritório, Ver o log completo, Exportar em Markdown).
  - ⌘F busca no fio.
- **Aceite:** 5 mil itens abrem em ≤ 300 ms (medir com `performance.now` no demo).

### CB-10 · Perfil do bot e galeria de Novo bot

- **Arquivos:** `src/renderer/src/ui/chat/profile.ts`, `new-bot.ts` (novos), `src/shared/bot-templates.ts` (novo) + `test/bot-templates.test.ts`.
- **Conteúdo:**
  - `BOT_TEMPLATES`: os 8 modelos da spec, cada um com nome, frase, função (pt-BR, escrita para o Claude, com o que nunca fazer), cor, `askBefore`, worktree e a agenda sugerida (`Schedule`, usada na fase 2).
  - Galeria em cartões + "Em branco"; formulário com os padrões da spec; salvar abre o fio com três sugestões de primeira mensagem.
  - Perfil: função, cérebro (`brainFields` de `ui/modals/brain.ts`), onde trabalha, permissões com "Sempre pedir antes de" (desmarcar pede confirmação), memória editável com tamanho, gastos, histórico das rodadas com link para o fio. Automações e Conexões aparecem como "Em breve" até a fase 2.
- **Testes:** cada modelo tem função não vazia, cor da paleta, `askBefore` válido e agenda válida (`scheduleError` nulo).

### CB-11 · Juntar, escritório e Configurações

- **Arquivos:** `src/renderer/src/ui/modals/settings.ts` (seção Chat), `src/renderer/src/world/*` ou `pixel/*` (etiqueta "bot" no nome), `src/renderer/src/main.ts` (clique na notificação abre o fio; "Não perturbe" vale para o Chat), `README.md` (seção "8. O Chat dos bots").
- **Conteúdo:** juntar as ondas, rodar o demo de ponta a ponta, capturas com `AGENT_OFFICE_SHOTS` para o README.
- **Aceite:** o roteiro da fase 1 (abaixo) roda sem erro no demo e com o Claude de verdade.

**Roteiro da fase 1:** criar o Chefe de gabinete pela galeria → mandar "rode agora" → ver a rodada com os passos → o bot pede para mover um ticket → responder "pode" → ver a decisão no fio → escrever na memória pelo perfil → pedir ao bot "faça git push" num repo de teste → o pedido chega mesmo no modo Automático.

---

## Fase 2 — Automações (5–6 dias)

### CB-12 · Rotina com executor bot

- **Arquivos:** `src/shared/types/routines.ts` (`RoutineWho` ganha `{ kind: 'bot'; botId: string }`), `src/main/routines/scheduler.ts` (`launch` chama `BotRunner.runScheduled`), `src/main/routines/store.ts`, `src/main/validate.ts`, `src/shared/routines.ts`, `test/routines.test.ts`.
- **Conteúdo:** a rotina de bot herda agenda, perdidas, puladas e histórico; o resultado da rodada fecha a execução da rotina (pelo `runId`). Apagar o bot apaga as rotinas dele. O quadro da parede mostra o nome do bot.
- **Testes:** dispara no horário, pula se o bot estiver ocupado, perdida com o app fechado, histórico com o custo.

### CB-13 · Automações de evento

- **Arquivos:** `src/main/bots/triggers.ts` (novo), `src/shared/bots.ts` (`matchTrigger`, `renderTriggerPrompt`, `allowRun` com limite por hora e profundidade), `test/bots-triggers.test.ts`.
- **Conteúdo:** escuta `ticket:upsert` (criado; mudou de coluna), `meeting:upsert` (ata pronta), e o fim de rodada dos bots; filtra por andar, tags, coluna, bot; monta o prompt com `{ticket}`, `{ata}`, `{saida}`; respeita o limite por hora, a profundidade 3 e "nunca a si mesmo"; grava o histórico do gatilho.
- **Testes:** cada evento com e sem filtro; laço A→B→A cortado; limite por hora; ticket editado sem mudar de coluna não dispara.

### CB-14 · Tela de Automações e calendário

- **Arquivos:** `src/renderer/src/ui/chat/automations/index.ts`, `calendar.ts`, `form.ts` (novos), `src/renderer/src/ui/routines/editor.ts` (exportar `scheduleFields`), `src/shared/bots-view.ts` (`weekGrid(automations, weekStart)`), `test/bots-view.test.ts`.
- **Conteúdo:** Lista | Semana; filtros por andar e por bot; formulário com agenda (o da rotina) ou evento; perfil do bot passa a listar as automações dele; Rodar agora; Pausar.
- **Testes:** `weekGrid` com diária, dias úteis, intervalo (vai para a faixa "A cada…"), cron, uma vez fora da semana.

### CB-15 · Automação a partir de uma frase

- **Arquivos:** `src/main/bots/automation.ts` (novo), `src/main/ledger.ts` (categoria `bots: 'Chat dos bots'`), `src/main/ipc/bots.ts`, `src/shared/bots.ts` (`cleanAutomationDraft`), `test/bots-automation.test.ts`.
- **Conteúdo:** `draftAutomation(text, floor)` com `runClaude` (Haiku, sem ferramentas, `schema`) devolve `{ botId | novoBot, schedule | evento, prompt, name }`; a saída passa por `scheduleError` e pelos filtros; custo no livro. Na UI, prévia com a frase da agenda e as próximas 3 execuções.
- **Testes:** saída do modelo inválida vira erro claro; agenda impossível recusada; bot inexistente vira proposta de bot novo.

### CB-16 · Conexões

- **Arquivos:** `src/renderer/src/ui/chat/connections.ts` (novo), `src/renderer/src/ui/chat/profile.ts`.
- **Conteúdo:** lista os servidores MCP (`window.office` de Bastidores → MCP), estado e quais bots usam; no perfil, "Todos" ou lista. Texto de como adicionar um MCP no Claude Code.

---

## Fase 3 — Canais (5–6 dias)

### CB-17 · Canais: dados e fio

- **Arquivos:** `src/main/bots/channels.ts` (novo), `src/main/bots/store.ts`, `src/main/ipc/bots.ts`, `src/shared/types/ipc.ts` (`saveChannel`, `deleteChannel`, `postToChannel`, `rerouteChannelMessage`), `src/preload/index.ts`, `test/bots-channels.test.ts`.
- **Conteúdo:** canal padrão por andar (criado na primeira abertura do Chat naquele andar); membros só do andar; fio do canal no `ThreadStore`; resposta do bot no canal com o contexto das últimas 20 mensagens e o tema.

### CB-18 · Roteador e `@menção`

- **Arquivos:** `src/main/bots/router.ts` (novo), `src/shared/bots.ts` (`parseMentions`, `routerPrompt`), `test/bots-router.test.ts`.
- **Conteúdo:** `@Nome` (com acento e espaço: `@"Chefe de gabinete"` ou o nome até o fim da palavra mais longa que bate) ganha sempre; sem menção, `runClaude` (modelo de `chat.routerModel`, sem ferramentas, `schema` `{ bots: string[] (0–2), why }`); custo no livro; "ninguém" vira a pergunta "Para quem é?" com os membros.
- **Testes:** menções com acento, nome composto e e-mail (`a@b.com` não é menção); prompt do roteador sem conteúdo além do canal; saída fora dos membros descartada.

### CB-19 · Bots conversando: `chat_post` e `bot_ask`

- **Arquivos:** `src/main/bots/mcp.ts`, `src/main/bots/runner.ts`, `test/bots-mcp.test.ts`.
- **Conteúdo:** `chat_post(channel, text)` só em canal de que é membro; `bot_ask(bot, question)` só para bot do mesmo canal, devolve na hora "Perguntei ao X; a resposta chega como mensagem nova", grava um item `side` no canal, manda a pergunta ao outro bot (gatilho `ask`), e a resposta volta ao primeiro como mensagem "[Resposta de X] …". Profundidade e limite por hora iguais aos dos eventos.
- **Testes:** escopo de canal; resposta entregue a quem perguntou; laço cortado.

### CB-20 · Telas de canal

- **Arquivos:** `src/renderer/src/ui/chat/channels/index.ts`, `form.ts`, `src/renderer/src/ui/chat/items.ts` (item `side`, chip "→ Bot · trocar"), `sidebar.ts`.
- **Conteúdo:** criar e editar canal (nome, tema, membros), fio do canal com autor por mensagem, chip do roteador, conversa paralela recolhida, `@` com autocompletar.

---

## Fase 4 — Squads e rotinas (3–4 dias)

### CB-21 · Squad como canal

- **Arquivos:** `src/main/bots/squad-channel.ts` (novo), `src/main/squads.ts` (só leitura), `src/main/bots/store.ts`, `src/renderer/src/ui/chat/squads/index.ts`.
- **Conteúdo:** cada squad de um andar vira canal (`Channel.squad`); "Rodar o ciclo" chama `manager.runSquad`; `member:ended` e o log dos subagentes com `member` viram mensagens do membro (nome e ícone); checkpoints (`AskUserQuestion` do orquestrador) chegam como pergunta no canal.

### CB-22 · Agenda de squad

- **Arquivos:** `src/shared/types/routines.ts` (`RoutineWho` `{ kind: 'squad'; floor; code }`), `src/main/routines/scheduler.ts`, `ui/chat/automations/form.ts`.
- **Conteúdo:** "toda segunda às 9h, rode o ciclo"; ciclo ainda rodando: pulada.

### CB-23 · Rotinas viram bots

- **Arquivos:** `src/main/bots/migrate.ts` (novo), `src/shared/bots.ts` (`botFromRoutine`), `ui/chat/automations/index.ts`, `ui/routines/index.ts` ("Abrir no Chat"), quadro da Diretoria ("Abrir no Chat").
- **Conteúdo:** "Converter em bot" cria o bot e a automação, pausa a rotina antiga e guarda o link; nunca apaga.
- **Testes:** cada tipo de executor (`new`, `template`, `agent`) vira um bot coerente.

---

## Fase 5 — Depois

- **CB-24** Webhook local: `127.0.0.1`, porta aleatória, token de 32 bytes por gatilho, corpo até 64 KB, nunca em log. ADR antes.
- **CB-25** Eventos de app por polling via MCP (ex.: Gmail a cada 15 min) com memória do último visto.
- **CB-26** Gravar uma skill a partir de uma conversa boa (`SKILL.md` na pasta do projeto, com prévia).
- **CB-27** Ligar para o bot: voz com o whisper local e a narração que o estúdio já tem.
- **CB-28** Resumo do dia por notificação às 18:00: o que os bots fizeram e o que espera você.
- **CB-29** Endurecer o guarda: os achados médios e baixos das revisões depois do congelamento (lista em "Limites conhecidos" da ADR 0014). Candidatos: ler scripts de `package.json` e `Makefile`, um tipo "não lido" no contrato em vez de `pay`, PowerShell com um parser de verdade (hoje toda linha pede e a cara de PowerShell é uma heurística), menos falsos positivos em buscas com `query`.
