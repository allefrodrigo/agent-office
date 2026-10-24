# Prompts de personagens (modo 2D pixel art)

Este guia gera no ChatGPT os sprites de personagens do escritório 2D. Salve cada imagem bruta em `arte-2d/personagens/`, na raiz do repositório, com o nome exato da tabela abaixo, de preferência em PNG. Depois rode `npm run pixel`.

## Arquivos

| Arquivo | O que é | Formato pedido | Final no app |
|---|---|---|---|
| `chefe.png` | o jogador, dono do escritório | folha 4x3, 12 poses | 192x192 (células de 48x64) |
| `agente-01.png` … `agente-08.png` | funcionários (agentes) | folha 4x3, 12 poses | 192x192 (células de 48x64) |
| `caveira.png` | esqueleto que dispensa agentes | pose única | 48x64 |
| `caveira-cabeca.png` | caveira voadora do ataque | pose única | 24x24 |

A fonte da verdade de nomes e tamanhos é `src/shared/pixel-catalog.json`.

## Ordem das 12 poses

| | Coluna 1 | Coluna 2 | Coluna 3 | Coluna 4 |
|---|---|---|---|---|
| **Linha 1** (de pé, parado) | frente | costas | lado (direita) | frente acenando |
| **Linha 2** (andando) | frente | costas | lado (direita) | lado (direita), outra perna à frente |
| **Linha 3** | sentado de frente | sentado de costas | sentado de lado (direita) | caído de costas, nocauteado |

O app espelha o lado esquerdo sozinho. Só existe "lado" virado para a direita.

## Por que as regras existem

O `npm run pixel` acha as 12 poses pelos espaços vazios entre elas, recorta, remove o fundo a partir das bordas e reduz tudo na mesma escala (a pose 1 fica com 46 px de altura). Poses encostadas viram uma só. Escala diferente entre poses faz o boneco crescer e encolher na animação. Texto, sombra ou objeto solto vira "pose" extra.

## Como usar

1. Abra uma conversa nova no ChatGPT.
2. Anexe o print do escritório Dunder Mifflin (visual alvo) e a folha "7 STANDALONE CHARACTER MODELS" (formato das poses). A folha de móveis é opcional: ajuda no contorno e na paleta.
3. Cole a bíblia de estilo.
4. Cole o prompt do chefe. Corrija até ficar certo.
5. Na mesma conversa, cole um agente por mensagem.
6. Baixe em PNG. Não converta para JPG: borra os pixels e perde a transparência.
7. Renomeie, salve em `arte-2d/personagens/` e rode `npm run pixel`.

## 1. Bíblia de estilo

Cole uma vez, no começo da conversa, junto com as referências.

```
Você vai desenhar sprites de personagens para um jogo de escritório em pixel art. Vou pedir um personagem por mensagem. Siga estas regras em TODAS as imagens desta conversa.

REFERÊNCIAS ANEXADAS
- Print do escritório: é o visual alvo (estilo, vista, proporção, cores).
- Folha de personagens: mostra o tipo de pose que quero. Ignore o texto, as molduras, o xadrez e a ordem das colunas dela.
- Não copie personagens, logos nem nomes das referências.

ESTILO
- Pixel art de RPG 16-bit, vista de cima 3/4 (câmera alta, olhando um pouco para baixo), igual ao escritório de referência.
- Proporção chibi: cabeça grande, cerca de 1/3 da altura do corpo.
- Contorno escuro de 1 pixel em volta de toda a figura.
- Paleta limitada (até 16 cores por personagem). Sombreamento simples em 2 a 3 tons. Luz vindo do alto à esquerda.
- Pixels quadrados e nítidos. Sem anti-aliasing, sem desfoque, sem gradiente, sem brilho suave.
- O boneco de pé mede cerca de 46 pixels de arte de altura.

FOLHA DE PERSONAGEM
- Imagem quadrada (1:1) com 12 poses do MESMO personagem, numa grade invisível de 4 colunas x 3 linhas, nesta ordem exata:
  Linha 1, de pé parado: 1 frente | 2 costas | 3 lado, virado para a DIREITA | 4 frente acenando, uma mão erguida acima da cabeça
  Linha 2, andando no meio do passo: 5 frente | 6 costas | 7 lado (direita) | 8 lado (direita) com a outra perna à frente e os braços trocados
  Linha 3: 9 sentado de frente | 10 sentado de costas | 11 sentado de lado (direita) | 12 caído
- Sentado: numa cadeira invisível, joelhos dobrados, coxas na horizontal, pés no chão, mãos à frente como se digitasse. Não desenhe a cadeira.
- Caído: deitado de barriga para cima no chão, na horizontal, cabeça à esquerda, braços abertos, olhos em X. Comprimento igual à altura de pé.
- Lado é sempre virado para a DIREITA. Nenhuma pose olha para a esquerda.

POSE ÚNICA
- Quando eu pedir "POSE ÚNICA", desenhe uma figura só, centralizada, com o mesmo estilo e as mesmas regras de fundo.

REGRAS FIXAS
- Fundo transparente. Se não der, uma única cor chapada, sem textura nem gradiente, que não aparece no personagem: verde #00FF00 (ou azul #0000FF se a roupa for verde).
- Nunca use magenta nem rosa-choque (#FF00FF).
- Mesma escala nas 12 poses: a cabeça tem o mesmo tamanho em todas. Sentado fica mais baixo porque dobra as pernas, não porque encolhe.
- Poses bem separadas, com espaço vazio largo entre elas. Nenhuma parte (cabelo, braço, pé) encosta na pose vizinha.
- Cada pose centralizada na sua célula, com margem até a borda da célula.
- Em cada linha, a sola dos pés de todas as poses fica na mesma linha de chão invisível.
- O mesmo personagem nas 12 poses: mesmas cores, cabelo, roupa e acessórios.
- Sem sombra no chão, sem cenário, sem móveis, sem objetos soltos (balão, estrela, gota, "Zzz").
- Sem texto, números, legendas, molduras, linhas de grade ou xadrez desenhado.

Não gere imagem agora. Responda só "Pronto" e espere o primeiro personagem.
```

