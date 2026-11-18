process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import { findLinks, findPaymentData, looksLikeBilling, sameText, strayNumber, type PaymentDataKind } from '@shared/crm-gate'

// CR-11: os detectores de texto do portão (ADR 0017, regras 5, 6 e 8). Cada um erra para o lado do
// cliente; os falsos positivos conhecidos estão no ADR, seção "O que ficou decidido no CR-11".

const hosts = (text: string) => findLinks(text).map((l) => l.host)
const kinds = (text: string) => findPaymentData(text).map((h) => h.kind)

describe('findLinks', () => {
  it.each([
    ['Veja https://pagamento-rapido.com/maria', 'pagamento-rapido.com'],
    ['Acesse pagamento-rapido.com para ver', 'pagamento-rapido.com'],
    ['Resumo aqui: bit.ly/3xYz9', 'bit.ly'],
    ['Me chama no wa.me/5511988887777', 'wa.me'],
    ['Acesse estudioexemplo.com.br.golpe.io', 'estudioexemplo.com.br.golpe.io'],
    ['entra em pagamento-rapido . com', 'pagamento-rapido.com'],
    ['entra em pagamento-rapido .com', 'pagamento-rapido.com'],
    ['Acesse golpe[.]io/maria', 'golpe.io'],
    ['Acesse golpe(ponto)io', 'golpe.io'],
    ['Acesse pagamentorapido ponto com', 'pagamentorapido.com'],
    ['Acesse pagamentorapido ponto com ponto br, é rápido', 'pagamentorapido.com.br'],
    ['Acesse golpe​.io', 'golpe.io'],
    ['Acesse ｇｏｌｐｅ．ｉｏ', 'golpe.io'],
    ['Acesse golpe。io', 'golpe.io'],
    ['Veja estúdioexemplo.com.br', 'estúdioexemplo.com.br'],
    ['Pague em http://192.168.0.10:8080/pix', '192.168.0.10'],
    ['Pague em 192.168.0.10/pix', '192.168.0.10'],
    ['Pague em https://estudioexemplo.com.br@golpe.io/pix', 'golpe.io'],
    ['Pague em estudioexemplo.com.br@golpe.io/pix', 'golpe.io'],
    ['Abra HTTPS://GOLPE.IO.', 'golpe.io'],
    ['Abra https://[::1]:3000/x', '::1'],
    ['Abra xn--estdio-fxa.com.br', 'xn--estdio-fxa.com.br'],
    ['Aposte em golpe.bet', 'golpe.bet'],
    ['Pague em golpe.qualquer/pix', 'golpe.qualquer'],
    ['Pague em golpe.qualquer:8080', 'golpe.qualquer'],
    ['Pague em www.golpe.qualquer', 'www.golpe.qualquer'],
  ])('%s → %s', (text, host) => {
    expect(hosts(text)).toContain(host)
  })

  it('falso positivo conhecido: "palavra . palavra" com TLD de duas letras vira link', () => {
    expect(hosts('Fechou, ok . vc me avisa')).toEqual(['ok.vc'])
  })

  it('o host que vem do caminho de uma URL não conta: o link é o do host', () => {
    expect(hosts('https://estudioexemplo.com.br/redirect?to=golpe.io')).toEqual(['estudioexemplo.com.br'])
    expect(hosts('https://golpe.io/estudioexemplo.com.br')).toEqual(['golpe.io'])
  })

  it('pontuação depois do link não entra no host', () => {
    expect(hosts('Veja https://estudioexemplo.com.br, e me diga.')).toEqual(['estudioexemplo.com.br'])
  })

  it.each([
    'Oi, Maria! Recebi sua mensagem e já confiro o seu pedido.',
    'Seu pedido 4521 sai em 3 dias, são 2 caixas.',
    'Combinado: amanhã, 19/11, às 14:30.',
    'O plano custa R$ 480,00 por mês.',
    'Fechado. Com prazer, Maria!',
    'Vou bater o ponto com atraso hoje.',
    'Mandei para maria@gmail.com, confere?',
    'Mande para joao.me@gmail.com',
    'pedido.Obrigado pela compra',
    'Estúdio Exemplo S.A. agradece',
    'Versão 1.2.3 no ar',
  ])('não é link: %s', (text) => {
    expect(findLinks(text)).toEqual([])
  })
})

