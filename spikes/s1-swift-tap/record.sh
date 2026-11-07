#!/bin/bash
# Grava N segundos (padrão 60) de áudio do sistema em out/tap.pcm, converte para out/tap.wav
# e mostra o resumo. Uso: ./record.sh [segundos]
set -euo pipefail
cd "$(dirname "$0")"
SECONDS_ARG="${1:-60}"
FFMPEG=/opt/homebrew/bin/ffmpeg
mkdir -p out
[ -x ./tap ] || ./build.sh

echo "Gravando ${SECONDS_ARG} s de áudio do sistema. Toque algo (ex.: um vídeo)..." >&2
./tap --seconds "$SECONDS_ARG" > out/tap.pcm 2> out/tap.log || echo "tap saiu com erro $?" >&2

ffmpeg_args=(-hide_banner -loglevel error -y -f s16le -ar 16000 -ac 1 -i out/tap.pcm out/tap.wav)
"$FFMPEG" "${ffmpeg_args[@]}"

echo "--- status ---" >&2
grep -E '"event":"(format|error|warning|summary|teardown)"' out/tap.log >&2 || true
if grep -q '"permission_suspect":true' out/tap.log; then
  echo "ATENÇÃO: só silêncio. Confira Ajustes > Privacidade e Segurança > Gravação de Tela e Áudio do Sistema." >&2
fi
echo "Ouça com: afplay out/tap.wav" >&2
