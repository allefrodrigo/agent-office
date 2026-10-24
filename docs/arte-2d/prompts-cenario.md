# Prompts de cenário (modo 2D pixel art)

Este guia gera no ChatGPT os sprites de cenário do escritório 2D: móveis, objetos de parede e pisos. Há um prompt para cada sprite dos grupos `moveis/`, `parede/` e `chao/` de `src/shared/pixel-catalog.json`, a fonte da verdade de nomes e tamanhos. Personagens têm guia próprio: `prompts-personagens.md`, nesta pasta.

## Onde salvar

- Salve cada imagem bruta em `arte-2d/<grupo>/<chave>.png`, na raiz do repositório, com o nome exato da chave. Exemplos: `arte-2d/moveis/sofa.png`, `arte-2d/parede/janela.png`, `arte-2d/chao/chao-copa.png`.
- PNG de preferência. Não converta para JPG: borra os pixels e perde a transparência. O tamanho não importa: o script reduz.
- Rode `npm run pixel`. O script tira o fundo, recorta o objeto, reduz para a caixa `w x h` do catálogo e ancora o centro de baixo da imagem na borda da frente do objeto no chão.
- O que faltar continua com o desenho provisório gerado por código. Entregue aos poucos.

## Como usar

1. Abra uma conversa nova no ChatGPT.
2. Anexe as três referências: `1.png` (escritório em pixel art, o visual alvo), `3.png` (folha "53 modular office assets", o formato de cada objeto) e `2.png` (interface, só o clima).
3. Cole a bíblia de estilo. Espere o "ok".
4. Cole um mini prompt por mensagem.
5. Confira com o checklist, baixe e salve com o nome do título.
6. Peça as variantes (`-lado`, `-costas`, `elevador-aberto`) logo depois do objeto base, na mesma conversa.
7. A cada 15 imagens, ou quando o estilo variar, abra outra conversa: cole a bíblia e anexe dois sprites já aprovados.

## 1. Bíblia de estilo

Cole uma vez, no começo da conversa, junto com as referências.

```
Você vai desenhar sprites de cenário para um jogo de escritório em pixel art. Vou pedir um objeto por mensagem. Siga estas regras em TODAS as imagens desta conversa.

REFERÊNCIAS ANEXADAS
- Print do escritório em pixel art: o visual alvo (traço, vista, paleta). Ignore textos e logos dele.
- Folha "53 modular office assets": mostra cada móvel como eu quero, sozinho, inteiro e isolado. Ignore os cartões, legendas, título e o xadrez cinza: são só a apresentação da folha. Ignore também os monitores girados.
- Tela de interface: só o clima do estilo.

ESTILO
- Pixel art de RPG 16-bit (era Super Nintendo). Pixels quadrados e nítidos. Sem anti-aliasing, sem desfoque, sem degradê suave, sem brilho, sem aparência 3D.
- Contorno escuro de 1 pixel em volta do objeto e nas divisões principais.
- Paleta limitada e alegre: madeira cor de mel, lilás e roxo, verdes vivos nas plantas, cinzas azulados no metal. Sombreamento simples em 2 a 3 tons.
- Luz vindo do alto à esquerda.
- O desenho vai ser reduzido ao tamanho em pixels que eu indicar, às vezes 10 px de largura. Use formas grandes e legíveis e só os detalhes que sobrevivem nesse tamanho.

VISTA
- Top-down 3/4 de RPG 16-bit, como no print do escritório: câmera de frente e de cima, a uns 45 graus. Aparecem o topo e a face da frente do objeto.
- Bordas da frente retas na horizontal, laterais retas na vertical. Sem ponto de fuga, sem isométrico, sem girar o objeto, sem face lateral.
- Exceções que vou pedir pelo nome: "de perfil virado para a direita" é o objeto girado, olhando para a DIREITA (a câmera não muda); "visto por trás" mostra as costas do objeto.
- Escala: 1 tile = 1 metro. Em cada pedido digo a base em tiles, a altura e a proporção do sprite (largura x altura em px). Siga essa proporção.
- Objetos de parede: vistos de frente, chapados, sem a parede desenhada atrás.

COMPOSIÇÃO
- UM objeto por imagem, inteiro, centralizado, com folga nas quatro bordas. Nada cortado.
- Sem chão, tapete ou parede em volta. Sem sombra no chão, nem sombra de contato.
- Sem texto, letras, números, logos, etiquetas, legendas, moldura de cartão ou grade. Nem em telas, livros, revistas ou painéis.
- Fundo transparente. Se não conseguir, uma cor lisa única que não aparece no objeto (nunca magenta).
- Sem variações lado a lado: só a imagem pedida.

REGRA DO MAGENTA
- Quando eu disser que o objeto tem tela ou vidro em magenta, pinte essa área inteira em magenta chapado #FF00FF: um só tom, sem reflexo, sem brilho, sem degradê, sem ícones, retângulo limpo de bordas retas.
- Em qualquer outro lugar, nunca use magenta nem rosa-choque. Para flores e detalhes rosa, use rosa-claro ou salmão.

Mantenha estilo, paleta, contorno e luz iguais em todas as imagens. Não gere nada agora: responda só "ok" e espere o primeiro pedido.
```

