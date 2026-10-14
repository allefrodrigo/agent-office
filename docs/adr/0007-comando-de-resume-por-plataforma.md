# 0007 — Comando copiado por plataforma numa função pura compartilhada (PowerShell 5.1)

- **Status:** aceito
- **Data:** 2026-10-07 (aceito no checkpoint 12 da rodada `2026-10-07-185405`; Q-6: manter `claude --resume` e documentar `claude.ps1`)
- **Origem:** ADR-run-7 · requisito FR-6

## Contexto

O comando `cd '…' && claude --resume <id>` não roda no Windows PowerShell 5.1 (`&&` é inválido) nem no CMD (aspas simples). O renderer já sabe a plataforma (`state.platform`).

## Decisão

`resumeCommand(platform, cwd, id)` em `src/shared/commands.ts`. No Windows: `Set-Location -LiteralPath '<pasta>'; claude --resume <id>`, dobrando `'` e as aspas tipográficas que o PowerShell também lê como aspa simples (U+2018, U+2019, U+201A, U+201B); `-LiteralPath` evita que `[`, `]` e `*` no nome virem curinga. Mac e Linux: a string de antes. Sem pasta, ou com caractere de controle na pasta (uma quebra de linha colada rodaria antes da hora), copia só `claude --resume <id>`. Id que não é UUID gera string vazia e o botão some.

## Alternativas consideradas

- Sintaxe do CMD (`cd /d "…" && claude …`): o shell padrão do Windows Terminal é o PowerShell.
- `cd '…'; claude …`: `cd` é alias de `Set-Location` sem `-LiteralPath` (curingas).
- Colar o caminho absoluto do exe: o renderer não conhece o caminho e o comando fica ilegível.
- Copiar `claude.cmd --resume` no Windows: resolveria a política de scripts, mas só para quem instalou pelo npm.

## Consequências

- Comando válido no PowerShell 5.1 e 7; testável.
- Não roda no CMD (o toast diz "Comando copiado para o PowerShell.").
- Com o Claude Code instalado pelo npm, `claude` no PowerShell resolve para `claude.ps1`, bloqueado pela política `Restricted`: documentado no COMO-RODAR (usar "Abrir no terminal", `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` ou o instalador nativo).
