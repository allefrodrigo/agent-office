# 0012 — Transcrição da reunião pelo whisper-server local, com token no caminho

- **Status:** aceito (2026-11-07)
- **Data:** 2026-11-07
- **Origem:** spike S-2 do [plano da sala de reunião](../prd/sala-de-reuniao-plano.md) (fase 0)

## Contexto

A sala de reunião transcreve trechos de até 25 s enquanto a reunião acontece. O `whisper-server` (whisper.cpp) carrega o modelo uma vez e atende por HTTP. Ele não tem autenticação: qualquer processo local, ou uma página aberta no navegador, pode chamá-lo. O `/load` troca o modelo a partir de um caminho no disco.

O spike mediu, no whisper.cpp 1.9.4 do Homebrew, macOS 27.0.1, Apple M5, com o servidor em `127.0.0.1`, porta livre e `--request-path /<64 hex de randomBytes(32)>`:

| Pergunta | Resposta |
|---|---|
| `/inference` sem token | 404 |
| `/load` sem token | 404 |
| Token errado, parcial, com sufixo ou com `../` | 404 |
| `/inference` e `/load` com token | 200 (o `/load` com token troca o modelo) |
| `GET /` sem token | 404; com token, 200 (a página HTML de exemplo do servidor) |
| Cabeçalhos CORS | **sim**: `Access-Control-Allow-Origin: *` e `Access-Control-Allow-Headers: content-type, authorization` em toda resposta, inclusive no `OPTIONS` e no 404 |
| `/load` com token e um arquivo que não é modelo (`/etc/passwd`) | **o processo cai** |

Latência de 50 trechos de 20 s (voz sintética pt-BR), `verbose_json`, `temperature=0`, `-l pt -nth 0.6 -sns`:

| Modelo | Subida | p50 | p95 | máx. | Memória (RSS ocioso / pico; footprint) |
|---|---|---|---|---|---|
| `ggml-small.bin` | 0,22 s | 681 ms | 818 ms | 1001 ms | 710 / 782 MB; 772 MB |
| `ggml-base.bin` | 0,23 s | 276 ms | 578 ms | 964 ms | 309 / 362 MB; 349 MB |
| `whisper-cli` por trecho, `small` (10 trechos) | — | 889 ms | — | 972 ms | sobe e desce a cada trecho |
| `whisper-cli` por trecho, `base` (10 trechos) | — | 474 ms | — | 631 ms | idem |

Outros agentes usavam a máquina durante a medida; os números são um teto, não a melhor marca.

## Decisão

Usar o `whisper-server`, um processo por reunião, com o `small` por padrão:

```
whisper-server -m <modelo> --host 127.0.0.1 --port <livre>
               --request-path /<token> -l pt -nth 0.6 -sns
```

O token protege `/inference` e `/load`, que era a condição da spec. Regras obrigatórias no RN-03:

1. `--host 127.0.0.1` sempre, porta livre escolhida pelo app, token de 32 bytes de `crypto.randomBytes` novo a cada reunião.
2. Nunca `--convert`. O app manda WAV 16 kHz que ele mesmo montou.
3. O app nunca chama `/load`. Trocar de modelo é encerrar e subir outro processo.
4. O token não vai para logs, relatórios nem mensagens de erro. A URL completa é uma credencial.
5. Supervisão: se o processo morrer, o app sobe outro com token novo; na segunda queda, cai para o `whisper-cli` por trecho.
6. SIGTERM ao fim da reunião e ao sair do app (`quit.ts`).

## Alternativas consideradas

- **`whisper-cli` por trecho, sem servidor.** Nada escuta em porta nenhuma. Custa ~200 ms a mais por trecho no M5 (o modelo fica no cache do sistema). Fica como fallback; seria a escolha se o token não protegesse o `/load`.
- **Servidor sem token, só porta aleatória.** Uma página no navegador varre as portas locais em segundos. Descartado.
- **Proxy próprio na frente do servidor.** Complexidade sem ganho sobre o token no caminho.

## Consequências

- Atraso de transcrição muito abaixo da meta da spec (p95 ≤ 20 s): o gargalo passa a ser o segmentador (trecho de 4 a 25 s), não o whisper.
- > **WARNING (segurança):** por causa do `Access-Control-Allow-Origin: *`, uma página que descubra a URL com o token lê a transcrição e pode chamar o `/load`. O token é a única barreira. Por isso as regras 1 e 4 não têm exceção, e o processo morre com a reunião.
- Quem tem o token derruba o servidor com um `/load` inválido. Como só o app tem o token, isso é robustez, não ataque; a regra 5 cobre.
- O `small` ocupa ~780 MB enquanto a reunião dura. Máquinas com 8 GB devem preferir o `base` (~360 MB).
- Processos do mesmo usuário enxergam o token na linha de comando (`ps`). Aceito: esses processos já leem os arquivos do app.
- FPS (spike S-3, `spikes/s3-fps/`): com o `small` no ritmo real o escritório fica em 60 FPS nos dois visuais; transcrevendo sem parar, o 2D cai para 48 FPS (p95 44 ms) e o 3D segura 60.
