# 0002 — Overlay da barra de tarefas desenhado em código no processo principal

- **Status:** aceito
- **Data:** 2026-10-07 (aceito no checkpoint 12 da rodada `2026-10-07-185405`)
- **Origem:** ADR-run-2 · requisitos FR-3, FR-4

## Contexto

`app.setBadgeCount` não tem efeito na barra de tarefas do Windows. O equivalente é `BrowserWindow.setOverlayIcon(NativeImage | null, descrição)`, com imagem de 16×16. Era preciso gerar a imagem do número sem dependência nova (CON-1) e sem abrir superfície entre renderer e main (I-05, I-14). O repositório já tinha um codificador PNG pequeno em `scripts/make-icon.mjs`.

## Decisão

`src/main/badge.ts` desenha um disco vermelho com o rótulo (`1` a `9`, `9+`) num buffer RGBA, com fonte de 3×5 pixels, e codifica em PNG com `node:zlib` e CRC32. O `index.ts` cria a `NativeImage` com `createFromBuffer` (16 px) e `addRepresentation` (32 px, para DPI alto), memorizada por rótulo. A descrição acessível vem de `badgeDescription(n)`: "1 pendência no Agent Office" / "{n} pendências no Agent Office". Com a janela sem foco, `permission:new` e `result:new` chamam `flashFrame(true)`; focar a janela para o piscar.

## Alternativas consideradas

- Desenhar num `<canvas>` do renderer e mandar a imagem por IPC: canal novo que recebe imagem de origem não confiável e acopla o badge ao renderer.
- Dez PNGs estáticos em `resources/`: exige `extraResources` e resolução de caminho entre dev e empacotado.
- `createFromBitmap` com BGRA cru: formato dependente de plataforma, segundo o próprio `.d.ts`.
- SVG via `createFromDataURL`: `nativeImage` não decodifica SVG.

## Consequências

- Zero dependência e zero IPC novo; a imagem deriva só de um inteiro calculado no main; pixels e PNG testáveis.
- Cerca de 80 linhas de desenho e codificação a manter, com o codificador duplicado em `make-icon.mjs` (aceito).
- Com "ícones pequenos" na barra do Windows 10, o overlay não aparece (limitação do sistema); o piscar continua.
