# S-1, caminho 2: helper Swift com process tap do Core Audio

Protótipo descartável. Captura o áudio global do sistema (todos os processos, menos o próprio
helper) com a API de process tap do macOS 14.2+ e escreve PCM s16le 16 kHz mono no stdout.
O stderr recebe só linhas JSON com números: formato, RMS/pico por segundo, frames, erros.

Peças: `CATapDescription(stereoGlobalTapButExcludeProcesses:)` → `AudioHardwareCreateProcessTap`
→ aggregate device privado com o tap → `AudioDeviceCreateIOProcIDWithBlock` → `AVAudioConverter`
(48 kHz float32 estéreo → 16 kHz Int16 mono). Ao sair (`--seconds`, SIGINT, SIGTERM ou pipe
fechado) destrói IO proc, aggregate e tap.

## Compilar

```bash
./build.sh
```

Usa `/usr/bin/swiftc` (Command Line Tools basta), embute `Info.plist` com
`NSAudioCaptureUsageDescription` e assina ad hoc (`codesign -s -`).

## Teste de 60 s (no Terminal.app)

1. Abra o Terminal.app e rode:
   ```bash
   cd spikes/s1-swift-tap
   ./record.sh        # ou ./record.sh 10 para um teste curto
   ```
2. Na primeira vez, o macOS pede acesso. Aceite. Se o pedido não aparecer ou você negou, abra
   **Ajustes do Sistema > Privacidade e Segurança > Gravação de Tela e Áudio do Sistema** e ligue
   o Terminal em **Somente Gravação de Áudio do Sistema** ("System Audio Recording Only").
   A permissão vai para o app que abriu o helper (o Terminal), não para o `tap`.
3. Durante a gravação, toque algo: um vídeo no navegador ou `afplay /System/Library/Sounds/Glass.aiff`.
4. Confira:
   ```bash
   afplay out/tap.wav
   ```
   No resumo, `"all_zero":false` indica que chegou som.

## Ler o status

- `format`: formato nativo do tap (normalmente 48000 Hz, 2 canais, float32).
- `level`: um por segundo, com `rms_dbfs`, `peak` e `all_zero`.
- `warning` `all_zero`: 3 s de zeros exatos. Ou nada tocava, ou a permissão foi negada: o macOS
  entrega silêncio, não erro.
- `error`: passo e `osstatus` (com fourcc) da chamada que falhou.
- `summary`: totais e `permission_suspect` (tudo zero com buffers chegando).

## Preflight de permissão

Não há API pública para consultar a permissão de áudio do sistema (`kTCCServiceAudioCapture`).
`TCCAccessPreflight` é SPI privada e fica de fora. O jeito público é o deste helper: criar o tap,
ler alguns buffers e tratar "tudo zero" como provável negação.
