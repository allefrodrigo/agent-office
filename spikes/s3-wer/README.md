# S-3 · WER do whisper.cpp em pt-BR

Mede a taxa de erro por palavra (WER) do `whisper-cli` local com os modelos `small` e `base`, com e sem prompt de vocabulário. Código descartável.

## Corpus

Fica fora do repositório. Cada caso é um áudio mais a transcrição de referência com o mesmo nome:

```
~/corpus-s3/
├── prompt.txt              # opcional: vocabulário para todos os arquivos
├── reuniao-tecnica.m4a
├── reuniao-tecnica.txt     # referência, UTF-8, texto puro
├── reuniao-tecnica.prompt.txt   # opcional: vocabulário só deste arquivo
├── um-a-um.wav
├── um-a-um.txt
├── chamada-eco.mp3
└── chamada-eco.txt
```

- Áudio: `.wav`, `.mp3`, `.m4a`, `.ogg` ou `.flac`. O script converte tudo que não for WAV 16 kHz mono para esse formato numa pasta temporária.
- Áudio sem `.txt` é ignorado com aviso.
- Prompt: `<nome>.prompt.txt` vence `--prompt-file`, que vence `prompt.txt`.

## Rodar

```sh
node spikes/s3-wer/wer.mjs ~/corpus-s3 --models small,base --out /tmp/s3-wer.json
# ou
AGENT_OFFICE_WER_CORPUS=~/corpus-s3 node spikes/s3-wer/wer.mjs
```

Opções:

- `--models small,base`: nomes em `~/.cache/hyperframes/whisper/models/ggml-<nome>.bin` ou caminho de um `.bin`.
- `--prompt-file vocab.txt`: prompt global.
- `--strip-accents`: compara sem acentos.
- `--keep-hyp <pasta>`: guarda as transcrições. A pasta terá conteúdo falado; apague depois.
- `--selftest`: confere a função de WER com casos conhecidos.

Precisa de Node 22+, `/opt/homebrew/bin/ffmpeg` e `/opt/homebrew/bin/whisper-cli`.

## Saída

Uma linha por arquivo × modelo × condição, depois uma tabela agregada por modelo × prompt.

- **WER**: (S + D + I) / palavras da referência. S = trocadas, D = faltando, I = sobrando. O agregado soma os erros de todos os arquivos e divide pela soma das palavras.
- **RTF**: tempo de transcrição / duração do áudio. Abaixo de 1 é mais rápido que o tempo real.
- Antes de comparar, os dois textos passam por: minúsculas, NFC, sem pontuação, espaços colapsados. Acentos ficam, salvo com `--strip-accents`. Números não são escritos por extenso: "dois" contra "2" conta como erro.

O relatório JSON (`--out`) e o terminal mostram só nomes de arquivo, contagens, WER e tempos. Nenhum texto falado sai da pasta temporária, que é apagada no fim.

## Meta

WER agregado ≤ 15% com `small` (sem prompt ou com prompt). Se só o `base` cumprir a meta de FPS, anotar o WER dele para a decisão.

## Linha de base pública (FLEURS pt-BR)

60 frases lidas do conjunto `dev` do [FLEURS](https://huggingface.co/datasets/google/fleurs) (1.389 palavras, ~15 min), sem prompt, Apple M5:

| Modelo | WER | RTF |
|---|---|---|
| `small` | 5,8% | 0,047 |
| `base` | 11,0% | 0,022 |

Fala lida e limpa: é o piso, não a reunião. Os números por extenso na referência ("dez") contam como erro quando o whisper escreve "10". Relatório: `fleurs-ptbr-report.json`.