## 2. Prompts por personagem

Cada prompt pressupõe a bíblia já colada na conversa.

### chefe.png

```
Personagem: CHEFE, o jogador, dono do escritório.
Homem de pele clara, cabelo castanho curto penteado de lado. Terno azul-marinho, camisa branca, gravata azul-clara, sapatos pretos.
Folha 4x3 com as 12 poses, na ordem da bíblia.
```

### agente-01.png

```
Personagem: AGENTE-01. Mesmo estilo, mesma escala e mesma grade 4x3 da folha do chefe.
Mulher de pele clara com sardas, cabelo castanho-escuro comprido e liso, solto até o meio das costas. Óculos redondos.
Cardigã laranja-abóbora sobre camiseta branca, calça jeans, tênis brancos.
```

### agente-02.png

```
Personagem: AGENTE-02. Mesmo estilo, mesma escala e mesma grade 4x3 da folha do chefe.
Homem de pele negra escura, cabelo black power preto e volumoso. Fone de ouvido grande, preto, na cabeça.
Camisa verde-oliva de manga comprida, calça cáqui, sapatos marrons.
Se o fundo não for transparente, use azul #0000FF.
```

### agente-03.png

```
Personagem: AGENTE-03. Mesmo estilo, mesma escala e mesma grade 4x3 da folha do chefe.
Mulher de pele parda, cabelo castanho-avermelhado preso num coque alto.
Blazer roxo sobre blusa branca, crachá branco pendurado no pescoço por cordão azul, calça preta.
```

### agente-04.png

```
Personagem: AGENTE-04. Mesmo estilo, mesma escala e mesma grade 4x3 da folha do chefe.
Homem de pele clara rosada, careca, barba ruiva curta e cheia.
Camisa vermelha de manga curta, calça cinza-escura, sapatos pretos.
```

### agente-05.png

```
Personagem: AGENTE-05. Mesmo estilo, mesma escala e mesma grade 4x3 da folha do chefe.
Mulher de pele negra, tranças pretas longas até os ombros.
Camisa social azul-claro com mangas dobradas, calça branca, sapatilhas pretas.
```

### agente-06.png

```
Personagem: AGENTE-06. Mesmo estilo, mesma escala e mesma grade 4x3 da folha do chefe.
Homem de pele bronzeada, cabelo preto curto e liso com franja reta. Óculos de armação preta quadrada.
Suéter cinza-grafite sobre camisa branca de gola aparente, calça preta.
```

### agente-07.png

```
Personagem: AGENTE-07. Mesmo estilo, mesma escala e mesma grade 4x3 da folha do chefe.
Homem de pele morena escura, cabelo preto cacheado curto, bigode.
Camisa polo amarela, calça jeans escura, tênis pretos.
```

### agente-08.png

```
Personagem: AGENTE-08. Mesmo estilo, mesma escala e mesma grade 4x3 da folha do chefe.
Mulher de pele morena clara, cabelo loiro preso num rabo de cavalo alto.
Moletom verde-água com capuz caído nas costas, calça cinza-clara, tênis brancos.
Se o fundo não for transparente, use azul #0000FF.
```

