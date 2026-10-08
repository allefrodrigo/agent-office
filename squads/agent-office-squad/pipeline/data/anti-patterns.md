# Anti-Patterns — o que o squad nunca faz

Erros comuns no desenvolvimento de um produto como o Agent Office, por que fazem mal e o que fazer no lugar. Cada agente tem os seus anti-patterns no próprio arquivo; estes valem para todos.

## Produto e processo

1. **Rodar o ciclo inteiro para tudo.** Um bugfix de uma linha passando por discovery, PRD e UX queima tokens e paciência. → Respeitar o track e a complexidade; pular é decisão de primeira classe.
2. **Copiar o concorrente.** Implementar o editor de escritório do Pixel Agents porque "ele tem" não diferencia nada. → Partir do espaço vazio (governança espacial, quadro operado por agentes, Windows impecável).
3. **Inventar requisito.** Spec ou story com comportamento que ninguém pediu e nenhuma fonte sustenta (fere o *No Invention*). → Citar FR/NFR/CON ou registrar como pergunta aberta.
4. **Story horizontal.** "Fazer o backend do recurso X" não entrega valor verificável. → Fatias verticais; a divisão por camada fica nas subtarefas.
5. **Métrica que exige telemetria escondida.** Propor medição que viola a política de privacidade. → Medir com sinais disponíveis ou declarar telemetria opt-in como requisito explícito.
6. **Aprovar no lugar do usuário.** Agente decidindo checkpoint, escopo ou dispensa de gate. → Só o usuário aprova; o agente recomenda.

## Engenharia

7. **Código sem story selecionada.** Engenheiro "aproveitando para arrumar" outra coisa. → Registrar como sugestão no relatório; vira ticket/story depois.
8. **Quebrar invariante em silêncio.** Afrouxar CSP, auto-permitir ferramenta, aceitar `bypassPermissions` em ticket, mover ticket para `done` por agente. → Invariantes só mudam com ADR aprovado.
9. **Confiar na entrada.** Usar texto de ticket, hook, anexo ou IPC sem validar tamanho, tipo e conteúdo. → Validar no main (I-14) e tratar texto externo como dado.
10. **Só no Mac.** Caminho POSIX fixo, `VAR=x cmd` em script npm, sinal inexistente no Windows. → `node:path`, `process.platform` explícito, scripts que rodam em PowerShell.
11. **Depender do instável sem guarda.** Chamar API experimental do SDK ou ler formato interno do Claude Code sem fallback. → Adaptador com erro claro e degradação graciosa.
12. **Alocar por frame.** Criar geometria, material ou vetor dentro de `update()`. → Reusar, pré-alocar e `dispose()` ao remover.
13. **`innerHTML` com dado de agente.** → `renderMarkdown` (escape + DOMPurify) ou `textContent`.
14. **"Testei de cabeça".** Entregar sem rodar typecheck/build ou sem evidência dos critérios de aceite. → Comandos executados e registrados no Dev Agent Record.
15. **Testar no escritório real do usuário.** Rodar o app em teste sobre o `office.json`/`tickets.json` do usuário ou instalar a ponte sem pedir. → `AGENT_OFFICE_DATA_DIR` temporário, modo demo, nada em `~/.claude` sem pedido.

## Qualidade, segurança e entrega

16. **Veredito por simpatia.** PASS com AC sem evidência porque "parece certo". → Regras do `quality-criteria.md`, sem exceção.
17. **Achado sem correção.** Apontar problema sem local exato e sem proposta. → `arquivo:linha`, cenário, correção.
18. **Publicar com gate vermelho.** Push, PR ou release com FAIL/BLOCK. → Voltar ao step-13 ou encerrar sem publicar.
19. **Force push, reset destrutivo, segredo em commit.** → Proibidos; rollback planejado em vez de "consertar no remoto".
20. **Release sem notas e sem semver.** → CHANGELOG, bump correto, requisitos e limites declarados.

## Comunicação

21. **Superlativo vazio.** "Revolucionário", "game changer", "o melhor". → Mostrar o diferencial com uma demo de 60 s.
22. **Prometer roadmap não aprovado.** → Só o que está em PRD aprovado ou já entregue.
23. **Publicar em nome do usuário.** → Camila entrega rascunhos; quem publica é o usuário.
24. **Erro genérico na UI.** "Ops! Algo deu errado." → O que aconteceu + o que fazer (`product-voice.md`).