## 2. Ordem

Comece pela `moveis/mesa-trabalho`. Corrija até o estilo ficar certo: ela vira a referência das outras.

**Prioridade 1 (25 sprites), nesta ordem:**

- Móveis: `mesa-trabalho`, `mesa-chefe`, `monitor`, `monitor-costas`, `cadeira-escritorio-costas`, `cadeira-chefe`, `sofa`, `mesa-centro`, `estante`, `bebedouro`, `impressora`, `planta-alta`, `planta-arbusto`, `planta-samambaia`, `cafeteira`
- Parede: `janela`, `quadro-mondrian`, `elevador`, `elevador-aberto`
- Pisos: `chao-hall`, `chao-chefe`, `chao-time`, `chao-lounge`, `chao-copa`, `parede-fundo`

**Depois:** os outros 39, na ordem deste guia. Os títulos marcados com (prio 1) são os da lista acima.

## 3. Prompts por sprite

O título é o caminho do arquivo de saída. Cada prompt pressupõe a bíblia já colada.

## Móveis

### Estações de trabalho

#### `arte-2d/moveis/mesa-trabalho.png` (prio 1)

```
Mesa de escritório vazia: tampo claro, pés de metal cinza, gaveteiro de 3 gavetas embaixo do lado direito. Vista pelo lado de quem senta: tampo e vão das pernas à mostra. Base 2x1 tiles, tampo a ~0,76 tile do chão, altura 1,6 tile; proporção 64x52 (largura x altura).
```

#### `arte-2d/moveis/mesa-chefe.png` (prio 1)

```
Mesa executiva de madeira escura, tampo vazio, vista pelo lado das visitas: painel frontal fechado até o chão com um friso dourado. Base 3x1 tiles, altura 1,75 tile; proporção 96x56 (largura x altura).
```

#### `arte-2d/moveis/monitor.png` (prio 1)

```
Monitor de computador de frente, moldura fina, haste e base escuras. A tela inteira em magenta chapado #FF00FF. Base 1x1 tile, altura 0,9 tile; proporção 32x28 (largura x altura).
```

#### `arte-2d/moveis/monitor-costas.png` (prio 1)

```
O mesmo monitor, agora visto por trás: carcaça cinza-escura lisa e a haste. Sem tela à vista, sem magenta. Mesma proporção 32x28 (largura x altura).
```

#### `arte-2d/moveis/notebook.png`

```
Notebook prateado aberto, visto por trás: a tampa lisa, sem logo, e um pouco da base. Sprite minúsculo, formas simples. Base 1x1 tile, altura 0,56 tile; proporção 16x18 (largura x altura).
```

#### `arte-2d/moveis/cadeira-escritorio-costas.png` (prio 1)

