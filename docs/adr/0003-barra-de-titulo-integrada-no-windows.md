# 0003 — Barra de título integrada no Windows com `titleBarOverlay` e CSS por plataforma

- **Status:** aceito
- **Data:** 2026-10-07 (aceito no checkpoint 12 da rodada `2026-10-07-185405`)
- **Origem:** ADR-run-3 · requisito FR-11

## Contexto

O Windows usava a moldura padrão, destoando do escritório. O Electron 44 suporta `titleBarStyle: 'hidden'` com `titleBarOverlay { color, symbolColor, height }` e expõe `env(titlebar-area-*)` ao CSS. O `body` já recebe a classe `platform-<plataforma>`.

## Decisão

`windowFrame(platform)` em `src/main/window-frame.ts` concentra as opções de moldura: Mac igual a antes (`hiddenInset`, semáforo em 16,18); Windows `hidden` com overlay `#1b1d2b` / `#e6e6f0` / 32 px; Linux com a moldura padrão. O renderer não recebe dado novo: a faixa de arraste e os deslocamentos do HUD são regras `.platform-win32` no CSS, com `env()` e valores de reserva fixos (32 px de altura, largura `100% − 138px`).

## Alternativas consideradas

- Manter a moldura padrão: descartada na aprovação do PRD (FR-11 entrou).
- Janela sem moldura com botões próprios em HTML: reimplementa minimizar, maximizar e os layouts de encaixe do Windows 11 e piora a acessibilidade.
- Mandar a altura da barra pelo estado do app: desnecessário com `env(titlebar-area-height)`.

## Consequências

- Visual coeso, sem IPC novo; reversível fazendo `windowFrame('win32')` devolver `{}`.
- O título "Agent Office" deixa de aparecer na barra (continua na barra de tarefas e no Alt+Tab).
- Toda interface nova perto do topo precisa respeitar a faixa de 32 px e a área dos botões nativos (cerca de 138 px à direita).
- Melhoria conhecida (QA-9, baixo): a faixa de arraste fica ativa por cima de modais nos 2 px de cima.
