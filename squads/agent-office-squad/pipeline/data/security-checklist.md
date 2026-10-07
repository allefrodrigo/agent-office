# Checklist de Segurança — Agent Office

Usado pelo Artur Arquitetura (modelo de ameaças no step-09) e pela Sílvia Sandbox (security gate no step-18). Cada item cita o invariante relacionado (`architecture-map.md` §7).

## 1. Modelo de ameaças resumido

| Ativo | Ameaça principal | Fronteira |
|---|---|---|
| Máquina do usuário (arquivos, comandos) | agente executa ação não consentida | `canUseTool`, modos de permissão, cartões |
| Sessões do terminal | outro processo local ou página web finge ser hook e aprova/nega ações | ponte HTTP 127.0.0.1 + token |
| `~/.claude/settings.json` | corromper ou apagar a configuração do usuário | `Bridge.writeHooks` |
| Renderer | XSS via saída de agente, ticket ou anexo → acesso à API `window.office` | sandbox, CSP, DOMPurify, validação no main |
| Tickets e comentários | injeção de prompt: texto escrito por outro agente/pessoa vira instrução | `ticketBrief`, regra sem bypass |
| Token da ponte | vazamento permite controlar decisões | arquivo 0600, comparação em tempo constante |
| Cadeia de suprimentos | dependência maliciosa ou comprometida | lockfile, dependências mínimas, revisão |
| Privacidade | logs/relatórios com segredos; telemetria sem consentimento | política sem telemetria, cuidado com logs |

## 2. Electron e renderer

- [ ] `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` mantidos (I-05).
- [ ] CSP sem `unsafe-inline` para scripts e sem `unsafe-eval`; `connect-src` mínimo (I-05).
- [ ] `setWindowOpenHandler` nega tudo e `will-navigate` é bloqueado (I-05).
- [ ] `openExternal` só aceita `http(s)`; `revealPath` só caminho existente (I-05).
- [ ] Nenhum `innerHTML`/`outerHTML`/`insertAdjacentHTML` com dado externo; Markdown só via `renderMarkdown` (I-06).
- [ ] Preload expõe só a `OfficeAPI` necessária; nenhuma função genérica (`invoke(canal, ...)`) exposta.
- [ ] Nenhum `webSecurity: false`, `allowRunningInsecureContent`, `experimentalFeatures` ou `webviewTag`.

## 3. IPC e main

- [ ] Todo handler `office:*` valida tipos, tamanhos e valores permitidos (I-14).
- [ ] Caminhos recebidos são verificados (existência, é pasta/arquivo) antes de uso.
- [ ] IDs de sessão validados como UUID antes de virar argumento de processo ou nome de arquivo (`isSessionId`).
- [ ] Processos externos com `execFile` (sem shell) e argumentos em lista; nada de interpolação em comando.
- [ ] Arquivos temporários com permissões restritas (ex.: `.command` com 0700 em `openInTerminal`).

## 4. Ponte do terminal (HTTP local)

- [ ] Escuta só em `127.0.0.1` (I-03).
- [ ] Exige `X-Agent-Office-Token` comparado com `timingSafeEqual` (I-03).
- [ ] Recusa requisição com cabeçalho `Origin` (bloqueia páginas web) (I-03).
- [ ] Limite de corpo de 2 MB e JSON inválido → 400 (I-03).
- [ ] `PermissionRequest` com timeout de 600 s e cancelamento quando o terminal desliga (I-03).
- [ ] Sessões do escritório ignoradas (I-07).
- [ ] Token gerado com `randomBytes`, salvo com 0600, nunca registrado em log.
- [ ] `settings.json`: JSON ilegível nunca é sobrescrito; backup antes; escrita atômica; desinstalação remove só o que tem o marcador (I-04).

## 5. Agentes, permissões e injeção de prompt

- [ ] Só `mcp__office__*` é auto-permitido (I-08). Qualquer nova auto-permissão exige ADR e aprovação explícita do usuário.
- [ ] Tickets nunca rodam em `bypassPermissions`, nem ao delegar, nem ao contratar para ticket (I-02).
- [ ] Ferramentas de agente não movem para `done` (I-01) e não apagam tickets.
- [ ] Texto vindo de ticket, comentário, anexo, nome de sessão, saída de hook ou transcrição é tratado como **dado**: nunca vira comando, caminho executável, flag de permissão ou HTML.
- [ ] Campos repassados ao renderer têm limite de tamanho (ex.: `agent:chat` corta em 140 caracteres; balões e atividades com `clip`).
- [ ] O `systemPrompt` anexado não dá autoridade extra ao agente além do que o usuário configurou.
- [ ] "Sempre permitir" grava só as `suggestions` que o próprio SDK/Claude Code propôs (sem ampliar escopo).
- [ ] Anexos: tipo por bytes, limites, formato desconhecido como caminho (I-09); nomes sanitizados (sem `"`, `<`, `>`).

## 6. Custo e consentimento

- [ ] Nada gasta tokens sem ação do usuário (I-13); leituras de limites continuam gratuitas (I-12).
- [ ] Novos loops automáticos (polling, re-tentativas, agentes autônomos) declaram limite e podem ser interrompidos.

## 7. Cadeia de suprimentos e build

- [ ] Dependência nova justificada no ADR, com versão fixada no lockfile e licença compatível com MIT.
- [ ] `npm audit --omit=dev` sem vulnerabilidade alta/crítica nova (quando houver rede).
- [ ] Scripts `postinstall` de dependências novas revisados.
- [ ] O pacote não embute o binário do Claude Code (`electron-builder.yml` exclui `claude-agent-sdk-*`).
- [ ] Assinatura: Mac hoje ad-hoc (só uso local); distribuição exige Developer ID + notarização + hardened runtime com entitlements mínimos; Windows exige certificado de assinatura de código. Releases sem isso são marcados como "não assinados" nas notas.

## 8. Segredos e privacidade

- [ ] Nenhum token, chave, cookie ou caminho pessoal sensível em commit, log, relatório da run ou PR.
- [ ] Logs de agente persistidos (150 últimos) não guardam conteúdo de anexos (só nome/tipo/tamanho).
- [ ] Telemetria só com opt-in explícito, documentada, desligável e sem conteúdo de código/prompt.

## 9. Escala de severidade (CVSS-lite)

| Severidade | Critério | Efeito no gate |
|---|---|---|
| Crítica | execução de comando/arquivo sem consentimento, exploração remota, vazamento do token da ponte, perda de dados do usuário | BLOCK |
| Alta | quebra de invariante de segurança (I-02…I-09, I-14), XSS no renderer, bypass de permissão local | BLOCK |
| Média | exposição limitada com contorno, validação ausente sem exploração demonstrada, dependência com CVE média | CONDITIONS (mitigação registrada no PR) |
| Baixa | endurecimento recomendado, higiene | CLEAR com recomendação |

Todo achado registra: id `SEC-n`, severidade, `arquivo:linha`, cenário de ataque ou prova, correção proposta, invariante relacionado e status.
