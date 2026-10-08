# 0006 — "Abrir no terminal" no Windows via `wt.exe` sem shell, com console próprio como reserva

- **Status:** aceito
- **Data:** 2026-10-07 (aceito no checkpoint 12 da rodada `2026-10-07-185405`; Q-2: aba nova na janela mais recente, `-w 0`)
- **Origem:** ADR-run-6 · requisito FR-5

## Contexto

O Windows Terminal aceita `wt -w 0 new-tab -d <pasta> --title <t> <comando…>`, mas trata `;` como separador de subcomandos em qualquer posição: uma pasta vinda de `~/.claude` com `;` poderia injetar subcomandos. O `wt.exe` é um alias de execução da Store (`%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe`), pode estar desligado e não existe em muitos Windows 10.

## Decisão

`src/main/terminal-launch.ts` roda `execFile(wt, ['-w', '0', 'new-tab', '-d', pasta, '--title', 'Claude Code', claudeExe, '--resume', id])` sem shell, tentando primeiro o caminho absoluto do alias e depois `wt.exe` do `PATH`. O título é constante. Se a pasta ou o caminho do exe tiver `;` ou caractere de controle, ou nenhum `wt` abrir, roda `spawn(claudeExe, ['--resume', id], { cwd, detached: true, stdio: 'ignore' })`, que dá ao processo uma janela de console própria. O ambiente da nova sessão sai sem `ELECTRON_*` e `AGENT_OFFICE_*` (`terminalEnv`), para ela aparecer na ponte (I-07). `src/main/resume-guard.ts` valida antes: pasta absoluta, sem caractere de controle e existente; exe terminando em `.exe`; no máximo uma abertura a cada 1,5 s. O retorno ganha `via` (`windows-terminal` ou `console`) para o toast certo.

## Alternativas consideradas

- `cmd /c start "" /D <pasta> claude --resume <id>`: reintroduz shell e as regras de escape do CMD.
- `powershell Start-Process`: shell com parsing próprio e cerca de 0,5 s de CPU.
- Arquivo `.cmd` temporário, como o `.command` do Mac: o CMD interpreta o conteúdo e deixa arquivo executável no `%TEMP%`.
- Escapar `;` para o `wt`: semântica de escape em `-d` não confirmada; desviar para o console é seguro.
- Preferência de terminal configurável: fora do escopo.

## Consequências

- Um clique leva à sessão no terminal padrão do Windows 11; nenhuma string não confiável passa por shell ou pelo parser do `wt`.
- O sucesso do `wt` significa só "o `wt` aceitou o pedido": erro dentro da aba aparece na aba, não no toast.
- A validação e o limite de 1,5 s valem também no Mac (efeito visível listado no CHANGELOG).
- Pendências: aba real do Windows Terminal com uma sessão real (roteiro M-3); SEC-1 (baixo): recusar pastas UNC e de dispositivo (`\\`, `\\?\`, `\\.\`) antes de tocar o disco.