```
Cadeira de escritório giratória azul-marinho vista por trás: encosto alto, braços, coluna e base com 5 rodinhas. Base 1x1 tile, altura 1,4 tile; proporção 20x44 (largura x altura).
```

#### `arte-2d/moveis/cadeira-chefe.png` (prio 1)

```
Cadeira de presidente de couro marrom, de frente: encosto alto acolchoado, braços largos, base giratória. Base 1x1 tile, altura 1,75 tile; proporção 24x56 (largura x altura).
```

#### `arte-2d/moveis/cadeira-simples.png`

```
Cadeira de madeira cor de mel com assento estofado laranja, de frente: assento visto de cima e encosto atrás. Base 1x1 tile, altura 1,4 tile; proporção 18x44 (largura x altura).
```

#### `arte-2d/moveis/cadeira-simples-lado.png`

```
A mesma cadeira, agora de perfil virada para a DIREITA. Mesma proporção 18x44 (largura x altura).
```

#### `arte-2d/moveis/cadeira-simples-costas.png`

```
A mesma cadeira, agora vista por trás, com o encosto na frente. Mesma proporção 18x44 (largura x altura).
```

### Lounge

#### `arte-2d/moveis/sofa.png` (prio 1)

```
Sofá de três lugares de tecido azul-petróleo, de frente, com almofadas no encosto e duas almofadas soltas laranja e mostarda. Base 3x1 tiles, altura 1,6 tile; proporção 96x52 (largura x altura).
```

#### `arte-2d/moveis/sofa-lado.png`

```
Sofá de dois lugares laranja, de perfil virado para a DIREITA, como se encostado numa parede à esquerda (não desenhe a parede): assento comprido visto de cima, na vertical, e o braço da frente. Base 1x2 tiles, altura 2,8 tiles; proporção 32x90 (largura x altura).
```

#### `arte-2d/moveis/poltrona.png`

```
Poltrona estofada laranja, de frente, braços largos e pés curtos de madeira. Base 1x1 tile, altura 1,6 tile; proporção 32x52 (largura x altura).
```

#### `arte-2d/moveis/poltrona-lado.png`

```
A mesma poltrona, agora de perfil virada para a DIREITA. Base 1x1 tile, altura 1,8 tile; proporção 28x58 (largura x altura).
```

#### `arte-2d/moveis/mesa-centro.png` (prio 1)

```
Mesa de centro baixa e comprida de madeira cor de mel, com duas revistas (capas sem texto) e uma caneca em cima. Base 3x1 tiles, altura 1,1 tile; proporção 96x36 (largura x altura).
```

#### `arte-2d/moveis/puff.png`

```
Pufe tipo saco (bean bag) roxo-claro, macio, afundado no meio. Base 1x1 tile, altura 1,25 tile; proporção 24x40 (largura x altura).
```

#### `arte-2d/moveis/mesa-baixa.png`

```
Mesinha redonda baixa de madeira cor de mel com uma caneca em cima. Base 1x1 tile, altura 0,9 tile; proporção 22x30 (largura x altura).
```

#### `arte-2d/moveis/tv-lounge.png`

```
TV grande de tela plana sobre um móvel baixo de madeira cor de mel, de frente. A tela inteira em magenta chapado #FF00FF. Base 2x1 tiles, altura 2,6 tiles; proporção 76x84 (largura x altura).
```

### Armazenamento e equipamentos

#### `arte-2d/moveis/estante.png` (prio 1)

```
Estante de madeira cor de mel, de frente, feita para encostar na parede: prateleiras cheias de livros coloridos, lombadas sem texto. Base 2x1 tiles, altura 2,4 tiles; proporção 64x76 (largura x altura).
```

#### `arte-2d/moveis/arquivo.png`

```
Arquivo de aço cinza com três gavetas e puxadores, de frente. Base 1x1 tile, altura 1,3 tile; proporção 32x42 (largura x altura).
```

#### `arte-2d/moveis/bebedouro.png` (prio 1)

```
Bebedouro branco de pé com galão azul de água em cima e duas torneirinhas, azul e vermelha, na frente. Base 1x1 tile, altura 1,8 tile; proporção 18x58 (largura x altura).
```

