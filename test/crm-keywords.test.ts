import { describe, expect, it } from 'vitest'
import { CRM_DEFAULTS } from '@shared/types'
import { keywordTokens, matchAlert, matchOptOut, OPT_OUT_REPLY } from '@shared/crm-keywords'

// CR-13: palavras de saída e de alerta, com a lista padrão das Configurações. Frases como chegam
// pelo WhatsApp: abreviação, emoji, pontuação, caixa alta, letra repetida, negação.

const OUT = CRM_DEFAULTS.optOutWords
const ALERT = CRM_DEFAULTS.alertWords

describe('keywordTokens', () => {
  it('tira acento e caixa, e pontuação e emoji viram quebra de oração', () => {
    expect(keywordTokens('Não, PARE!!! 😡 obrigado')).toEqual(['nao', '|', 'pare', '|', 'obrigado'])
  })

  it('letra repetida conta uma vez e abreviação vira a palavra', () => {
    expect(keywordTokens('naum kero q vc PAAAARE pfv')).toEqual(['nao', 'quero', 'que', 'voce', 'pare', 'por', 'favor'])
  })

  it('letra estilizada (negrito matemático) vira letra comum', () => {
    expect(keywordTokens('𝐏𝐀𝐑𝐀𝐑')).toEqual(['parar'])
  })

  it('texto vazio, só pontuação ou não-texto vira lista vazia', () => {
    expect(keywordTokens('')).toEqual([])
    expect(keywordTokens('?!... 🙏')).toEqual([])
    expect(keywordTokens(undefined as unknown as string)).toEqual([])
  })
})

describe('matchOptOut: sai das ofertas', () => {
  it.each([
    ['PARAR', 'parar'],
    ['parar', 'parar'],
    ['Parar.', 'parar'],
    ['pare por favor', 'pare'],
    ['Pare, por favor.', 'pare'],
    ['pareeee', 'pare'],
    ['quero parar de receber', 'parar'],
    ['Quero sair da lista', 'sair'],
    ['quero sair 🙏', 'sair'],
    ['sair', 'sair'],
    ['descadastrar', 'descadastrar'],
    ['não quero mais', 'não quero'],
    ['Não quero mais receber essas mensagens', 'não quero'],
    ['ñ quero mais', 'não quero'],
    ['n quero', 'não quero'],
    ['naum quero mais isso', 'não quero'],
    ['nao quero, obrigado', 'não quero'],
    ['Não, pode parar', 'parar'],
    ['não... pode parar de mandar', 'parar'],
    ['pode parar sim, obrigado', 'parar'],
    ['nunca mais quero receber, pare', 'pare'],
    ['𝐏𝐀𝐑𝐀𝐑', 'parar'],
    ['Bom dia! Não tenho interesse, pode me descadastrar.', 'descadastrar'],
  ])('%s', (text, word) => {
    expect(matchOptOut(text, OUT)).toBe(word)
  })
})

describe('matchOptOut: núcleo fixo, vale mesmo fora da lista', () => {
  it.each([
    ['para de me mandar isso', 'para de me mandar'],
    ['Para de me mandar isso!!!', 'para de me mandar'],
    ['PAAAARA DE MANDAR', 'para de mandar'],
    ['Por favor, parem de enviar ofertas', 'parem de enviar'],
    ['vocês não param de mandar mensagem', 'param de mandar'],
    ['para com isso', 'para com iso'],
    ['sai fora', 'sai fora'],
    ['SAI FORA 😡', 'sai fora'],
    ['me tira dessa lista', 'tira desa lista'],
    ['tira meu número daí por favor', 'tira meu numero'],
    ['Me descadastra, pfv', 'descadastra'],
    ['não me mande mais mensagem', 'nao me mande mais'],
    ['nao precisa mandar mais nada', 'nao precisa mandar mais'],
    ['chega de propaganda', 'chega de propaganda'],
    ['STOP', 'stop'],
  ])('%s', (text, word) => {
    expect(matchOptOut(text, OUT)).toBe(word)
    expect(matchOptOut(text, [])).toBe(word)
  })
})

describe('matchOptOut: a frase que nega a saída não tira das ofertas', () => {
  it.each([
    'não quero parar',
    'não vou sair',
    'nem pensar em sair',
    'Não quero sair da lista não, gosto das promoções',
    'não precisa parar',
    'Não é pra parar não!',
    'não quero que você pare',
    'nao vo sair nao kkk',
    'Não pare! Adoro as ofertas',
    'nunca vou descadastrar',
    'jamais vou sair',
    'não me tira da lista, gosto das ofertas',
  ])('%s', (text) => {
    expect(matchOptOut(text, OUT)).toBeNull()
  })
})

