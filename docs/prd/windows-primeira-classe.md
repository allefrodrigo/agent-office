# PRD (resumo) — Windows de primeira classe

- **Status:** aprovado em 2026-10-07 (épico inteiro: fatias 1, 2 e 3)
- **Rodada:** `2026-10-07-185405` · track iniciativa · autora do PRD: Rita Roadmap
- **Decisões técnicas:** [docs/adr/0001](../adr/0001-busca-do-claude-no-windows.md) a [0010](../adr/0010-instaladores-windows-x64-arm64.md)

## Problema

O Agent Office nasceu no Mac, e o Windows era um porte incompleto. Medido num Windows 11 com o Claude Code 2.1.293:

- O app empacotado não encontrava o Claude Code instalado pelo npm (procurava `%APPDATA%\npm\claude.exe`, que não existe). Sem isso, contratar agente e ler os limites do plano quebravam.
- Pendências invisíveis: o badge não aparecia na barra de tarefas e não havia equivalente ao pulo do Dock. A promessa central ("quem precisa de você vem até você") falhava com o app em segundo plano.
- "Abrir no terminal" só existia no Mac, e "Copiar comando" gerava `cd '…' && claude --resume`, que não roda no Windows PowerShell 5.1.
- O card Sistema contava o app Claude Desktop como agente (17 de 31 processos `claude.exe` na máquina medida).
- "Fechar sessão" no Windows era encerramento forçado sem o usuário saber.
- `npm run demo` não rodava no Windows.

Metade dos sócios usa Windows.

## Para quem

- **Dev multi-sessão no Windows (primária):** quer que a barra de tarefas avise quando um agente precisa dele e voltar a uma sessão no terminal com um clique ou um comando que funcione no seu shell.
- **Sócio que desenvolve no Windows:** quer rodar o demo e os scripts do projeto no PowerShell sem adaptar comandos.

## Métricas (sem telemetria)

| Tipo | Métrica | Meta |
|---|---|---|
| Norte | Fluxos principais que funcionam no Windows 11 (contratar, chamar, permissão, entrega, quadro, delegar, resume, abrir no terminal, conectar terminal, fechar sessão) | 10 de 10 |
| Valor | Permissões e entregas sinalizadas na barra de tarefas com o app sem foco | 100% |
| Guarda | Mudança de comportamento no Mac fora das listadas | 0 |
| Guarda | Custo de CPU do monitor de sistema | ≤ 1 ponto percentual |
| Guarda | Achados altos no security gate | 0 |

## Escopo

**Dentro:** localizar o Claude Code no Windows (nativo, npm, WinGet) e mensagem de instalação por sistema; overlay e piscar na barra de tarefas; abrir no terminal e copiar comando no Windows; card Sistema sem o Claude Desktop e com CPU dos agentes; "Fechar sessão" declarado; `npm run demo` multiplataforma; textos neutros de plataforma; documentação do Windows; barra de título integrada; alvo NSIS `arm64` (não verificado); assinatura preparada, sem certificado.

**Fora:** assinatura de fato (sem orçamento; o COMO-RODAR documenta o SmartScreen); instalação MSIX/Store do Claude Code; preferência de terminal configurável; testes em execução no macOS (só revisão de código).

## Requisitos

| Id | Requisito |
|---|---|
| FR-1 | Achar o `claude.exe` do instalador nativo, do npm global e do WinGet, além do `PATH` e de `AGENT_OFFICE_CLAUDE` |
| FR-2 | Sem Claude Code, mensagem com o comando de instalação do sistema (Windows: `irm https://claude.ai/install.ps1 \| iex`) |
| FR-3 | Overlay numérico na barra de tarefas com descrição acessível ("N pendências"); zero limpa |
| FR-4 | Pedido de permissão ou entrega com a janela sem foco faz a janela piscar até receber foco |
| FR-5 | "Abrir no terminal" no Windows: aba do Windows Terminal; sem ele, console próprio |
| FR-6 | "Copiar comando" válido no shell padrão do sistema (Windows: PowerShell 5.1) |
| FR-7 | Card Sistema conta só o Claude Code, não o Claude Desktop |
| FR-8 | "Fechar sessão" no Windows avisa que o encerramento é imediato; a checagem de PID não confunde o Claude Desktop |
| FR-9 | `npm run demo` no PowerShell, no CMD e no zsh, sem dependência nova |
| FR-10 | Textos da UI que citam o Mac usam o equivalente do sistema atual |
| FR-11 | Barra de título integrada ao tema no Windows, sem colisão do HUD com os botões nativos |
| NFR-1 | Nenhuma mudança de comportamento no Mac além dos textos e do comando copiado |
| NFR-2 | Processos externos novos sem shell, com argumentos em lista, só por ação do usuário ou pelos monitores existentes |
| NFR-3 | Monitor de sistema sem aumentar a CPU do app em mais de 1 ponto percentual |
| CON-1 | Sem dependência nova de runtime; de dev, só com ADR |
| CON-2 | Invariantes preservados; mudança no I-11 para o Windows só com ADR |

## Decisões de produto

- Épico inteiro na mesma rodada, incluindo a barra de título, a CPU dos agentes no Windows, o `arm64` e a assinatura preparada.
- "Fechar sessão" no Windows: manter o botão, com aviso de encerramento imediato e "a conversa fica salva" (exceção ao I-11 no [ADR 0005](../adr/0005-encerramento-imediato-de-sessao-no-windows.md)).
- Sem certificado de assinatura: documentar o aviso do SmartScreen.
- Testes automáticos com `node:test` nativo; a partir daqui, lógica nova sem teste reprova o gate.
- "Abrir no terminal" abre aba nova na janela mais recente do Windows Terminal.

## Resultado da rodada

- Gate de qualidade: dispensado pelo usuário (WAIVED) no ciclo 2, com 28 de 39 critérios evidenciados, 65 testes verdes e nenhum achado acima de baixo. Os 11 critérios restantes viraram checklist obrigatório no PR (roteiro manual M-1 a M-6).
- Security gate: CLEAR, com quatro recomendações de endurecimento de severidade baixa (SEC-1 a SEC-4) para a próxima rodada.
- Não verificados: macOS em execução, Windows 10, Windows arm64.
