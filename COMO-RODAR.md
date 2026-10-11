# Como rodar o Agent Office

Passo a passo para abrir o escritório, usar e gerar o app instalável.

## 1. Pré-requisitos

- macOS com Apple Silicon (M1 ou mais novo) ou Windows 10/11.
- Node.js 20 ou mais novo. Confira com `node -v`.
- Claude Code instalado e logado. Confira com `claude --version`.

Se ainda não tem o Claude Code:

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude   # rode uma vez para fazer login
```

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

No Windows (PowerShell):

```powershell
$env:AGENT_OFFICE_DEMO=1; npm run dev
```

## 4. Usar

### Contratar um agente com tarefa

1. Clique no botão do lápis na barra de baixo (ou em **Com tarefa…** no Chamar agente).
2. Descreva a tarefa. No térreo, escolha a pasta; num andar de empresa, a pasta é a do andar.
3. Escolha o modo de permissão. "Pedir permissão" faz o agente vir até você antes de editar arquivos ou rodar comandos.
4. Clique em **Contratar**. O agente chega pelo elevador, senta numa mesa e começa.

Quando ele precisar de você, vai até a sua sala e um cartão abre com **Permitir**, **Sempre permitir** ou **Negar**. Ao terminar, ele traz o resultado.

### Chamar um agente sem tarefa

Para conversar como no terminal, sem preencher o formulário:

1. Clique em **Chamar agente** na barra de baixo (funciona em qualquer andar), ou na etiqueta **Chamar agente** em cima do seu computador.
2. No térreo, escolha a pasta. Num andar de empresa, a pasta já é a do andar.
3. O agente chega e o painel dele abre. Digite o que quer.

Ele usa o modelo e o modo de permissão padrão das Configurações.

### Retomar uma sessão antiga

1. Clique no botão do relógio (**Central de resume**).
2. Busque pela sessão: título, pedido, pasta ou ID (ex.: `7548dd2f`).
3. Escolha:
   - **Chamar**: a sessão volta como agente no escritório, com o histórico e o mesmo modelo. Mande a próxima instrução no painel que abre.
   - **Terminal** (`>_`): abre uma janela do Terminal já rodando `claude --resume <id>` na pasta certa (só no Mac).
   - **Copiar**: copia `cd <pasta> && claude --resume <id>` para colar onde quiser.

Sessões marcadas como "usada agora" ou "aberta no terminal" provavelmente estão abertas em outro lugar. Retomar a mesma sessão em dois lugares ao mesmo tempo mistura as conversas.

### Conversar com um agente

Clique no agente (ou no nome dele na lista à direita) para ver o log ao vivo e mandar novas instruções.

### Ver as sessões do terminal no escritório

1. Abra **Configurações** (engrenagem) e clique em **Conectar**.
2. Abra um novo `claude` no terminal.

Cada sessão aparece como um agente temporário, com a etiqueta "terminal". Ele vai embora quando a sessão fecha. Sessões abertas antes de conectar não aparecem.

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
| Pegar a airsoft | Clique nela (mesa da sala de reunião) ou aperte E perto dela |
| Atirar | Com a arma na mão, clique num agente |
| Largar a arma | Q |

### Airsoft

Cada agente aguenta 3 tiros (os corações aparecem no crachá e voltam depois de 12 segundos sem levar tiro). No terceiro, um agente contratado cai, vira fantasma e sai do escritório: **a sessão dele é encerrada de verdade**, como em Demitir. Um agente do terminal fica caído e o app pergunta se você quer fechar aquela sessão. "Fechar sessão" encerra o `claude` daquele terminal (a conversa fica salva para `claude --resume`); "Deixar viver" faz ele levantar. O mesmo botão "Fechar sessão" fica no painel do agente.

## 5. Gerar o app instalável

### Mac

```bash
npm run dist:mac
```

O instalador sai em `dist/Agent Office-<versão>-arm64.dmg`. Abra o `.dmg` e arraste o app para **Aplicativos**.

O build não tem assinatura da Apple. Em outro Mac, a primeira abertura é bloqueada: clique com o botão direito no app e escolha **Abrir**.

### Windows

Rode no próprio Windows:

```bash
npm run dist:win
```

O instalador sai em `dist/`.

## 6. Problemas comuns

| Problema | Solução |
| --- | --- |
| `Error: Electron uninstall` | `node node_modules/electron/install.js` |
| Agente diz "Não encontrei o Claude Code" | Instale o Claude Code (passo 1). Se estiver num lugar incomum, aponte o caminho: `AGENT_OFFICE_CLAUDE=/caminho/para/claude npm run dev` |
| Sessão do terminal não aparece | Conecte em Configurações, deixe o app aberto e abra um `claude` **novo** |
| "A porta 47821 já está em uso" | Feche a outra cópia do app que está aberta |
| Quero zerar o escritório | Feche o app e apague `office.json` na pasta de dados (abaixo) |

Pasta de dados do app:

- Mac: `~/Library/Application Support/agent-office/`
- Windows: `%APPDATA%\agent-office\`

## 7. Para desenvolver

```bash
npm run typecheck   # checa os tipos
npm run build       # compila sem empacotar
```

A arquitetura e as notas do porte para Windows estão no [README](README.md).
