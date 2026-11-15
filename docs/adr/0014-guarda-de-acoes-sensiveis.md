# 0014 — Guarda de ações sensíveis dos bots

- **Status:** aceito (2026-11-15)
- **Origem:** plano do Chat dos bots, CB-03 (spec `docs/prd/chat-de-bots.md`, "Segurança")

## Contexto

Um bot roda sozinho: por mensagem, por "Rodar agora" e, na fase 2, por horário ou evento. Ele pode estar em "Aceitar edições" ou "Automático". Enviar, publicar, apagar, pagar ou mexer no git remoto não pode acontecer sem o sim do jogador, qualquer que seja o modo.

## Decisão

O guarda é defesa em profundidade, por cima do modo de permissão. Não é a única barreira.

1. **Primeira linha: o modo de permissão.** Bot novo nasce em "Pedir permissão". Nunca roda em "Sem pedir nada": a validação recusa, o store converte ao carregar, o gerente converte de novo ao rodar e ao configurar, e o CLI do bot sempre recebe `allowDangerouslySkipPermissions: false`. No modo "Automático" do Claude Code, o classificador do próprio CLI também roda.
2. **Segunda linha: o guarda.** `sensitiveKinds(tool, input)` (`src/shared/bots-guard.ts`) é uma função pura com um parser que **falha fechado**: o que ele não entende por inteiro devolve todos os tipos (pede), e o cartão diz "Conferir: … (o guarda não conseguiu ler o que isto faz)". Só passa o que ele entende como inofensivo. Exemplos do que pede tudo:
   - comando, subcomando ou opção que vem de uma expansão (`$X`, `$(…)`, `` `…` ``, `{a,b}`, `eval "$X"`, `sh -c "$X"`, `xargs git`, `curl … | bash`);
   - `git -c` fora de uma lista segura, `--config-env`, alias desconhecido, `git config` que grava alias ou comando, `--upload-pack` e afins (também abreviados), `ext::`;
   - `npm` com comando fora da lista (o npm aceita abreviações: `npm pu` publica);
   - opção longa de `curl`, `wget`, `httpie` ou `Invoke-WebRequest` que ele não reconhece por inteiro (eles aceitam prefixos: `--post-d`), proxy, `--resolve`, arquivo de configuração;
   - PowerShell não é lido: toda chamada da ferramenta PowerShell e toda linha com `pwsh` ou `powershell` (`-Command`, `-EncodedCommand`, `-File`, script, entrada padrão) pede tudo, sem exceção. Texto de shell ou de MCP com cara de PowerShell também: um cmdlet (`Remove-Item`, `Invoke-WebRequest`, `Send-MailMessage`; em minúsculas, quando o substantivo é conhecido), `iex`, `iwr`, `irm`, `saps`;
   - comando com CR solto ou quebra de linha Unicode (U+0085, U+2028, U+2029): o shell e o guarda poderiam ver comandos diferentes. CRLF conta como uma quebra comum;
   - MCP: executor (`execute`, `run`, `eval`, `shell`…); ferramenta de consulta (pelo nome ou por um argumento chamado `sql`, `query`, `statement` ou `execute`) com algum texto que não é uma leitura simples nem claramente outra coisa (identificador que não é verbo SQL, número, data). `vacuum`, `commit` ou `checkpoint` sozinhos são instruções, então pedem. Leitura simples: começa com `SELECT`, `WITH`, `EXPLAIN`, `SHOW` ou `DESCRIBE`, sem comentário, sem segunda instrução, sem verbo de escrita; ou um `PRAGMA` de leitura. Os de tabela e índice (`table_info`, `index_list`, `foreign_key_list`…) aceitam um identificador; os de ajuste (`journal_mode`, `user_version`, `page_size`…) só passam sem argumento, porque com argumento eles gravam. Também pede a entrada que não foi lida até o fim (mais de 100 textos, mais de 8 níveis, texto com mais de 20.000 caracteres).
   - "localhost" só vale para `localhost`, `::1` e `127.x.x.x` escrito por extenso. `127.evil.com`, `*.localhost`, `0.0.0.0`, userinfo e fragmento não enganam.

