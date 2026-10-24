# Modo 2D pixel art

O escritório pode ser desenhado em 2D, em pixel art com vista de cima 3/4, como um RPG de 16 bits. É uma opção para computadores mais fracos: não usa WebGL, sombra nem pós-processamento. O isométrico 3D continua como padrão.

## Ligar

Configurações → Vídeo → **Visual** → *2D pixel art (mais leve)* → Salvar. A janela recarrega no novo visual. Para voltar, escolha *Isométrico 3D (padrão)*.

Em dev, `AGENT_OFFICE_VIEW=2d npm run dev` abre em 2D sem mexer nas configurações (vale também para `npm run bench` e para as capturas com `AGENT_OFFICE_SHOTS`).

## Como funciona

- O jogo é o mesmo: andares, agentes, caminhos, cliques e etiquetas. Muda só quem desenha (`src/renderer/src/pixel/`).
- Cada móvel do 3D vira um sprite do catálogo (`src/shared/pixel-catalog.json`). O que ainda não tem sprite é desenhado a partir das peças do próprio modelo 3D, achatadas em pixel art. Por isso o 2D já sai completo e melhora a cada sprite novo.
- Telas, céu das janelas, quadro de rotinas, painel de gastos e placas continuam ao vivo: o app pinta o conteúdo por cima da área magenta do sprite.
- Personagens seguem o visual de cada um, como no 3D: pele, cor e estilo do cabelo, camisa (ou o uniforme do squad), calça e sapato. O seu muda em Configurações (Pele, Cabelo, Corte, Camiseta, Calça). Cada estilo de cabelo tem um molde (`personagens/molde-0` a `molde-5`), pintado em cores-chave que o app troca pelas cores do agente. Ajudantes (subagentes) saem iguais ao agente que os chamou, em tamanho menor. Sem os moldes, o app usa as folhas fixas `chefe` e `agente-NN`.
- Móveis que mudam de cor no 3D fazem o mesmo: tecido do sofá, da poltrona, do pufe e das cadeiras, assento da banqueta, tampo e pés da mesa de trabalho.

## Pastas

| Pasta | O que vai nela | Vai para o git? |
|---|---|---|
| `arte-2d/personagens/`, `arte-2d/moveis/`, `arte-2d/parede/`, `arte-2d/chao/` | imagem bruta de um sprite, com o nome da chave (`arte-2d/moveis/sofa.png`) | não |
| `arte-2d/folhas/` | folha com vários sprites em grade + um `.json` dizendo qual chave é cada célula | não |
| `src/renderer/src/assets/pixel/` | sprites prontos, no tamanho final (saída do `npm run pixel`) | sim |

## Comandos

```sh
npm run pixel:gerar              # pede ao Codex as imagens brutas que faltam (usa sua conta ChatGPT)
npm run pixel:gerar -- --list    # o que já foi gerado
npm run pixel:gerar -- personagens/agente-03   # redesenha uma imagem
npm run pixel                    # corta, tira o fundo e reduz tudo para src/renderer/src/assets/pixel/
npm run pixel -- --check         # o que tem sprite, o que tem bruto e o que falta
```

Depois do `npm run pixel`, o `npm run dev` já mostra os sprites novos.

## Trocar um sprite

1. Gere de novo (`npm run pixel:gerar -- <chave>`) ou salve uma imagem sua em `arte-2d/<grupo>/<chave>.png`. Uma imagem avulsa vale mais que a célula da folha.
2. Rode `npm run pixel -- <grupo>/<chave>`.
3. Confira no app.

Os prompts estão em `scripts/pixel/prompts.mjs` (os que o Codex usa) e, para gerar à mão no ChatGPT, em [prompts-personagens.md](prompts-personagens.md) e [prompts-cenario.md](prompts-cenario.md).

## Regras das imagens

- Vista de cima 3/4: aparecem o topo e a frente do objeto. "-lado" olha para a direita (o app espelha); "-costas" mostra o objeto por trás.
- Um objeto por imagem (ou por célula da folha), inteiro, sem sombra, sem texto, fundo liso.
- Tela ou vidro em magenta `#FF00FF`: é onde o app desenha o conteúdo ao vivo. Magenta em qualquer outro lugar some.
- Folha de personagem: 4 colunas x 3 linhas (de pé, andando, sentado/caído), na ordem do catálogo.
- Moldes recoloríveis (catálogo: `molde-N` e os sprites com `"tint": true`): cada parte só na sua cor-chave, em 3 tons (claro, base, escuro), fundo magenta.

| Cor-chave | Personagem | Móvel |
|---|---|---|
| vermelho `#FF0000` | camisa | cor A: tecido, tampo da mesa |
| azul `#0000FF` | calça | cor B: pés e estrutura da mesa |
| amarelo `#FFFF00` | pele | — |
| verde `#00FF00` | cabelo | — |
| ciano `#00FFFF` | sapato | — |

Preto, branco, cinza e marrom ficam como estão (contorno, olhos, metal, madeira).
