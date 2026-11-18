# 0017 — Portão de envio do CRM

- **Status:** aceito (2026-11-17). As 8 mudanças no spec e os falsos positivos das palavras de saída ("vou sair pra almoçar", "não quero que pare de mandar") foram aprovados pelo usuário antes do CR-11.
- **Origem:** spike S-3 do [plano da Sala de CRM](../prd/sala-de-crm-plano.md); regras em [sala-de-crm.md](../prd/sala-de-crm.md), "O portão de envio".
- **Corpus:** [`test/fixtures/crm-gate-cases.json`](../../test/fixtures/crm-gate-cases.json), 185 casos. `test/crm-gate-cases.test.ts` confere a forma do corpus; o portão em si é do CR-11.

## Contexto

Toda mensagem do CRM, do bot ou sua, passa por um trecho de código que decide se ela sai, espera você, é barrada ou fica para depois. O modelo propõe; o portão decide. O spec lista 14 regras em ordem, mas deixa abertas a forma da entrada, a diferença entre "aprovar" e "passar por cima", e o que conta como dia, semana, resposta e texto igual. Este ADR fecha essas pontas para que o CR-11 escreva o código contra uma tabela, não contra uma ideia.

## Decisão

### 1. Uma função pura

`gate(draft, ctx): GateDecision` em `src/shared/crm-gate.ts`. Sem IA, sem rede, sem relógio próprio (`ctx.now` entra pronto) e sem estado. A primeira regra que falha decide. A `Outbox` chama o portão ao enfileirar e de novo no instante de enviar.

### 2. A entrada

| Campo       | O que é                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `now`       | Instante da decisão, ISO com deslocamento. O relógio de parede (janela, dia, feriado) é lido no fuso da máquina.                                                                                                              |
| `connected` | WhatsApp conectado agora.                                                                                                                                                                                                     |
| `settings`  | As regras de `CrmSettings`: `rehearsal`, `autonomy`, `hours`, `holidays`, `perCustomer`, `offerEveryDays`, `globalCap`, `maxDiscountPct`, `allowedLinks`, `stopAll`, `payment`.                                               |
| `customer`  | O cliente do destino, ou `null` se não existe: `id`, `phones`, `phoneChecked`, `group`, `consent` (`service`, `billing`, `offers`, `optOutAt`), `handedToPlayer`, `phoneReplyAt`.                                             |
| `payments`  | Os pagamentos desse cliente (`id`, `amountCents`, `due`, `state`, `reference`).                                                                                                                                               |
| `history`   | O que já saiu para esse cliente: `at`, `category`, `initiated`, `text` (já preenchido). Quem monta o histórico classifica `initiated`.                                                                                        |
| `global`    | `lastHour` e `today` (todos os envios do escritório, iniciados e respostas) e `oldestInHour` (o envio mais antigo da última hora).                                                                                            |
| `run`       | A rodada do bot: `{ kind: 'customer', customerId }`, `{ kind: 'schedule' }` ou `{ kind: 'suggestion', suggestionId, customerIds }`. `null` para mensagem sua ou do sistema.                                                   |
| `draft`     | `customerId`, `by` (`bot`, `player` ou `system`), `edited`, `category`, `text` (com os marcadores ainda por preencher), `replyTo` (`{ id, at }` da mensagem respondida, ou `null`), `paymentId`, `discountPct`, `validUntil`. |
| `approved`  | Você clicou "Enviar" no cartão do rascunho.                                                                                                                                                                                   |
| `override`  | Você confirmou "Enviar mesmo assim".                                                                                                                                                                                          |

### 3. A saída

`GateDecision` de `src/shared/types/crm.ts`: `action` (`send`, `hold`, `block`, `schedule`), `rule` (1 a 14, ou 0 quando passou em tudo), `reason` em pt-BR, `at` (só em `schedule`), `rehearsal` (só na regra 13) e `overridable`.

### 4. Três autores, dois tipos de sim

- **Bot:** texto escrito pelo modelo. Todas as regras valem.
- **Você:** texto seu. As regras de rodada (3), desconto (7), conversa com você (9), ensaio (13) e autonomia (14) não valem: mandar já é o seu sim. Dado de pagamento que você digita é escolha sua.
- **Sistema:** texto fixo do app (régua sem bot, confirmação de saída das ofertas). Vale como bot, menos a regra 3.

