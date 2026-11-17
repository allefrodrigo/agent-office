# S-1 · Evolution de verdade

Sobe uma Evolution API v2 só nesta máquina, liga um número de teste e responde as sete perguntas do S-1 ([plano](../../../docs/prd/sala-de-crm-plano.md)). As respostas viram o ADR 0015 e os fixtures de `test/mocks/evolution.ts` (CR-08).

Leva uns 40 minutos. Precisa de:

- Docker Desktop rodando.
- Um número de teste: um chip só para isso, num celular com WhatsApp. **Não use o número do negócio**: a Evolution usa o protocolo do WhatsApp Web (Baileys) e o WhatsApp pode bloquear o número.
- Um segundo WhatsApp (o seu pessoal serve) para mandar e receber as mensagens de teste.
- `curl`, `jq` e `openssl` (o macOS já tem `curl` e `openssl`; `brew install jq`).

Mande poucas mensagens, só as dos testes abaixo.

## 1. Criar o `.env`

Na pasta `spikes/crm/s1-evolution/`, crie o arquivo `.env` (o `.gitignore` do repositório já o deixa de fora):

```sh
cd spikes/crm/s1-evolution
cat > .env <<EOF
AUTHENTICATION_API_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
WEBSOCKET_ENABLED=false
EOF
chmod 600 .env
```

A chave global abre todas as instâncias. Ela fica só neste arquivo e nunca vai para o app.

## 2. Subir

```sh
docker compose up -d
docker compose logs -f evolution-api
```

Espere a linha que diz que o HTTP subiu na porta 8080 e saia do log com Ctrl+C.

## 3. Conferir a porta e fixar a versão (pergunta 7)

```sh
curl -s http://127.0.0.1:8080/ | jq .
curl -s --max-time 3 "http://$(ipconfig getifaddr en0):8080/" ; echo "saída: $?"
```

- O primeiro responde com a versão da Evolution. Anote e fixe no `.env` (`EVOLUTION_TAG=v<versão>`), depois rode `docker compose up -d` de novo.
- O segundo, pelo IP da rede local, **precisa falhar** (saída diferente de 0). Se responder, a porta está aberta para a rede: pare aqui e confira a linha `ports` do compose.
- Sem Wi-Fi, troque `en0` pela interface da rede cabeada (`ipconfig getifaddr en1`).

## 4. Criar a instância e guardar o token dela

Carregue as variáveis do `.env` no terminal (os valores não entram no histórico do shell):

```sh
set -a; source .env; set +a
export EVO=http://127.0.0.1:8080 INST=agent-office-teste
```

Crie a instância com a chave global:

```sh
curl -s -X POST "$EVO/instance/create" \
  -H "apikey: $AUTHENTICATION_API_KEY" -H 'Content-Type: application/json' \
  -d "{\"instanceName\":\"$INST\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":false}" \
  | tee /tmp/evo-create.json | jq 'del(.hash)'
export INST_TOKEN=$(jq -r '.hash' /tmp/evo-create.json); rm /tmp/evo-create.json
```

O campo `hash` é o token da instância (a documentação não diz isso com todas as letras: confirme no passo 5, porque as chamadas com ele precisam funcionar). Guarde o token no seu gerenciador de senhas. É ele, e não a chave global, que o app vai pedir.

## 5. Conectar o número de teste

```sh
curl -s "$EVO/instance/connect/$INST" -H "apikey: $INST_TOKEN" \
  | jq -r '.base64' | sed 's/^data:image\/png;base64,//' | base64 -d > /tmp/qr.png && open /tmp/qr.png
```

No celular de teste: WhatsApp → Aparelhos conectados → Conectar um aparelho → leia o QR code. O código vence em segundos; se vencer, rode o comando de novo. Depois apague a imagem (`rm /tmp/qr.png`) e confira:

```sh
curl -s "$EVO/instance/connectionState/$INST" -H "apikey: $INST_TOKEN" | jq .
```

O estado precisa ser `open`.

## 6. As perguntas

Em todos os testes, troque `55DDDNUMERO` pelo seu WhatsApp pessoal (só dígitos, com 55 e DDD).

