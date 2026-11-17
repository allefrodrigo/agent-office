# 0017 — Portão de envio do CRM

- **Status:** proposto (2026-11-17). Espera revisão antes do CR-11, como o plano pede.
- **Origem:** spike S-3 do [plano da Sala de CRM](../prd/sala-de-crm-plano.md); regras em [sala-de-crm.md](../prd/sala-de-crm.md), "O portão de envio".
- **Corpus:** [`test/fixtures/crm-gate-cases.json`](../../test/fixtures/crm-gate-cases.json), 167 casos. `test/crm-gate-cases.test.ts` confere a forma do corpus; o portão em si é do CR-11.

## Contexto

Toda mensagem do CRM, do bot ou sua, passa por um trecho de código que decide se ela sai, espera você, é barrada ou fica para depois. O modelo propõe; o portão decide. O spec lista 14 regras em ordem, mas deixa abertas a forma da entrada, a diferença entre "aprovar" e "passar por cima", e o que conta como dia, semana, resposta e texto igual. Este ADR fecha essas pontas para que o CR-11 escreva o código contra uma tabela, não contra uma ideia.

## Decisão

### 1. Uma função pura

`gate(draft, ctx): GateDecision` em `src/shared/crm-gate.ts`. Sem IA, sem rede, sem relógio próprio (`ctx.now` entra pronto) e sem estado. A primeira regra que falha decide. A `Outbox` chama o portão ao enfileirar e de novo no instante de enviar.

### 2. A entrada

| Campo | O que é |
|---|---|
| `now` | Instante da decisão, ISO com deslocamento. O relógio de parede (janela, dia, feriado) é lido no fuso da máquina. |
| `connected` | WhatsApp conectado agora. |
| `settings` | As regras de `CrmSettings`: `rehearsal`, `autonomy`, `hours`, `holidays`, `perCustomer`, `offerEveryDays`, `globalCap`, `maxDiscountPct`, `allowedLinks`, `stopAll`, `payment`. |
| `customer` | O cliente do destino, ou `null` se não existe: `id`, `phones`, `phoneChecked`, `group`, `consent` (`service`, `billing`, `offers`, `optOutAt`), `handedToPlayer`, `phoneReplyAt`. |
| `payments` | Os pagamentos desse cliente (`id`, `amountCents`, `due`, `state`, `reference`). |
| `history` | O que já saiu para esse cliente: `at`, `category`, `initiated`, `text` (já preenchido). Quem monta o histórico classifica `initiated`. |
| `global` | `lastHour` e `today` (todos os envios do escritório, iniciados e respostas) e `oldestInHour` (o envio mais antigo da última hora). |
| `run` | A rodada do bot: `{ kind: 'customer', customerId }`, `{ kind: 'schedule' }` ou `{ kind: 'suggestion', suggestionId, customerIds }`. `null` para mensagem sua ou do sistema. |
| `draft` | `customerId`, `by` (`bot`, `player` ou `system`), `edited`, `category`, `text` (com os marcadores ainda por preencher), `replyTo` (`{ id, at }` da mensagem respondida, ou `null`), `paymentId`, `discountPct`, `validUntil`. |
| `approved` | Você clicou "Enviar" no cartão do rascunho. |
| `override` | Você confirmou "Enviar mesmo assim". |

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

| # | Regra | Vale para | Falhou | Enviar mesmo assim |
|---|---|---|---|---|
| 1 | Parar tudo desligado e WhatsApp conectado | todos | barra | não |
| 2 | O cliente existe, tem telefone, o número foi conferido e não é grupo | todos | barra | não |
| 3 | O destino está no escopo da rodada | bot | barra | não |
| 4 | O cliente aceita a categoria | todos | barra | oferta: não; atendimento e cobrança: sim |
| 5 | Cobrança com dados do sistema; nada com cara de cobrança fora da categoria | bot e sistema (você: só "há pagamento aberto") | barra | bot: não; você: sim |
| 6 | Sem link fora da lista; sem dado de pagamento escrito pelo modelo | links: todos; dados: bot e sistema | barra | bot: não; você: sim |
| 7 | Desconto dentro do teto e da validade | bot | espera você | não (aprovar resolve) |
| 8 | Texto diferente do que saiu para o cliente nas últimas 24 h | todos | barra | sim |
| 9 | Conversa não passada para você, sem resposta sua pelo celular em 12 h, mensagem respondida com menos de 2 h | bot e sistema | espera você | não (aprovar resolve) |
| 10 | Dentro da janela de envio | todos | agenda para a próxima janela | sim |
| 11 | Limites por cliente | todos, só o que nós iniciamos | espera você | sim |
| 12 | Teto global por hora e por dia | todos, respostas incluídas | agenda para a vaga | não |
| 13 | Modo ensaio desligado | bot e sistema, categoria em Autônomo | espera você, "teria sido enviada" | não (aprovar resolve) |
| 14 | Categoria em Autônomo | bot e sistema | espera você | não (aprovar resolve) |

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

## O que fica para o CR-11

- Os detectores (`findLinks`, `findPaymentData`, `sameText`, a cobrança disfarçada), o formato do `fillPayment` e os textos de `reason`.
- Rodar os 167 casos com o fuso de cada um (`process.env.TZ`), mais os testes de propriedade do plano.
- Revisão de segurança dedicada, com 95% de cobertura de linhas.
- Achado novo de revisão vira caso no JSON antes da correção.

## Consequências

- A tela mostra a regra e o motivo de cada bloqueio, e o botão "Enviar mesmo assim" só aparece quando `overridable` é verdadeiro.
- Os falsos positivos são conhecidos e baratos: o bot não escreve telefone, nem número solto numa cobrança, nem desconto sem declarar. Cada um custa um clique seu.
- Mudar uma regra é mudar este ADR, o JSON e o código, nessa ordem.
