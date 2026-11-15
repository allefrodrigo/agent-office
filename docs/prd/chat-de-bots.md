# Spec — Chat dos bots (um time autônomo no estilo Slack)

- **Status:** rascunho de 2026-11-15, para aprovação.
- **Referências de produto:** [agentes.chat](https://agentes.chat/) (pessoas e agentes no mesmo chat, aprovação antes do que é sensível, rotinas que rodam a noite toda) e [MausBot](https://mausbot.com/) (uma lista de bots, cada um com função, agenda e conversa própria; "automação a partir de uma frase").
- **Plano de implementação:** [chat-de-bots-plano.md](chat-de-bots-plano.md)
- **Substitui com o tempo:** o fluxo de squads (Diretoria) e o quadro de rotinas como porta de entrada. Os dois continuam funcionando; a fase 4 os traz para dentro do Chat.

## Resumo

O escritório ganha uma tela nova, o **Chat** (tecla `C`), no molde da sala de reunião e do estúdio: tela cheia, com cara de app de mensagens.

À esquerda, os seus **bots**. Um bot é um agente com emprego fixo: nome, função, cérebro, andar, agenda e o que pode tocar. "Chefe de gabinete, dias úteis às 07:30." "Triagem do quadro, a cada 30 minutos." "Caçador de bugs, quando nasce um ticket com a tag `bug`." Ele roda sozinho no horário ou no evento e escreve o resultado na conversa. Quando precisa de você, a pergunta aparece no fio, com botões: **Permitir**, **Negar**, ou as opções que ele propôs.

```
07:30  Chefe de gabinete
       Três coisas pedem você hoje: a revisão do AO-31, o PR do Ada esperando
       merge e uma reunião às 14:00 que bate com o deploy.
       ┌ Aprovação ─────────────────────────────────────────┐
       │ Mover o AO-31 para "Fazendo" e chamar o Turing      │
       │ [Permitir]  [Negar]                                 │
       └─────────────────────────────────────────────────────┘
                                                   Pode mover  ◀ você
07:41  Chefe de gabinete
       Movi o AO-31 e o Turing começou. A tarde fica livre para o deploy.
```

Bots conversam entre si em **canais** (`#lançamento`, `#suporte`), como no Slack: você escreve no canal, o bot certo responde, e um bot pode pedir ajuda a outro. Um **squad** do Opensquad vira um canal com os membros dele.

O que o Chat faz e o MausBot e o agentes.chat não fazem: tudo roda na sua máquina, com o Claude Code e as contas que você já tem; cada bot ganha mesa no escritório, entra no quadro de tickets, lê as atas das reuniões e entra no livro de custos.

## Problema

- **Rotinas são cegas.** Uma rotina dispara, o agente trabalha e entrega um relatório que some depois do "Recebido". Não há conversa contínua: amanhã, a rotina não lembra o que você respondeu hoje.
- **Squads são pesados.** Rodar um squad exige uma pasta `squads/` do Opensquad, um orquestrador e a Diretoria. Não há agenda nem gatilho, e você não conversa com um membro sozinho.
- **Agentes são descartáveis.** Contratar, dar a tarefa, receber, dispensar. Quem quer um "analista de suporte" fixo recontrata e recola o mesmo prompt toda semana.
- **Aprovação é um cartão que anda até você.** Funciona no escritório, mas não guarda a decisão no contexto da conversa, nem deixa responder com uma frase ("pode mover, mas só depois das 15h").

## Para quem

- **Dono do escritório que delega trabalho recorrente (primária):** dev, PM ou fundador que quer um time fixo que trabalha sem ser chamado e só para quando precisa de um "sim".
- **Quem já usa squads (secundária):** quer o mesmo time, mas com agenda, conversa por membro e aprovação no fio.

## Princípios

1. **Cada bot tem um emprego.** Função escrita, cérebro, andar, agenda e permissões. Nada de prompt colado de novo.
2. **Nada sensível sem o seu sim.** Enviar, publicar, apagar, pagar e mexer no git remoto sempre pedem aprovação, em qualquer modo de permissão. Bots nunca rodam em "Sem pedir nada".
3. **A conversa é o histórico.** Rodadas agendadas, eventos, aprovações e respostas ficam no mesmo fio, em ordem. O bot lê o fio recente antes de agir.
4. **Um bot é um agente do escritório.** Ele usa o motor que já existe: mesa, conta, revezamento, teto de custo, worktree, quadro, atas, livro de custos. O Chat é outra janela para o mesmo time.
5. **Local primeiro.** Nada sai da máquina além do que o Claude Code já manda. Sem servidor, sem nuvem, sem webhook aberto na v1.
6. **Arte própria.** Avatar de bot é o retrato em pixel art do próprio agente, sobre a cor dele. Nada copiado do MausBot ou do agentes.chat (veja a memória do projeto sobre a arte 2D).

## Métricas (sem telemetria)

Medidas nos testes, no `npm run demo` e no `npm run bench`, como no resto do projeto.

| Tipo | Métrica | Meta |
|---|---|---|
| Norte | Bots com pelo menos uma automação ativa, entre os criados | ≥ 60% |
| Valor | Rodadas automáticas que terminam sem você abrir o painel do agente | ≥ 80% |
| Qualidade | Do "Enviar" ao primeiro sinal do bot no fio ("Lendo…") | ≤ 1,5 s |
| Qualidade | Abrir o Chat com 20 bots e 5 mil mensagens no fio maior | ≤ 300 ms |
| Guarda | Ação sensível executada sem aprovação, no corpus de testes do guarda | 0 |
| Guarda | Bot em `bypassPermissions` depois de salvar, importar ou carregar | 0 |
| Guarda | Gatilho que dispara a si mesmo ou entra em laço | 0 (limite por hora e profundidade) |
| Guarda | FPS do escritório com o Chat aberto e 8 bots trabalhando (Apple Silicon) | ≥ 30 |
| Guarda | Achados altos no security gate | 0 |

## Escopo

**Dentro (v1, fases 1 a 4):**

- Bots: criar, editar, fixar, duplicar, esconder, apagar; galeria de modelos prontos.
- Conversa por bot (DM), com anexos, microfone e troca de modelo no meio.
- Aprovações, perguntas e planos dentro do fio.
- Memória por bot (`memoria.md`), lida em toda rodada e editável por você e pelo bot.
- Guarda de ações sensíveis.
- Automações: agenda (as mesmas da rotina) e eventos do escritório (ticket, ata, bot terminou).
- "Automação a partir de uma frase".
- Calendário da semana com todas as automações.
- Conexões: quais servidores MCP cada bot enxerga.
- Canais com vários bots, `@menção`, roteamento automático e conversa paralela entre bots.
- Squads como canais, com agenda; rotinas antigas convertidas em bots.

**Fora (v1):** webhooks e eventos de apps externos (Gmail, Stripe) por push; OAuth de apps (estilo Composio); app de celular; chamada de voz com o bot; computador na nuvem; vários usuários humanos no mesmo canal; sincronizar entre máquinas.

**Depois (fase 5):** webhook local com token; eventos de app por polling via MCP; gravar uma skill a partir de uma conversa; ligar para o bot (voz); resumo diário por e-mail.

## Conceitos

| Conceito | O que é | Onde vive |
|---|---|---|
| **Bot** | Agente com emprego fixo: função, cérebro, andar, permissões, conexões, memória | `userData/bots.json` |
| **Fio** | A conversa com um bot, ou de um canal: mensagens, rodadas, aprovações | `userData/bots/<id>/fio.jsonl`, `userData/bots/canais/<id>.jsonl` |
| **Rodada** | Uma execução do bot, do primeiro passo ao resultado; aparece no fio como um bloco | dentro do fio |
| **Automação** | O que faz o bot rodar sozinho: agenda ou evento | agenda: `routines.json` (uma rotina cujo executor é o bot); evento: `bots.json` |
| **Memória** | Notas duráveis do bot, em Markdown, até 16 KB | `userData/bots/<id>/memoria.md` |
| **Canal** | Conversa com vários bots e você; pode ser de um squad | `bots.json` + fio do canal |
| **Conexão** | Um servidor MCP do Claude Code que o bot pode usar | lista por bot em `bots.json` |

**Bot × agente.** O bot é a definição que fica. O agente é quem trabalha agora. O Chat contrata (ou chama de volta, com a mesma conversa) o agente do bot quando precisa, e o agente aparece no escritório como qualquer outro, com uma etiqueta "bot". Dispensar o agente com a caveira não apaga o bot: a próxima rodada o chama de volta.

**Automação de agenda = rotina.** Uma agenda de bot é uma rotina com executor `bot`. Assim, ela herda o que a rotina já resolveu: fuso local, app fechado ou Mac dormindo, execução pulada, histórico, notificação e o quadro na parede de cada andar.

## Experiência

### Abrir o Chat

- **Teclado:** `C`.
- **HUD:** botão "Chat" na faixa de cima, ao lado de "Reunião" e do estúdio, com o número de não lidas.
- **Notificação do sistema:** clicar abre o fio do bot.
- **Escritório:** clicar na etiqueta "bot" de um agente abre o fio dele.

Esc fecha. O Chat abre no último fio visto.

### Layout

Visual próprio, mais sóbrio que o escritório: quase preto, tipografia grande, balões arredondados. Os tokens ficam em `.chat-screen`, sem mexer nos do app.

```
┌──────────────────────────┬──────────────────────────────────────────────────┐
│  Andar: Agent Office ▾  ✎│ ▣ Chefe de gabinete            Sonnet ▾   ⓘ  ⋯   │
│ ⌕ Buscar                 │                                                  │
│                          │                 Hoje 07:30                       │
│ BOTS                   ⠿ │ ╭──────────────────────────────────────────────╮ │
│ ▣ Chefe de gabinete  agora│ │ Três coisas pedem você hoje: …               │ │
│   Esperando seu sim  ●   │ ╰──────────────────────────────────────────────╯ │
│ ▣ Triagem do quadro      │ ╭ Aprovação ───────────────────────────────────╮ │
│   A cada 30 min          │ │ Mover AO-31 para Fazendo e chamar o Turing   │ │
│ ▣ Caçador de bugs        │ │ [Permitir]  [Negar…]                          │ │
│   Quando nasce um bug    │ ╰──────────────────────────────────────────────╯ │
│ ▣ Relator da semana      │                                  ╭────────────╮  │
│   Sextas às 17:00        │                                  │ Pode mover │  │
│                          │                                  ╰────────────╯  │
│ CANAIS                   │ ╭──────────────────────────────────────────────╮ │
│ # agent-office           │ │ Movi o AO-31 e o Turing começou.             │ │
│ # lançamento         2   │ ╰──────────────────────────────────────────────╯ │
│                          │                                                  │
│ ⚡ Automações             │ ╭──────────────────────────────────────────────╮ │
│ ⧉ Conexões               │ │ 📎  Mensagem para Chefe de gabinete    🎙  ➤ │ │
│ ＋ Novo bot               │ ╰──────────────────────────────────────────────╯ │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

- **Barra lateral:** seletor de andar (o Chat mostra os bots e canais de um andar; "Todos" junta tudo), busca, **Bots**, **Canais**, e no pé **Automações**, **Conexões** e **Novo bot**.
- **Linha de bot:** avatar, nome, hora da última mensagem e uma linha de estado, nesta ordem de prioridade:
  1. "Esperando seu sim" (pedido pendente), com ponto âmbar.
  2. "Trabalhando · Lendo app.ts" enquanto roda.
  3. "Falhou às 09:00" se a última rodada falhou, em vermelho.
  4. A próxima automação ("Dias úteis às 07:30").
  5. O começo da última mensagem.
- **Não lidas:** número à direita; nome em negrito.
- **Arrastar** reordena; fixados ficam no topo. Menu de contexto: Fixar, Marcar como não lido, Duplicar, Esconder, Apagar.
- **Cabeçalho do fio:** avatar, nome (clique renomeia), seletor de modelo (vale a partir da próxima mensagem), ⓘ abre o perfil à direita, ⋯ abre: Rodar agora, Pausar automações, Nova conversa, Ver no escritório, Ver o log completo, Exportar em Markdown.

### O fio

Cada item do fio tem um tipo:

| Item | Como aparece |
|---|---|
| Sua mensagem | Balão à direita, com anexos |
| Mensagem do bot | Balão à esquerda, em Markdown |
| Rodada | Linha fina com o gatilho ("⚡ Dias úteis às 07:30", "🎫 AO-44 criado", "Rodar agora"); enquanto roda, "Trabalhando · Rodando npm test · 12 passos"; ao terminar, recolhe em "12 passos · 1min40 · US$ 0,08 ▸" (abre os passos) |
| Aprovação | Cartão com título, detalhe (comando, diff resumido, destino do envio) e botões; depois de decidido, vira uma linha "Você permitiu às 07:41" |
| Pergunta | As opções do `AskUserQuestion` como botões; "Outra…" abre o campo |
| Plano | O plano em Markdown, com "Aprovar" e "Pedir mudanças" |
| Aviso | Linha cinza centralizada: "Nova conversa", "Pulei a rodada das 09:00: o bot estava ocupado", "Teto de custo atingido" |
| Divisor de dia | "Hoje", "Ontem", "Seg, 10 nov" |

- **Só o essencial no balão.** O texto final da rodada vira o balão. O que o bot narrou no meio ("Vou ler o arquivo…") fica dentro dos passos.
- **Responder com uma frase.** Com um pedido pendente, a caixa de mensagem mostra "Responder ao pedido": a frase vira a resposta (Negar com instrução, ou Permitir quando você escreve "pode", "sim", "manda"). Na dúvida, o app pergunta qual dos dois.
- **Rolagem:** o fio abre no fim; 200 itens por vez, mais ao subir.
- **Busca:** ⌘F busca no fio; a busca da lateral procura em todos os fios do andar.

### Escrever

- Caixa em pílula, com 📎 (anexos, os mesmos do painel), 🎙 (o microfone que o app já tem) e Enviar. ⇧Enter quebra a linha.
- `!comando` roda no shell da pasta do bot, como no painel.
- `/` lista as receitas do bot e os comandos do Claude Code.
- Enquanto o bot trabalha, a mensagem entra na fila da rodada atual (como no painel) e o botão vira **Parar**.
- Conversa fria e grande: o mesmo aviso de economia do painel ("Limpar e enviar" ou "Enviar assim mesmo").

### Perfil do bot (painel à direita)

| Seção | Conteúdo |
|---|---|
| Função | O texto do emprego, editável. "Você é o chefe de gabinete do andar. Toda manhã…" |
| Cérebro | Modelo, esforço, contas |
| Onde trabalha | Andar (ou pasta, no térreo); "Cópia isolada (worktree)" liga e desliga |
| Permissões | Modo (Pedir permissão, Aceitar edições, Automático, Planejar); "Sempre pedir antes de" com Enviar, Publicar, Apagar, Pagar, Git remoto, todos marcados por padrão |
| Automações | As do bot, com a próxima execução; "＋ Automação" |
| Conexões | Servidores MCP que ele enxerga: "Todos" ou uma lista; o `office` sempre ligado |
| Memória | O `memoria.md`, editável, com o tamanho ("3,2 de 16 KB") |
| Gastos | Hoje, 7 dias, 30 dias, do livro de custos; teto por bot (opcional) |
| Histórico | Últimas 20 rodadas, com estado, custo e link para o ponto do fio |

### Novo bot

"＋ Novo bot" abre a galeria. Cada modelo preenche o formulário; "Em branco" começa vazio.

| Modelo | Automação padrão | O que faz |
|---|---|---|
| Chefe de gabinete | Dias úteis às 07:30 | Lê o quadro do andar, as atas de ontem e o que os agentes fazem; propõe as três prioridades do dia e o que mover. Pede antes de mexer em ticket. |
| Triagem do quadro | A cada 30 min | Tickets novos sem critério de aceite ganham contexto, critérios, tags e prioridade. Pede antes de mover de coluna. |
| Caçador de bugs | Quando nasce um ticket com a tag `bug` | Reproduz, escreve o teste que falha, corrige numa worktree, comenta no ticket e move para Revisão. |
| Revisor do dia | Dias úteis às 18:00 | Revisa os commits e worktrees do dia e aponta riscos, sem mexer em arquivos. |
| Ata em tickets | Quando uma ata fica pronta | Propõe tickets a partir dos itens de ação; cria só os que você aprovar. |
| Vigia de dependências | Segundas às 10:00 | `npm outdated` e `npm audit`; diz o que atualizar primeiro. Sem mexer em arquivos. |
| Relator da semana | Sextas às 17:00 | Gasto, tickets feitos, PRs e reuniões da semana, em uma página. |
| Vigia de concorrentes | Segundas às 07:00 | Lê as páginas de preço e changelog listadas na memória e resume o que mudou. |

O formulário pede só o necessário, com valores prontos:

| Campo | Padrão |
|---|---|
| Nome | o do modelo |
| Função | o texto do modelo |
| Andar | o andar em que você está |
| Modelo e esforço | os padrões do app |
| Permissões | "Pedir permissão"; "Sempre pedir antes de" tudo marcado |
| Automação | a do modelo, ligada |
| Cópia isolada | ligada só para quem edita código (Caçador de bugs) |

Salvar cria o bot e mostra o fio vazio com três sugestões de primeira mensagem ("Rode agora para eu ver", "O que você precisa saber sobre este projeto?", "Ajuste a sua agenda").

### Automações

A tela "⚡ Automações" lista e mostra no calendário todas as automações do andar (ou de todos).

```
┌ Automações ─────────────────────────────── Lista | Semana ───── ＋ Nova ┐
│        Seg       Ter       Qua       Qui       Sex       Sáb   Dom      │
│ 07:00  Vigia                                                             │
│ 07:30  Chefe     Chefe     Chefe     Chefe     Chefe                     │
│ 10:00  Depend.                                                           │
│ 17:00                                          Relator                   │
│ 18:00  Revisor   Revisor   Revisor   Revisor   Revisor                   │
│ ─────────────────────────────────────────────────────────────────────── │
│ A cada 30 min: Triagem do quadro                                         │
│ Em eventos:  🎫 bug → Caçador de bugs   📝 ata → Ata em tickets          │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Agenda:** os mesmos tipos da rotina (uma vez, todo dia, dias da semana, a cada N minutos ou horas, cron) e o mesmo formulário, com a frase e as próximas 3 execuções.
- **Eventos do escritório:**

| Evento | Filtro | O que o bot recebe |
|---|---|---|
| Ticket criado | andar; tags (opcional) | O ticket completo |
| Ticket mudou de coluna | coluna de destino; tags | O ticket e a coluna de onde veio |
| Ata pronta | andar | A ata e os itens de ação |
| Outro bot terminou | qual bot; só com sucesso ou sempre | O texto final da rodada do outro |

- **Uma frase:** "＋ Nova" aceita texto livre: "toda sexta às 17h, resuma a semana no #geral". O Claude propõe bot, agenda (ou evento) e tarefa; você vê a prévia ("Roda às sextas às 17:00 · próximas: 21/11, 28/11, 5/12") e salva ou ajusta.
- **Regras de execução:** iguais às da rotina. Bot ocupado: a rodada é pulada e o fio avisa. App fechado no horário: roda ao abrir ou pula, por automação. Cada rodada agendada começa conversa nova; a memória e as últimas 20 mensagens do fio vão junto, para o bot saber o que você respondeu ontem.
- **Proteção contra laço:** no máximo 6 rodadas por hora por automação de evento (ajustável até 30); um bot nunca dispara a si mesmo; uma cadeia "bot terminou → outro bot" para no terceiro elo.

### Conexões

"⧉ Conexões" lista os servidores MCP que o Claude Code conhece (os mesmos de Bastidores → MCP), com o estado e quais bots usam cada um. Em cada bot, você escolhe "Todos" ou uma lista. O servidor `office` (quadro, atas e as ferramentas do Chat) fica sempre ligado. Conectar um app novo é configurar o MCP no Claude Code; a tela explica como e tem "Abrir a documentação".

### Canais

- Cada andar nasce com um canal com o nome dele (`#agent-office`). "＋ Canal" cria outros, com nome, tema e membros (bots do andar).
- **Escrever num canal:** `@Nome` chama um bot. Sem menção, o app escolhe quem responde: um modelo rápido lê o tema do canal, a função de cada membro e as últimas mensagens, e devolve um ou dois bots, ou ninguém. Acima da resposta, um chip "→ Chefe de gabinete · trocar" deixa você mandar para outro.
- **O que o bot vê:** a mensagem, o tema e as últimas 20 mensagens do canal. A resposta vai para o canal.
- **Bots no canal:** um bot posta num canal de que é membro (`chat_post`): "Triagem do quadro: 3 tickets novos organizados". Um bot pede ajuda a outro do mesmo canal (`bot_ask`): a pergunta aparece no canal como uma conversa recolhida ("Chefe de gabinete perguntou ao Revisor do dia ▸"), e a resposta volta para quem perguntou como mensagem nova. Ninguém espera parado: a pergunta não trava quem perguntou.
- **Aprovações de um bot no canal** aparecem no canal, no ponto em que ele estava.

### Squads no Chat

- Cada squad do Opensquad de um andar aparece como canal (`#ciclo-de-produto`), com os membros como participantes, cada um com o ícone do `squad.yaml`.
- "Rodar o ciclo" no cabeçalho do canal faz o que o quadro da Diretoria faz hoje. As falas dos membros (fim de cada passo) entram no canal com o nome e o ícone do membro; os checkpoints do pipeline chegam como pergunta no fio.
- O canal do squad aceita automações: "toda segunda às 9h, rode o ciclo". Assim, squad + rotina vira uma coisa só.
- O quadro da Diretoria continua; ele passa a mostrar "Abrir no Chat".

### Rotinas antigas

- As rotinas aparecem em Automações com o selo "rotina". "Converter em bot" cria um bot com o nome do agente da rotina (ou o da rotina), a tarefa como função e a agenda como automação; a rotina original é pausada, nunca apagada.
- O quadro de rotinas da parede mostra as automações de agenda dos bots junto com as rotinas.

### No escritório

- O agente de um bot tem a etiqueta "bot" no nome e a cor do bot no diamante de conta.
- **Resultado:** a rodada de um bot termina no fio, não no seu escritório: o agente não anda até você com o relatório. O número de não lidas sobe no botão Chat e no Dock. (Configurações → Chat → "Entregar também no escritório" volta ao jeito antigo.)
- **Pedido de permissão:** continua vindo até você, como hoje, quando o Chat está fechado. Com o Chat aberto no fio do bot, o cartão aparece só no fio.
- **"Não perturbe" da reunião** vale também para o Chat: nada abre sozinho durante a gravação.

### Configurações → Chat

| Opção | Padrão |
|---|---|
| Entregar o resultado também no escritório | desligado |
| Notificar no sistema | aprovações e falhas |
| Teto de custo por bot por dia (US$) | 0 = sem teto, além do teto por agente |
| Máximo de rodadas por hora em automações de evento | 6 |
| Modelo do roteador dos canais | Haiku |
| Agente do bot sai do escritório depois de parado por | 30 min (0 = nunca) |

## Como funciona

### Peças novas no main

| Peça | Arquivo | Papel |
|---|---|---|
| `BotStore` | `src/main/bots/store.ts` | Lê e grava `bots.json` (bots, canais, automações de evento) e as pastas de cada bot, no molde do `RoutineStore` |
| `ThreadStore` | `src/main/bots/thread.ts` | Fio em JSONL, só anexando; lê de trás para frente em páginas; corta acima de 5 mil itens |
| `BotRunner` | `src/main/bots/runner.ts` | Liga bot a agente: contrata ou chama de volta, manda mensagens, transforma os eventos do agente em itens do fio |
| `BotTriggers` | `src/main/bots/triggers.ts` | Escuta tickets, atas e rodadas; aplica filtros, limite por hora e profundidade |
| `BotRouter` | `src/main/bots/router.ts` | Escolhe quem responde num canal (`runClaude` com esquema, sem ferramentas) |
| Ferramentas do Chat | `src/main/bots/mcp.ts` | `memory_read`, `memory_write`, `chat_post`, `bot_ask`, dentro do servidor `office` |
| Guarda | `src/shared/bots-guard.ts` + hook em `agents/sdk.ts` | Classifica a chamada de ferramenta e força a aprovação no que é sensível |

### Do bot ao agente

1. Uma mensagem chega para o bot (você, uma automação, um canal).
2. `BotRunner.ensureAgent(bot)`: se o agente do bot está no escritório, usa; se não, chama de volta a conversa salva (`manager.recall`) ou contrata um agente novo, com `AgentSummary.bot = bot.id`.
3. O prompt de sistema do agente ganha, depois do texto do escritório: o nome e a função do bot, a memória, as regras de aprovação e as ferramentas do Chat.
4. A mensagem vai por `manager.sendMessage`. Uma rodada agendada antes limpa a conversa (`clearContext`) e manda junto as últimas 20 mensagens do fio.
5. O `BotRunner` escuta `agent:log`, `permission:new`, `permission:resolved` e `result:new` daquele agente e grava os itens no fio. O resultado é marcado como recebido (`ackResult`) para não virar cartão no escritório, a não ser que a opção "Entregar também no escritório" esteja ligada.

### Guarda de ações sensíveis

Um hook `PreToolUse` roda antes de cada ferramenta de um agente de bot. Uma função pura classifica a chamada:

| Tipo | Exemplos que pegam |
|---|---|
| Enviar | MCP com `send`, `reply`, `post_message`; `sendmail`; `curl -X POST` para fora de localhost. Rascunho (`create_draft`) não conta |
| Publicar | `npm publish`, `gh release create`, `vercel deploy`, MCP com `publish`, `deploy` |
| Apagar | `rm -r`, `git clean`, `DROP TABLE`, MCP com `delete`, `remove`, `archive` |
| Pagar | MCP com `payment`, `charge`, `refund`, `invoice`, `payout` |
| Git remoto | `git push`, `gh pr merge`, `gh pr create`, `git push --force` |

Chamada sensível e marcada no bot → o hook devolve `permissionDecision: 'ask'`, que manda a chamada para o `canUseTool` do escritório (o cartão de sempre, ou o item de aprovação no fio). "Sempre permitir" nunca aparece para uma chamada sensível. O classificador erra para o lado de pedir.

### Dados

- `userData/bots.json`: `{ bots, channels, eventTriggers }`, gravado de forma atômica, com debounce, backup diário e arquivo corrompido guardado à parte (entra em `DATA_FILES`).
- `userData/bots/<botId>/fio.jsonl`, `memoria.md`; `userData/bots/canais/<canalId>.jsonl`. Pastas `0700`, arquivos `0600`.
- Bots importados de outra máquina chegam com as automações pausadas, como as rotinas.
- Apagar um bot apaga a pasta dele e as automações; o agente, se estiver no escritório, é dispensado com confirmação.

## Segurança

- **Nunca "Sem pedir nada".** `validate.ts` recusa `bypassPermissions` para bot; o `BotStore` troca para `default` ao carregar; o runner confere de novo antes de contratar.
- **Guarda ligado por padrão.** Desmarcar um tipo pede confirmação e mostra o risco.
- **Ferramentas do Chat com escopo.** `chat_post` só nos canais de que o bot é membro; `bot_ask` só para bots do mesmo canal; `memory_*` só no `memoria.md` do próprio bot, com caminho fixo e limite de 16 KB.
- **Laços.** Limite por hora, profundidade 3 e "nunca a si mesmo", testados.
- **Roteador.** Recebe só nomes, funções, o tema e as últimas mensagens do canal; não tem ferramentas. Uma mensagem que tenta mandar o roteador escolher outro bot só troca quem responde, entre os membros.
- **Logs sem conteúdo.** Só contagens, durações, ids e modelo.
- **IPC.** Todo argumento passa por `validate.ts`.

## Riscos e perguntas abertas

| Risco | Como tratar |
|---|---|
| O hook `ask` não força o `canUseTool` no modo Automático ou Aceitar edições | Spike S-1. Se falhar, o bot roda sempre em "Pedir permissão" e o escritório libera sozinho o que não é sensível. |
| Conversa de DM cresce sem parar | Rodada agendada limpa a conversa; DM usa o aviso de contexto e o `/compact` que o painel já tem. |
| Um bot por agente ocupa mesa | Agente de bot sem nada a fazer por 30 min sai do escritório (a conversa fica salva) e volta na próxima mensagem. Ajustável. |
| Classificador do guarda deixa passar algo | Corpus de testes com 100+ casos; erra para o lado de pedir; o modo padrão continua "Pedir permissão". |
| O roteador escolhe mal | `@menção` sempre ganha; chip "trocar"; o roteador pode dizer "ninguém" e o app pergunta. |
| Retratos novos da 0.4.0-beta.4 | Já juntada na branch; o avatar usa `portrait(look)`, cuja assinatura não mudou. |
