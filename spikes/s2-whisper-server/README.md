# Spike S-2 — whisper-server com token

Código descartável. Resultado em `docs/adr/0012-whisper-server-local-com-token.md`.

Gere 50 trechos de 20 s em 16 kHz mono numa pasta (`c0.wav` … `c49.wav`) e rode:

```
node bench.mjs ~/.cache/hyperframes/whisper/models/ggml-small.bin <pasta> 50 result-small.json
node bench.mjs ~/.cache/hyperframes/whisper/models/ggml-base.bin  <pasta> 50 result-base.json
```

O script sobe o servidor em `127.0.0.1`, porta livre, token novo, mede latência e memória e encerra o processo. A saída tem só números.
