# Voz do Produto e Microcopy — Agent Office

Guia da Lívia Linguagem para todo texto visível ao usuário: interface, erros, notas de versão e documentação. Fonte de referência: os textos atuais do app (v0.2.0), que já seguem esta voz.

## 1. Personalidade

O escritório fala como **colegas de trabalho competentes e de bom humor**: diretos, calorosos, sem pose. O humor mora no mundo (o lounge, o pebolim, o "Ai! Tô trabalhando!"), não nas mensagens de risco.

| É | Não é |
|---|---|
| direto ("Escolha uma pasta de projeto que exista.") | burocrático ("Por gentileza, selecione um diretório válido.") |
| caloroso ("Chegando ao escritório", "Trazendo o resultado") | infantil ("Eba! Seu agentinho chegou!") |
| honesto sobre risco ("PERIGOSO: roda qualquer comando sem perguntar.") | alarmista ou eufemista ("Modo avançado ✨") |
| concreto ("Esperando sua revisão no quadro") | vago ("Algo aconteceu") |

## 2. Padrões de texto

- **Status e atividades**: gerúndio curto no presente — "Lendo app.ts", "Editando bridge.ts", "Organizando a memória", "Esperando no terminal".
- **Pedidos do agente**: primeira pessoa, pergunta direta — "Posso rodar este comando?", "Posso editar index.ts?", "Tenho uma pergunta", "Posso seguir com este plano?".
- **Erros**: o que aconteceu + o que fazer, numa ou duas frases. "Não achei essa sessão no disco." / "A porta 47821 já está em uso." + solução no COMO-RODAR.
- **Confirmações destrutivas**: título com a consequência e botões com verbo explícito — "Fechar a sessão de Ada?" · [Fechar sessão] [Deixar viver].
- **Toasts**: frase completa, sem ponto de exclamação — "Ada terminou e vai te entregar o resultado."
- **Botões**: verbo no infinitivo ou imperativo curto — "Contratar", "Permitir", "Sempre permitir", "Negar", "Delegar", "Recebido".
- **Números**: formato pt-BR (`1,2 GB`, `23:00`, `amanhã 07:00`, `qui 07:00`).

## 3. Glossário (um termo por conceito)

| Use | Conceito | Não use |
|---|---|---|
| contratar | criar agente com tarefa | criar, instanciar, spawnar |
| chamar | criar agente sem tarefa, só com a pasta | invocar, abrir agente |
| demitir | encerrar o agente do escritório | matar, deletar agente |
| agente | sessão do Claude Code no escritório | bot, IA, robô |
| sessão do terminal | `claude` rodando fora do app, conectado pela ponte | agente externo, CLI session |
| ponte / conectar | hooks que ligam o terminal ao app | integração, plugin |
| quadro | kanban de tickets | board (na UI), backlog (para o quadro todo) |
| ticket | item do quadro, chave `AO-n` | card, issue, tarefa (quando for o ticket) |
| delegar | entregar ticket a um agente | atribuir para IA |
| critérios de aceite | lista verificável do ticket | requisitos, checklist |
| Backlog · A fazer · Fazendo · Revisão · Feito | colunas | To do, Doing, Done (na UI) |
| permitir · sempre permitir · negar | decisões de permissão | aceitar, autorizar, bloquear |
| compactar · limpar | `/compact` · `/clear` | resumir memória, resetar |
| contexto | janela de contexto (`/context`) | memória (exceto em "Organizando a memória") |
| limites do plano | janelas de uso (`/usage`) | cota, rate limit (na UI) |
| central de resume | lista de sessões para retomar | histórico |
| sua sala | sala do usuário no mundo | escritório do chefe |
| lounge | área de descanso | sala de jogos |

## 4. Palavras e construções a evitar

- "Ops!", "Algo deu errado", "Erro desconhecido" — sempre dizer o que aconteceu.
- "Clique aqui", "simplesmente", "basta", "fácil" — condescendentes ou inúteis.
- Exclamações em série, emojis decorativos, CAIXA ALTA fora do aviso de perigo.
- Anglicismos quando há palavra comum em pt-BR (exceto termos técnicos consagrados: commit, branch, prompt, token, hook).
- Culpar o usuário ("Você escolheu uma pasta inválida") — descreva o estado ("A pasta não existe mais.").

## 5. Escrita para o pior momento

- Risco de perda de trabalho ou de dados: diga o que se perde e o que fica salvo ("A conversa fica salva: dá para voltar com claude --resume.").
- Modo "Sem pedir nada": manter o aviso PERIGOSO e a confirmação; nunca suavizar.
- Falta de pré-requisito: instrução acionável com comando ("Instale com `curl -fsSL https://claude.ai/install.sh | bash`…").

## 6. Internacionalização (i18n)

Hoje todas as strings estão fixas no código em pt-BR. Regras para preparar e implementar i18n (a implementação em si é uma story com ADR):

- pt-BR é o idioma-fonte; en-US é o primeiro alvo; es depois.
- Chaves semânticas por área: `hud.inbox.empty`, `dialog.permission.bash.title`, `board.column.review`.
- Nunca concatenar fragmentos de frase; usar interpolação nomeada (`{name} terminou e vai te entregar o resultado.`).
- Plural e gênero tratados pela biblioteca (ICU MessageFormat ou equivalente), não com `if` no código.
- Datas, horas e números com `Intl` no locale ativo (hoje `toLocaleTimeString('pt-BR')` fixo).
- Textos que o agente lê (`ticketBrief`, `systemPrompt` anexado, instruções das ferramentas MCP) são **conteúdo de prompt**, não UI: mudar o idioma deles é decisão de produto separada (afeta o comportamento do agente).
- Strings de erro lançadas no main também entram no catálogo (o renderer só exibe).
- Comprimento: prever +30% em inglês/espanhol nos layouts (crachás, botões, balões).

## 7. Notas de versão (padrão)

```markdown
## v0.3.0 — 2026-10-20

**Novidades**
- Subagentes aparecem como estagiários ao lado da mesa do agente que os chamou.

**Melhorias**
- O painel do agente lista os subagentes ativos; dá para focar a câmera em cada um.

**Correções**
- O cartão de permissão de uma sessão do terminal some quando você responde no próprio terminal.

**Requisitos e limites**
- Claude Code instalado e logado. Mac com Apple Silicon (build não assinado) ou Windows 10/11.
```

Benefício primeiro, linguagem do usuário, sem nome de arquivo nem jargão interno.