### 1 · O corpo de `sendText` e de `sendMedia`

```sh
# formato da v2 nos exemplos
curl -s -X POST "$EVO/message/sendText/$INST" -H "apikey: $INST_TOKEN" -H 'Content-Type: application/json' \
  -d '{"number":"55DDDNUMERO","text":"Teste 1 do S-1"}' | jq .
# formato do OpenAPI
curl -s -X POST "$EVO/message/sendText/$INST" -H "apikey: $INST_TOKEN" -H 'Content-Type: application/json' \
  -d '{"number":"55DDDNUMERO","textMessage":{"text":"Teste 2 do S-1"}}' | jq .
```

Anote qual chegou no seu celular e o que cada um respondeu. Para o PDF, use um arquivo de teste sem dado pessoal:

```sh
B64=$(base64 -i teste.pdf | tr -d '\n')
curl -s -X POST "$EVO/message/sendMedia/$INST" -H "apikey: $INST_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"number\":\"55DDDNUMERO\",\"mediatype\":\"document\",\"mimetype\":\"application/pdf\",\"fileName\":\"teste.pdf\",\"media\":\"$B64\"}" | jq 'del(.message)'
```

### 2 e 3 · Os eventos e a autenticação do WebSocket

Ligue o WebSocket **só durante este teste**: troque para `WEBSOCKET_ENABLED=true` no `.env` e rode `docker compose up -d`. Ative os eventos da instância:

```sh
curl -s -X POST "$EVO/websocket/set/$INST" -H "apikey: $INST_TOKEN" -H 'Content-Type: application/json' \
  -d '{"websocket":{"enabled":true,"events":["MESSAGES_UPSERT","MESSAGES_UPDATE","SEND_MESSAGE","CONNECTION_UPDATE","QRCODE_UPDATED"]}}' | jq .
```

Abra um cliente **sem nenhuma chave** (Node 22 já tem `WebSocket`; o código fala o protocolo do socket.io à mão):

```sh
node -e '
const ns = "/" + process.env.INST
const ws = new WebSocket("ws://127.0.0.1:8080/socket.io/?EIO=4&transport=websocket")
ws.onmessage = (e) => {
  const m = String(e.data)
  if (m.startsWith("0")) ws.send("40" + ns + ",")   // abriu: entra no namespace da instância, sem apikey
  else if (m === "2") ws.send("3")                  // ping → pong
  else console.log(new Date().toISOString(), m.slice(0, 4000))
}
ws.onclose = (e) => console.log("fechou", e.code, e.reason)
'
```

Com ele aberto, mande uma mensagem do seu celular para o número de teste, responda pelo celular de teste e mande um `sendText` pelo `curl`.

- **Pergunta 3:** se aparecer `40/agent-office-teste,{"sid":…}` e depois linhas `42/…["messages.upsert",…]`, o WebSocket **não exige apikey**: qualquer programa desta máquina lê as mensagens. Se o servidor recusar (`44/…` ou a conexão fecha), repita passando a chave na conexão (`ws.send("40" + ns + "," + JSON.stringify({ apikey: process.env.INST_TOKEN }))`) e anote se passa a receber.
- **Pergunta 2:** copie um exemplo de cada evento (`messages.upsert` recebida, `messages.upsert` com `fromMe`, `messages.update` com cada estado, `send.message`, `connection.update`). Anote onde ficam o remetente, `fromMe`, o id, o texto e a hora.

Feche com Ctrl+C, volte para `WEBSOCKET_ENABLED=false` e rode `docker compose up -d`.

### 4 · O alcance do token da instância

Crie uma segunda instância com a chave global (sem conectar número) e tente alcançá-la com o token da primeira:

```sh
curl -s -X POST "$EVO/instance/create" -H "apikey: $AUTHENTICATION_API_KEY" -H 'Content-Type: application/json' \
  -d '{"instanceName":"outra","integration":"WHATSAPP-BAILEYS","qrcode":false}' | jq 'del(.hash)'
curl -s -o /dev/null -w '%{http_code}\n' "$EVO/instance/connectionState/outra" -H "apikey: $INST_TOKEN"
curl -s -o /dev/null -w '%{http_code}\n' "$EVO/instance/fetchInstances" -H "apikey: $INST_TOKEN"
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$EVO/instance/create" -H "apikey: $INST_TOKEN" -H 'Content-Type: application/json' \
  -d '{"instanceName":"criada-pelo-token","integration":"WHATSAPP-BAILEYS","qrcode":false}'
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$EVO/instance/delete/outra" -H "apikey: $INST_TOKEN"
```

