# Padrões de Engenharia — Agent Office

Convenções observadas no código atual (v0.2.0) e regras que o squad segue. Quem muda uma convenção registra um ADR (Artur Arquitetura).

## 1. Stack e configuração

- Electron 44 · electron-vite 5 · Vite 7 · TypeScript 5.9 · three.js 0.186 · marked 18 + DOMPurify 3 · zod 4 · `@anthropic-ai/claude-agent-sdk` 0.3.x · electron-builder 26.
- `"type": "module"`. Main e preload compilados pelo electron-vite; **o preload sai em CommonJS** (`[name].cjs`) porque preload com sandbox exige CJS.
- TypeScript `strict`, `noUnusedLocals`, alvo ES2023, `moduleResolution: Bundler`. Dois projetos: `tsconfig.node.json` (main, preload, shared) e `tsconfig.web.json` (renderer, shared).
- Alias `@shared/*` → `src/shared/*` em main, preload e renderer. Tipos compartilhados sempre por esse alias.
- Versão do app em `package.json` e exibida nas Configurações junto com o horário do build (`__APP_VERSION__`, `__APP_BUILD__`).

## 2. Estilo de código

- **Sem framework de UI.** DOM puro com o helper `h(tag, attrs, ...children)` e `icon(nome)` de `ui/dom.ts`. Adotar React/Vue/Svelte exige ADR.
- Classes pequenas com responsabilidade única (`AgentManager`, `TicketBoard`, `TicketDesk`, `Bridge`, `UsageMonitor`, `SystemMonitor`, `Game`, `Engine`, `Hud`, `AgentPanel`, `Dialog`, `Board`).
- Main emite eventos com `EventEmitter` (`'event'`, `'usage'`, `'system'`); `index.ts` faz o broadcast para a janela.
- Comentários curtos, em inglês, explicando **por quê** — não o quê. Exemplos reais: `// Sandboxed preload scripts must be CommonJS.`, `// No SIGKILL: a hard kill can leave the user's terminal stuck in raw mode.`
- Docstrings `/** … */` nas APIs públicas e em decisões não óbvias.
- Nomes em inglês no código; **todo texto visível ao usuário em pt-BR** (ver `product-voice.md`).
- Mensagens de erro lançadas no main já são frases para o usuário em pt-BR (o renderer limpa o prefixo do Electron com `cleanError`).
- Entrada não confiável é limpa por funções dedicadas (`cleanDraft`, `cleanText`, `oneOf`, `isSessionId`).
- Constantes de limite no topo do arquivo em MAIÚSCULAS (`LOG_LIMIT`, `MAX_TITLE`, `BODY_LIMIT`, `PERMISSION_TIMEOUT_S`).
- Sem dependências novas sem justificativa; dependência de runtime nova exige ADR e revisão da Sílvia Sandbox.

## 3. Comandos

| Objetivo | Comando |
|---|---|
| Instalar | `npm install` (se faltar o binário: `node node_modules/electron/install.js`) |
| Rodar | `npm run dev` |
| Demo sem tokens | `npm run demo` (zsh, PowerShell e CMD; `scripts/demo.mjs`) |
| Tipos | `npm run typecheck` |
| Testes | `npm test` (`node --test "src/**/*.test.ts"`; Node ≥ 22.18) |
| Build sem empacotar | `npm run build` |
| Pacote Mac | `npm run dist:mac` (só em Mac; arm64; assinatura ad-hoc) |
| Pacote Windows | `npm run dist:win` (só em Windows; NSIS x64 e arm64 em instaladores separados, não assinados; arm64 não verificado) |
| Ícone | `npm run icon` |

Helpers de desenvolvimento: `AGENT_OFFICE_SHOTS`, `AGENT_OFFICE_EVAL`, `AGENT_OFFICE_DATA_DIR`, `AGENT_OFFICE_SEED`, `AGENT_OFFICE_CLAUDE`, `AGENT_OFFICE_DEMO` (detalhes e sintaxe PowerShell em `run-conventions.md` §8).

## 4. Estado atual da qualidade (lacunas conhecidas)

| Item | Hoje | Alvo |
|---|---|---|
| Testes unitários | `node:test` nativo (ADR 0009, run `2026-10-07-185405`): `npm test` roda `src/**/*.test.ts` (65 testes na entrega); cobre só os módulos puros do porte para Windows (`claude-path`, `badge`, `window-frame`, `win-processes`, `terminal-launch`, `resume-guard`, `session-process`, `claude-messages`, `shared/commands`, `ui/os-text`) | estender a `cleanDraft`, `hookDecision`, `permissionFromTool`, `sniff`/`buildMessage`, `describeTool`, `ticketBrief`, `lookFromSeed`; Vitest só se precisar de alias ou mock de Electron (ADR próprio) |
| Testes de integração | inexistentes | `AgentManager` com SDK simulado (fixtures de `SDKMessage`), `Bridge` com requisições HTTP reais em porta aleatória |
| E2E | inexistente | Playwright para Electron com `AGENT_OFFICE_DEMO=1` e `AGENT_OFFICE_DATA_DIR` temporário |
| Regressão visual | manual | capturas `AGENT_OFFICE_SHOTS` comparadas por story |
| Lint/format | inexistentes | ESLint (typescript-eslint) + Prettier com regras que não briguem com o estilo atual |
| CI | inexistente | GitHub Actions: typecheck + build + testes em `macos-latest` e `windows-latest` |
| Cobertura | — | não diminuir depois que existir |

O test runner existe desde a run `2026-10-07-185405` (Q-1 do checkpoint 12): **lógica nova sem teste é FAIL** no quality gate. Regras do `node:test`:

- Funções testadas moram em módulos que só importam `node:*` e `import type` (o Node não resolve o alias `@shared/*` nem o SDK); lógica com efeitos recebe dependências injetadas (padrão de `WindowsClaude`, `ClaudeIdentities`, `createOpenGuard`).
- Testes importam com a extensão `.ts` (`allowImportingTsExtensions: true` nos dois tsconfig). Em código de produção, preferir import sem extensão; `session-process.ts` importa `./win-processes.ts` com extensão (funciona porque o bundler resolve) — convenção a padronizar (QA-11).
- Exige Node ≥ 22.18 de quem roda os testes (o app continua com Node 20+).

## 5. Definition of Done (por story)

- [ ] Critérios de aceite com evidência (teste, captura ou passo reproduzível).
- [ ] `npm run typecheck` e `npm run build` verdes; `npm test` e `npm run lint` verdes quando existirem.
- [ ] Invariantes I-01…I-14 tocados verificados (`architecture-map.md` §7).
- [ ] Paridade macOS/Windows ou limite declarado no código (`process.platform`) e na story.
- [ ] Textos novos em pt-BR seguindo `product-voice.md`, revisados pela Lívia.
- [ ] UI nova acessível (nome, papel, foco, teclado, contraste) — ver §7.
- [ ] Sem regressão de performance (§8).
- [ ] Dev Agent Record completo (`run-conventions.md` §6).
- [ ] README/COMO-RODAR atualizados quando o comportamento visível muda.

## 6. Plataforma (macOS e Windows)

- Ramificar com `process.platform` explícito e comentário do motivo. Nunca supor caminhos POSIX.
- Caminhos com `node:path` (`join`, `sep`, `delimiter`); nunca concatenar com `/`.
- Processos externos com `execFile` (sem shell), `timeout` e `windowsHide: true`.
- Diferenças conhecidas (estado da branch da run `2026-10-07-185405`):
  - badge: `app.dock.setBadge` no Mac; overlay `win.setOverlayIcon` no Windows, com PNG gerado em `badge.ts` e descrição acessível; `setBadgeCount` só no Linux;
  - chamada de atenção: `dock.bounce` no Mac; `flashFrame(true)` no Windows com a janela sem foco, desligado no `focus`;
  - barra de título: `hiddenInset` no Mac; `hidden` + `titleBarOverlay` no Windows (`window-frame.ts`), com UI nova perto do topo respeitando 32 px e ~138 px dos botões nativos; moldura padrão no Linux;
  - PID por porta (`lsof` × `netstat -ano`); checagem de processo (`ps` × CIM por PID com nome exato, caminho fora do Claude Desktop e horário de criação; sem PowerShell, `tasklist` com nome exato);
  - sinais: o Windows não tem SIGHUP e trata SIGTERM como `TerminateProcess` — exceção declarada do I-11 (ADR 0005);
  - CPU dos processos `claude`: no Windows, amostra CIM a cada `sampleEveryMs(cores)` (15–60 s), separando o Claude Desktop pelo caminho; PowerShell bloqueado → `null`;
  - abrir no terminal: Terminal (`.command`) no Mac; Windows Terminal (`wt.exe` sem shell) ou console próprio no Windows; indisponível no Linux;
  - comando copiado: `cd '…' && claude --resume` no Mac/Linux; `Set-Location -LiteralPath '…'; claude --resume` no Windows (PowerShell 5.1; não roda no CMD);
  - executável do Claude Code: no Windows só `claude.exe` (nunca `.cmd`/`.ps1`, que exigem shell);
  - PATH do shell de login: só macOS/Linux;
  - mensagens entre sessões do Claude Code: macOS, Linux e WSL 2 desde 2.1.224; Windows nativo desde 2.1.234 (named pipe).
- Scripts npm devem rodar em PowerShell, CMD e zsh: não usar `VAR=x cmd` em `package.json`; quando precisar de variável de ambiente, usar um script Node em `scripts/` (padrão de `scripts/demo.mjs`, ADR 0008). Dívida do `npm run demo` quitada.

## 7. Acessibilidade (base)

Hoje o código tem 0 atributos `aria-*`. Toda UI nova ou alterada segue WCAG 2.2 AA:
- nome e papel acessíveis (`aria-label`, `role`, `<button>` de verdade);
- foco visível e ordem lógica; tudo operável por teclado (atalhos documentados, `Esc` fecha);
- contraste ≥ 4,5:1 para texto e ≥ 3:1 para elementos gráficos de status;
- status nunca só por cor (ícone ou texto junto);
- alvo de clique ≥ 24×24 px;
- `prefers-reduced-motion` respeitado em animações de UI;
- conteúdo dinâmico importante anunciado (`aria-live="polite"` para toasts e chegada de cartões).

## 8. Performance (orçamento)

- 60 fps com a janela em foco e ~20 fps em segundo plano (loop de `main.ts`) com 10 agentes no demo.
- Sem alocação por frame no `update()`; geometria e materiais compartilhados (`unitBox`, `mat()`); `dispose()` do que sai de cena.
- Medir com `renderer.info.render.calls` e `.triangles` antes e depois de mudanças no mundo; registrar no Dev Agent Record.
- HUD: evitar re-render completo em eventos frequentes (como já feito com `renderSystem()` a cada 3 s).
- Main: monitores com intervalos atuais (sistema 3 s, limites 3 min) — não reduzir sem motivo.

## 9. Git

- Commits em pt-BR, verbo no presente, 3ª pessoa: "Adiciona…", "Corrige…", "Remove…" (padrão do histórico).
- Um commit por story e executor dentro da branch da run; mensagens citam a story (`S-n`) e, se houver, o ticket (`AO-n`).
- Nada de segredo, `.env`, `out/`, `dist/` ou `node_modules/` em commit (ver `.gitignore`).
- Push, PR, tag e release: só Diego Deploy, após o checkpoint 21.
