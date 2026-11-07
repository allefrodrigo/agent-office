# 0013 — Dados de reunião em userData, fora do projeto

- **Status:** aceito (2026-11-07)
- **Origem:** plano da sala de reunião, RN-02 (CON-4 da spec)

## Contexto

Uma reunião gera notas, transcrição, ata, conversa e áudio temporário. A transcrição traz fala literal de terceiros. Gravar isso na pasta do projeto do andar arrisca ir para o git.

## Decisão

Tudo fica em `userData`:

```
userData/meetings.json                         índice (loadJson, backup, flush e lock como os outros stores)
userData/meetings/<andar>/<id>/notes.md        notas
                               transcript.jsonl um segmento por linha
                               ata.json, ata.md ata
                               chat.jsonl       conversa
                               audio/<faixa>.pcm temporário; apagado quando a ata fica pronta
```

- Pastas `0700`, arquivos `0600`. Andar e id validados contra caminho fora de `userData/meetings`.
- O áudio é apagado com a ata pronta. Com "Guardar o áudio", vira `.m4a` antes.
- Exportar para o projeto só por ação do usuário ("Salvar .md").
- Agentes leem atas pelo MCP `office`, só do próprio andar; transcrições só com a opção do andar ligada e `include_transcript=true`.

## Consequências

- Backup e restauração cobrem o índice (`DATA_FILES`); as pastas ficam onde estão. Restaurar um índice antigo pode deixar pasta sem entrada ou entrada sem pasta: a reunião sem pasta lê vazio.
- Apagar uma reunião apaga a pasta inteira.
- Retenção automática (apagar com mais de N dias) fica para o RN-27.
