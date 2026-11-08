# Modo 2D Habbo

O escritório pode ser desenhado em 2D isométrico com a arte do Habbo: móveis e avatares vêm do Imager público do [HabboAssets](https://www.habboassets.com/api). É uma opção para computadores mais fracos: não usa WebGL, sombra nem pós-processamento. O isométrico 3D continua como padrão.

## Ligar

Configurações → Vídeo → **Visual** → *2D Habbo (mais leve)* → Salvar. A janela recarrega no novo visual. Para voltar, escolha *Isométrico 3D (padrão)*.

Em dev, `AGENT_OFFICE_VIEW=2d npm run dev` abre em 2D sem mexer nas configurações (vale também para `npm run bench` e para as capturas com `AGENT_OFFICE_SHOTS`).

## Como funciona

- O jogo é o mesmo: andares, agentes, caminhos, cliques e etiquetas. Muda só quem desenha (`src/renderer/src/pixel/`).
- Projeção do Habbo: um tile é um losango de 64 x 32, x desce para a direita e z para a esquerda. As paredes do fundo (z = 0 e x = 0) fecham a sala por cima, como no 3D.
- Cada móvel com px() tag que tem par no Habbo vira a imagem do Imager (`/imaging/furniture/<classname>.png?direction=N`). A tabela fica em `pixel/habbo.ts` (`BY_TAG`, `PLANTS`, `SOFAS`). Direções: 2 olha para +x, 4 para +z, 0 e 6 de costas.
- O resto (telas ao vivo, paredes, vidro, quadros, elevador) é desenhado a partir das peças do modelo 3D, projetadas em isométrico (`pixel/voxel.ts`). Telas, céu das janelas e placas continuam ao vivo.
- Editor de visual: no 2D, Configurações (você) e o editor de modelo (agentes) abrem o guarda-roupa do Habbo (`ui/habbo-editor.ts`). São 13 categorias com todo o catálogo do cliente, uma ou duas cores da paleta por peça e o avatar ao vivo ao lado: gira nas 8 direções, anda, acena, fala e pisca. A escolha fica em `Look.habbo`; as cores principais também vão para o visual 3D. As miniaturas vêm do Imager (`/imaging/clothing/set/<id>.png`).
- Avatares: montados peça por peça, como no cliente do Habbo (`pixel/figure.ts`, catálogo em `pixel/habbo-catalog.ts`). Quem não tem `Look.habbo` ganha um visual derivado das cores 3D (pele, cabelo, corte, camisa ou uniforme do squad, calça, sapato), que vira um conjunto de peças (corpo, cabeça, rosto, cabelo, camisa, mangas, pernas, sapatos). Cada peça é um sprite da sua biblioteca de roupa (`.nitro` do HabboAssets), tingido com a cor da paleta e desenhado na ordem da sua direção.
- Animações do próprio cliente: andar (4 frames), sentar, deitar, acenar, carregar, falar (boca) e piscar. Sentado e deitado, o Habbo só tem as diagonais, então o avatar vira para a mais próxima.
- O processo principal baixa as bibliotecas (o CDN não libera CORS para a página) e guarda em `userData/habbo/`. Ao abrir o 2D, ele também baixa em segundo plano, uma a cada 1,5 s, todas as bibliotecas do catálogo que faltam. Assim qualquer roupa do editor aparece na hora e sem internet. Um 429 do HabboAssets espera o Retry-After e tenta de novo. Enquanto as bibliotecas chegam, aparece a imagem em pé do Imager.
- Quais peças formam cada conjunto, em que biblioteca cada peça fica e as paletas vêm do `figuredata.xml` e do `figuremap.xml` do cliente (`pixel/habbo-avatar.json`). A ordem de desenho por direção foi medida contra o Imager: é a que reproduz a imagem dele.
- Sem internet, ou enquanto a imagem não chega, o objeto aparece desenhado pelas peças 3D. O Imager limita a 60 por minuto as imagens que ainda não estão no cache dele; uma imagem recusada é pedida de novo depois de 15 s, 1 min e 5 min.

## Atualizar os dados dos avatares

1. Baixe o pacote do cliente: `https://www.habboassets.com/api/v2/swfs/builds` lista os builds; o `download` de um deles é um ZIP.
2. Descompacte e rode `npm run habbo:avatar -- <pasta do build>` (a pasta com `figuremap.xml` e `gamedata/figuredata.xml`).
3. O script extrai todo conjunto selecionável das 13 categorias do editor. Para mudar o visual de quem não escolheu um, troque os ids em `HAIR_SETS`/`BODY` (`pixel/habbo-catalog.ts`).
4. Cabelo e chapéu seguem o Imager. Cabelo com versão cheia (`hrb`) desenha só ela, nunca o `hr` gêmeo de mesmo id. O chapéu esconde o `hrb` (`hiddenlayers` do `figuredata.xml`), e o capacete esconde mais.
5. O `figuremap.xml` lista algumas partes só pelo tipo principal (o `hrb 4` fica na biblioteca do `hr 4`). O script dá a essas partes a biblioteca das outras peças do conjunto.
6. Para conferir o catálogo inteiro contra o Imager, desenhe cada conjunto com a mesma regra do app e compare pixel a pixel. Fora a textura (o Imager usa revisões mais antigas da arte), tudo deve bater.

## Trocar um móvel

1. Ache o classname em <https://www.habboassets.com/furniture> ou em `https://www.habboassets.com/imaging/search?type=furniture&q=<texto>`.
2. Veja as direções que ele tem: `https://www.habboassets.com/imaging/info/furniture/<classname>`.
3. Troque a linha da tag em `BY_TAG` (`pixel/habbo.ts`) e confira no app.

## Móveis que o Habbo não tem

Gela água, pebolim, pingue-pongue, mesa alta, mesa de reunião, relógio de parede, armário de parede, papéis e caneca não existem no catálogo do Habbo. A luminária de mesa também: a do Habbo tem tamanho de móvel de chão. O Codex desenha cada um no estilo dos móveis do Habbo, com móveis reais anexados como régua de estilo.

```sh
npm run habbo:moveis                    # gera os que faltam (usa sua conta ChatGPT)
npm run habbo:moveis -- foosball        # redesenha um, pela chave
npm run habbo:moveis -- --process       # só recorta de novo os brutos de arte-2d/habbo/
```

- O bruto vai para `arte-2d/habbo/` (fora do git). O sprite pronto vai para `src/renderer/src/assets/habbo/<chave>.png`, na escala do Habbo: um tile tem 64 px de largura. A largura de cada um fica em `JOBS` (`scripts/habbo-furni.mjs`).
- Cada sprite é desenhado numa direção, e o app espelha para a outra. Ao redesenhar, confira para onde ficou a frente e acerte o `own('<chave>', 2 | 4)` em `pixel/habbo.ts`. Na direção 2, o comprimento vai na diagonal para baixo-esquerda; na 4, para baixo-direita.
- Laptop e arquivo de aço usam móveis do próprio Habbo (`computer_laptop`, `army_c15_cabinet`). A luminária de mesa do Habbo tem tamanho de móvel de chão; a nossa é desenhada pequena.
- Continuam desenhados pelas peças 3D os objetos com conteúdo ao vivo ou animação: TVs, quadro branco, painéis de custo e de rotinas, placas da sala e da marca, janelas, quadros, elevador, giroflex e o cantinho do café.

## Computadores

As mesas usam o computador do próprio Habbo (`computer_flatscreen`), desmontado em `pixel/habbo-computer.ts`. O processo principal baixa o `.nitro` do móvel (zip da API do HabboAssets) e guarda em `userData/habbo/furni/`.

- O `.nitro` tem duas camadas: o corpo (monitor, teclado e mouse) e a tela. O monitor e o teclado viram duas figuras, porque a mesa os põe em lugares diferentes e a mesa de dois monitores tem um teclado só.
- A camada da tela dá o paralelogramo exato onde o app desenha a tela ao vivo do agente (ou o código rolando, nos monitores extras).
- De costas (a mesa do chefe e as da diretoria), o monitor usa a vista de trás do mesmo móvel.
- O que fica em cima de uma mesa é desenhado depois dela; senão o tampo da figura do Habbo cobre o que está na metade de trás.

## Direitos

A arte é do Habbo (Sulake). O HabboAssets é um arquivo da comunidade, sem vínculo com a Sulake. Antes de distribuir o app com esse visual, confirme se o uso é permitido.

## Sprites do catálogo (retrato e pet)

O retrato do agente e o pet da área de trabalho ainda usam os sprites pixel art do catálogo (`src/renderer/src/assets/pixel/`). As regras abaixo valem para eles.

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
- Moldes recoloríveis (catálogo: `molde-N` e os sprites com `"tint": true`): cada parte só na sua cor-chave, fundo magenta. Móveis usam 3 tons (claro, base, escuro); os moldes de personagem usam 5 e vão ao Codex com a folha `agente-NN` de cabelo parecido como referência de estilo, para sair no mesmo nível de detalhe. Os olhos dos moldes não ficam no desenho: o `npm run pixel` apaga os olhos nas caixas de `characters.eyes` do catálogo e grava onde ficam em cada pose (`molde-N.json`); o app desenha olhos próprios, abertos ou piscando. Ao regerar um molde, confira essas caixas.

| Cor-chave | Personagem | Móvel |
|---|---|---|
| vermelho `#FF0000` | camisa | cor A: tecido, tampo da mesa |
| azul `#0000FF` | calça | cor B: pés e estrutura da mesa |
| amarelo `#FFFF00` | pele | — |
| verde `#00FF00` | cabelo | — |
| ciano `#00FFFF` | sapato | — |

Preto, branco, cinza e marrom ficam como estão (contorno, olhos, metal, madeira).