describe('findPaymentData', () => {
  it.each<[string, PaymentDataKind]>([
    ['Meu CPF para o PIX: 123.456.789-09', 'cpf'],
    ['CPF: um dois três 456.789-09', 'cpf'],
    ['CPF 1 2 3 4 5 6 7 8 9 0 9', 'cpf'],
    ['CPF 123 . 456 . 789 - 09', 'cpf'],
    ['CPF １２３.４５６.７８９-０９', 'cpf'],
    ['CPF ١٢٣٤٥٦٧٨٩٠٩', 'cpf'],
    ['CPF 123​456​789​09', 'cpf'],
    ['PIX no CNPJ 98.765.432/0001-10', 'cnpj'],
    ['chave 98 765 432 0001 10', 'cnpj'],
    ['manda no pix financeiro@golpe.com', 'email'],
    ['pix: maria arroba gmail ponto com', 'email'],
    ['pix: maria (at) gmail [dot] com', 'email'],
    ['pix maria @ gmail.com', 'email'],
    ['pix maria@ gmail.com', 'email'],
    ['pix maria at gmail dot com', 'email'],
    ['PIX pelo celular (11) 98888-7777', 'phone'],
    ['liga no +55 11 98888-7777', 'phone'],
    ['liga no 98888-7777', 'phone'],
    ['liga no 3333 4444', 'phone'],
    ['liga no nove oito oito oito oito sete sete sete sete', 'phone'],
    ['liga no 11 3333-4444', 'phone'],
    ['chave aleatória 123e4567-e89b-42d3-a456-426614174000', 'random'],
    ['Segue a linha: 34191.79001 01043.510047 91020.150008 1 96610000048000', 'boleto'],
    ['cartão 4111 1111 1111 1111', 'card'],
    ['depósito na agência 1234 conta 56789-0', 'account'],
    ['ag. nº 1234', 'account'],
    ['c/c 12345-6', 'account'],
    ['00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano', 'pix'],
    ['protocolo 2026111800123456789', 'number'],
  ])('%s → %s', (text, kind) => {
    expect(kinds(text)).toContain(kind)
  })

  it('o primeiro achado é o mais específico (a chave aleatória antes dos números dela)', () => {
    expect(findPaymentData('chave 123e4567-e89b-42d3-a456-426614174000')[0].kind).toBe('random')
  })

  it('CPF de dígitos repetidos não é CPF válido, mas 11 dígitos ainda barram', () => {
    expect(kinds('CPF 111.111.111-11')).toEqual(['phone'])
  })

  it('barra que não é data fica como número curto', () => {
    expect(findPaymentData('Na caixa 45/67 itens')).toEqual([])
  })

  it('falsos positivos conhecidos, de propósito (ADR 0017): mudar um destes é mudar o ADR', () => {
    expect(kinds('Seu protocolo é 2026111800123')).not.toEqual([])
    expect(kinds('Total da conta: 4800')).toEqual(['account'])
    expect(kinds('Siga no insta @estudio.com')).toEqual(['email'])
    expect(kinds('Total da conta: 480')).toEqual([])
  })

  it('chave só de dígitos não é aleatória, mas é número longo', () => {
    expect(kinds('chave 00000000-0000-0000-0000-000000000000')).toEqual(['number'])
  })

  it.each([
    'Oi, Maria! Recebi sua mensagem e já confiro o seu pedido.',
    'Seu pedido 4521 sai em 3 dias, são 2 caixas.',
    'Combinado: amanhã, 19/11, às 14:30.',
    'Sua visita: 19/11/2026 14:30, endereço CEP 01310-100.',
    'Das 9h30 às 18h, de segunda a sexta.',
    'O plano custa R$ 1.480,00 em 12x de R$ 123,33.',
    'Segue o valor: R$ 480,00.',
    'Fale com a gente no @estudioexemplo',
    'pedido 12345678',
    'Um abraço, até mais!',
    'Chegou às 3 e meia.',
    'See you at 10, ok?',
  ])('não é dado de pagamento: %s', (text) => {
    expect(findPaymentData(text)).toEqual([])
  })
})

