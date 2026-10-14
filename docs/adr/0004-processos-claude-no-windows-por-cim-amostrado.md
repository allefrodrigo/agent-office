# 0004 — Processos `claude` no Windows por consulta CIM amostrada e `tasklist` de 3 s

- **Status:** aceito
- **Data:** 2026-10-07 (aceito no checkpoint 12 da rodada `2026-10-07-185405`)
- **Origem:** ADR-run-4 · requisitos FR-7, NFR-3 e lacuna L6b

## Contexto

O card Sistema contava o app Claude Desktop como agente (ele também é `claude.exe`; na máquina medida, 18 de 32 processos rodavam de `C:\Program Files\WindowsApps\Claude_…`) e não tinha CPU no Windows. O `tasklist` não mostra caminho nem tempo de CPU. O NFR-3 limita o custo a 1 ponto percentual de CPU. Medido: PowerShell frio com `Get-CimInstance` custa cerca de 0,5 s de CPU por chamada; `tasklist`, cerca de 94 ms.

## Decisão

Manter o `tasklist` a cada 3 s para contagem e memória (custo inalterado) e acrescentar uma consulta `Get-CimInstance Win32_Process` filtrada por `claude.exe` (PID, nome, ticks de CPU, working set, criação, caminho) a cada `sampleEveryMs(cores)` = clamp(100 000 / núcleos, 15 s, 60 s), antecipada para 5 s quando surge um PID não classificado. O Claude Desktop é separado pelo caminho (`isDesktopPath`); a CPU vem da diferença de ticks. O PowerShell é chamado pelo caminho absoluto de `%SystemRoot%`, com `-NoProfile -NonInteractive -EncodedCommand`, timeout de 5 s, uma consulta por vez e sem ler `CommandLine`. Se falhar, volta ao comportamento anterior (CPU vazia, contagem por nome) com um único aviso no console. A lógica fica em `src/main/win-processes.ts` (classe `WindowsClaude`, com dependências injetadas para teste).

## Alternativas consideradas

- PowerShell a cada 3 s: cerca de 1,4 p.p. em 12 núcleos, estoura o NFR-3.
- Um PowerShell persistente lendo comandos pelo stdin (cerca de 19 ms por consulta): processo filho de longa duração e protocolo próprio; fica como otimização futura.
- `typeperf`: os nomes de instância não trazem caminho e não separam o Claude Desktop.
- `wmic`: em remoção no Windows 11.
- Addon nativo: dependência nativa (CON-1) e rebuild por arquitetura.

## Consequências

- Contagem correta e CPU no Windows com custo estimado de 0,3 a 0,5 p.p.; falha degrada para o comportamento anterior.
- A CPU chega com atraso de 15 a 60 s; depende de PowerShell e CIM disponíveis (bloqueio por política deixa a CPU vazia).
- O padrão de caminho do Claude Desktop pode mudar (isolado em `isDesktopPath`).
- Pendências: medição manual do NFR-3 no Gerenciador de Tarefas (roteiro M-4); QA-7 (contagem com o Desktop nos primeiros segundos) e QA-8 (cadência de 5 s com troca contínua de PIDs) como melhorias.
