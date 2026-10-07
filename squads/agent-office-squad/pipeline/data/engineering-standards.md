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
| Demo sem tokens | `npm run demo` (zsh) · `$env:AGENT_OFFICE_DEMO=1; npm run dev` (PowerShell) |
| Tipos | `npm run typecheck` |
| Build sem empacotar | `npm run build` |
| Pacote Mac | `npm run dist:mac` (só em Mac; arm64; assinatura ad-hoc) |
| Pacote Windows | `npm run dist:win` (só em Windows; NSIS x64) |
| Ícone | `npm run icon` |

Helpers de desenvolvimento: `AGENT_OFFICE_SHOTS`, `AGENT_OFFICE_EVAL`, `AGENT_OFFICE_DATA_DIR`, `AGENT_OFFICE_SEED`, `AGENT_OFFICE_CLAUDE`, `AGENT_OFFICE_DEMO` (detalhes e sintaxe PowerShell em `run-conventions.md` §8).

## 4. Estado atual da qualidade (lacunas conhecidas)

| Item | Hoje | Alvo |
|---|---|---|
| Testes unitários | inexistentes | Vitest para main e shared (sem Electron), começando por `cleanDraft`, `hookDecision`, `permissionFromTool`, `sniff`/`buildMessage`, `describeTool`, `ticketBrief`, `lookFromSeed` |
| Testes de integração | inexistentes | `AgentManager` com SDK simulado (fixtures de `SDKMessage`), `Bridge` com requisições HTTP reais em porta aleatória |
| E2E | inexistente | Playwright para Electron com `AGENT_OFFICE_DEMO=1` e `AGENT_OFFICE_DATA_DIR` temporário |
| Regressão visual | manual | capturas `AGENT_OFFICE_SHOTS` comparadas por story |
| Lint/format | inexistentes | ESLint (typescript-eslint) + Prettier com regras que não briguem com o estilo atual |
| CI | inexistente | GitHub Actions: typecheck + build + testes em `macos-latest` e `windows-latest` |
| Cobertura | — | não diminuir depois que existir |

Até a story de infraestrutura de testes ser entregue, o quality gate aceita evidência manual/visual e marca a ausência de teste automatizado como CONCERNS (ver `quality-criteria.md`). Depois dela, lógica nova sem teste é FAIL.

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
- Diferenças conhecidas: badge (`app.dock.setBadge` no Mac; `setBadgeCount` não funciona no Windows → usar `win.setOverlayIcon`), barra de título (`hiddenInset` só no Mac), PID por porta (`lsof` × `netstat -ano`), checagem de processo (`ps` × `tasklist`), sinais (Windows não tem SIGHUP e trata SIGTERM como encerramento forçado), CPU dos processos `claude` (`null` no Windows), abrir no Terminal (só Mac), PATH do shell de login (só macOS/Linux), mensagens entre sessões do Claude Code (oficial só macOS/Linux).
- Scripts npm devem rodar em PowerShell e zsh: não usar `VAR=x cmd` em `package.json` (o `npm run demo` atual viola isso — dívida conhecida).

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
