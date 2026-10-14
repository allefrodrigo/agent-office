# 0001 — Busca do `claude.exe` no Windows por lista ordenada e sem cache negativo

- **Status:** aceito
- **Data:** 2026-10-07 (aceito no checkpoint 12 da rodada `2026-10-07-185405`, "Windows de primeira classe")
- **Origem:** ADR-run-1 da arquitetura da rodada · requisitos FR-1, FR-2

## Contexto

A busca procurava `%APPDATA%\npm\claude.exe`, mas o npm cria ali só `claude.cmd` e `claude.ps1`; o binário real fica em `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`. No app empacotado (que não leva o binário do SDK), contratar agente e ler os limites do plano quebravam. Além disso, `findClaude()` memorizava "não achei", então "instale e tente de novo" exigia reiniciar o app.

## Decisão

Uma função pura `claudeCandidates(env, platform, home)` em `src/main/claude-path.ts` lista os lugares, nesta ordem:

`AGENT_OFFICE_CLAUDE` → binário do SDK (só em dev, resolvido à parte) → `PATH` (`PATH` ou `Path`) → `%USERPROFILE%\.local\bin` (instalador nativo) → `%USERPROFILE%\.claude\local` → npm global (`%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin`) → a mesma pasta sob `%NVM_SYMLINK%` → `%LOCALAPPDATA%\Microsoft\WinGet\Links` → `%LOCALAPPDATA%\Programs\claude` (legado).

No Windows, sempre `claude.exe`. A busca só testa existência de arquivo; nada é executado (I-13). Só o acerto é memorizado (`createFinder`).

## Alternativas consideradas

- Executar `where claude` ou `npm prefix -g`: roda processo na abertura, acharia `claude.cmd` (que exige shell) e fere o espírito do I-13.
- Ler `npm config get prefix` do `.npmrc`: parsing de formato do npm para ganho marginal; `AGENT_OFFICE_CLAUDE` cobre o caso.
- Aceitar `claude.cmd`: o spawn de `.cmd` exige shell (o Node recusa sem `shell: true` desde a correção do CVE-2024-27980) e reabre injeção.

## Consequências

- Funciona com as instalações nativa, npm (prefixo padrão) e WinGet; testável sem Windows.
- Prefixo npm customizado e instalação MSIX/Store ficam de fora; a saída é `AGENT_OFFICE_CLAUDE`.
- Sem cache negativo, cada tentativa sem Claude Code faz cerca de 10 checagens de arquivo (desprezível).
- Única mudança de comportamento no Mac: instalar o Claude Code com o app aberto e tentar de novo passa a funcionar.
- Débito conhecido (security gate, SEC-2, baixo): entradas relativas do `PATH` viram candidatos relativos; descartá-las numa próxima rodada.