O guarda entra de dois jeitos:

- **Hook `PreToolUse`** (`src/main/bots/guard.ts`, `guardHook`): responde `permissionDecision: 'ask'` com o motivo ("Publicar: npm publish"). Soma-se ao hook do squad.
- **`askPlayer`**: reconhece o pedido sensível, marca `canAlwaysAllow: false` (sem "Sempre permitir") e não aplica as sugestões de regra.

As conexões do bot (`apps`) seguem a mesma regra: o hook `appsHook` nega `mcp__<servidor>__*` fora da lista e as ferramentas embutidas de recursos (`ListMcpResourcesTool`, `ReadMcpResourceTool`…) quando o servidor que elas nomeiam não está na lista ou não dá para saber qual é. As ferramentas do `office` do próprio app passam sempre, pela procedência (`source: 'sdk'`). Recurso nomeando `office` não passa: o servidor do app só tem ferramentas, então esse é outro servidor com o mesmo nome.

## O que foi verificado

Sem login no Claude aqui, a verificação foi estática:

- `sdk.d.ts` (Agent SDK 0.3.292): `PreToolUse` aceita `permissionDecision: 'ask'`; a documentação diz que "ask" leva a decisão ao fluxo normal de permissão. `McpServerProvenance.source` vale `sdk` para servidores do próprio app e deve ser tratado como desconhecido em qualquer outro valor.
- Bundle do CLI 2.1.325: o "ask" do hook passa pelas regras e chega ao `canUseTool` em qualquer modo, `auto` incluído; uma regra de negar vence o "ask"; com `hookAskFloor`, um "allow" do classificador do modo automático volta a ser "ask".

## Plano B

Se uma versão do CLI deixar de levar o "ask" ao `canUseTool`, `AGENT_OFFICE_BOT_GUARD=fallback` liga o plano B: o CLI do bot roda em "Pedir permissão" e o `askPlayer` libera sozinho o que o modo do bot liberaria, desde que não seja sensível. Perguntas e planos sempre chegam ao jogador.

## Limites conhecidos

- O guarda lê o comando, não o que ele executa. Script (`./deploy.sh`, `npm run x`, `make`), código de interpretador (`python -c`, `node -e`) e binário próprio podem enviar ou apagar sem que o texto diga. A primeira linha (o modo) cobre esses casos.
- Arquivos de configuração escritos antes por outra ferramenta (`.git/config` com alias, `~/.curlrc` com proxy) mudam o que um comando inofensivo faz.
- Um servidor MCP com nome inocente e efeito colateral (`mcp__x__sync`) só pede quando o que ele carrega parece um comando.
- O guarda pede mais do que precisa: `git push --dry-run`, `$EDITOR arquivo`, SQL com `;` dentro de um texto, busca com `query` em texto livre, todo comando PowerShell, mensagem de commit que cita `powershell` ou um cmdlet. Um falso positivo custa um clique.
- A cara de PowerShell é uma heurística. Um cmdlet em minúsculas com substantivo fora da lista (`out-file`) ou um script `.ps1` chamado por outro nome passam pelo texto; quem os roda é um host PowerShell, que pede.
- Pedido que o guarda não leu chega com o tipo `pay` no campo `sensitive` (o primeiro da ordem); o motivo do cartão diz "Conferir".

## Congelado nesta fase

Depois de quatro rodadas de revisão, o guarda fica congelado na fase 1. Achado novo de severidade alta é corrigido; médio ou baixo entra nos limites acima e no CB-29 ("Endurecer o guarda") do plano.

## Consequências

- Todo pedido sensível chega ao fio do bot como item `approval` e ao escritório como cartão, sem "Sempre permitir".
- Mudar um tipo em "Pedir antes de" no perfil vale na próxima chamada: o hook lê a lista a cada vez.
- O corpus de testes (`test/bots-guard.test.ts`) tem um bloco para cada brecha achada nas revisões.
