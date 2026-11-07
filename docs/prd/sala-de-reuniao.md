# Spec — Sala de reunião (bloco de notas com IA)

- **Status:** aprovada em 2026-11-07; primeira versão na 0.3.9. Onde divergir de [sala-de-reuniao-fase0.md](sala-de-reuniao-fase0.md), vale a fase 0.
- **Referência de produto:** [Granola](https://www.granola.ai/), "o bloco de notas com IA para quem vive em reunião"
- **Plano de implementação:** [sala-de-reuniao-plano.md](sala-de-reuniao-plano.md)
- **Autor:** Turing

## Resumo

Cada andar ganha uma sala de reunião. Você entra, aperta **Gravar** e anota como num caderno. O whisper que o app já usa transcreve na sua máquina, ao vivo, o que você fala (microfone) e o que os outros falam (o áudio do computador: Zoom, Meet, Teams). Ao encerrar, o Claude junta as suas notas e a transcrição numa **ata** no modelo que você escolheu. Os itens de ação viram tickets do quadro do andar ou tarefa de um agente, com um clique. Depois, você conversa com a reunião, ou com todas as reuniões do andar, e os agentes consultam as atas pelo MCP `office`.

O que o Granola não faz e o Agent Office faz: o áudio nunca sai da máquina, e a reunião desemboca direto no trabalho dos agentes.

## Problema

- Quem emenda uma reunião na outra escolhe entre prestar atenção e anotar. Sai sem registro ou sem ter ouvido.
- No Agent Office, decisão de reunião vira trabalho de agente, mas alguém redigita tudo: o ticket, o prompt, o contexto. O que foi dito se perde no caminho.
- Os anotadores do mercado mandam áudio ou transcrição para a nuvem deles e não conversam com os seus agentes nem com o seu quadro.

## Para quem

- **Dono do escritório em reuniões seguidas (primária):** dev, PM ou fundador que conduz reuniões e delega o resultado aos agentes. Quer anotar pouco, sair com uma ata boa e transformar os combinados em tickets sem redigitar.
- **Reunião presencial (secundária):** uma mesa, um notebook no meio. Só o microfone.

## Princípios

1. **O áudio não sai da máquina.** O whisper transcreve localmente. Só texto vai ao Claude, e só quando você gera a ata ou pergunta algo.
2. **Sem robô na chamada.** O app ouve o áudio do computador; ninguém entra na reunião.
3. **As suas notas mandam.** A IA completa, não reescreve. O que você escreveu aparece diferente do que a IA acrescentou.
4. **Toda frase da IA mostra a fonte.** Cada bloco da ata aponta para os trechos da transcrição de onde saiu.
5. **Nada vira ação sozinho.** Ticket, tarefa de agente e e-mail só saem com um clique seu, depois de uma prévia editável.
6. **É um lugar do escritório.** A sala existe no mapa, o seu avatar senta à mesa, a porta acende.

## Métricas (sem telemetria)

Medidas no corpus de teste e no `npm run bench`, como no resto do projeto.

| Tipo | Métrica | Meta |
|---|---|---|
| Norte | Reuniões gravadas que terminam com ata | ≥ 80% |
| Valor | Reuniões com itens de ação em que ao menos um vira ticket ou tarefa | ≥ 50% |
| Qualidade | Atraso da transcrição ao vivo (fim da fala → texto na tela), p50 / p95 | ≤ 8 s / ≤ 20 s |
| Qualidade | Taxa de erro de palavras (WER) em pt-BR, modelo `small`, corpus de teste | ≤ 15% |
| Qualidade | Linhas das suas notas presentes na ata | 100% |
| Guarda | Áudio enviado para fora da máquina | 0 bytes |
| Guarda | Buracos na gravação de 60 min com o app em segundo plano | 0 |
| Guarda | FPS do escritório durante a gravação (Apple Silicon) | ≥ 30 |
| Guarda | Achados altos no security gate | 0 |

## Escopo

**Dentro (v1):** sala de reunião em cada andar de projeto e no térreo; gravar microfone e áudio do sistema em faixas separadas; transcrição local ao vivo com o whisper; bloco de notas com salvamento automático; ata com IA a partir de modelos; citações da transcrição; itens de ação para ticket ou agente; conversa com a reunião e com o andar; receitas com `/`; ferramentas MCP para os agentes lerem as atas; ícone na barra de menus durante a gravação; "Não perturbe" durante a reunião; recuperação depois de um travamento; exportar Markdown; seção Reuniões nas Configurações.

**Fora (v1):** robô que entra na chamada; separar falantes por pessoa (só "Você" e "Outros"); tradução; vídeo e captura de tela; link público de compartilhamento; integrações (Slack, Notion, CRM); sincronizar entre máquinas; app de celular; Linux com áudio do sistema.

**Depois (v2, no plano como fase 5):** agenda por URL ICS; detectar reunião começando; segunda passada do whisper na gravação inteira; janela flutuante; busca semântica.

## Experiência

### Entrar na sala

- **No mapa:** clique na etiqueta "🎙 Sala de reunião" sobre a porta da sala do andar.
- **No teclado:** `M` abre a sala do andar em que você está (livre hoje; `N T R B I L E ?` já têm dono).
- **No HUD:** botão "Reunião" ao lado do estúdio.

A sala abre em tela cheia, como o estúdio criativo:

```
┌──────────────┬─────────────────────────────────────┬──────────────────────┐
│ Reuniões     │  Kickoff do checkout · 14:30        │ Transcrição  Conversa│
│ ⌕ buscar     │  Modelo: Kickoff ▾   ● 23:41  ⏸  ■ │                      │
│              │                                     │ 14:52 Outros         │
│ Hoje         │  # Escopo                           │ a gente precisa do   │
│ ● Kickoff…   │  - pix primeiro, cartão depois      │ pix até dia 20…      │
│   Daily      │  - [ ] ver limite do gateway        │                      │
│ Semana       │                                     │ 14:53 Você           │
│   1:1 Ana    │                                     │ fechado, pix primeiro│
│   …          │                                     │                      │
│ + Nova       │  Você ▁▃▅▂  Outros ▂▆▃▁             │ ⌄ recolher           │
└──────────────┴─────────────────────────────────────┴──────────────────────┘
```

- **Esquerda:** reuniões do andar, por Hoje, Semana e Antes, com busca. "+ Nova" no fim.
- **Centro:** o bloco de notas (durante) ou a ata (depois).
- **Direita, recolhível:** transcrição ao vivo e conversa. Fechada por padrão durante a gravação, para você olhar para a reunião, não para o texto.

### Antes

"Nova reunião" pede só o necessário, com valores prontos:

| Campo | Padrão |
|---|---|
| Título | "Reunião 14:30" (editável a qualquer momento) |
| Modelo da ata | o último usado no andar, ou "Geral" |
| Participantes | vazio, opcional; ajuda o whisper com os nomes e a ata com os donos |
| Fontes | "Microfone + áudio do computador"; alternativa "Só microfone (presencial)" |

Na primeira gravação, e depois uma vez por dia, um aviso: **"Avise quem está na chamada que você está transcrevendo."** O botão "Copiar aviso" põe na área de transferência um texto curto para colar no chat da chamada.

### Durante

- **Bloco de notas:** texto livre com Markdown leve (`#` título, `-` lista, `[ ]` tarefa). Salva sozinho a cada segundo sem digitar.
- **Faixa de gravação:** tempo, medidor "Você" e medidor "Outros", Pausar, Encerrar. Medidor parado com áudio do sistema ligado por 60 s mostra "Não estou ouvindo o computador. A chamada está no mudo?".
- **Transcrição ao vivo:** linhas "Você" e "Outros" com a hora, chegando a cada fala. Um aviso "atrasada 40 s" aparece se a fila do whisper crescer.
- **Fora do app:** ícone vermelho na barra de menus com o tempo e "Encerrar reunião"; ponto vermelho no ícone do Dock.
- **No mapa:** o seu avatar vai até a sala de reunião do andar e senta; a placa da porta acende "EM REUNIÃO"; a TV da sala mostra o cronômetro.
- **Não perturbe (padrão ligado):** pedidos de permissão e entregas dos agentes não abrem cartão; vão para a caixa de entrada e para o número do Dock. Ao encerrar, um resumo: "3 pedidos esperando você".
- **Pausar:** para a captura e marca o intervalo na transcrição. Retomar continua a mesma reunião.
- **Proteções:** 5 min sem fala em nenhuma faixa mostram "Esqueceu de encerrar?"; 15 min (ajustável) encerram sozinhos. Limite duro de 4 h.

### Depois

1. **Encerrar** para a captura. A fila do whisper termina o que falta ("Terminando a transcrição… 12 s").
2. A ata é gerada sozinha (ajustável). Enquanto isso: "Lendo 412 falas…", "Escrevendo a ata…".
3. **A ata aparece em blocos.** Texto escuro: o que você escreveu. Texto cinza: o que a IA acrescentou. Cada bloco cinza tem um ícone de citação que destaca, na transcrição, os trechos que o sustentam.
4. **Editar:** clique num bloco para editar. Bloco editado passa a ser seu (escuro) e sobrevive a uma nova geração.
5. **Trocar de modelo:** "Modelo: Kickoff ▾" → escolher outro regera só os blocos da IA.
6. **Itens de ação** ficam numa seção própria, com dono e prazo quando a conversa disse. Cada item tem:
   - **Criar ticket:** prévia editável (título no imperativo, descrição, critérios de aceite, prioridade, coluna) e depois `board.create` no quadro do andar, com a tag `reuniao` e o link da reunião.
   - **Entregar a um agente:** escolhe um agente do andar; cria o ticket e delega (`TicketDesk.delegate`), como o quadro já faz.
   - **Criar todos:** prévia em lista; você desmarca o que não quer.
7. **Compartilhar:** copiar como Markdown, salvar `.md`, ou rodar a receita "/follow-up" para um e-mail pronto.

### Conversa e receitas

- **Escopo:** "esta reunião" (padrão dentro de uma reunião) ou "todas as reuniões do andar".
- **Contexto do andar:** além das reuniões, a conversa recebe os tickets abertos do andar (título, status, responsável) e o que cada agente faz agora. É o "chat que já sabe no que você está trabalhando".
- **Citações:** a resposta cita `[Kickoff do checkout, 14:52]`; clicar abre a reunião no trecho.
- **Receitas com `/`:**

| Receita | O que faz |
|---|---|
| `/follow-up` | E-mail de acompanhamento para os participantes |
| `/decisoes` | Lista do que foi decidido, com quem decidiu |
| `/tickets` | Propõe tickets a partir da conversa (abre a prévia de "Criar todos") |
| `/resumo` | Três linhas para colar num chat |
| `/riscos` | Riscos e dúvidas em aberto |
| `/prd` | Rascunho de PRD no formato de `docs/prd` |

Receitas próprias ficam nas Configurações, por andar ou para todos, como os modelos de agente.

- **"Abrir com um agente":** para perguntas que precisam do código ("isso que combinamos quebra o quê?"), a conversa vira tarefa de um agente do andar, que lê a ata pelo MCP e tem acesso ao repositório.

### Agentes

Três ferramentas novas no MCP `office`, só leitura, limitadas ao andar do agente:

| Ferramenta | Devolve |
|---|---|
| `meetings_list` | Reuniões do andar: data, título, modelo, nº de itens de ação |
| `meeting_get` | Ata em Markdown e itens de ação; a transcrição só com `include_transcript=true` e se o andar permitir |
| `meetings_search` | Trechos de atas (e transcrições, se permitido) que batem com a busca, com a citação |

Por padrão, agentes leem atas, não transcrições. Cada andar escolhe nas Configurações.

## Requisitos

### Funcionais

| Id | Requisito |
|---|---|
| FR-1 | Sala de reunião em cada andar de projeto (uma das salas da frente, ao lado do estúdio) e no térreo, com etiqueta clicável no mapa |
| FR-2 | Abrir a sala pelo mapa, pela tecla `M` e pelo HUD |
| FR-3 | Criar reunião com título, modelo, participantes e fontes; padrões preenchidos |
| FR-4 | Gravar o microfone e o áudio do sistema em faixas separadas ("Você" e "Outros"); modo "Só microfone" grava uma faixa "Sala" |
| FR-5 | Transcrever localmente com o whisper durante a gravação; cada fala aparece na tela em até 20 s (p95) |
| FR-6 | Descartar falas duplicadas pelo eco (microfone captando o alto-falante) |
| FR-7 | Filtrar as alucinações conhecidas do whisper em silêncio ("Legendas pela comunidade Amara.org", "Obrigado por assistir" e afins) |
| FR-8 | Bloco de notas com salvamento automático e Markdown leve |
| FR-9 | Pausar, retomar e encerrar; encerrar sozinho depois de N minutos sem fala; limite de 4 h |
| FR-10 | Ícone na barra de menus e ponto no Dock durante a gravação, com "Encerrar" |
| FR-11 | Avatar senta na sala, placa "EM REUNIÃO", TV com cronômetro |
| FR-12 | "Não perturbe" durante a gravação: pedidos e entregas vão para a caixa de entrada |
| FR-13 | Ata gerada pelo Claude a partir de notas, transcrição e modelo, em blocos com origem (você ou IA) e citações |
| FR-14 | Toda linha não vazia das notas aparece na ata; se a IA omitir, o app reinsere numa seção "Suas notas" |
| FR-15 | Editar blocos da ata; bloco editado vira seu e sobrevive a regerar |
| FR-16 | Regerar a ata com outro modelo |
| FR-17 | Itens de ação para ticket (prévia editável) ou para agente (cria e delega) |
| FR-18 | Conversa com a reunião e com o andar, com citações clicáveis |
| FR-19 | Receitas com `/`, embutidas e próprias |
| FR-20 | Modelos de ata embutidos e próprios, globais ou por andar |
| FR-21 | MCP `office` com `meetings_list`, `meeting_get` e `meetings_search`, só do andar do agente |
| FR-22 | Exportar a ata em Markdown e copiar para a área de transferência |
| FR-23 | Depois de um travamento, a reunião interrompida aparece com "Transcrever o que ficou gravado" |
| FR-24 | Apagar uma reunião apaga notas, transcrição, ata, conversa e áudio temporário |
| FR-25 | Aviso de consentimento com "Copiar aviso" |
| FR-26 | Seção "Reuniões" nas Configurações (lista em [Configurações](#configurações)) |

### Não funcionais

| Id | Requisito |
|---|---|
| NFR-1 | Áudio nunca deixa a máquina; nenhum processo externo recebe áudio além do whisper local |
| NFR-2 | Gravação contínua com a janela em segundo plano ou minimizada por 4 h, sem buracos |
| NFR-3 | Áudio vai para o disco à medida que chega; a memória do app não cresce com a duração |
| NFR-4 | Escritório a ≥ 30 FPS durante a gravação em Apple Silicon |
| NFR-5 | Processos externos sem shell, com argumentos em lista, encerrados ao fim da reunião e ao sair do app |
| NFR-6 | Todo argumento de IPC validado em `validate.ts`; pedaços de áudio com tamanho máximo e número de sequência |
| NFR-7 | Logs sem conteúdo: só contagens, durações e modelo (como o modo voz faz hoje) |
| NFR-8 | Lógica nova coberta por testes no vitest; funções puras em `src/shared` |
| NFR-9 | Contraste AA nos textos novos (`npm run contrast`) e navegação completa pelo teclado |

### Restrições

| Id | Restrição |
|---|---|
| CON-1 | Sem dependência nova de runtime. Usar o whisper, o ffmpeg e o Agent SDK que já estão no projeto |
| CON-2 | Transcrição só com o whisper (whisper.cpp, `brew install whisper-cpp`); nada de serviço de transcrição na nuvem |
| CON-3 | Funciona sem o whisper instalado até o ponto de gravar: a sala diz o que instalar, como o modo voz já diz |
| CON-4 | Nada é gravado dentro da pasta do projeto sem você pedir (risco de ir para o git) |

## Arquitetura

### Visão geral

```
renderer                                    main
────────                                    ────
getUserMedia (mic) ──┐                      MeetingRecorder
getDisplayMedia      ├─ AudioWorklet        ├─ anexa PCM em audio/<faixa>.pcm
  (áudio do sistema) ┘  48 kHz → 16 kHz     ├─ Segmentador (energia): corta nas pausas
                        Int16, 1 s por      │     └─ fila ─► WhisperServer (127.0.0.1)
                        pedaço  ──IPC──►    │                 └─ fallback: whisper-cli
                                            ├─ filtros: alucinação, eco
UI da sala ◄── office:event ────────────────┤─ transcript.jsonl (append)
 (notas, ata,    meeting:segment            │
  conversa)      meeting:upsert             Ata: runClaude (sem ferramentas, JSON schema)
                 meeting:progress           Conversa: runClaude + busca local
                                            MCP office: meetings_* para os agentes
```

### Captura de áudio

**Microfone.** `getUserMedia` com cancelamento de eco, supressão de ruído e ganho automático, como o `MicButton` (`src/renderer/src/ui/voice.ts`). No modo presencial, cancelamento de eco desligado.

**Áudio do sistema.** No macOS, o renderer chama `getDisplayMedia({ audio: true, video: true })` e o main responde em `session.setDisplayMediaRequestHandler` com uma tela e `audio: 'loopback'`. O renderer descarta a faixa de vídeo na hora. O macOS pede a permissão "Gravação de tela e áudio do sistema" uma vez.

O suporte do Electron 44 a loopback no macOS é o maior risco técnico e abre o plano (spike S-1). Caminhos em ordem:

1. Loopback do Electron, se preciso com as flags do Chromium (`MacLoopbackAudioForScreenShare`, `MacSckSystemAudioLoopbackOverride` ou o caminho por Core Audio tap, conforme a versão).
2. Ajudante nativo pequeno em Swift (Core Audio process tap, macOS 14.2+) que escreve PCM 16 kHz no stdout. Exige assinar e notarizar junto com o app.
3. Só microfone, com instruções para um dispositivo virtual (BlackHole) para quem precisar.

No Windows, o loopback do Electron é suportado oficialmente. No Linux, só microfone.

**Duas faixas, nunca misturadas.** Faixa `eu` (microfone) e faixa `outros` (sistema); no presencial, uma faixa `sala`. Saber a faixa é saber quem falou, sem diarização.

**AudioWorklet `pcm16k`.** Recebe o áudio em 48 kHz, aplica um passa-baixa simples, decima para 16 kHz e converte para Int16. Posta blocos de 100 ms; o renderer junta 1 s e manda por IPC (32 KB/s por faixa). O worklet carrega de um arquivo do próprio app, como a CSP (`script-src 'self'`) exige.

**Segundo plano.** O Chromium estrangula timers de páginas escondidas. Durante a gravação, o main chama `webContents.setBackgroundThrottling(false)` e segura um `powerSaveBlocker('prevent-app-suspension')`; ao encerrar, devolve os dois como estavam. O envio pelo IPC é disparado pelas mensagens do worklet, não por `setInterval`.

**Interrupções.**

- Fone conectado ou trocado (`devicechange`): reabre o microfone sem parar a reunião e marca a troca.
- Compartilhamento revogado (a faixa do sistema termina): aviso "Perdi o áudio do computador" e a reunião segue só com o microfone.
- Número de sequência pulado no main: registra o buraco na transcrição ("— 3 s sem áudio —").

### Transcrição

**Binários e modelo.** Reaproveita `findBin` e `findWhisperModel` de `src/main/creative/tools.ts` (o `small` é o preferido, depois o `base`). Acrescenta `findBin('whisper-server')`. O Homebrew já instala `whisper-server` com o `whisper-cli` (conferido no whisper.cpp 1.9.4 desta máquina).

**WhisperServer.** Um processo por reunião, iniciado ao gravar e encerrado ao terminar:

```
whisper-server -m <modelo> --host 127.0.0.1 --port <livre>
               --request-path /<token aleatório> -l pt -nth 0.6 -sns
```

O modelo carrega uma vez. Cada trecho vai por `POST /<token>/inference` como WAV 16 kHz (gerado pelo app, sem ffmpeg) com `response_format=verbose_json` e `temperature=0`. A resposta traz segmentos com início, fim e `no_speech_prob`.

> **WARNING (segurança):** o `whisper-server` não tem autenticação e aceita requisições de qualquer processo local, inclusive de uma página aberta no navegador (um POST multipart não passa por preflight de CORS). O endpoint `/load` troca o modelo a partir de um caminho. Mitigações obrigatórias: porta aleatória só em `127.0.0.1`; `--request-path` com token aleatório de 32 bytes, o que transforma a URL numa credencial; nunca usar `--convert` (que roda o ffmpeg sobre o que chegar); encerrar o processo quando a reunião termina. O spike S-2 confirma que o `--request-path` protege também o `/load`. Se não proteger, a alternativa segura é o `whisper-cli` por trecho, sem servidor.

**Fallback.** Sem `whisper-server` ou se ele não subir, cada trecho roda no `whisper-cli` (recarrega o modelo a cada trecho; mais lento, mas funciona).

**Segmentador.** Analisa a energia do PCM em quadros de 30 ms, com limiar adaptado ao ruído de fundo (3× o piso). Corta um trecho quando:

- há pausa ≥ 700 ms e o trecho tem ≥ 4 s; ou
- o trecho chega a 25 s, no quadro mais silencioso dos últimos 3 s.

Trechos sem fala não vão ao whisper. É uma função pura em `src/shared`, testada com PCM sintético.

**Fila.** Uma fila serial no servidor, em ordem de início, alternando as faixas. Mede o atraso (agora menos o fim do trecho) e o expõe na UI.

**Idioma.** Configuração "Idioma das reuniões": Português (padrão), English, Automático. Trechos curtos detectam mal o idioma, por isso o padrão é fixo.

**Vocabulário.** O parâmetro `prompt` leva os participantes, o nome do andar, os nomes dos agentes e o fim do trecho anterior da mesma faixa, até ~200 tokens. Melhora a grafia de nomes próprios e a continuidade.

**Filtros (funções puras, testadas).**

- **Alucinação:** descarta segmentos com `no_speech_prob` > 0,6 e frases da lista conhecida do whisper em pt e en.
- **Eco:** descarta um segmento da faixa `eu` se ele se sobrepõe no tempo (±1,5 s) a um segmento de `outros` com similaridade de trigramas ≥ 0,8. A dica "Use fone para uma transcrição melhor" aparece quando o filtro dispara muito.

### Armazenamento

Tudo em `userData`, fora do projeto (CON-4):

```
userData/
  meetings.json                     índice: id, andar, título, datas, status, modelo, duração, contagens
  meetings/<andar>/<aaaa-mm-dd-hhmm-slug>/
    notes.md                        o que você digitou
    transcript.jsonl                um segmento por linha (append)
    ata.json                        blocos estruturados
    ata.md                          a ata em Markdown (exportar, agentes)
    chat.jsonl                      a conversa
    audio/eu.pcm, audio/outros.pcm  temporário
```

- O índice segue o padrão do `RoutineStore` (`loadJson`, `backupCopies`, debounce, flush e lock) e entra em `DATA_FILES`/`DATA_SHAPES` (`backups.ts`) e no `WHAT` (`data.ts`).
- Escritas de JSON com `writeJsonAtomic` (`fs-safe.ts`). Pastas `0700`, arquivos `0600`.
- O áudio temporário é apagado quando a ata fica pronta. "Guardar o áudio" (desligado por padrão) converte as faixas para `.m4a` com o ffmpeg antes de apagar o PCM.
- O andar do térreo é `terreo`. Reuniões do térreo pedem o andar na hora de criar ticket.

**Recuperação.** Ao abrir, uma reunião com status `recording` vira `interrupted`. Como o PCM está no disco, "Transcrever o que ficou gravado" roda o segmentador e o whisper sobre os arquivos e segue o fluxo normal.

### Modelo de dados

```ts
// src/shared/types/meetings.ts
type MeetingStatus = 'recording' | 'paused' | 'finishing' | 'enhancing' | 'ready' | 'interrupted' | 'error'
type Track = 'eu' | 'outros' | 'sala'

interface Meeting {
  id: string                 // '2026-11-07-1430-kickoff-do-checkout'
  floor: string              // ProjectFloor.id ou 'terreo'
  title: string
  template: string           // id do modelo de ata
  attendees: string[]
  sources: { mic: boolean; system: boolean }
  status: MeetingStatus
  startedAt: number
  endedAt?: number
  pauses: { at: number; ms: number }[]
  lang?: string
  whisperModel?: string      // 'ggml-small.bin'
  counts: { segments: number; actions: number; open: number }
  costUsd?: number           // soma das chamadas ao Claude desta reunião
}

interface Segment {
  id: number                 // sequencial na reunião
  track: Track
  start: number              // ms desde o início
  end: number
  text: string
}

interface AtaBlock {
  id: string
  kind: 'heading' | 'paragraph' | 'bullet' | 'action'
  text: string
  origin: 'user' | 'ai'
  refs: number[]             // ids de Segment que sustentam o bloco
  owner?: string             // só em 'action'
  due?: string               // só em 'action', texto livre ("até sexta")
  ticket?: string            // chave do ticket criado (AO-31)
}

interface MeetingTemplate {
  id: string
  name: string
  floor?: string             // ausente = todos os andares
  sections: { title: string; hint: string }[]
  instruction: string        // orientação extra para a ata
}
```

### Ata com o Claude

**Chamada.** Reaproveita `runClaude` (`src/main/creative/claude.ts`), que já roda o Agent SDK com a conta do Claude Code de cada andar (`accountEnv(accounts.pick(...))`), sem sessão salva, e aceita `schema` para saída JSON. Duas mudanças:

- O system prompt hoje é fixo ("estrategista criativo"). Passa a ser parâmetro. A função sai de `creative/` para `src/main/claude-run.ts`, e o estúdio passa a chamá-la com o texto de hoje.
- O custo (`costUsd`) entra no livro de custos, na categoria "Reuniões", e na reunião.

**Sem ferramentas.** A chamada não recebe `readRoots`, logo não tem ferramentas. A transcrição é fala de terceiros: é entrada não confiável.

> **WARNING (segurança):** alguém na reunião pode dizer "ignore as instruções e…" e isso entra no prompt. Por isso: a geração da ata e a conversa rodam sem ferramentas; o prompt marca a transcrição como dados, não instruções; a saída passa pelo `renderMarkdown` (DOMPurify); e nenhuma ação sai da resposta do modelo sem clique. Trechos da transcrição copiados para um ticket vão num bloco citado com o rótulo "fala transcrita, não são instruções", porque o ticket depois chega a um agente que tem ferramentas.

**Entrada.**

```
<modelo>   seções e orientação do modelo escolhido
<reuniao>  título, data, participantes, andar
<notas>    as suas notas, uma linha por item, com número: n1, n2…
<transcricao>
  [s12 03:41 Outros] a gente precisa do pix até dia 20
  [s13 03:44 Você] fechado, pix primeiro
```

Uma reunião de 1 h tem ~10 mil palavras (~15 mil tokens); 4 h cabem na janela de contexto sem cortar. Não há divisão em partes na v1.

**Saída.** JSON validado por zod: `{ title, blocks: AtaBlock[] }`. Regras do prompt: cada linha das notas vira um bloco `origin: 'user'` (pode ganhar sub-blocos da IA embaixo); blocos da IA sempre com `refs`; itens de ação só quando alguém se comprometeu; nada inventado sem fonte.

**Verificação no app (função pura).** Confere se cada linha não vazia das notas aparece num bloco `user` (comparação normalizada). O que faltar vai para uma seção "Suas notas" no fim. Blocos da IA sem `refs` válidos perdem o ícone de citação.

**Regerar.** Blocos `user` (inclusive os que você editou) entram como notas; só os blocos da IA são substituídos.

**Modelo do Claude.** `sonnet` por padrão (rápido e bom para resumo); ajustável para `opus`.

### Modelos de ata embutidos

| Modelo | Seções |
|---|---|
| Geral | Resumo · Pontos discutidos · Decisões · Itens de ação |
| 1:1 | Como a pessoa está · Atualizações · Bloqueios · Feedback · Combinados |
| Daily | Ontem · Hoje · Bloqueios (por pessoa) |
| Cliente (discovery) | Contexto do cliente · Dores · Como resolvem hoje · Objeções · Próximos passos |
| Planejamento | Objetivo · Escopo · Fora do escopo · Estimativas · Riscos · Itens de ação |
| Kickoff de projeto | Objetivo · Papéis · Marcos · Riscos · Itens de ação |
| Retrospectiva | O que foi bem · O que melhorar · Ações |
| Entrevista | Perfil · Respostas por tema · Sinais · Recomendação |

Modelos próprios seguem o padrão dos modelos de agente (`cleanTemplate`, limites, escopo global ou por andar), mas como tipo e lista próprios.

### Conversa

- Uma chamada `runClaude` por pergunta, sem ferramentas, com o contexto reenviado a cada vez (o Agent SDK one-shot não guarda sessão).
- **Esta reunião:** ata + transcrição inteira + as últimas 10 trocas da conversa.
- **O andar:** busca local, sem embeddings. BM25 simples sobre os segmentos e os blocos de ata de todas as reuniões do andar; os 40 melhores trechos com ±2 segmentos de contexto; mais o resumo do quadro (tickets abertos) e dos agentes. Função pura, testada.
- A resposta cita no formato `[r:<id>#s<n>]`; a UI troca por um link "Kickoff do checkout, 14:52".

### Do papo à ação

- **Ticket:** `TicketBoard.create(draft, player())` com `cwd` do andar, `tags: ['reuniao']`, descrição com contexto, citação marcada e a referência `reuniao:<id>#s<n>`, critérios de aceite sugeridos pela IA e editáveis na prévia. O detalhe do ticket no quadro troca a referência por um link "Kickoff do checkout, 14:52" que abre a sala no trecho (link interno, sem protocolo novo no sistema). O bloco da ata guarda a chave do ticket e mostra "AO-31 · a fazer".
- **Agente:** cria o ticket e chama `TicketDesk.delegate(ticketId, { agentId }, player())`. As regras do quadro valem (agente do mesmo andar, livre, fora do modo sem permissões). Agente ocupado aparece desabilitado com o motivo.
- O relatório do agente volta como comentário no ticket, que vai para revisão, como hoje.

### Sala no escritório

**Andares de projeto.** `projectPlan(squads, studio, meeting)` reserva a sala da frente seguinte ao estúdio (`FRONT_ROOMS[1]` quando o estúdio existe; `FRONT_ROOMS[0]` quando não). Uma função `meetingRoom()` em `upper-floor.ts`, no molde de `studioRoom()`, monta: tapete, placa "Sala de reunião" com luz, mesa comprida, 6 cadeiras, TV de parede (`LoopScreen`) com cronômetro e quadro branco. Devolve a âncora da etiqueta e a lista de assentos (`HangSpot`).

Custo: a sala ocupa uma sala da frente. Andares com 3 ou mais setores de squad perdem espaço; a regra de hoje ("Outros setores" e o time cedendo uma sala do fundo) continua valendo.

**Térreo.** Não há espaço livre na grade 32×24. Proposta: a ponta direita do lounge vira a sala ([24,15,32,24]), e o lounge fica com [11,15,24,24]. Isso move móveis posicionados à mão (`LOUNGE` em `layout.ts`). Alternativa: a metade de cima da copa. Decisão em aberto, com spike no plano.

**Os dois visuais.** O 2D e o 3D leem o mesmo grafo de cena. A sala é montada uma vez em `world/*`; o 2D usa sprites do catálogo quando existem (`px(obj, key)`) e achata os modelos 3D quando não. Piso novo `'meeting'` exige entrada em `FloorStyle`, `PAINTERS` (3D), `ZONE_FLOOR` (2D), no catálogo e um PNG (`npm run pixel`).

**Clique.** Etiqueta HTML `Tag` sobre a âncora, com `onClick → hooks.onMeeting(project)`, como o estúdio. A etiqueta da sala é escondida nos outros andares em `showFloor()`.

**Durante a gravação.** O avatar do jogador (`player`) anda até um assento da mesa e senta. Novo destino `'meeting'` em `Goal`, com ramos em `reconcile`/`pose`. A placa acende e a TV mostra o cronômetro. Ao encerrar, o avatar volta para a sua sala.

**Pedidos durante a reunião.** Com "Não perturbe", o agente que precisa de você não sobe até a sala de reunião; o pedido fica na caixa de entrada.

### IPC

Arquivo novo `src/main/ipc/meetings.ts` com `registerMeetingsIpc(ctx)`. Todo argumento passa por `parse(schema, raw, msg)`.

| Canal | Faz |
|---|---|
| `office:meetings` | lista do andar (índice) |
| `office:meeting` | uma reunião: metadados, notas, ata, transcrição |
| `office:meetingCreate` | cria e devolve a reunião |
| `office:meetingStart` | prepara a captura (libera um pedido de `getDisplayMedia`) e sobe o whisper |
| `office:meetingAudio` | pedaço de PCM: `{ id, track, seq, pcm }`, máx. 64 KB |
| `office:meetingPause` / `Resume` / `Stop` | controle da gravação |
| `office:meetingNotes` | salva as notas |
| `office:meetingEnhance` | gera ou regera a ata com um modelo |
| `office:meetingBlocks` | salva a ata editada |
| `office:meetingAsk` | pergunta à reunião ou ao andar |
| `office:meetingTicket` | cria ticket (e delega, se vier `agentId`) a partir de um item |
| `office:meetingDelete` | apaga tudo da reunião |
| `office:meetingTemplates` / `SaveTemplate` | modelos e receitas |
| `office:meetingDoctor` | o que há na máquina: whisper-cli, whisper-server, modelo, ffmpeg, permissões |

Eventos novos no `OfficeEvent` (canal `office:event`): `meeting:upsert`, `meeting:segment`, `meeting:progress` (fila do whisper, etapas da ata), `meeting:warning` (sem áudio do sistema, eco, atraso).

### Configurações

Seção "Reuniões", no molde da seção Vídeo (`cleanMeetings` em `validate.ts`, padrão em `DEFAULT_SETTINGS`, migração em `migrateSettings`):

| Ajuste | Padrão |
|---|---|
| Idioma das reuniões | Português |
| Modelo do whisper | o melhor achado (mostra qual; link para instalar outro) |
| Fontes padrão | Microfone + áudio do computador |
| Gerar a ata ao encerrar | ligado |
| Modelo do Claude para a ata | Sonnet |
| Não perturbe durante a reunião | ligado |
| Encerrar sozinho após minutos sem fala | 15 |
| Guardar o áudio | desligado |
| Agentes podem ler as atas / as transcrições (por andar) | sim / não |
| Apagar reuniões com mais de N dias | nunca |
| Modelos de ata e receitas próprios | vazio |

### Segurança e privacidade

- **Permissões do Electron.** Hoje a sessão padrão não tem `setPermissionRequestHandler` e o Electron aprova qualquer pedido. A rádio embute o YouTube num iframe; a política `allow="autoplay; encrypted-media"` impede o iframe de pedir microfone, por isso não há falha aberta hoje. Com a reunião usando microfone e captura de tela, o app passa a ter defesa em profundidade: um handler que libera `media` só para a página do próprio app e nega o resto, e um `setDisplayMediaRequestHandler` que só atende quando o main armou um início de reunião (uso único, expira em 10 s).
- **whisper-server:** ver o WARNING em [Transcrição](#transcrição).
- **Injeção de prompt pela transcrição:** ver o WARNING em [Ata com o Claude](#ata-com-o-claude).
- **Dados no disco:** `userData`, permissões `0600`/`0700`, fora do repositório. Exportar para a pasta do projeto só por ação explícita.
- **Dados que saem:** só texto (notas, transcrição, ata) para o Claude, pela conta do Claude Code do andar, quando você gera a ata ou pergunta. A primeira gravação explica isso numa linha.
- **Logs:** contagens e durações, nunca texto falado.
- **LGPD e consentimento:** gravar uma conversa da qual você participa é permitido no Brasil, mas a transcrição trata dados pessoais de terceiros. O app dá transparência (aviso com "Copiar aviso"), retenção configurável e exclusão completa. O texto do aviso deve passar por quem cuida do jurídico.

### Desempenho

- O whisper usa a GPU (Metal), que o escritório também usa. Guarda de 30 FPS (NFR-4). Se não segurar, o escritório entra no modo economia durante a gravação (o mesmo da bateria).
- O PCM vai para o disco: 64 KB/s com as duas faixas, ~230 MB por hora, apagado ao fim.
- O renderer segura no máximo 2 s de áudio em memória.

### Plataformas

| Sistema | Microfone | Áudio do sistema | Whisper |
|---|---|---|---|
| macOS 13+ (Apple Silicon) | sim | depende do spike S-1 (13+ via ScreenCaptureKit, 14.2+ via Core Audio tap) | Homebrew, Metal |
| macOS Intel | sim | idem | lento; recomendar `base` |
| Windows 10/11 | sim | loopback nativo do Electron | binário do whisper.cpp no `PATH` (`findBin`); a verificar |
| Linux | sim | fora da v1 | `PATH` |

## Riscos

| Risco | Efeito | Resposta |
|---|---|---|
| Loopback do macOS não funciona no Electron 44 | Sem a voz dos outros | Spike S-1 antes de tudo; ajudante Swift ou só microfone |
| `--request-path` não protege o `/load` | Servidor local abusável | Spike S-2; cair para `whisper-cli` por trecho |
| Whisper alucina em silêncio (pt) | Frases falsas na ata | Segmentador não manda silêncio; filtro de `no_speech_prob` e lista |
| Eco sem fone | Falas duplicadas | Filtro de eco; dica de fone |
| GPU dividida | Atraso e FPS baixo | Medir no spike S-3; modo economia; `base` em máquinas fracas |
| Ata omite notas ou inventa | Perda de confiança | Verificação das notas; citações obrigatórias; regerar |
| Limite do plano do Claude | Ata não sai | Rodízio de contas que já existe; mensagem clara; ata pode ser gerada depois |
| Ticket com fala de terceiros chega a agente com ferramentas | Injeção indireta | Citação marcada; prévia obrigatória; permissões do agente valem |
| Sala da frente a menos nos andares | Setores apertados | Regra de "Outros setores" já existente; avaliar no spike S-4 |

## Decisões em aberto

Cada uma tem a minha recomendação; o plano segue a recomendação até você dizer o contrário.

1. **Nome.** "Sala de reunião" para o lugar, "ata" para o resultado. *Recomendo manter.*
2. **Térreo.** Ponta do lounge ou metade da copa. *Recomendo a ponta do lounge.*
3. **Gerar a ata sozinho ao encerrar.** *Recomendo ligado*, como no Granola; quem economiza plano desliga.
4. **Agentes lendo transcrições.** *Recomendo só atas por padrão*; a transcrição tem fala literal de terceiros.
5. **Áudio guardado.** *Recomendo não guardar* por padrão.
6. **Ordem das fases.** *Recomendo a ordem do plano*: gravar e transcrever primeiro, ata depois, a sala no mapa em seguida, ação e conversa por último.
