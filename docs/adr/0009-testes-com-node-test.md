# 0009 — Testes de funções puras com `node:test` nativo (sem dependência)

- **Status:** aceito
- **Data:** 2026-10-07 (aceito no checkpoint 12 da rodada `2026-10-07-185405`, pergunta Q-1, opção a)
- **Origem:** ADR-run-9

## Contexto

O repositório não tinha test runner. Os padrões de engenharia apontavam o Vitest como alvo, mas dependência de dev nova pede ADR (CON-1). O Node 22.18 ou mais novo executa `.ts` com remoção de tipos sem configuração. O que impedia rodar os módulos do app direto no Node eram o alias `@shared/*` e imports relativos sem extensão.

## Decisão

`npm test` = `node --test "src/**/*.test.ts"`. As funções testadas moram em módulos que só importam `node:*` e `import type` (apagado na execução). Os testes importam com a extensão `.ts`, e `allowImportingTsExtensions: true` nos dois tsconfig deixa o `typecheck` passar. Sem cobertura e sem mocks de Electron; lógica com efeitos recebe dependências injetadas (ex.: `WindowsClaude`, `ClaudeIdentities`, `createOpenGuard`).

## Alternativas consideradas

- Vitest: melhor ergonomia, resolve o alias e permite mockar o Electron; descartado nesta rodada por ser dependência nova. Os testes em `node:test` migram trocando o import.
- Só roteiro manual: o gate de qualidade ficaria em CONCERNS e as funções de segurança (`wtSafe`, `psScript`, `resumeCommand`) ficariam sem regressão automática.

## Consequências

- Primeiro `npm test` do repositório (65 testes na entrega da rodada), sem dependência; funções de segurança com regressão.
- Quem roda os testes precisa de Node 22.18 ou mais novo (o app continua com Node 20+).
- Restrição de imports nos módulos puros, documentada no topo de cada um. A partir desta decisão, lógica nova sem teste é FAIL no gate de qualidade.
- Convenção a padronizar (QA-11, baixo): um módulo de produção (`session-process.ts`) importa `./win-processes.ts` com extensão; funciona porque o bundler resolve.
