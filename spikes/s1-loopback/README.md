# Spike S-1: áudio do sistema no macOS (Electron 44)

Grava o áudio do sistema por `getDisplayMedia` + `audio: 'loopback'` e salva PCM s16le 16 kHz mono. Código descartável.

## Variantes

| Variante | `--enable-features` | Existe no Electron 44.5.1? |
|---|---|---|
| `a` | nenhuma | — |
| `b` | `MacLoopbackAudioForScreenShare` | não (nome antigo) |
| `c` | `MacSckSystemAudioLoopbackOverride` | não (nome antigo) |
| `d` | `b` + `c` + `MacCatapLoopbackAudioForScreenShare` | só o terceiro |
| `e` | `MacCatapLoopbackAudioForScreenShare` (Core Audio tap) | sim |

Outros nomes do Core Audio tap presentes no binário: `MacCatapLoopbackAudioForCast`, `MacCatapCaptureAllDevices`, `MacCatapProbeTapOnCreation`, `MacCatapRestartOnDeviceChange`, `MacCatapRestartAudioProcessOnTimeout`, `MacCatapForceInternalResampling`, `MacCatapSonomaInternalResampling`, `MacCatapForceMonoCaptureOfMonoDevices`. Do ScreenCaptureKit: `UseSCContentSharingPicker`, `ScreenCaptureKitStreamPickerSonoma`, `ScreenCaptureKitFullDesktopFallback`.

## Passo a passo (60 s)

1. Rode `npm ci` na raiz do repositório, se ainda não rodou.
2. Abra o **Terminal.app** (não o Agent Office: o macOS pede a permissão para o app que abriu o processo).
3. Abra no Chrome ou Safari um vídeo com fala ou música, ou uma chamada de teste do Meet. Deixe tocando.
4. Rode:
   ```
   cd spikes/s1-loopback
   ./run.sh e
   ```
5. Clique em **Gravar 60 s**.
6. Se o macOS pedir "Gravação de tela e áudio do sistema", aceite em Ajustes do Sistema > Privacidade e Segurança > Gravação de Tela e Áudio do Sistema para o **Terminal**. O macOS pede para reabrir o app: feche o Terminal, abra de novo e repita os passos 4 e 5.
7. Com a gravação andando, troque para outro app e deixe a janela do spike atrás (testa o segundo plano). A janela fecha a gravação sozinha aos 60 s.
8. Repita com `./run.sh a`, `./run.sh b`, `./run.sh c` e `./run.sh d`.

## Onde ficam os arquivos

- `out/system-<variante>.pcm`: PCM cru (s16le, 16 kHz, mono).
- `out/system-<variante>.wav`: a mesma coisa em WAV.
- `out/report-<variante>.json`: só números (versões, status da permissão, erro, configurações da faixa, RMS e pico por segundo, blocos, buracos de sequência).

## Como conferir

```
afplay out/system-e.wav
python3 -c 'import json;r=json.load(open("out/report-e.json"));print(r["getDisplayMedia"],r["audioTrack"],r["chunks"],r["gaps"],r["totalNonZeroSamples"],r["overallPeak"])'
```

Sucesso: `audioTrack.present: true`, `chunks` = 600, `gaps` vazio, `overallPeak` > 0 e o WAV soa como o vídeo.

## Opções

- `--auto`: começa sem clique (para teste automatizado).
- `S1_SECONDS=10`: encurta a gravação.
- `S1_HIDE=1`: esconde a janela ao começar.
- `S1_SYSTEM_PICKER=1`: `useSystemPicker: true` (seletor do macOS no lugar do handler).
- `S1_SELFTEST=1`: troca o `getDisplayMedia` por um tom de 440 Hz gerado na página. Testa worklet, IPC e segundo plano sem permissão.