### caveira.png

Não é folha 4x3. É uma pose só.

```
POSE ÚNICA: CAVEIRA. Mesmo estilo e mesma altura do chefe de pé.
Esqueleto simpático (sorriso, nada assustador, sem sangue), de pé, de frente, segurando numa das mãos uma foice pequena de cabo curto, na vertical, junto ao corpo. Nem cabo nem lâmina passam do topo da cabeça.
Ossos bege-claro com sombra cinza-quente, lâmina cinza-metálica.
Uma figura só, centralizada, pés no chão invisível, imagem quadrada.
```

### caveira-cabeca.png

Também é pose única.

```
POSE ÚNICA: CAVEIRA-CABEÇA. Mesmo estilo.
Só a cabeça de uma caveira, sem corpo, voando, de frente, com expressão travessa.
Olhos brilhando em roxo-violeta (não magenta). O brilho fica só dentro das órbitas, sem halo nem aura em volta.
Formas grandes e simples: vai virar um ícone de 24x24 px.
Sem rastro, chamas ou partículas soltas. Uma figura só, centralizada, imagem quadrada.
```

## 3. Consistência

- Gere o chefe primeiro. Ele é a régua de estilo e escala dos outros: só siga quando ele estiver certo.
- Faça todos na mesma conversa, um personagem por mensagem.
- Se o estilo desandar numa conversa longa, abra outra. Cole a bíblia, anexe as referências e a folha aprovada do chefe, e diga: "Esta é a folha aprovada do chefe. Use o mesmo tamanho, o mesmo estilo e a mesma grade."
- Peça a folha inteira de novo com a correção. Editar só um trecho costuma mudar a escala ou o estilo daquela pose.

### Como pedir correção

Poses grudadas:

```
As poses estão encostando umas nas outras. Refaça a folha com espaço vazio largo entre todas as poses. Nenhuma parte pode tocar a pose vizinha.
```

Escala diferente entre poses:

```
As poses não estão na mesma escala: a cabeça muda de tamanho. Refaça com a cabeça do mesmo tamanho nas 12 poses, igual à pose 1 (de pé, de frente).
```

Pés desalinhados:

```
Alinhe a sola dos pés de todas as poses de cada linha na mesma linha de chão invisível.
```

Ordem trocada ou grade errada:

```
A ordem está errada. Refaça com exatamente 12 poses em 4 colunas x 3 linhas:
Linha 1: frente | costas | lado (direita) | frente acenando
Linha 2: andando de frente | andando de costas | andando de lado (direita) | andando de lado (direita) com a outra perna à frente
Linha 3: sentado de frente | sentado de costas | sentado de lado (direita) | caído de costas, nocauteado
```

Lado virado para a esquerda:

```
As poses de lado precisam olhar para a DIREITA. Refaça a folha com todas as poses de lado viradas para a direita.
```

Texto, números ou molduras:

```
Remova todo texto, número, legenda, moldura e linha de grade. Deixe só os bonecos sobre o fundo.
```

Sombra ou objeto solto:

```
Tire a sombra do chão e qualquer objeto solto (balão, estrela, gota). Só o personagem.
```

Fundo errado:

```
O fundo precisa ser transparente. Se não conseguir, use uma única cor chapada #00FF00, sem xadrez, textura nem gradiente.
```

Bordas suaves ou borradas:

```
As bordas estão suaves. Refaça em pixel art nítida: pixels quadrados, sem anti-aliasing nem desfoque, contorno escuro de 1 pixel.
```

Personagem muda entre poses:

```
As poses não parecem a mesma pessoa. Refaça com as mesmas cores, cabelo, roupa e acessórios nas 12 poses, iguais à pose 1.
```

## 4. Checklist antes de salvar

- [ ] Folha: 12 poses em 4x3, na ordem da tabela. Pose única: uma figura só.
- [ ] Todas as poses de lado olham para a direita.
- [ ] Nenhuma pose encosta noutra. Nada solto na imagem.
- [ ] A cabeça tem o mesmo tamanho em todas as poses.
- [ ] Os pés de cada linha estão na mesma altura.
- [ ] Sem texto, números, molduras, grade ou sombra no chão.
- [ ] Fundo transparente ou uma cor chapada única.
- [ ] Nenhum magenta (#FF00FF).
- [ ] Mesmas cores, cabelo e acessórios em todas as poses.
- [ ] Pixels nítidos, contorno escuro de 1 px.
- [ ] PNG com o nome exato, salvo em `arte-2d/personagens/`.
