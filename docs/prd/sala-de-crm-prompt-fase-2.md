Rode o S-1 comigo e depois faça a fase 2 da Sala de CRM do Agent Office (WhatsApp, CR-08 a CR-14).

**Antes de começar**

- A fase 1 está na branch `agent/linus-c743717a`. Confira se `src/main/crm/store.ts` existe na sua base. Se não existir, junte essa branch antes de tudo.
- Leia por inteiro:
  - `docs/prd/sala-de-crm.md` (spec);
  - `docs/prd/sala-de-crm-plano.md` (fases 0 e 2);
  - `docs/adr/0017-portao-de-envio.md`;
  - `spikes/crm/s1-evolution/README.md`;
  - `docs/adr/0014-guarda-de-acoes-sensiveis.md` (o molde de ADR).
- O Docker Desktop está rodando. Tenho um número de teste num celular separado, que não é o número da empresa.

**1. S-1 comigo**

- Você roda os passos do README. Eu leio o QR code e mando mensagens do outro celular. Pare em cada passo que precisa de mim e diga exatamente o que fazer.
- Regras:
  - Fale só com a Evolution local, em `127.0.0.1:8080`, e com nenhuma outra API de WhatsApp.
  - A chave global e a senha do Postgres saem do `openssl` direto para o `.env` (0600).
  - Nunca mostre chave, token ou QR em texto no chat ou no log. Salve o QR como PNG, abra com `open` e me diga o caminho.
  - Mande mensagens só para os números que eu der, no máximo 10 no spike todo. O Baileys não é a API oficial, e volume alto pode banir o número.
  - Antes de gravar em `respostas/`, troque telefones, nomes, textos e tokens por valores falsos, como o README manda.
- Saída:
  - `docs/adr/0015-evolution-api-sem-porta-aberta.md`, com as sete respostas e a escolha entre WebSocket e busca a cada 20 s. Se o WebSocket aceitar cliente sem chave, fica a busca.
  - Os fixtures de `test/mocks/evolution.ts`.
  - A versão da imagem fixada no compose (`EVOLUTION_TAG`).
- Deixe a Evolution rodando para os aceites da fase 2. Ao fim da sessão, rode `docker compose down`.

**2. Revisão do portão**

Antes do CR-11, mostre numa lista curta as 8 mudanças de spec do ADR 0017 e espere meu ok. Só então o ADR passa de "proposto" a "aceito".

**3. Fase 2**

1. Você é o coordenador. Se a fase 2 precisar de tipos, eventos ou métodos novos, ponha-os em `src/shared/types/crm.ts`, `ipc.ts` e `preload` você mesmo. Deixe o typecheck verde antes de abrir agentes.
2. Abra dois agentes em paralelo, cada um na sua worktree. Mande cada um juntar a sua branch antes de começar, porque as worktrees nascem do `origin/main`.
   - `crm-whatsapp`: CR-08, CR-09 e CR-10.
   - `crm-portao`: CR-11, CR-12 e CR-13. O corpus é `test/fixtures/crm-gate-cases.json` (167 casos), com 95% de cobertura.
   - Nenhum dos dois mexe em `crm.ts`, `ipc.ts` ou `preload`. Se precisarem, pedem a você.
3. Você faz o CR-14 e junta tudo. Corrija também um defeito da fase 1: os avisos do escritório (toasts) cobrem a tela do CRM.
4. Os aceites usam a Evolution local e o app em dev numa pasta de dados de teste (`AGENT_OFFICE_DATA_DIR`), nunca o meu escritório real:
   - CR-10: do zero ao ponto verde em menos de 2 minutos.
   - CR-14: conversar com o número de teste e enviar à mão. Depois eu mando "PARAR", e a próxima oferta é barrada também para mim.
   - O modo ensaio vem ligado. Só eu desligo, e só para o teste.
5. Depois do CR-14, abra um agente de revisão de segurança, só de leitura, sobre o diff da fase 2. O resultado precisa ter nenhum achado alto; os médios vão para o ADR 0017. Esse agente só apaga pastas que ele mesmo criou, com prefixo único.

**Regras de todo ticket**

- `npm run typecheck`, `npm run lint`, `npm test` e `npm run contrast` verdes.
- Lógica nova em funções puras de `src/shared`, com teste em `test/<modulo>.test.ts` (vitest, `describe`/`it` em pt-BR). Módulos novos entram na lista de cobertura do `vitest.config.ts`: 70% de linhas, e 95% para o portão.
- Todo argumento de IPC passa por `validate.ts`.
- Textos da UI em pt-BR; erro diz o que fazer. Visual próprio em `.crm-screen`. A tela do OpenBot é referência de função, não de aparência.
- Logs sem conteúdo de mensagem, sem token e com telefone mascarado.
- O token da instância fica no cofre (`safeStorage`) e nunca volta ao renderer.
- Nenhum teste fala com uma Evolution de verdade; `test/mocks/evolution.ts` responde no lugar.
- Todo envio passa por `Outbox.enqueue`. Um teste de arquitetura falha se outro arquivo chamar `EvolutionClient.send*`.
- Texto de cliente vai para a tela como texto (`h()`/`textContent`), nunca como HTML.
- Arquivos de dados 0600, pastas 0700.

**Fora desta sessão:** as fases 3 e 4. Nenhum bot responde cliente.

Não faça commit no main nem push. Ao terminar, relate:

- as respostas do S-1 e a escolha entre WebSocket e busca;
- o que ficou pronto por ticket;
- o resultado dos quatro comandos;
- os aceites feitos com o número de teste;
- o resultado da revisão de segurança;
- qualquer ponto do spec que precisou mudar, com o motivo.
