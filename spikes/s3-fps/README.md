# Spike S-3 — FPS com o whisper rodando

`npm run bench` (stress: 50 agentes, 4 andares), `AGENT_OFFICE_BENCH_LIVE=1`, 20 s, Apple M5, whisper `small`.

| Visual | Sem whisper | Whisper contínuo (pior caso) | Whisper no ritmo real (1 trecho a cada 10 s) |
|---|---|---|---|
| iso (3D) | 60 FPS, p95 18,3 ms | 60 FPS, p95 20,5 ms | 60 FPS, p95 19,4 ms |
| 2d | 60 FPS, p95 19,0 ms | 48 FPS, p95 43,9 ms | 60 FPS, p95 19,3 ms |

Uma primeira rodada, com outro Electron capturando telas ao mesmo tempo, deu iso 33 FPS (p95 66,7 ms) no pior caso: com a GPU disputada por três clientes, o escritório cai perto do limite.

Reproduzir:

```
node whisper-loop.mjs ~/.cache/hyperframes/whisper/models/ggml-small.bin <pasta-wavs> &   # PACE_MS=10000 para o ritmo real
AGENT_OFFICE_VIEW=iso AGENT_OFFICE_BENCH_LIVE=1 AGENT_OFFICE_BENCH_S=20 AGENT_OFFICE_BENCH_OUT=spikes/s3-fps/out/iso.json npm run bench
```