O rascunho de bot que você **edita** continua texto de modelo para as regras 5 e 6: uma chave PIX trocada passa despercebida num texto longo, e é exatamente esse o ataque. Quem quer mandar uma chave à mão escreve uma mensagem nova.

Há dois tipos de sim, e eles não se misturam:

- **Aprovar** (`approved`): o "Enviar" do cartão. Resolve o que "espera você": regras 7, 9, 13 e 14.
- **Enviar mesmo assim** (`override`): uma segunda confirmação, com o motivo à vista. Passa por cima só do que o spec deixa: horário (10), limites por cliente (11), texto repetido (8) e, em texto seu, permissão de atendimento ou cobrança (4), cobrança sem pagamento aberto (5) e link fora da lista (6). A decisão traz `overridable: true` quando esse botão aparece.

Nada passa por cima de: Parar tudo e conexão (1), cliente e número (2), rodada (3), oferta a quem saiu ou não aceitou (4), dado de pagamento ou cobrança do modelo (5 e 6) e teto global (12).

### 5. As regras, na ordem

| #   | Regra                                                                                                       | Vale para                                      | Falhou                            | Enviar mesmo assim                       |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------- | ---------------------------------------- |
| 1   | Parar tudo desligado e WhatsApp conectado                                                                   | todos                                          | barra                             | não                                      |
| 2   | O cliente existe, tem telefone, o número foi conferido e não é grupo                                        | todos                                          | barra                             | não                                      |
| 3   | O destino está no escopo da rodada                                                                          | bot                                            | barra                             | não                                      |
| 4   | O cliente aceita a categoria                                                                                | todos                                          | barra                             | oferta: não; atendimento e cobrança: sim |
| 5   | Cobrança com dados do sistema; nada com cara de cobrança fora da categoria                                  | bot e sistema (você: só "há pagamento aberto") | barra                             | bot: não; você: sim                      |
| 6   | Sem link fora da lista; sem dado de pagamento escrito pelo modelo                                           | links: todos; dados: bot e sistema             | barra                             | bot: não; você: sim                      |
| 7   | Desconto dentro do teto e da validade                                                                       | bot                                            | espera você                       | não (aprovar resolve)                    |
| 8   | Texto diferente do que saiu para o cliente nas últimas 24 h                                                 | todos                                          | barra                             | sim                                      |
| 9   | Conversa não passada para você, sem resposta sua pelo celular em 12 h, mensagem respondida com menos de 2 h | bot e sistema                                  | espera você                       | não (aprovar resolve)                    |
| 10  | Dentro da janela de envio                                                                                   | todos                                          | agenda para a próxima janela      | sim                                      |
| 11  | Limites por cliente                                                                                         | todos, só o que nós iniciamos                  | espera você                       | sim                                      |
| 12  | Teto global por hora e por dia                                                                              | todos, respostas incluídas                     | agenda para a vaga                | não                                      |
| 13  | Modo ensaio desligado                                                                                       | bot e sistema, categoria em Autônomo           | espera você, "teria sido enviada" | não (aprovar resolve)                    |
| 14  | Categoria em Autônomo                                                                                       | bot e sistema                                  | espera você                       | não (aprovar resolve)                    |

### 6. Cada regra, em detalhe

**1 · Parar tudo e conexão.** `settings.stopAll` ligado ou `connected` falso barra. A `Outbox` confere de novo no instante de enviar. O cartão do rascunho barrado por conexão continua com "Enviar": a decisão vale para esta tentativa.

**2 · Cliente e número.** `customer` nulo, sem telefone, `phoneChecked` falso ou `group` verdadeiro barra. O motivo manda conferir o número na ficha.

**3 · Escopo da rodada.** Rascunho de bot sem rodada barra. Rodada de cliente só fala com aquele cliente. Rodada de agenda (Vendedor) nunca propõe mensagem direta: ela cria Sugestões. Rodada de sugestão aprovada só fala com quem está na lista. Aprovar não conserta o escopo.

