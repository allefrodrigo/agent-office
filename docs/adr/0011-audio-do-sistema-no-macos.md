# 0011 — Áudio do sistema no macOS: ajudante Swift com Core Audio process tap

- **Status:** aceito (2026-11-07)
- **Data:** 2026-11-07
- **Origem:** spike S-1 do [plano da sala de reunião](../prd/sala-de-reuniao-plano.md) (fase 0)

## Contexto

A sala de reunião grava a voz dos outros pelo áudio do computador (Zoom, Meet, Teams). A spec lista três caminhos: (1) loopback do Electron, (2) ajudante Swift com Core Audio process tap, (3) só microfone.

Ambiente: Electron 44.5.1 (Chrome 152.0.7977.130), macOS 27.0.1 (26A434), Apple M5, Swift 6.2.1.

**Caminho 1** (`spikes/s1-loopback/`): `getDisplayMedia({ audio: true, video: true })` no renderer, `setDisplayMediaRequestHandler` com `{ video: <tela>, audio: 'loopback' }` no main.

- `MacLoopbackAudioForScreenShare` e `MacSckSystemAudioLoopbackOverride`, citadas na spec, **não existem** neste Chromium. Existe a família Core Audio tap (`MacCatapLoopbackAudioForScreenShare`, `MacCatapCaptureAllDevices`, `MacCatapRestartOnDeviceChange`…) e a ScreenCaptureKit (`UseSCContentSharingPicker`…).
- Nenhuma variante (sem flag, Catap, todas juntas) entregou faixa de áudio, nem rodando pelo Agent Office nem pelo Terminal.app: `desktopCapturer.getSources` falha ("Failed to get sources."), o `getDisplayMedia` volta `AbortError`, e `getMediaAccessStatus('screen')` diz `denied`. O caminho exige a permissão de **gravação de tela**, mesmo descartando o vídeo.
- `cb({})` no handler lança `TypeError: Video was requested, but no video stream was provided`.
- O resto do desenho funciona: worklet 48→16 kHz Int16 dentro da CSP, IPC disparado pelo worklet, janela escondida; 100 blocos em 10 s, sem buraco.

**Caminho 2** (`spikes/s1-swift-tap/`, 277 linhas de Swift): `CATapDescription` global (exclui o próprio PID), `AudioHardwareCreateProcessTap`, aggregate device, IO proc; converte 48 kHz float32 estéreo para 16 kHz mono Int16 no stdout; status em JSON, só números, no stderr.

- Compila com `swiftc` das Command Line Tools, sem Xcode; binário universal de 173 KB, assinado ad hoc, `NSAudioCaptureUsageDescription` embutido.
- **Captura o áudio do sistema:** tom de 1 kHz tocado com `afplay` chegou a −21 a −23 dBFS, frequência conferida, 5 s e 10 s sem erro de conversão, teardown limpo por `--seconds`, SIGTERM e pipe fechado.
- A permissão pedida é a de **áudio do sistema** ("Somente gravação de áudio do sistema"), não a de tela. Ela fica com o processo responsável (o app que dispara o ajudante).
- **60 s sem buraco:** 959.989 de 960.000 amostras (faltam 0,7 ms, a latência do conversor), nível estável entre −21,6 e −20,4 dBFS em todos os 60 segundos, nenhum segundo zerado.
- Na primeira execução, a partida levou ~27 s (provável pedido de permissão aberto); depois, 2 ms.
- Permissão negada não dá erro: o tap entrega zeros. O ajudante avisa (`all_zero`, `permission_suspect`).

## Decisão

Caminho 2: ajudante Swift com Core Audio process tap, macOS 14.2+, PCM 16 kHz mono no stdout, um processo por reunião.

Motivos: é o único caminho que capturou áudio no spike; pede só a permissão de áudio, que o usuário entende, em vez de "gravar a tela"; o PCM chega pronto para o segmentador, sem passar pelo renderer.

O microfone continua no renderer (`getUserMedia` + worklet), como na spec.

## Alternativas consideradas

- **Caminho 1, loopback do Electron (com `MacCatapLoopbackAudioForScreenShare`).** Custo zero de empacotamento, mas exige gravação de tela e não entregou áudio no spike. Pode voltar se um teste com a permissão de tela liberada der sinal; nesse caso, comparar os pedidos de permissão antes de trocar.
- **Caminho 3, só microfone + BlackHole.** Fica como saída para macOS anterior a 14.2 e para quem negar a permissão.

## Consequências

- **Esforço: 2,5 a 3,5 dias** a mais na fase 1 (novo ticket entre RN-03 e RN-05):
  - compilar no CI (runner macOS com `swiftc`) ou versionar o binário: 0,5 dia;
  - `extraResources` no `electron-builder.yml` e caminho dev/empacotado: 0,5 h;
  - assinatura com o mesmo Team ID, hardened runtime e notarização junto com o app: 0,5 dia;
  - ciclo de vida no main (spawn sem shell, stdout para o gravador, stderr JSON, SIGTERM ao fim e ao sair, órfãos, partida com timeout): 1 dia;
  - interface de permissão e teste em conta limpa (`tccutil reset`): 0,5 a 1 dia.
- `NSAudioCaptureUsageDescription` entra no `extendInfo` do `electron-builder.yml`; o pedido mostra "Agent Office".
- A primeira partida pode bloquear dezenas de segundos com o pedido aberto: subir o ajudante de forma assíncrona e mostrar "Aguardando a permissão do macOS".
- Silêncio total por 3 s com o tap ativo vira o aviso "Libere o áudio do sistema em Ajustes", com link (`x-apple.systempreferences:`).
- **Eco do próprio app:** o tap global pega a voz do TTS e a rádio do Agent Office. O tap deve excluir os processos do app (PIDs do main e dos helpers do Electron, ou `bundleIDs`).
- macOS anterior a 14.2: só microfone, com a dica do BlackHole.
- A faixa `outros` deixa de vir pelo IPC `office:meetingAudio`; o gravador do main lê o stdout do ajudante. O RN-05 encolhe: sai o `setDisplayMediaRequestHandler`, fica o `setPermissionRequestHandler` para o microfone.
- Windows segue com o loopback do Electron (suportado oficialmente), fora deste ADR.

## Aceite

Aprovado pelo usuário em 2026-11-07. O teste de ouvido com uma voz real (`./record.sh` em `spikes/s1-swift-tap/`) foi dado como aprovado; o spike conferiu nível, frequência e continuidade com um tom de teste. Repetir a escuta no RN-05b, com uma chamada de verdade.
