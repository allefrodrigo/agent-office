# Changelog

Mudanças do Agent Office que você percebe ao usar. As seções seguem a voz do produto: Novidades, Melhorias, Correções e Requisitos e limites. Entre parênteses, a story da rodada que trouxe a mudança.

## [Não lançado]

Windows de primeira classe: o app funciona com qualquer instalação do Claude Code no Windows, avisa na barra de tarefas e devolve você ao terminal.

### Novidades

- No Windows, o ícone na barra de tarefas mostra quantas permissões e resultados esperam por você (de 1 a "9+"), e o Narrador lê "N pendências no Agent Office". Quando chega um pedido ou um resultado com o app em segundo plano, o ícone pisca até você voltar (S-2).
- No Windows, "Abrir no terminal" na central de resume abre a sessão numa aba nova do Windows Terminal, já na pasta certa. Sem o Windows Terminal, abre numa janela de console própria (S-3).
- No Windows, a barra de título usa as cores do escritório, com os botões de minimizar, maximizar e fechar do próprio Windows (S-6).
- O card Sistema do Windows mostra quanto de CPU os agentes usam (S-4).

### Melhorias

- No Windows, "Copiar comando" gera um comando que roda no PowerShell, inclusive com espaço, aspas ou colchetes no nome da pasta. O aviso diz "Comando copiado para o PowerShell." (S-3).
- No Windows, a confirmação de "Fechar sessão" avisa que o encerramento é na hora, porque o Windows não tem fechamento suave, e lembra que a conversa fica salva para `claude --resume` (S-5).
- No Windows, antes de fechar uma sessão do terminal, o app confere que o processo ainda é aquele Claude Code. Assim não encerra o app Claude Desktop nem outro programa que tenha herdado o número do processo (S-5).
- Os textos citam o sistema certo: "Mostrar no Explorador" e "como no Gerenciador de Tarefas" no Windows; "Mostrar na pasta" no Linux. No Mac, nada muda (S-4, S-7).
- Quando falta o Claude Code no Windows, o agente mostra o instalador do PowerShell: `irm https://claude.ai/install.ps1 | iex` (S-1).
- Dá para instalar o Claude Code com o app aberto e contratar de novo, sem reiniciar o app. Vale para Mac e Windows (S-1).
- `npm run demo` funciona igual no PowerShell, no CMD e no zsh (S-7).
- O Windows ganha um instalador por arquitetura: x64 e arm64 (S-8).
- O projeto ganha testes automáticos: `npm test` (S-1 a S-8).

### Correções

- No Windows, o app encontra o Claude Code instalado pelo npm. Antes, o app instalado não achava o `claude.exe` e não conseguia contratar agentes nem ler os limites do plano. Também encontra as instalações nativa e do WinGet (S-1).
- No Windows, o card Sistema deixa de contar o app Claude Desktop como agente (S-4).
- No Windows, um clique duplo em "Abrir no terminal" abre um terminal só (S-3).

### Requisitos e limites

- Claude Code instalado e logado. Mac com Apple Silicon (build sem assinatura da Apple) ou Windows 10/11 x64.
- Os instaladores do Windows não têm assinatura de código: o SmartScreen avisa na primeira execução ("Mais informações" › "Executar assim mesmo").
- O instalador arm64 do Windows é gerado, mas ainda não foi testado.
- No Windows 10, sem o Windows Terminal, "Abrir no terminal" usa uma janela de console. Com "ícones pequenos" na barra de tarefas, o número não aparece, mas o ícone continua piscando.
- No Windows, a CPU dos agentes aparece de 15 a 60 segundos depois de abrir o app. Se o PowerShell estiver bloqueado por política da empresa, a CPU fica vazia e o app Claude Desktop volta a entrar na contagem.
- O comando copiado no Windows é para o PowerShell, não para o CMD. Com o Claude Code instalado pelo npm e scripts bloqueados no PowerShell, use "Abrir no terminal" ou veja o COMO-RODAR.
- A animação de conversa entre sessões do terminal ainda não foi conferida no Windows nativo (o Claude Code troca mensagens entre sessões lá desde a versão 2.1.234).
- `npm test` exige Node 22.18 ou mais novo. O app continua rodando com Node 20.
- No Mac, além dos textos (iguais aos de antes), mudam só estas coisas:
  - instalar o Claude Code com o app aberto e tentar de novo passa a funcionar sem reiniciar;
  - um clique duplo em "Abrir no Terminal" em menos de 1,5 s mostra "Já estou abrindo um terminal.";
  - uma sessão com pasta inválida no histórico (caminho relativo ou com quebra de linha) não abre no Terminal e mostra um aviso;
  - nesse caso, e quando a sessão não tem pasta, "Copiar comando" copia só `claude --resume <id>` (antes copiava `cd '.' && …`);
  - os botões "Abrir no Terminal" e "Copiar comando" ganharam nome acessível para leitores de tela.
- No Linux, "Abrir no terminal" continua indisponível; a mensagem agora diz que funciona no Mac e no Windows e sugere "Copiar comando".
- Antes do lançamento, ainda falta conferir à mão: o número e o piscar na barra de tarefas, a leitura do Narrador, a aba real do Windows Terminal, o custo de CPU, "Fechar sessão" com a ponte conectada e o app empacotado com os instaladores.

## [0.2.0] — 2026-10-06

### Novidades

- Quadro de tickets: kanban com Backlog, A fazer, Fazendo, Revisão e Feito. Dá para delegar um ticket a um agente, e os agentes também usam o quadro sozinhos.
- Chamar agente: escolha só a pasta, sem tarefa nem formulário, e converse como no terminal.
- Contexto do agente: quanto da janela de contexto a conversa ocupa, com Compactar e Limpar.
- Limites do plano: as janelas de 5 horas, da semana e por modelo, sem gastar tokens.
- Card Sistema: CPU e RAM do Mac, do próprio app e dos processos do Claude Code.
- Conversa entre sessões: quando uma sessão do terminal manda mensagem para outra, o agente anda até a mesa do destinatário.
- Anexos nas mensagens: imagens, PDFs e textos.

### Requisitos e limites

- Claude Code instalado e logado. Mac com Apple Silicon (build sem assinatura da Apple). Windows ainda como porte incompleto.

## [0.1.0] — 2026-10-06

### Novidades

- Escritório isométrico em pixel art: cada agente do Claude Code tem mesa e computador, e a tela mostra o que ele está fazendo.
- Contratar agente com pasta, tarefa, modelo e modo de permissão.
- Permissões, perguntas e planos viram cartões: o agente vai até a sua sala pedir e entregar o resultado.
- Sessões do terminal: conecte a ponte e cada `claude` aberto no terminal aparece no escritório.
- Central de resume: chame sessões antigas de volta ao escritório.
- Lounge com sofás, pebolim, fliperama e pingue-pongue para os agentes livres.
- Airsoft na sala de reunião (no terceiro tiro, a sessão é encerrada; para sessões do terminal, o app pergunta antes).
