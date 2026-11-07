# Sala de reunião — resultado da fase 0 (spikes)

- **Status:** aprovado pelo usuário, 2026-11-07
- **Spec:** `sala-de-reuniao.md` · **Plano:** `sala-de-reuniao-plano.md` (na branch do Turing)
- **ADRs:** [0011](../adr/0011-audio-do-sistema-no-macos.md) (áudio do sistema), [0012](../adr/0012-whisper-server-local-com-token.md) (whisper-server com token)
- **Código dos spikes:** `spikes/` (descartável) e a branch `spike/s4-planta`
- **Máquina:** Apple M5, macOS 27.0.1, Electron 44.5.1, whisper.cpp 1.9.4

Este documento muda o plano. Onde ele e o plano divergem, vale este.

## Respostas

| Spike | Pergunta | Resposta |
|---|---|---|
| S-1 | O loopback do Electron entrega o áudio do sistema? | Não. Exige a permissão de gravação de tela e não entregou faixa de áudio em nenhuma variante. As flags `MacLoopbackAudioForScreenShare` e `MacSckSystemAudioLoopbackOverride` não existem no Electron 44 |
| S-1 | O ajudante Swift (Core Audio process tap) entrega? | Sim. 60 s sem buraco (959.989 de 960.000 amostras), nível estável, macOS 14.2+ |
| S-2 | O `--request-path` protege `/inference` e `/load`? | Sim, 404 sem o token |
| S-2 | O servidor manda CORS? | Sim, `Access-Control-Allow-Origin: *` |
| S-2 | Latência por trecho de 20 s | `small` p50 681 ms, p95 818 ms; `base` p50 276 ms, p95 578 ms |
| S-2 | Memória | `small` ~780 MB; `base` ~360 MB |
| S-3 | FPS com o whisper no ritmo real | 60 no 3D e no 2D. Transcrevendo sem parar: 60 no 3D, 48 no 2D |
| S-3 | WER pt-BR | FLEURS (fala lida): `small` 5,8%, `base` 11,0%. Corpus de reunião do usuário: aprovado |
| S-4 | Térreo | Ponta do lounge, sala `[24,15,32,24]` |

## Decisões

1. **Áudio do sistema no macOS:** ajudante Swift com Core Audio process tap (caminho 2). Só microfone abaixo do macOS 14.2.
2. **Transcrição:** `whisper-server` por reunião, `small` por padrão, com token no caminho; `whisper-cli` por trecho como fallback.
3. **Desempenho:** sem modo economia durante a gravação no Apple Silicon.
4. **Térreo:** a ponta direita do lounge vira a sala; o lounge fica com `[11,15,24,24]`.

## Mudanças no plano

### Fase 1

- **Novo RN-05b · Ajudante de áudio do sistema (2,5 a 3,5 dias).** Arquivos: `native/system-audio/tap.swift` (a partir de `spikes/s1-swift-tap/`), `resources/` (binário), `electron-builder.yml` (`extraResources`, `extendInfo.NSAudioCaptureUsageDescription`), `src/main/meetings/system-audio.ts`, CI do macOS.
  - Spawn sem shell; stdout PCM 16 kHz para o gravador; stderr JSON só com números.
  - Partida assíncrona com timeout: o primeiro pedido de permissão segura a partida por até ~30 s ("Aguardando a permissão do macOS").
  - 3 s de zeros exatos com o tap ativo: aviso "Libere o áudio do sistema em Ajustes" com link.
  - O tap exclui os processos do próprio app (TTS e rádio), para não criar eco.
  - Assinar com o mesmo Team ID, hardened runtime, notarizar junto com o app; teste em conta limpa com `tccutil reset`.
  - Aceite: chamada real do Meet ouvida no arquivo; 30 min com o app minimizado sem buraco.
- **RN-05 encolhe:** sai o `setDisplayMediaRequestHandler` no macOS. O renderer captura só o microfone; a faixa `outros` não passa pelo IPC `office:meetingAudio`. Fica o `setPermissionRequestHandler` (microfone só para a página do app). No Windows, o loopback do Electron segue como na spec; se um dia o handler precisar recusar, `cb({})` lança `TypeError` no Electron 44.
- **RN-03 ganha regras (ADR 0012):** o app nunca chama `/load`; o token não vai para log nem para mensagem de erro; o processo é supervisionado (caiu, sobe outro com token novo; na segunda queda, `whisper-cli`). Teste: os argumentos nunca contêm `--convert` nem o token fora de `--request-path`.
- **RN-04:** o gravador recebe a faixa `outros` do stdout do ajudante, além dos pedaços do renderer para `eu`.
- **Configurações:** sugerir o `base` em máquinas com 8 GB (o `small` ocupa ~780 MB durante a reunião).

### Fase 3

- **RN-14:** com estúdio e sala, sobram 2 salas da frente para setores.
  - 3 setores: o 3º vai para a sala do fundo, e o time cai de 12 para 6 mesas.
  - "Outros setores" entra a partir de 4 setores (antes, 5).
  - Sem estúdio, nada muda.
  - No 2D, a etiqueta "Abrir estúdio criativo" quase cobre o quadro branco da sala: afastar a etiqueta ou o quadro.
  - Teste novo de `projectPlan` com `meeting`. Ponto de partida: `spikes/s4-planta/planta.diff`.
- **RN-15:** confirmado nas capturas: a etiqueta do estúdio aparece em todos os andares e no térreo. Corrigir antes da sala.
- **RN-16 (desbloqueado):** sala na ponta do lounge. Saem o canto do sofá azul (sofá, mesa, 3 pufes, estante, luminária); fliperamas para (22–23, 15); pingue-pongue para (22,5, 20), girado; o lounge perde 7 assentos e ganha 2.

### Estimativa

| | Antes | Depois |
|---|---|---|
| Fase 1 | 7–9 dias | 9,5–12,5 dias |
| Total (fases 0 a 4) | 22–29 dias | 24,5–32,5 dias |

### Riscos atualizados

| Risco | Situação |
|---|---|
| Loopback do macOS não funciona | Confirmado; resolvido pelo ajudante Swift |
| `--request-path` não protege o `/load` | Descartado; o CORS `*` e a queda no `/load` viram regras do RN-03 |
| GPU dividida | Descartado no M5; medir de novo em Intel se houver máquina |
| Assinatura e notarização do ajudante | Novo; dentro do RN-05b |
| Eco do próprio app no tap global | Novo; dentro do RN-05b |
