# 0008 — `npm run demo` por script Node, sem `cross-env`

- **Status:** aceito
- **Data:** 2026-10-07 (aceito no checkpoint 12 da rodada `2026-10-07-185405`)
- **Origem:** ADR-run-8 · requisito FR-9

## Contexto

O script `"demo": "AGENT_OFFICE_DEMO=1 electron-vite dev"` falhava no npm do Windows, que roda os scripts no `cmd.exe`. Era dívida registrada nos padrões de engenharia. Dependência de dev nova só com ADR (CON-1).

## Decisão

`scripts/demo.mjs` define `AGENT_OFFICE_DEMO=1` só no ambiente do processo filho e roda o `bin` do `electron-vite` (lido do `package.json` dele, que é exportado) com `process.execPath`, sem shell, herdando a saída e o código de saída. `"demo": "node scripts/demo.mjs"`. Sem `node_modules`, termina com "Não encontrei o electron-vite. Rode npm install e tente de novo." e código diferente de zero.

## Alternativas consideradas

- `cross-env`: dependência nova para 10 linhas.
- Scripts `demo:win` e `demo:mac`: o usuário precisa saber qual usar, e CMD e PowerShell têm sintaxes diferentes.
- Ler `--demo` dos argumentos no main: muda o contrato dos helpers de dev, que são todos variáveis de ambiente.

## Consequências

- Um comando para PowerShell, CMD e zsh (verificado no PowerShell, no CMD e no Git Bash; zsh no Mac não verificado); quita a dívida.
- Depende de o `electron-vite` manter `bin` no `package.json` (isolado em 3 linhas).
