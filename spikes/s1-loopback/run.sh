#!/bin/bash
# Uso: ./run.sh <a|b|c|d|e> [--auto]   (S1_SECONDS=10 para encurtar, S1_HIDE=1 para esconder a janela)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
V="${1:-a}"; shift || true
exec "$ROOT/node_modules/.bin/electron" "$HERE" --variant="$V" "$@"
