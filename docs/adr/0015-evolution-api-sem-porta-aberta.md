# 0015 — Evolution API sem porta aberta

- **Status:** proposto (2026-11-17). Respostas 3, 4 e 7 do S-1 medidas; 1, 2, 5 e 6 esperam o número de teste.
- **Origem:** spike S-1 do [plano da Sala de CRM](../prd/sala-de-crm-plano.md); passo a passo em [`spikes/crm/s1-evolution/README.md`](../../spikes/crm/s1-evolution/README.md).
- **Servidor medido:** Evolution API **2.3.7** (`evoapicloud/evolution-api:v2.3.7`, WhatsApp Web 2.3000.1055059001), Baileys, Postgres 15, no Colima (macOS, Apple Silicon). O código lido para confirmar o comportamento veio do source map da própria imagem (`/evolution/dist/main.js.map`).

## Contexto

O CRM fala com uma Evolution que roda nesta máquina, em Docker. O spec pede: nenhuma porta de entrada no app, porta da Evolution só local, o token da instância (nunca a chave global) no cofre e nunca no renderer. Faltava saber como os eventos chegam ao app, se o WebSocket da Evolution exige chave e até onde o token de uma instância alcança.

## Respostas

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Corpo de `sendText` e de `sendMedia` | _espera o número de teste_ |
| 2 | Forma de `MESSAGES_UPSERT` e estados de `MESSAGES_UPDATE` | _espera o número de teste_. Já visto: todo evento chega como `42/<instância>,["<evento>",{event, instance, data, server_url, date_time, sender, apikey}]`; `connection.update` traz `data.state` (`close`, `connecting`, `open`) e `data.statusReason`; `qrcode.updated` traz `data.qrcode.{code, base64, pairingCode}`. |
| 3 | O WebSocket exige chave? | **Exige.** Sem chave: `403 {"code":4,"message":"apiKey is required"}`; chave errada: `403 "Invalid global token"`. Aceita o token da instância no cabeçalho `apikey` (ou na query `apikey=`). Duas brechas, fechadas no compose: (a) quem chega de um endereço de `WEBSOCKET_ALLOWED_HOSTS` (padrão `127.0.0.1,::1`, visto de dentro do contêiner) entra sem chave; (b) o token de **qualquer** instância entra no canal de **qualquer** outra (`40/outra,{sid}` com o token da primeira), e cada evento leva o token da própria instância no campo `apikey`. Ou seja: com o padrão, o token de A lê o QR, as mensagens e o token de B. |
| 4 | Alcance do token da instância | **Só a própria instância, na API HTTP.** Com o token de A, em B: `connectionState`, `logout`, `delete`, `websocket/set`, `sendText` e `findMessages` dão `401`. `instance/create` dá `401`. `fetchInstances` responde `200`, mas só com A. Na própria instância o token faz todas as chamadas da tabela do spec, e também `webhook/set` e `settings/set` (o dono do token pode mandar as mensagens para fora: guardar o token no cofre importa). |
| 5 | `findMessages` com o app fechado; filtro por data | _espera o número de teste_. Já visto: `POST /chat/findMessages/{inst}` com `{"where":{},"page":1,"offset":1}` responde `{"messages":{"total","pages","currentPage","records":[]}}` (pagina por `page`/`offset`, não `take`/`skip`). |
| 6 | Unidade de `delay`; número sem WhatsApp | _espera o número de teste_ |
| 7 | Porta só local | **Some da rede.** Com `127.0.0.1:8080:8080`, `http://127.0.0.1:8080/` responde e `http://192.168.0.112:8080/` recusa (curl, saída 7). No Colima o encaminhamento é um `ssh` que escuta só em `127.0.0.1:8080`. Com `8080:8080` (sem o IP) o Colima escuta em `*:8080`: a porta fica aberta para a rede, como os contêineres de outros projetos nesta máquina mostraram. |

Outros achados:

- **Token da instância:** um UUID (36 caracteres), no campo `hash` da resposta de `instance/create`.
- **Reconhecer a chave global sem criar nada:** `POST /instance/create` com `{"instanceName":"<qualquer>","integration":"NAO-EXISTE"}` responde `401` ao token de uma instância e `400 "Invalid integration"` à chave global. O CR-08 usa esta sonda para recusar a chave global colada no lugar do token.
- **A instância nova nasce com `groupsIgnore: false`, `readMessages: false`, `syncFullHistory: false`.**

## Decisão

1. **Eventos pelo WebSocket de saída, com a busca a cada 20 s como reserva.** O WebSocket exige chave, então a regra do plano ("sem autenticação, só busca") não se aplica. O app abre `ws://127.0.0.1:8080/socket.io/?EIO=4&transport=websocket` (ou `wss://` num servidor remoto) com o token **no cabeçalho** `apikey`, nunca na URL, e entra só no canal `/<instância>`. Caiu: reconecta de 1 s a 60 s e, enquanto isso, busca com `findMessages` a cada 20 s. Ao abrir e ao reconectar, busca o que chegou desde a última mensagem vista.
2. **O compose do guia fecha as duas brechas da resposta 3:**
   - `WEBSOCKET_ALLOWED_HOSTS: nenhum` — nenhum endereço entra sem chave;
   - `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "false"` — o evento sai com `"apikey": null` (medido);
   - **uma instância por servidor.** O token de uma instância ainda entra no canal de outra; com uma só, não há outra.
3. **A porta fica em `127.0.0.1:8080:8080`.** O CR-10 confere a mesma API pelos IPs da rede local e avisa, com a linha a trocar, quando ela responde.
4. **Nunca `network_mode: host` nem a Evolution instalada fora do Docker:** nesses casos o app e qualquer programa desta máquina chegam ao WebSocket como `127.0.0.1`.
5. **Versão fixa:** `EVOLUTION_TAG=v2.3.7` no `.env`. Trocar de versão pede refazer este spike.

## Consequências

- A tela de conexão mostra se os eventos vêm pelo WebSocket ou pela busca (`CrmConnection.via`).
- Um servidor remoto com várias instâncias de outras pessoas não é um cenário seguro para o CRM: quem tem o token de qualquer instância lê as mensagens de todas. O guia diz isso.
- O CR-30 (webhook local) continua fora: o WebSocket de saída resolve sem porta de entrada.
