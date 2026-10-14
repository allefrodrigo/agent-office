# Como rodar o Agent Office

Passo a passo para abrir o escritório, usar e gerar o app instalável.

## 1. Pré-requisitos

- macOS (Apple Silicon ou Intel), Windows 10/11 ou Linux x64.
- Node.js 20 ou mais novo. Confira com `node -v`.
- Claude Code instalado e logado. Confira com `claude --version`.

Se ainda não tem o Claude Code:

Mac (zsh):

```bash
curl -fsSL https://claude.ai/install.sh | bash   # macOS e Linux
claude   # rode uma vez para fazer login
```

Windows (PowerShell):

```powershell
irm https://claude.ai/install.ps1 | iex
claude   # rode uma vez para fazer login
```

O app também encontra o Claude Code instalado pelo npm (`npm install -g @anthropic-ai/claude-code`) ou pelo WinGet. Se você instalar com o app aberto, basta contratar o agente de novo: não precisa reiniciar.

Só quer usar, sem mexer no código? Baixe o instalador nas [Releases](https://github.com/allefrodrigo/agent-office/releases/latest) e pule para o passo 4.

## 2. Instalar

Na pasta do projeto:

```bash
npm install
```

Se o próximo passo der `Error: Electron uninstall`, baixe o Electron manualmente:

```bash
node node_modules/electron/install.js
```

## 3. Abrir

```bash
npm run dev
```

A janela abre com o escritório vazio e você sentado na sua mesa.

### Testar sem gastar tokens

O modo demo enche o escritório com 6 agentes simulados:

```bash
npm run demo
```

O mesmo comando funciona no zsh, no PowerShell e no CMD.

## 4. Usar

### Contratar um agente com tarefa

1. Clique em **Novo agente** na barra de baixo (ou tecle `N`) e escolha a aba **Com tarefa**.
2. Descreva a tarefa. No térreo, escolha a pasta; num andar de empresa, a pasta é a do andar.
3. Escolha o modo de permissão. "Pedir permissão" faz o agente vir até você antes de editar arquivos ou rodar comandos.
4. Clique em **Contratar** (ou ⌘/Ctrl+Enter). O agente chega pelo elevador, senta numa mesa e começa.

Quando ele precisar de você, vai até a sua sala e um cartão abre com **Permitir**, **Sempre permitir** ou **Negar**. Ao terminar, ele traz o resultado.

### Chamar um agente sem tarefa

Para conversar como no terminal, sem preencher o formulário:

1. Clique em **Novo agente** na barra de baixo (funciona em qualquer andar) e fique na aba **Conversar**, ou clique na etiqueta **Novo agente** em cima do seu computador.
2. No térreo, escolha a pasta. Num andar de empresa, a pasta já é a do andar.
3. O agente chega e o painel dele abre. Digite o que quer.

Ele usa o modelo e o modo de permissão padrão das Configurações.

### Retomar uma sessão antiga

1. Clique no botão do relógio (**Central de resume**).
2. Busque pela sessão: título, pedido, pasta ou ID (ex.: `7548dd2f`).
3. Escolha:
   - **Chamar**: a sessão volta como agente no escritório, com o histórico e o mesmo modelo. Mande a próxima instrução no painel que abre.
   - **Abrir no terminal** (`>_`): abre a sessão já rodando `claude --resume <id>` na pasta certa. No Mac, numa janela do Terminal. No Windows, numa aba nova do Windows Terminal; sem ele (comum no Windows 10), numa janela de console própria.
   - **Copiar comando**: copia o comando para colar no terminal. No Mac: `cd '<pasta>' && claude --resume <id>`. No Windows, para o PowerShell: `Set-Location -LiteralPath '<pasta>'; claude --resume <id>` (não funciona no CMD).

Sessões marcadas como "usada agora" ou "aberta no terminal" provavelmente estão abertas em outro lugar. Retomar a mesma sessão em dois lugares ao mesmo tempo mistura as conversas.

### Conversar com um agente

Clique no agente (ou no nome dele na lista à direita) para ver o log ao vivo e mandar novas instruções.

### Ver as sessões do terminal no escritório

1. Abra **Configurações** (engrenagem) e clique em **Conectar**.
2. Abra um novo `claude` no terminal.

Cada sessão aparece como um agente temporário, com a etiqueta "terminal". Ele vai embora quando a sessão fecha. Sessões abertas antes de conectar não aparecem.

**Fechar sessão** (no painel do agente do terminal) encerra o `claude` daquele terminal. No Mac, é como fechar a aba. No Windows, o encerramento é **na hora**, porque o Windows não tem fechamento suave: a última resposta em andamento pode se perder. Nos dois, a conversa fica salva e dá para voltar com `claude --resume`.

Conectar adiciona hooks em `~/.claude/settings.json` e faz backup em `settings.json.agent-office.bak`. **Desconectar** remove só o que o app adicionou. Com o app fechado, o terminal funciona normal.

### Controles

| Ação | Como |
| --- | --- |
| Andar | Clique no chão, ou WASD / setas |
| Mover a câmera | Arraste com o botão direito |
| Zoom | Roda do mouse ou botões no canto |
| Voltar para a sua cadeira | Botão da casinha |
| Ver pendências | Botão da caixa de entrada |
| Fechar cartão ou painel | Esc |
| Dispensar um agente | Clique na caveira (armário ao lado da sua sala) |

### Caveira

A caveira fica no armário ao lado da sua sala. Clique nela (ou na etiqueta "Caveira") para ver a lista de agentes, com nome e status. Clique num agente e confirme: se ele estiver trabalhando, a confirmação avisa que o trabalho em andamento se perde. Cancelar não muda nada.

Depois de confirmar, a câmera vai até o agente, mesmo em outro andar. A caveira cai do teto, gargalha e acerta o agente, que desmaia e vira fantasma. Aí **a sessão dele é encerrada de verdade**, como em Dispensar:

- Agente contratado: sai do escritório.
- Agente do terminal: o `claude` daquele terminal fecha, sem outra pergunta. A conversa fica salva para `claude --resume`.

Se a sessão não fechar, o agente levanta e um aviso explica o erro. O painel do agente também tem "Dispensar agente" (contratados) e "Fechar sessão" (terminal).

## 5. Gerar o app instalável

### Mac

```bash
npm run dist:mac
```

O instalador sai em `dist/Agent-Office-<versão>-arm64.dmg`. Abra o `.dmg` e arraste o app para **Aplicativos**.

O build não tem assinatura da Apple. Em outro Mac, a primeira abertura é bloqueada: clique com o botão direito no app e escolha **Abrir**.

### Windows

Rode no próprio Windows (PowerShell ou CMD):

```powershell
npm run dist:win
```

O instalador sai em `dist/Agent-Office-Setup-<versão>.exe`.

O instalador não tem assinatura de código. Na primeira execução, o Windows mostra "O Windows protegeu o computador" (SmartScreen): clique em **Mais informações** e depois em **Executar assim mesmo**. Instale só um arquivo que você mesmo gerou ou cujo hash SHA-256 confere com o publicado no release.

### Linux

Rode no próprio Linux:

```bash
npm run dist:linux
```

O AppImage sai em `dist/`. Dê permissão de execução (`chmod +x`) e rode.

## 6. Problemas comuns

| Problema | Solução |
| --- | --- |
| `Error: Electron uninstall` | `node node_modules/electron/install.js` |
| Agente diz "Não encontrei o Claude Code" | Instale o Claude Code (passo 1) e contrate de novo. Se ele estiver num lugar incomum (por exemplo, um prefixo do npm diferente do padrão), aponte o caminho. zsh: `AGENT_OFFICE_CLAUDE=/caminho/para/claude npm run dev`. PowerShell: `$env:AGENT_OFFICE_CLAUDE="C:\caminho\para\claude.exe"; npm run dev` (no Windows, precisa ser o `claude.exe`, não o `claude.cmd`) |
| Windows: o comando copiado falha com "a execução de scripts foi desabilitada neste sistema" | Acontece com o Claude Code instalado pelo npm: no PowerShell, `claude` vira o script `claude.ps1`, bloqueado pela política `Restricted`. Escolha uma saída: use o botão **Abrir no terminal**, que roda o `claude.exe` direto; libere scripts locais só para o seu usuário com `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`; ou instale pelo instalador nativo (passo 1) |
| Windows: o comando copiado não funciona no CMD | Ele é para o PowerShell (o shell padrão do Windows Terminal). No CMD, use `cd /d "<pasta>"` e depois `claude --resume <id>` |
| Windows: "Abrir no terminal" abriu uma janela de console em vez do Windows Terminal | Normal sem o Windows Terminal (comum no Windows 10), com o alias `wt.exe` desligado em Configurações › Aplicativos › Aliases de execução, ou com `;` no nome da pasta |
| "Já estou abrindo um terminal." | Você clicou duas vezes seguidas. Espere um segundo e meio e tente de novo, se o terminal não abriu |
| Windows: o SmartScreen bloqueia o instalador | O instalador não é assinado. Clique em **Mais informações** › **Executar assim mesmo** (veja [Windows](#windows) acima) |
| Windows: não aparece o número no ícone da barra de tarefas | Com "ícones pequenos" na barra de tarefas, o Windows 10 não mostra o número; o ícone continua piscando quando chega pedido |
| Windows: a CPU dos agentes fica vazia no card Sistema | Nos primeiros 15–60 segundos é normal. Se não aparecer nunca, o PowerShell está bloqueado por política da empresa: o card conta todo `claude.exe`, inclusive o app Claude Desktop |
| Sessão do terminal não aparece | Conecte em Configurações, deixe o app aberto e abra um `claude` **novo** |
| "A porta 47821 já está em uso" | Feche a outra cópia do app que está aberta |
| Quero zerar o escritório | Feche o app e apague `office.json` na pasta de dados (abaixo) |

Pasta de dados do app:

- Mac: `~/Library/Application Support/agent-office/`
- Windows: `%APPDATA%\agent-office\`
- Linux: `~/.config/agent-office/`

## 7. Para desenvolver

```bash
npm run typecheck   # checa os tipos
npm run build       # compila sem empacotar
npm test            # testes (Vitest)
```

Para testar sem mexer nos seus dados, use uma pasta de dados separada. zsh: `AGENT_OFFICE_DATA_DIR=/tmp/ao-teste npm run demo`. PowerShell: `$env:AGENT_OFFICE_DATA_DIR="$env:TEMP\ao-teste"; npm run demo` (a variável vale até fechar o PowerShell; para limpar, `Remove-Item Env:AGENT_OFFICE_DATA_DIR`).

A arquitetura e as notas do porte para Windows estão no [README](README.md).
