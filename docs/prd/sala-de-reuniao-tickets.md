# Sala de reunião — tickets das fases 1 a 4 (rascunho para o quadro)

Fonte: `sala-de-reuniao-plano.md` (branch do Turing) com as mudanças de [sala-de-reuniao-fase0.md](sala-de-reuniao-fase0.md). Cada linha vira um ticket com a tag `reuniao` e a tag da fase. A descrição de cada ticket aponta para a seção do plano com o mesmo id e copia os arquivos e os testes de lá. Estimativa em dias.

Regras de todo ticket: `npm run typecheck`, `lint`, `test` e `contrast` verdes; lógica nova pura em `src/shared` com teste no vitest; IPC validado em `validate.ts`; logs sem conteúdo falado ou digitado.

## Fase 1 · Gravar e transcrever

| Id | Título | Tipo | Prioridade | Dias | Depende de | Status |
|---|---|---|---|---|---|---|
| RN-01 | Criar os tipos e as funções puras de reunião (segmentador, WAV, alucinação, eco, prompt) | feature | high | 1,5 | — | todo |
| RN-02 | Guardar reuniões em `userData` (índice, pastas, transcrição, recuperação) | feature | high | 1,5 | RN-01 | backlog |
| RN-03 | Subir o whisper-server com token, fila e fallback para `whisper-cli` (regras do ADR 0012) | feature | high | 1,5 | RN-01 | backlog |
| RN-05b | Empacotar o ajudante Swift de áudio do sistema (Core Audio tap, ADR 0011) | feature | high | 3 | RN-01 | backlog |
| RN-04 | Gravar as faixas `eu` (renderer) e `outros` (ajudante) e gerar segmentos | feature | high | 1,5 | RN-02, RN-03, RN-05, RN-05b | backlog |
| RN-05 | Capturar o microfone no renderer e restringir permissões de mídia no main | feature | high | 1 | RN-01 | backlog |
| RN-06 | Criar o IPC, o preload e os eventos de reunião | feature | medium | 1 | RN-04 | backlog |
| RN-07 | Montar a tela da sala: lista, nova reunião, notas, gravação, transcrição ao vivo | feature | medium | 2 | RN-06 | backlog |
| RN-08 | Mostrar a gravação na barra de menus e no Dock | feature | low | 0,5 | RN-07 | backlog |

Notas que entram nas descrições:

- **RN-03:** o app nunca chama `/load`; o token não aparece em log nem em erro; o servidor cai com um `/load` inválido e manda `Access-Control-Allow-Origin: *`, então supervisionar (sobe outro com token novo; na segunda queda, `whisper-cli`). Teste: argumentos sem `--convert` e sem o token fora de `--request-path`.
- **RN-05b:** partir de `spikes/s1-swift-tap/` (worktree margaret-9cc6c942). Partida assíncrona (o pedido de permissão segura até ~30 s); aviso com 3 s de zeros; excluir os processos do próprio app do tap; `NSAudioCaptureUsageDescription` no `extendInfo`; assinatura, hardened runtime e notarização. Aceite: chamada real do Meet ouvida; 30 min minimizado sem buraco; macOS anterior a 14.2 cai para só microfone.
- **RN-05:** sem `setDisplayMediaRequestHandler` no macOS. `cb({})` lança `TypeError` no Electron 44.

## Fase 2 · Ata

| Id | Título | Tipo | Prioridade | Dias | Depende de |
|---|---|---|---|---|---|
| RN-09 | Tornar o `runClaude` genérico, com system prompt por parâmetro e custo no livro | improvement | medium | 0,5 | RN-01 |
| RN-10 | Criar os modelos de ata e as receitas, embutidos e próprios | feature | medium | 1 | RN-09 |
| RN-11 | Gerar a ata com notas garantidas, citações e regeração | feature | high | 1,5 | RN-10 |
| RN-12 | Mostrar e editar a ata na tela, com citações e exportação | feature | medium | 1 | RN-11, RN-07 |
| RN-13 | Criar a seção Reuniões nas Configurações | feature | medium | 1 | RN-12 |

## Fase 3 · A sala no mapa

| Id | Título | Tipo | Prioridade | Dias | Depende de |
|---|---|---|---|---|---|
| AO-71 | (já existe) Esconder a etiqueta do estúdio criativo nos outros andares | bug | low | 0,2 | — |
| RN-14 | Desenhar a sala de reunião nos andares de projeto | feature | medium | 2 | — |
| RN-15 | Pôr a etiqueta clicável da sala no mapa | feature | medium | 0,5 | RN-14, AO-71 |
| RN-16 | Abrir a sala de reunião na ponta do lounge do térreo | feature | medium | 1 | RN-14 |
| RN-17 | Sentar o avatar na sala, acender a placa e ligar o "Não perturbe" | feature | medium | 1,5 | RN-15, RN-07 |

Notas:

- **RN-14:** partir de `spikes/s4-planta/planta.diff`. Com estúdio e sala, 3 setores mandam o 3º para o fundo (time cai de 12 para 6 mesas) e "Outros setores" entra com 4. No 2D, afastar a etiqueta do estúdio do quadro branco da sala. Teste novo de `projectPlan` com `meeting`.
- **RN-16:** sala `[24,15,32,24]`, lounge `[11,15,24,24]`. Saem o canto do sofá azul, sofá, mesa, 3 pufes, estante e luminária; fliperamas para (22–23, 15); pingue-pongue para (22,5, 20), girado.
- **AO-71:** reproduzido nas capturas do S-4 (`spikes/s4-planta/shots/`).

## Fase 4 · Do papo à ação

| Id | Título | Tipo | Prioridade | Dias | Depende de |
|---|---|---|---|---|---|
| RN-18 | Transformar itens de ação em tickets e tarefas de agente | feature | high | 1,5 | RN-12 |
| RN-19 | Conversar com a reunião e com o andar, com receitas `/` | feature | medium | 2 | RN-12 |
| RN-20 | Dar aos agentes as ferramentas MCP `meetings_*` | feature | medium | 1 | RN-11 |
| RN-21 | Abrir uma pergunta da reunião com um agente | feature | low | 0,5 | RN-19, RN-20 |

A fase 5 (RN-22 a RN-27) fica fora do quadro até a v1 sair.