describe('matchOptOut: conversa comum fica como está', () => {
  it.each([
    'Oi, o boleto de novembro já saiu?',
    'Pode mandar para o meu e-mail',
    'Paramos de vender esse produto?',
    'Bom dia, tudo bem?',
    'Quanto fica para dezembro?',
    'Quero saber do pedido',
    'A saída do estacionamento é por onde?',
    'Comprei um par de tênis',
    'Pessoal, obrigado!',
    'Manda o PIX que eu pago hoje 👍',
  ])('%s', (text) => {
    expect(matchOptOut(text, OUT)).toBeNull()
  })
})

describe('matchOptOut: falsos positivos aceitos (errar para o lado do cliente)', () => {
  it('"sair" da lista padrão pega quem só vai sair de casa', () => {
    expect(matchOptOut('vou sair pra almoçar, já volto', OUT)).toBe('sair')
  })

  it('o núcleo fixo não tem negação: "não quero que pare de mandar" também sai', () => {
    expect(matchOptOut('não quero que pare de mandar', OUT)).toBe('pare de mandar')
  })
})

describe('matchOptOut: a lista das Configurações', () => {
  it('palavra da lista com acento e caixa compara igual', () => {
    expect(matchOptOut('nao quero mais', ['NÃO QUERO'])).toBe('NÃO QUERO')
    expect(matchOptOut('quero cancelar', ['Cancelar'])).toBe('Cancelar')
  })

  it('palavra inteira: "parar" não pega "paradas", e lista vazia só usa o núcleo', () => {
    expect(matchOptOut('as paradas de ônibus', ['parar'])).toBeNull()
    expect(matchOptOut('PARAR', [])).toBeNull()
    expect(matchOptOut('PARAR', ['', '  ', '!!'])).toBeNull()
  })

  it('devolve a primeira expressão do texto', () => {
    expect(matchOptOut('sair, ou melhor, parar', OUT)).toBe('sair')
  })

  it('texto muito longo: o que passa de 8 mil caracteres não é lido', () => {
    expect(matchOptOut(`${'a '.repeat(4500)}parar`, OUT)).toBeNull()
    expect(matchOptOut(`${'a '.repeat(100)}parar`, OUT)).toBe('parar')
  })
})

describe('matchAlert: chama você', () => {
  it.each([
    ['atendente humano?', 'atendente'],
    ['vou no procon', 'procon'],
    ['isso é golpe?', 'golpe'],
    ['PROCON!!!', 'procon'],
    ['Quero falar com uma pessoa', 'pessoa'],
    ['Tem algum humano aí?', 'humano'],
    ['Preciso falar com o atendente', 'atendente'],
    ['minha advogada vai entrar em contato', 'advogado'],
    ['vou chamar meus advogados', 'advogado'],
    ['Já abri reclamação no Reclame Aqui', 'reclamação'],
    ['tenho várias reclamações', 'reclamação'],
    ['não é golpe, né?', 'golpe'],
    ['Qual o processo para renovar?', 'processo'],
  ])('%s', (text, word) => {
    expect(matchAlert(text, ALERT)).toBe(word)
  })

  it.each([
    ['Vou processar vocês', 'procesar'],
    ['vou na justiça', 'justica'],
    ['vou denunciar', 'denunciar'],
    ['é um golpista', 'golpista'],
    ['vou chamar a polícia', 'policia'],
    ['isso é fraude', 'fraude'],
    ['vou postar no reclameaqui', 'reclameaqui'],
  ])('núcleo fixo: %s', (text, word) => {
    expect(matchAlert(text, ALERT)).toBe(word)
    expect(matchAlert(text, [])).toBe(word)
  })

  it.each([
    'Pessoal, bom dia',
    'O processamento do pagamento demorou',
    'Obrigado pela atenção',
    'Manda o boleto, por favor',
    'Pode parar de mandar',
  ])('conversa comum: %s', (text) => {
    expect(matchAlert(text, ALERT)).toBeNull()
  })
})

describe('OPT_OUT_REPLY', () => {
  it('é texto fixo, sem link, sem número e sem palavra de saída que o faça sair de novo', () => {
    expect(OPT_OUT_REPLY).not.toMatch(/https?:|www\.|\d/)
    expect(OPT_OUT_REPLY.length).toBeLessThan(200)
    expect(matchAlert(OPT_OUT_REPLY, ALERT)).toBeNull()
  })
})
