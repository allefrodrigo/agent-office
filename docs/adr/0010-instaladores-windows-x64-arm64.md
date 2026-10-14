# 0010 — Empacotamento Windows: NSIS x64 e arm64 em instaladores separados, assinatura preparada e desligada

- **Status:** aceito
- **Data:** 2026-10-07 (aceito no checkpoint 12 da rodada `2026-10-07-185405`; Q-7: instaladores separados)
- **Origem:** ADR-run-10 · lacuna L15 · escopo extra aprovado no PRD

## Contexto

A aprovação do PRD trouxe o alvo `arm64` (sem máquina para testar) e a preparação de assinatura sem certificado. Com `arch: [x64, arm64]`, o NSIS do electron-builder gera por padrão um instalador universal com as duas arquiteturas (`buildUniversalInstaller` vale `true` por padrão).

## Decisão

`electron-builder.yml`: `arch: [x64, arm64]`, `nsis.buildUniversalInstaller: false` e `artifactName: ${productName}-Setup-${version}-${arch}.${ext}`. Um bloco `win.azureSignOptions` comentado traz os quatro campos obrigatórios (`publisherName`, `endpoint`, `certificateProfileName`, `codeSigningAccountName`), com a nota de que as credenciais vêm de variáveis de ambiente do CI e de que, sem certificado, nada é assinado e o SmartScreen avisa.

## Alternativas consideradas

- Instalador universal: dobra o download para todo mundo.
- `signtoolOptions` com certificado `.pfx` como padrão: o Azure Trusted Signing (Artifact Signing) é o caminho integrado e evita guardar `.pfx`; fica citado no comentário.
- Adiar o `arm64`: descartado na aprovação do PRD.

## Consequências

- Dois instaladores menores; ligar a assinatura é descomentar e configurar os segredos no CI.
- O `arm64` sai "gerado, não executado"; o `dist:win` fica mais lento (para builds locais: `electron-builder --win --x64`).
- Notas de release devem dizer "não assinado" e publicar o SHA-256 de cada instalador.
- Pendência: gerar os instaladores e abrir o app empacotado (roteiro M-6); o `dist:win` não fechou na máquina da rodada por falta de memória e disco.