#### `arte-2d/moveis/impressora.png` (prio 1)

```
Impressora multifuncional grande de escritório, cinza-claro, em cima de um gabinete com porta; bandeja de papel e painel sem texto. Base 1x1 tile, altura 1,5 tile; proporção 28x48 (largura x altura).
```

#### `arte-2d/moveis/lixeira.png`

```
Lixeira cilíndrica cinza de escritório, aberta em cima. Sprite minúsculo, formas simples. Base 1x1 tile, altura 0,6 tile; proporção 10x18 (largura x altura).
```

### Plantas e luz

#### `arte-2d/moveis/planta-alta.png` (prio 1)

```
Planta alta (ficus) num vaso de terracota: tronco fino e copa cheia de folhas verdes. Base 1x1 tile, altura 2,25 tiles; proporção 28x72 (largura x altura).
```

#### `arte-2d/moveis/planta-arbusto.png` (prio 1)

```
Planta arbustiva redonda e cheia num vaso de terracota. Base 1x1 tile, altura 1,4 tile; proporção 26x44 (largura x altura).
```

#### `arte-2d/moveis/planta-samambaia.png` (prio 1)

```
Samambaia de folhas compridas caindo para os lados, num vaso redondo. Base 1x1 tile, altura 1,1 tile; proporção 28x36 (largura x altura).
```

#### `arte-2d/moveis/planta-flor.png`

```
Vasinho branco com flores rosa-claro e amarelas. Sprite minúsculo, formas simples, nada de rosa-choque. Base 1x1 tile, altura 0,6 tile; proporção 14x20 (largura x altura).
```

#### `arte-2d/moveis/cacto.png`

```
Cacto pequeno de mesa num vasinho de terracota, com uma flor rosa-claro no topo. Sprite minúsculo, formas simples. Base 1x1 tile, altura 0,7 tile; proporção 10x22 (largura x altura).
```

#### `arte-2d/moveis/luminaria-chao.png`

```
Luminária de chão acesa: base redonda, haste preta fina, cúpula amarela. Sem halo de luz em volta. Base 1x1 tile, altura 1,9 tile; proporção 14x62 (largura x altura).
```

#### `arte-2d/moveis/luminaria-mesa.png`

```
Luminária de mesa articulada amarela. Sprite minúsculo, 8 px de largura: silhueta simples, 2 a 3 cores. Base 1x1 tile, altura 0,4 tile; proporção 8x14 (largura x altura).
```

### Lazer

#### `arte-2d/moveis/pebolim.png`

```
Mesa de pebolim vermelha, campo verde, bonequinhos azuis e amarelos nas barras, vista pelo lado comprido, com os puxadores virados para nós. Base 2x1 tiles, altura 2 tiles; proporção 44x64 (largura x altura).
```

#### `arte-2d/moveis/pingue-pongue.png`

```
Mesa de pingue-pongue verde com linhas brancas e pés de metal, vista pelo lado comprido: a rede branca corta a mesa no meio, de trás para a frente. Base 2x1 tiles, altura 1,9 tile; proporção 64x60 (largura x altura).
```

#### `arte-2d/moveis/fliperama.png`

```
Máquina de fliperama roxa, de frente: letreiro em cima sem texto, joystick e botões coloridos no painel. A tela inteira em magenta chapado #FF00FF. Base 1x1 tile, altura 2,7 tiles; proporção 26x86 (largura x altura).
```

#### `arte-2d/moveis/fliperama-costas.png`

```
A mesma máquina de fliperama, agora vista por trás: painel traseiro roxo liso com grade de ventilação. Sem magenta. Mesma proporção 26x86 (largura x altura).
```

### Copa

#### `arte-2d/moveis/mesa-redonda.png`

```
Mesa redonda de café, tampo branco, pé central e base redonda. Base 1x1 tile, altura 1,9 tile; proporção 36x60 (largura x altura).
```

#### `arte-2d/moveis/banqueta.png`

