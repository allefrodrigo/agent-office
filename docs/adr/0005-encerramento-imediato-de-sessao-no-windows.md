# 0005 — Exceção ao I-11 no Windows: encerramento imediato declarado e checagem de PID estrita

- **Status:** aceito
- **Data:** 2026-10-07 (decisão de produto na aprovação do PRD; ADR aceito no checkpoint 12 da rodada `2026-10-07-185405`)
- **Origem:** ADR-run-5 · requisito FR-8 · invariante I-11

## Contexto

O invariante I-11 diz que uma sessão do terminal nunca recebe SIGKILL (SIGTERM, depois SIGHUP). No Windows, `process.kill(pid, 'SIGTERM')` vira `TerminateProcess` (encerramento forçado) e não existe SIGHUP: o invariante já era violado na prática, sem o usuário saber. A checagem contra reuso de PID usava `/claude/i` sobre o `tasklist`, que também casava com o app Claude Desktop.

## Decisão

No Windows, "Fechar sessão" continua usando `TerminateProcess`, agora **declarado** na confirmação ("vai ser encerrado na hora (o Windows não tem fechamento suave). A conversa fica salva: dá para voltar com claude --resume.") e no comentário de `terminate()`. Em troca, a checagem de PID fica mais forte que a do Mac: nome de imagem exato `claude.exe`, caminho fora do Claude Desktop e o mesmo horário de criação registrado quando o PID foi aprendido (`ClaudeIdentities` em `src/main/win-processes.ts`, até 256 identidades). Sem PowerShell, cai para nome exato pelo `tasklist`. macOS e Linux sem mudança.

Texto do I-11 a partir desta decisão: "macOS/Linux: SIGTERM, depois SIGHUP, nunca SIGKILL. Windows: encerramento imediato (`TerminateProcess`) só após confirmação com texto explícito; PID checado por nome exato, caminho fora do Claude Desktop e horário de criação."

## Alternativas consideradas

- `taskkill /PID` sem `/F`: envia `WM_CLOSE`, que processos de console não recebem; não fecha.
- `GenerateConsoleCtrlEvent` (Ctrl+C/Ctrl+Break) por um helper que se anexa ao console do alvo: exige addon nativo ou P/Invoke, o helper derruba a si mesmo ao anexar, e Ctrl+C no Claude Code só interrompe o turno.
- Esconder o botão no Windows: descartada na aprovação do PRD.
- Fechar a aba do Windows Terminal: não há API para identificar a aba de um PID.

## Consequências

- Comportamento honesto e decidido; menor chance de encerrar o processo errado do que antes.
- A última escrita da transcrição pode se perder e o hook `SessionEnd` não dispara (já compensado por `terminalKill()`).
- O I-11 passa a ter texto por plataforma (atualizado no mapa de arquitetura do squad).
- Pendências: encerramento de uma sessão real com a ponte conectada (roteiro M-5); SEC-4 (baixo): limitar as consultas de identidade disparadas por eventos da ponte.