**4 · Categoria aceita.** Oferta exige `consent.offers` e nenhum `optOutAt`, e ninguém passa por cima. Atendimento exige `consent.service`; cobrança, `consent.billing`; nesses dois, você passa por cima com confirmação. Atendimento a quem saiu das ofertas sai normalmente.

**5 · Cobrança com dados do sistema** (texto de bot ou do sistema):

- Existe pagamento do cliente em `open` (vencido conta; `paid`, `canceled` e `disputed` não). Com `paymentId`, ele precisa ser desse cliente e estar aberto. Sem `paymentId`, só passa se houver um único pagamento aberto.
- O texto tem `{valor}`, `{vencimento}` e `{pagamento}` (`{referente}` é opcional).
- Fora dos marcadores, todo número precisa bater com o pagamento: o valor (480, 480,00 ou R$ 480,00) ou o vencimento (20/11, 20/11/2026, dia 20). Valor por extenso ("quatrocentos e oitenta reais") barra, mesmo quando bate.
- **Cobrança disfarçada:** texto de bot em Atendimento ou Oferta com `{pagamento}`, ou com valor em reais ou data junto de uma palavra de cobrança (boleto, PIX, pagamento, vencimento, vence, fatura, cobrança), barra e manda usar a categoria Cobrança.

Na cobrança que você escreve, vale só "há pagamento aberto", com "Enviar mesmo assim".

**6 · Links e dados de pagamento.**

- **Links** (todos os autores): URL com ou sem `http`, domínio solto (inclusive com espaço em volta do ponto), encurtador e `wa.me`. Passa o domínio da lista e os subdomínios dele. `estudioexemplo.com.br.golpe.io` e `golpe.io/estudioexemplo.com.br` não passam. No texto seu, "Enviar mesmo assim" libera.
- **Dados de pagamento** (texto de bot ou do sistema, editado ou não): CPF, CNPJ, e-mail, telefone, chave aleatória (UUID), linha digitável de boleto, cartão (13 a 19 dígitos com Luhn), agência e conta, PIX copia e cola (`000201…br.gov.bcb.pix`). Disfarces contam: dígitos separados por espaço ou ponto, "arroba" e "ponto" por extenso, dígitos por extenso no meio de um número. Os dados do sistema entram por `{pagamento}` e não são lidos aqui. Números comuns (pedido 4521, 3 dias, 19/11, 14:30, R$ 480,00 sem palavra de cobrança) passam.

**7 · Desconto** (oferta de bot). O desconto vem de `discountPct` e do texto ("15%", "15 por cento"). Espera você quando passa de `maxDiscountPct`, quando o texto e o campo não batem, quando o texto fala em desconto sem declarar, ou quando falta `validUntil` ou ele já passou. Com o teto padrão (0%), todo desconto do bot espera você.

**8 · Texto repetido.** Barra o texto igual a um já enviado ao cliente nas últimas 24 h (iniciado ou resposta). Igual ignora caixa, acento, espaços e pontuação. A comparação usa o texto já preenchido (`fillPayment`).

**9 · Conversa com você.** Espera você quando a conversa foi passada para você, quando você respondeu pelo celular há menos de 12 h, ou quando o rascunho responde a uma mensagem com mais de 2 h. Este último é o "resposta a mensagem velha sempre espera você" do spec, posto aqui para não depender de o handoff ter rodado antes.

**10 · Janela de envio.** `hours[dia da semana]` em hora local: início incluído, fim excluído (18:00 em ponto já está fora). Feriado não tem janela. Fora da janela, `schedule` com `at` no início da próxima janela, contando feriados e o horário de verão do fuso. Resposta a mensagem recebida há menos de 15 min passa, mesmo no domingo ou num feriado.

**11 · Limites por cliente.** Valem só para mensagem iniciada por nós (`replyTo` nulo) e contam só as iniciadas do histórico, de qualquer autor:

- dia: o dia do calendário local;
- semana: os últimos 7×24 h;
- ofertas: as ofertas iniciadas nos últimos `offerEveryDays`×24 h.

Passa quando o que já saiu é menor que o limite.