```
Banqueta alta de bar: assento redondo turquesa, pé de metal e apoio para os pés. Base 1x1 tile, altura 1,1 tile; proporção 14x36 (largura x altura).
```

#### `arte-2d/moveis/mesa-bar.png`

```
Mesa alta de bar: tampo redondo de madeira cor de mel, pé central de metal, base redonda. Base 1x1 tile, altura 1,9 tile; proporção 28x62 (largura x altura).
```

#### `arte-2d/moveis/bancada.png`

```
Um único módulo de bancada de cozinha, de frente: armário branco com uma porta e puxador, tampo cinza. Laterais retas, para encaixar ao lado de outros módulos. Base 1x1 tile, altura 1,6 tile; proporção 32x50 (largura x altura).
```

#### `arte-2d/moveis/bancada-lado.png`

```
O mesmo módulo de bancada, agora de perfil virado para a DIREITA, como se encostado numa parede à esquerda (não desenhe a parede): tampo cinza visto de cima, comprido na vertical, e a lateral do armário. Base 1x1 tile, altura 1,9 tile; proporção 20x60 (largura x altura).
```

#### `arte-2d/moveis/bancada-costas.png`

```
O mesmo módulo de bancada, agora visto por trás: painel liso branco e tampo cinza. Mesma proporção 32x50 (largura x altura).
```

#### `arte-2d/moveis/geladeira.png`

```
Geladeira branca de duas portas (congelador em cima), de frente, puxadores cinza e alguns ímãs coloridos. Base 1x1 tile, altura 2,5 tiles; proporção 24x80 (largura x altura).
```

#### `arte-2d/moveis/geladeira-lado.png`

```
A mesma geladeira, agora de perfil virada para a DIREITA. Base 1x1 tile, altura 2,6 tiles; proporção 22x82 (largura x altura).
```

#### `arte-2d/moveis/geladeira-costas.png`

```
A mesma geladeira, agora vista por trás: painel traseiro liso com a grade do motor embaixo. Mesma proporção 24x80 (largura x altura).
```

#### `arte-2d/moveis/micro-ondas.png`

```
Micro-ondas branco pequeno, de frente: porta com visor escuro (não magenta) e botões sem números. Sprite minúsculo, formas simples. Base 1x1 tile, altura 0,6 tile; proporção 16x20 (largura x altura).
```

#### `arte-2d/moveis/cafeteira.png` (prio 1)

```
Máquina de espresso preta e compacta com uma xícara branca embaixo do bico. Sprite pequeno, formas simples. Base 1x1 tile, altura 0,9 tile; proporção 14x28 (largura x altura).
```

### Terraço

#### `arte-2d/moveis/tanque-agua.png`

```
Caixa d'água cilíndrica azul-acinzentada de telhado, com tampa, sobre uma base de metal com pés. Base 1x1 tile, altura 2,6 tiles; proporção 36x84 (largura x altura).
```

#### `arte-2d/moveis/ar-condicionado.png`

```
Condensadora de ar-condicionado de telhado: caixa de metal cinza com o ventilador redondo e a grade à vista em cima. Base 1x1 tile, altura 1,75 tile; proporção 36x56 (largura x altura).
```

## Parede

Todos vistos de frente, chapados, sem a parede atrás.

#### `arte-2d/parede/janela.png` (prio 1)

```
Janela de parede, de frente: moldura branca, cruz no meio dividindo 4 vidros, peitoril embaixo. Os 4 vidros inteiros em magenta chapado #FF00FF. Vaga de 2 tiles na parede, altura 1,4 tile; proporção 80x46 (largura x altura).
```

#### `arte-2d/parede/quadro-mondrian.png` (prio 1)

```
Quadro de parede com moldura fina de madeira, estilo Mondrian: retângulos vermelho, azul e amarelo sobre branco, linhas pretas grossas. Vaga de 1 tile na parede, altura 0,9 tile; proporção 36x28 (largura x altura).
```

#### `arte-2d/parede/quadro-montanhas.png`

```
A mesma moldura do quadro anterior, agora com montanhas e céu azul. Mesma proporção 36x28 (largura x altura).
```

