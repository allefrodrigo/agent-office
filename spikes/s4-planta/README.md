# S-4 · Planta (spike, código descartável)

Capturas da sala de reunião nos andares de projeto e das duas opções do térreo, nos visuais 3D (`iso`) e 2D.

## Arquivos

- `planta.diff`: mudanças do spike (branch `spike/s4-planta`, sem commit).
- `shots/`: capturas. `andar-*` = andar com estúdio + 3 setores (Produto, Design, Engenharia); `andar-4setores-*` = mesmo andar com 4 setores; `terreo-lounge-*` = opção A; `terreo-copa-*` = opção B; `*-antes-*` = sem sala.
- `run.sh`, `setup.js`, `cam.js`: roteiro das capturas.

## Reproduzir

```sh
cd <worktree com o diff aplicado>      # git apply planta.diff
npm ci && npx electron-vite build
# run.sh <iso|2d> <antes|lounge|copa> <prefixo> <zoom: 0 no iso, 1 no 2d>
SPIKE_WT=$PWD spikes/s4-planta/run.sh iso lounge /tmp/s4/lounge-iso 0
SPIKE_WT=$PWD spikes/s4-planta/run.sh 2d  copa   /tmp/s4/copa-2d 1
```

Cada execução grava três PNGs: `-1` andar com 3 setores, `-2` andar com 4 setores, `-3` térreo.

Como funciona:

- `AGENT_OFFICE_DATA_DIR=$(mktemp -d)` isola os dados; seus dados reais ficam intactos.
- `AGENT_OFFICE_SPIKE_TERREO=antes|lounge|copa` vira `?terreo=` na página (`src/main/index.ts`). `antes` desliga a sala em todos os andares.
- `setup.js` cria dois andares falsos com squads e setores, liga o estúdio (`__game.setStudios(true)`) e chama `__game.setProjects`.
- `cam.js` troca de andar (`__game.goFloor`), afasta o zoom e centraliza a câmera.
- `AGENT_OFFICE_VIEW=iso|2d` escolhe o visual.