**12 · Teto global.** Conta todos os envios do escritório, respostas incluídas, e vale para toda mensagem. Hora cheia: `at` = `oldestInHour` + 1 h. Dia cheio: início da janela do próximo dia. Se o `at` cair fora da janela, vai para o início da próxima. Ninguém passa por cima: o teto protege o número de um bloqueio do WhatsApp.

**13 · Modo ensaio.** Vale só para rascunho de bot ou do sistema, não aprovado, cuja categoria está em Autônomo: espera você com `rehearsal: true` ("teria sido enviada"). Mensagem sua e rascunho aprovado saem de verdade.

**14 · Autonomia.** Rascunho e Aprovação esperam você; Autônomo envia. O motivo diz qual: "Rascunho: o bot só escreve nesta categoria" ou "Espera você: Atendimento está em Aprovação".

## Mudanças no spec

O spec continua valendo; estes pontos ele não dizia, ou dizia de um jeito que não fechava:

1. **Regra 4 cobre atendimento e cobrança.** O spec guarda `consent.service` e `consent.billing` na ficha, mas a tabela só olhava a oferta. Sem isso, desmarcar "Cobrança" na ficha não teria efeito.
2. **Regra 5 pega a cobrança disfarçada** (texto de bot em outra categoria com valor e palavra de cobrança, ou com `{pagamento}`) e a cobrança sem `paymentId` com mais de um pagamento aberto. Sem isso, o bot fugiria da regra trocando a categoria.
3. **Regra 6 trata telefone como chave PIX.** O bot não escreve telefone. Se o negócio quiser mandar o próprio número, isso vira um marcador do sistema numa fase seguinte.
4. **Regra 9 inclui a mensagem com mais de 2 h**, que o spec cita na seção da Evolution.
5. **Regra 12 conta respostas.** O spec diz "regras 10 a 12 contam só mensagens iniciadas por nós" e, na frase seguinte, que a resposta "respeita o teto global". Fica assim: 10 e 11 isentam respostas (a 10, só as de menos de 15 min); a 12 conta e vale para tudo.
6. **Regra 13 só vale em Autônomo.** Na ordem do spec, um rascunho em Aprovação com o ensaio ligado mostraria "teria sido enviada", o que é falso: ele esperaria você de qualquer jeito. Quem decide é a regra 14.
7. **"Passar por cima" tem dois níveis** (aprovar e enviar mesmo assim), com a lista da seção 4. O spec dizia "você pode passar por cima dos limites de frequência e horário"; o teto global fica de fora, pelo motivo da regra 12.
8. **A confirmação de saída das ofertas segue a autonomia de Atendimento.** No padrão (Aprovação), ela espera você como qualquer atendimento. Quem quiser que ela saia sozinha põe Atendimento em Autônomo.

## Casos do corpus

O JSON tem a `base` (uma resposta do bot dentro da regra, tudo em Autônomo, ensaio desligado, quarta-feira 18/11/2026 às 10:00 em São Paulo) e um `patch` por caso. Por grupo: 5 casos que passam em tudo, de 5 a 30 por regra (30 na regra 6, a dos disfarces) e 10 de ordem, em que duas regras falham e a primeira decide. Dois casos usam o fuso de Nova York para o começo e o fim do horário de verão.

## O que ficou decidido no CR-11

O código está em `src/shared/crm-gate.ts`. Os testes: o corpus em `test/crm-gate-cases.test.ts` (cada caso no seu fuso), uma bateria por regra e as propriedades em `test/crm-gate.test.ts`, os detectores em `test/crm-gate-detectors.test.ts`. Cobertura de linhas: 100%.

**`fillPayment(text, payment, settings)`.** Uma passada só: o que entra não é lido de novo.

| Marcador       | Vira                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `{valor}`      | `R$ 480,00`                                                                                                                                 |
| `{vencimento}` | `20/11/2026`                                                                                                                                |
| `{referente}`  | o "referente a" do pagamento                                                                                                                |
| `{pagamento}`  | uma linha por dado: `Chave PIX (CNPJ): …`, `Favorecido: …`, `Banco: …` e o texto fixo. Linha vazia sai; tipo de chave vazio sai sem rótulo. |

Marcador sem dado (sem pagamento; `{pagamento}` sem chave PIX) fica como está, e a regra 5 barra.