Anote o código de cada um. O esperado é recusa (401, 403 ou 404) nas quatro. Confirme também que o token da instância faz todas as chamadas da tabela do spec ("Evolution API"). No fim, apague a `outra` (e a `criada-pelo-token`, se existir) com a chave global.

### 5 · `findMessages` e o que chegou com o app fechado

Mande duas mensagens do seu celular para o número de teste. Depois:

```sh
curl -s -X POST "$EVO/chat/findMessages/$INST" -H "apikey: $INST_TOKEN" -H 'Content-Type: application/json' \
  -d '{"where":{"key":{"remoteJid":"55DDDNUMERO@s.whatsapp.net"}},"offset":10,"page":1}' | jq .
```

Anote se as duas aparecem, em que ordem, e como paginar (`offset`/`page`, ou `take`/`skip` como o spec supõe). Teste um filtro por data (por exemplo `"messageTimestamp":{"gte":<segundos>}` dentro de `where`) e anote o que funciona: é ele que o app vai usar para "desde a última vista".

### 6 · A unidade de `delay` e o número sem WhatsApp

```sh
time curl -s -X POST "$EVO/message/sendText/$INST" -H "apikey: $INST_TOKEN" -H 'Content-Type: application/json' \
  -d '{"number":"55DDDNUMERO","text":"Teste de delay","delay":3000}' > /dev/null
curl -s -X POST "$EVO/chat/whatsappNumbers/$INST" -H "apikey: $INST_TOKEN" -H 'Content-Type: application/json' \
  -d '{"numbers":["5511900000000"]}' | jq .
curl -s -w '\n%{http_code}\n' -X POST "$EVO/message/sendText/$INST" -H "apikey: $INST_TOKEN" -H 'Content-Type: application/json' \
  -d '{"number":"5511900000000","text":"não deve chegar"}'
```

Se o primeiro levar uns 3 s, `delay` é em milissegundos. Anote a resposta de `whatsappNumbers` e o código e o corpo do envio para um número que não tem WhatsApp.

### 7 · A porta só local

Já respondida no passo 3. Anote também se a API continua respondendo em `127.0.0.1` depois de reiniciar o Docker.

## 7. Guardar as respostas sem dados pessoais

Grave um exemplo de cada resposta e de cada evento em `spikes/crm/s1-evolution/respostas/<nome>.json`. Antes de salvar, troque:

- telefones e `remoteJid` por `5511900000001` e `5511900000002`;
- nomes de perfil por `Cliente Teste`;
- textos por `texto de teste`;
- `hash`, tokens, chaves, `base64` e `jpegThumbnail` por `"<removido>"`.

Mantenha os ids, os tipos e a forma: são eles que os fixtures do CR-08 precisam. Confira com `grep -rE '55[0-9]{10,11}' respostas/` antes de fazer commit.

## 8. Desligar

```sh
curl -s -X DELETE "$EVO/instance/logout/$INST" -H "apikey: $INST_TOKEN" | jq .
docker compose down          # para tudo e mantém a sessão no volume
docker compose down -v       # para tudo e apaga a sessão e o banco
unset AUTHENTICATION_API_KEY POSTGRES_PASSWORD INST_TOKEN
```

No celular de teste, confira em Aparelhos conectados que a sessão saiu.

## O que levar de volta

Com as respostas do passo 6 e os arquivos de `respostas/`, a próxima sessão escreve o `docs/adr/0015-evolution-api-sem-porta-aberta.md` e escolhe entre WebSocket e busca periódica a cada 20 s. Se a pergunta 3 mostrar que o WebSocket não exige chave, a v1 fica com a busca periódica e o `WEBSOCKET_ENABLED=false` deste compose vira regra do guia.
