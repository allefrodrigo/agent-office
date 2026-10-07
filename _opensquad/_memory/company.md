# Perfil do Produto — Agent Office

> Contexto carregado pelo opensquad em toda execução de squad. Mantido pela equipe do produto.
> Última atualização: 2026-10-07 (base: v0.2.0, commit 78249be).

## Empresa / Produto

- **Nome:** Agent Office
- **O que é:** app desktop (Electron) que transforma agentes do Claude Code em personagens de um escritório isométrico em pixel art. Cada agente tem mesa e computador; a tela mostra o que ele faz. Quando precisa de permissão, tem uma pergunta, um plano para aprovar ou termina a tarefa, ele levanta e vai até a sala do usuário.
- **Inspirações declaradas:** Habbo Hotel (visual isométrico) e Gather (escritório virtual).
- **Estágio:** v0.2.0, uso pessoal/early adopters. Build de Mac (arm64, assinatura ad-hoc) e porte para Windows em andamento (instalador NSIS).
- **Equipe:** dois sócios (autor do código no Mac; sócio responsável pelo porte para Windows).
- **Licença:** MIT (pacote marcado como `private`).
- **Repositório:** este (`agent-office`). Arquitetura em `README.md`, passo a passo em `COMO-RODAR.md`.

## Proposta de valor

Trabalhar com vários agentes ao mesmo tempo sem perder o controle: o escritório vira um quadro de status vivo e uma "caixa de entrada espacial". Ninguém precisa vigiar terminais — quem precisa de você vem até você.

Pilares:
1. **Visibilidade** — status, atividade, contexto (como `/context`), custo e limites do plano (como `/usage`) num relance.
2. **Governança** — permissões (Permitir / Sempre permitir / Negar com instrução), `AskUserQuestion` como cartão de opções, `ExitPlanMode` como plano para aprovar.
3. **Delegação** — quadro kanban de tickets (chaves `AO-n`) que agentes também usam via ferramentas MCP `mcp__office__*`; só pessoas movem para "Feito".
4. **Continuidade** — central de resume, sessões do terminal conectadas por hooks, agentes que sobrevivem a reinícios.
5. **Prazer de uso** — lounge, pebolim, fliperama, airsoft, avatares estilo Habbo.

## Público-alvo

- **Primário:** desenvolvedores que usam Claude Code intensamente com 2+ sessões em paralelo (planos Pro/Max), em Mac ou Windows.
- **Secundário:** tech leads e pequenos times que orquestram agentes por tickets; criadores de conteúdo dev (o visual é altamente compartilhável).
- **Mercado de entrada:** comunidade brasileira de devs e de IA (UI 100% em pt-BR hoje). Ecossistemas próximos e também brasileiros: AIOX (Synkra) e opensquad.

## Produtos e funcionalidades (v0.2.0)

- Contratar agente (pasta, tarefa, modelo, modo de permissão) e Chamar agente (só a pasta, como abrir `claude`).
- Painel do agente: log ao vivo, envio de instruções com anexos (imagem, PDF, texto), interromper, compactar (`/compact`), limpar (`/clear`), demitir.
- Cartões de permissão com diff/comando; perguntas e planos; entrega de resultados em mãos.
- Quadro de tickets (Backlog, A fazer, Fazendo, Revisão, Feito) com critérios de aceite, delegação para agente livre ou novo, relatório vira comentário.
- Central de resume (sessões do terminal e do escritório), recall como agente, abrir no Terminal (Mac).
- Ponte do terminal: hooks HTTP em `~/.claude/settings.json` (127.0.0.1 + token), permissões do terminal aprovadas no app.
- Limites do plano (5h, semana, por modelo) sem gastar tokens; monitor de CPU/RAM e processos `claude`.
- Conversa entre sessões (`SendMessage`) animada: o agente anda até a mesa do destinatário.
- Modo demo (`npm run demo`) com agentes simulados.

## Stack

Electron 44 · electron-vite 5 · Vite 7 · TypeScript 5.9 (strict) · three.js 0.186 (RenderPixelatedPass, câmera ortográfica 2:1) · UI em DOM puro (helper `h()`, sem framework) · marked + DOMPurify · zod 4 · `@anthropic-ai/claude-agent-sdk` 0.3.x · electron-builder 26. Persistência em JSON (`userData/office.json`, `userData/tickets.json`).

## Tom de voz do produto

- pt-BR natural, direto, caloroso e levemente lúdico — o escritório "fala" como colegas de trabalho: "Chegando ao escritório", "Trazendo o resultado", "Esperando sua revisão no quadro".
- Mensagens de erro humanas e acionáveis: dizem o que aconteceu e o que fazer ("Escolha uma pasta de projeto que exista.").
- Avisos de risco sem eufemismo: "PERIGOSO: roda qualquer comando sem perguntar. Use só em pastas descartáveis."
- Sem jargão de marketing, sem exclamações em excesso, sem emojis na UI além dos símbolos funcionais (✓, ✗, !, ?).

## Concorrência e referências (resumo — detalhes em `squads/agent-office-squad/pipeline/data/benchmark-landscape.md`)

- **Escritórios visuais de agentes:** Pixel Agents (extensão VS Code + `npx`, ~9,6 mil estrelas, ~87 mil instalações), Atlassian roving-office (alpha), Claude-Office (W17ant), Cubicle, dashboard "Virtual Office" do opensquad, AIOX Cockpit.
- **GUIs e orquestradores de sessões paralelas:** app desktop oficial do Claude Code (redesenho de abril/2026 com sessões paralelas e worktrees), Conductor (Mac), Nimbalyst (sucessor do Crystal), Vibe Kanban (descontinuado pela empresa em abril/2026), Claude Squad (tmux), Opcode.
- **"Mission control" de plataformas:** GitHub Agent HQ, Cursor 3 Agents Window, Google Antigravity Agent Manager.
- **Diferencial do Agent Office:** é o único que junta visualização espacial + governança interativa (aprovar, responder, aprovar plano) + kanban que os próprios agentes operam + ponte para sessões do terminal + telemetria de contexto/limites/custo, num app desktop.

## Restrições e princípios inegociáveis

- Segurança do usuário acima de conveniência: renderer isolado (contextIsolation, sandbox, CSP), ponte só em 127.0.0.1 com token, tickets nunca rodam em "Sem pedir nada".
- Nada de telemetria sem consentimento explícito.
- O app usa o `claude` instalado na máquina do usuário (não embute o binário de ~220 MB).
- Toda mudança precisa funcionar em macOS e Windows (ou declarar explicitamente o limite).
- Textos da UI em pt-BR; código e comentários em inglês.

## Redes e canais

- Ainda não há site, redes sociais ou comunidade oficiais. Canal principal: o repositório.