**Textos de `reason`.** Curtos, em pt-BR, dizendo o que fazer. Espera você começa com "Espera você:"; agendar diz quando sai ("sai qui 19/11 às 09:00", "sai hoje às 10:20"); a regra 11 conta a mensagem que seria enviada ("2ª oferta em 30 dias"); a 13 é "Modo ensaio: teria sido enviada."; a 14 usa as duas frases deste ADR. Link barrado mostra o domínio; dado de pagamento barrado diz o tipo.

**Detectores.**

- `findLinks`: URL com qualquer esquema (o host vem depois do `usuário@`), domínio solto com TLD conhecido ou de duas letras, qualquer TLD quando vem caminho depois ou o host começa com `www.`, espaço antes do ponto, `[.]`, `(ponto)`, "ponto com" no fim da frase, ponto de largura total, caractere invisível e IPv4. Host com acento não vira ASCII: `estúdioexemplo.com.br` não é o domínio da lista. E-mail não é link.
- `findPaymentData`: PIX copia e cola, chave aleatória (com ao menos uma letra), e-mail ("arroba", "ponto", "(at)", "at … dot"), agência e conta, e sequências de dígitos unidas por espaço, ponto, traço, barra, parênteses ou vírgula colada. Dígito por extenso ("um", "meia" = 6), de largura total ou de outra escrita conta. Data e hora saem antes, para não grudar nos vizinhos. Dez dígitos ou mais sempre barram (CPF, CNPJ, telefone, cartão com Luhn, boleto, número longo); oito ou nove barram com cara de telefone (`98888-7777`) ou partidos em cinco pedaços ou mais.
- `sameText`: compara só letras e dígitos, sem acento e sem caixa. Texto só de símbolos compara como veio.
- Cobrança disfarçada (`looksLikeBilling`): qualquer marcador de pagamento, ou valor em reais (`R$ 480`, `480 reais`, por extenso, `{valor}`) ou data (`20/11`, `dia 20`, `20 de novembro`, `{vencimento}`) junto de boleto, PIX, pagamento, pagar, pague, vencimento, vence, venceu, vencido, fatura ou cobrança.
- Número da cobrança (`strayNumber`): datas, "N de mês" e "dia N" contra o vencimento; o resto contra o valor (`parseMoney`). Centena ou milhar por extenso nunca bate.
- Desconto: porcentagens com `%` ou "por cento"; "fala em desconto" é a palavra desconto, off, abatimento, "pela metade" ou, numa oferta, qualquer porcentagem.

**Pontas que a tabela não fechava.** Nenhuma muda uma regra; cada uma tem caso no JSON ou teste. Aprovadas pelo dono do produto em 18/11/2026.

1. Marcador de pagamento em Atendimento ou Oferta do bot é cobrança disfarçada (regra 5), mesmo sem palavra de cobrança.
2. Marcador sem dado ou escrito errado (`{ Valor }`, `{PAGAMENTO}`) barra na regra 5 para qualquer autor, sem "Enviar mesmo assim": a mensagem sairia quebrada.
3. A regra 7 vale para o bot em qualquer categoria, como diz a tabela. Fora da oferta, só a palavra desconto conta ("80% pronto" passa).
4. Nenhum dia com horário de envio: a regra 10 espera você, com "Enviar mesmo assim", em vez de agendar para nunca.
5. Teto por hora: `at` é a vaga, mas no mínimo um minuto à frente. Sem janela nenhuma, o `at` fica como calculado (dia cheio: meia-noite seguinte).
6. Hora da decisão ilegível barra com regra 0. Autor desconhecido vale como bot; categoria desconhecida vale como oferta na regra 4. Hora ilegível no histórico ou na resposta pelo celular conta como agora; na mensagem respondida, como muito antiga.

**Corpus.** Passou de 167 para 180 casos com os achados da revisão: R05-22 a R05-25, R06-31 a R06-37, R07-12 e R07-13. A revisão de segurança automática do commit achou mais dois buracos na regra 6, e o corpus foi a 185 (R06-38 a R06-42), cada caso conferido como falha no portão anterior:

- **Domínio colado em `_` ou `-`** (`x_golpe.io/pix`, `--golpe.io`, `golpe.io_pix`) não era lido como link. `_` e `-` deixam de esconder um host, antes e depois dele.
- **Marcador colado no texto** (`golpe{vencimento}.io`, `pix{vencimento}@golpe.io`) montava um link ou um dado de pagamento que só existe depois de preenchido, e os detectores liam só o texto sem marcadores. Agora eles leem também o texto preenchido, como ele sai; passam só os achados que os dados do sistema têm sozinhos (a chave PIX de `{pagamento}`, por exemplo).

**Falsos positivos conhecidos** (todos no texto do bot ou do sistema, salvo o de link):

- Número de dez dígitos ou mais (protocolo, rastreio só de dígitos) barra, e também quatro dígitos ou mais depois de "conta" ou "cc" ("Total da conta: 4800").
- Numa cobrança, todo número que não é o valor nem o vencimento barra ("parcela 2 de 3", "novembro/2026", "multa de 2%").
- Numa oferta, qualquer porcentagem é desconto ("80% dos clientes").
- `palavra . palavra` com TLD de duas letras ("ok . vc") e "ponto com" no fim da frase viram link. No texto seu, isso custa um "Enviar mesmo assim".
- Perfil com ponto e espaço antes da arroba ("insta @estudio.com") conta como e-mail.

## Revisão de segurança da fase 2 (18/11/2026)

A revisão só de leitura do diff da fase 2 achou um problema alto, três médios e dois baixos. Nenhum vaza token nem injeta HTML.

**Corrigidos no mesmo dia**, cada um com teste que falha sem a correção:

- **Alto: cliente apagado voltava depois de reabrir o app.** A busca relê os 30 min antes da última mensagem vista, e só a memória sabia o que já tinha entrado. Uma mensagem de antes do apagamento recriava o contato, com o texto. Agora "Apagar este cliente" guarda no `index.json` das conversas o sha256 do número, com sal aleatório, e a hora do apagamento. A busca ignora as mensagens desse número até essa hora. O registro sai quando a busca não alcança mais o apagamento. A confirmação de apagar avisa que a Evolution guarda a própria cópia no banco dela.
- **Médio: oferta saía depois de um PARAR que chegou durante o "digitando…".** Entre o portão e o `sendText` passavam segundos (presença e novas tentativas), e só "Parar tudo" e a conexão eram conferidos de novo. Agora o portão inteiro roda de novo antes de cada tentativa: saída das ofertas, conversa com você e resposta pelo celular.
- **Médio (latente): aprovar um rascunho de bot passava a regra 3.** A aprovação montava a rodada a partir da própria conversa. Rascunho de bot barrado pela regra 3 agora só sai descartado: o cartão mostra só "Descartar", e o main recusa "Enviar" e "Enviar mesmo assim".
- **Baixo: "Enviar mesmo assim" não ficava na auditoria**, embora a tela dissesse que sim. A linha do envio leva `override: true`.

**Ficam abertos:**

- **Médio: oferta digitada à mão como Atendimento.** Para o texto seu, o portão confia na categoria que você escolhe. "30% off na revisão" marcado como Atendimento sai para quem mandou PARAR. A regra 4 permite atendimento a quem saiu das ofertas, então fechar isso é decisão de produto. Proposta: para quem saiu das ofertas, rodar o detector de desconto e oferta também no atendimento e pedir confirmação da categoria.
- **Baixo: mensagem endereçada só por `@lid`** (sem `remoteJidAlt` nem `senderPn`) é descartada, inclusive um PARAR ou uma palavra de alerta; só a contagem vai ao log. Proposta: aviso "mensagem não identificada" na tela e um mapa lid → número aprendido dos registros que trazem os dois.
- **Baixo, já aceito no PRD:** o texto dos itens da fila em `crm.json` fica em `crm.json.bak` e nas cópias diárias por 14 dias depois de apagar o cliente.

## Consequências

- A tela mostra a regra e o motivo de cada bloqueio, e o botão "Enviar mesmo assim" só aparece quando `overridable` é verdadeiro.
- Os falsos positivos são conhecidos e baratos: o bot não escreve telefone, nem número solto numa cobrança, nem desconto sem declarar. Cada um custa um clique seu.
- Mudar uma regra é mudar este ADR, o JSON e o código, nessa ordem.