#### `arte-2d/parede/quadro-por-do-sol.png`

```
A mesma moldura, agora com um pôr do sol laranja sobre o mar. Mesma proporção 36x28 (largura x altura).
```

#### `arte-2d/parede/quadro-planta.png`

```
A mesma moldura, agora com a ilustração de uma folha verde sobre fundo creme. Mesma proporção 36x28 (largura x altura).
```

#### `arte-2d/parede/relogio.png`

```
Relógio de parede redondo: mostrador branco, aro preto, ponteiros pretos, sem números. Sprite minúsculo. Vaga de 1 tile na parede, altura 0,5 tile; proporção 16x16 (quadrado).
```

#### `arte-2d/parede/elevador.png` (prio 1)

```
Porta de elevador fechada, de frente: duas folhas de aço escovado com fenda no meio, moldura cinza, luz verde acesa em cima, botoeira à direita. Vaga de 2 tiles na parede, altura 2,6 tiles; proporção 56x82 (largura x altura).
```

#### `arte-2d/parede/elevador-aberto.png` (prio 1)

```
O mesmo elevador, com a mesma moldura, luz e botoeira, agora com as portas abertas e a cabine iluminada por dentro com luz quente. Mesma proporção 56x82 (largura x altura).
```

#### `arte-2d/parede/tv-parede.png`

```
TV fina de parede, de frente, moldura preta fina. A tela inteira em magenta chapado #FF00FF. Vaga de 2 tiles na parede, altura 0,9 tile; proporção 52x30 (largura x altura).
```

#### `arte-2d/parede/sirene.png`

```
Sirene vermelha de alarme presa num suporte de metal de parede, de frente. Sprite minúsculo, formas simples. Vaga de 1 tile na parede, altura 0,4 tile; proporção 12x14 (largura x altura).
```

## Pisos

Pisos mudam as regras de fundo e vista. Antes do primeiro piso, cole este bloco na mesma conversa (ou numa nova, depois da bíblia):

```
Agora vamos fazer texturas de piso. Estilo, paleta e luz continuam os mesmos. Mudam estas regras:
- Vista de cima, reta, como planta baixa. Sem perspectiva.
- A textura preenche a imagem inteira. Sem fundo transparente, sem objeto, sem nada em cima do piso.
- Textura contínua (seamless/tileable): a borda direita casa com a esquerda e a de cima casa com a de baixo, sem emenda ao repetir.
- Cor e luz uniformes: sem vinheta, sem mancha de luz, sem sombra.
- Imagem quadrada, salvo quando eu pedir outro formato.
Responda só "ok".
```

#### `arte-2d/chao/chao-hall.png` (prio 1)

```
Piso de corredor de escritório: placas quadradas de vinil cinza-lilás claro em grade 2x2, rejunte fino, manchinhas discretas. Textura contínua; cobre 2x2 tiles; imagem quadrada, proporção 64x64.
```

#### `arte-2d/chao/chao-chefe.png` (prio 1)

```
Piso de tábuas de madeira cor de mel da sala do chefe: 8 fileiras horizontais de tábuas estreitas, emendas desencontradas, veios sutis. Textura contínua; cobre 2x2 tiles; imagem quadrada, proporção 64x64.
```

#### `arte-2d/chao/chao-time.png` (prio 1)

```
Carpete de escritório azul-acinzentado com trama discreta: grade de 2x2 placas de carpete, com a trama alternando de direção. Textura contínua; cobre 2x2 tiles; imagem quadrada, proporção 64x64.
```

#### `arte-2d/chao/chao-lounge.png` (prio 1)

```
Piso de madeira clara (bege-areia) do lounge: 4 fileiras horizontais de tábuas largas, emendas desencontradas. Textura contínua; cobre 2x2 tiles; imagem quadrada, proporção 64x64.
```

#### `arte-2d/chao/chao-copa.png` (prio 1)