describe('sameText', () => {
  it('ignora caixa, acento, espaço, pontuação e emoji', () => {
    expect(sameText('Oi, Maria! Recebi sua mensagem.', 'OI  MARIA recebi sua mensagem')).toBe(true)
    expect(sameText('Já confiro 😊', 'ja confiro')).toBe(true)
    expect(sameText('Oi Maria', 'Oi Mario')).toBe(false)
  })

  it('só símbolos: compara o texto como veio', () => {
    expect(sameText('👍', ' 👍 ')).toBe(true)
    expect(sameText('👍', '👎')).toBe(false)
  })
})

describe('looksLikeBilling', () => {
  it.each([
    'Oi, Maria! Seu boleto de R$ 480,00 vence dia 20.',
    'Segue: {pagamento}',
    'O plano fica em {valor}.',
    'O plano fica em { Vencimento }.',
    'O PIX de quatrocentos e oitenta reais, tá?',
    'A fatura vence em 20/11.',
    'Pode pagar 480 reais até 20 de novembro.',
  ])('tem cara de cobrança: %s', (text) => {
    expect(looksLikeBilling(text)).toBe(true)
  })

  it.each([
    'O plano custa R$ 480,00 por mês.',
    'Combinado: amanhã, 19/11, às 14:30.',
    'Pode pagar no PIX quando quiser.',
    'Pronto, você não vai mais receber ofertas nossas por aqui. Atendimento e cobrança continuam normais.',
    'Mil desculpas pela demora no pagamento do frete.',
  ])('não tem: %s', (text) => {
    expect(looksLikeBilling(text)).toBe(false)
  })
})

describe('strayNumber', () => {
  const p = { amountCents: 48_000, due: '2026-11-20' }

  it.each([
    'São R$ 480,00 ({valor})',
    'São 480 reais',
    'São R$480.',
    'Vence em 20/11, dia 20/11/2026, ou 20/11/26',
    'Vence dia 20, 20 de novembro de 2026',
    'Sem número nenhum: {referente}, {valor}, {vencimento}. {pagamento}',
  ])('bate com o pagamento: %s', (text) => {
    expect(strayNumber(text, p)).toBeNull()
  })

  it.each([
    ['São R$ 520,00', 'r$ 520,00'],
    ['Ficou 520 de {referente}', '520'],
    ['Vence em 25/11', '25/11'],
    ['Vence em 20/11/2025', '20/11/2025'],
    ['Vence dia 21', 'dia 21'],
    ['Vence 20 de dezembro', '20 de dezembro'],
    ['São quatrocentos e oitenta reais', 'quatrocentos e oitenta reais'],
    ['São quatrocentos e oitenta', 'quatrocentos'],
    ['Parcela 2 de 3', '2'],
  ])('não bate: %s', (text, piece) => {
    expect(strayNumber(text, p)).toBe(piece)
  })

  it('valor com milhar', () => {
    expect(strayNumber('Total R$ 1.234,56', { amountCents: 123_456, due: '2026-11-20' })).toBeNull()
  })
})

describe('detectores em texto hostil', () => {
  it('4.000 caracteres feitos para travar uma expressão regular passam em menos de 1 s, todos juntos', () => {
    const hostile = ['a', 'a.', 'a-', '1 ', '1,', 'a@', 'a @', 'um ', 'a ponto ', '1/', 'r$ ', 'ab.cd-ef 12.34 ', '{ ', 'x at '].map((p) =>
      p.repeat(Math.ceil(4000 / p.length)).slice(0, 4000),
    )
    const t = performance.now()
    for (const s of hostile) {
      findLinks(s)
      findPaymentData(s)
      looksLikeBilling(s)
      sameText(s, s)
      strayNumber(s, { amountCents: 48_000, due: '2026-11-20' })
    }
    expect(performance.now() - t).toBeLessThan(1000)
  })
})
