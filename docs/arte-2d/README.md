# Modo 2D

O escritório pode ser desenhado em 2D isométrico, em pixel art própria. É uma opção para computadores mais fracos: não usa WebGL, sombra nem pós-processamento, nem internet. O isométrico 3D continua como padrão.

## Ligar

Configurações → Vídeo → **Visual** → *2D pixel art (mais leve)* → Salvar. A janela recarrega no novo visual. Para voltar, escolha *Isométrico 3D (padrão)*.

Em dev, `AGENT_OFFICE_VIEW=2d npm run dev` abre em 2D sem mexer nas configurações (vale também para `npm run bench` e para as capturas com `AGENT_OFFICE_SHOTS`).

## Como funciona

- O jogo é o mesmo: andares, agentes, caminhos, cliques e etiquetas. Muda só quem desenha (`src/renderer/src/pixel/`).
- Projeção: um tile é um losango de 64 x 32, x desce para a direita e z para a esquerda. As paredes do fundo (z = 0 e x = 0) fecham a sala por cima, como no 3D.
- Cada móvel com px() tag que tem sprite vira a imagem de `src/renderer/src/assets/iso/<chave>.png`. A tabela fica em `pixel/iso-art.ts` (`BY_TAG`, `PLANTS`, `SOFAS`).
- O resto (paredes, vidro, quadros, elevador, TVs, painéis) é desenhado a partir das peças do modelo 3D, projetadas em isométrico (`pixel/voxel.ts`). Telas, céu das janelas e placas continuam ao vivo.
- Pessoas: `pixel/people.ts`, com as cores do visual de cada um (Configurações → Você e o editor de modelo dos agentes: cores e corte de cabelo). Enquanto as folhas carregam, o avatar 3D aparece desenhado plano.

## Móveis

```sh
npm run arte:iso                       # desenha os que faltam (usa sua conta ChatGPT)
npm run arte:iso -- desk sofa3         # redesenha estes, pela chave
npm run arte:iso -- --process [chaves] # só recorta de novo os brutos de arte-2d/iso/
npm run arte:iso -- --list             # os jobs e quais já estão prontos
```

- Os prompts e o tamanho 3D de cada móvel (comprimento, profundidade, altura, em tiles) ficam em `scripts/iso/prompts.mjs` (`ISO_JOBS`). A largura do sprite sai do tamanho: (comprimento + profundidade) x 32 px.
- Para cada job, o script desenha uma caixa cinza em isométrico 2:1 exato (`arte-2d/iso/_blockout-<chave>.png`) e manda junto com o prompt, para o Codex manter o ângulo do piso. A mesa (`desk`) sai primeiro e vai junto como régua de estilo.
- O bruto vai para `arte-2d/iso/` (fora do git); o sprite pronto, para `src/renderer/src/assets/iso/<chave>.png`.
- Direção: a arte de frente olha para baixo-direita (direção 2); espelhada, vira a 4. A arte `<chave>-back` mostra o móvel de costas (direção 6); espelhada, a 0. Sem `-back`, o móvel mostra a frente também de costas.
- Móvel novo: crie o job em `ISO_JOBS`, rode `npm run arte:iso -- <chave>` e ligue a tag em `BY_TAG` (`pixel/iso-art.ts`).

## Pessoas

```sh
npm run arte:pessoas                       # desenha as folhas que faltam (molde-0 primeiro: a régua)
npm run arte:pessoas -- molde-3            # redesenha esta
npm run arte:pessoas -- --process [chaves] # só recorta de novo os brutos de arte-2d/iso/people/
```

- Uma folha por corte de cabelo (`Look.hairStyle` 0 a 5): `src/renderer/src/assets/iso/people/molde-N.png`. Prompts em `scripts/iso/people.mjs`.
- Grade de 4 x 3 células de 64 x 100. Linha 1, três-quartos de frente: em pé, andando, andando, acenando. Linha 2, três-quartos de costas: em pé, andando, andando, sentado. Linha 3: sentado de frente, caído, falando, sentado falando. Espelhadas, cobrem as outras duas diagonais.
- Cada parte é pintada na sua cor-chave, em 5 tons; `pixel/tint.ts` troca pela cor do visual de cada um: amarelo `#FFFF00` pele, verde `#00FF00` cabelo, vermelho `#FF0000` camisa, azul `#0000FF` calça, ciano `#00FFFF` sapato. Contorno, olhos e boca ficam como estão.

## Telas

A tela do monitor é pintada em magenta `#FF00FF`. O app transforma esses pixels numa máscara e desenha ali a tela ao vivo do agente (ou o código rolando, nos monitores extras). De costas, o monitor usa `monitor-back`.

## Direitos

Toda a arte 2D é original, desenhada para este projeto com o Codex a partir dos nossos prompts. Não há sprite de terceiros.

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