```
Piso de ladrilho xadrez creme e terracota da copa: 4x4 ladrilhos quadrados alternados, rejunte fino. Textura contínua; cobre 2x2 tiles; imagem quadrada, proporção 64x64.
```

#### `arte-2d/chao/chao-deck.png`

```
Deck de madeira de terraço: 4 fileiras horizontais de tábuas cor de mel acinzentada, frestas escuras entre elas, pregos à vista. Textura contínua; cobre 2x2 tiles; imagem quadrada, proporção 64x64.
```

#### `arte-2d/chao/parede-fundo.png` (prio 1)

```
Exceção: faixa da parede do fundo vista de FRENTE, preenchendo a imagem inteira, contínua só na horizontal (borda esquerda casa com a direita). De cima para baixo: lilás claro liso; lambri de ripas verticais lilás mais escuro no terço de baixo; rodapé roxo fino no pé. Sem janela, quadro, tomada ou sombra. Largura 2 tiles, altura 2,75 tiles; imagem em pé, proporção 64x88.
```

## 4. Como pedir correção

Responda na mesma conversa com a frase do problema. Para consertar só um pedaço, selecione a área no editor de imagem do ChatGPT e cole a frase.

- **Perspectiva torta, isométrico ou face lateral:** `Refaça o mesmo objeto de frente, com a câmera de cima a 45 graus, como no print do escritório: bordas da frente retas na horizontal, sem face lateral, sem ponto de fuga.`
- **Objeto cortado:** `Refaça com o objeto inteiro e menor, centralizado, com folga nas quatro bordas.`
- **Sombra ou chão desenhado:** `Tire a sombra e todo o chão em volta. Só o objeto, fundo transparente.`
- **Texto, número ou logo:** `Tire todo texto, letra, número e logo, inclusive da tela, das lombadas e dos painéis.`
- **Várias peças numa imagem:** `Só um objeto por imagem. Refaça apenas o <objeto>, sem variações ao lado.`
- **Magenta com degradê, reflexo ou ícone:** `A tela deve ser um retângulo #FF00FF chapado, um só tom, sem reflexo, brilho, degradê ou ícones.`
- **Magenta ou rosa-choque fora da tela:** `Troque todo magenta e rosa-choque fora da tela por rosa-claro ou outra cor da paleta.`
- **Visual borrado, suave ou 3D:** `Deixe em pixel art 16-bit de verdade: pixels nítidos, sem anti-aliasing, sem degradê suave, contorno escuro de 1 pixel.`
- **Proporção errada:** `Está alto (ou largo) demais. Refaça na proporção <L>x<A> (largura x altura).`
- **Variante "-lado" virada para a esquerda:** `Espelhe: o objeto deve olhar para a DIREITA.`
- **Piso com emenda:** `As bordas não casam. O que sai pela direita deve entrar pela esquerda, e o de cima casar com o de baixo. Sem vinheta nem luz variando.`
- **Estilo mudou no meio da conversa:** anexe a `mesa-trabalho` aprovada e escreva `Mantenha exatamente o estilo, o contorno e a paleta desta imagem.`

Fundo xadrez desenhado (transparência falsa) não é problema: o script tira fundo liso ou xadrez pelas bordas.

## 5. Checklist antes de salvar

- [ ] Um objeto só, inteiro, sem nada cortado.
- [ ] Vista certa: topo e frente; perfil para a direita nos `-lado`; costas nos `-costas`; de frente nos de parede.
- [ ] Fundo transparente ou liso. Sem chão, sem sombra.
- [ ] Sem texto, número, logo, cartão ou grade.
- [ ] Magenta chapado só na tela ou vidro dos itens que pedem. Nenhum magenta no resto.
- [ ] Proporção largura x altura perto da pedida.
- [ ] Pixels nítidos, contorno de 1 px, luz da esquerda, mesmo estilo dos sprites aprovados.
- [ ] Pisos: preenchem a imagem e repetem sem emenda.
- [ ] Arquivo em `arte-2d/<grupo>/<chave>.png`, nome exato da chave, em PNG.
- [ ] `npm run pixel` rodado e resultado conferido no app.
