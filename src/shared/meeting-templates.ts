// Sala de reunião: os modelos de ata e as receitas da conversa que vêm com o app, e a junção
// com os próprios (globais ou por andar). Puro, para testar com `npm test` (docs/prd/sala-de-reuniao.md).

import type { MeetingRecipe, MeetingTemplate } from './types/meetings'

/** Limites checados dos dois lados: o formulário corta os campos, o main recusa o resto. */
export const MEETING_TEMPLATE_LIMITS = { name: 40, sections: 12, sectionTitle: 60, sectionHint: 300, instruction: 4000, count: 100 }
export const MEETING_RECIPE_LIMITS = { name: 40, command: 32, prompt: 4000, count: 100 }

/** Ids seguros: letras, números, `_` e `-`. */
export const MEETING_ID_RE = /^[\w-]{1,64}$/
/** '/follow-up': barra seguida de minúsculas, números e hífens, começando por letra. */
export const RECIPE_COMMAND_RE = /^\/[a-z][a-z0-9-]{0,30}$/

/** O andar das reuniões fora de todo projeto (Meeting.floor). */
export const GROUND_FLOOR = 'terreo'

/** Modelo usado quando a reunião não escolhe outro. */
export const DEFAULT_MEETING_TEMPLATE = 'geral'

const s = (title: string, hint: string) => ({ title, hint })

/** Os 8 modelos da spec ("Modelos de ata embutidos"). */
export const BUILTIN_MEETING_TEMPLATES: readonly MeetingTemplate[] = [
  {
    id: 'geral',
    name: 'Geral',
    sections: [
      s('Resumo', 'Duas a quatro frases: do que se tratou e onde chegou.'),
      s('Pontos discutidos', 'Um item por assunto, com o que cada lado defendeu.'),
      s('Decisões', 'O que ficou decidido e quem decidiu.'),
      s('Itens de ação', 'Só quando alguém se comprometeu: quem faz o quê e até quando.'),
    ],
    instruction: 'Ata objetiva para quem não esteve na reunião. Sem decisão, deixe a seção vazia em vez de inventar.',
  },
  {
    id: '1-1',
    name: '1:1',
    sections: [
      s('Como a pessoa está', 'Humor, carga de trabalho e o que ela contou de si, nas palavras dela.'),
      s('Atualizações', 'O que andou desde o último 1:1.'),
      s('Bloqueios', 'O que trava o trabalho e quem pode destravar.'),
      s('Feedback', 'Nos dois sentidos, com o exemplo citado.'),
      s('Combinados', 'O que cada um vai fazer até o próximo 1:1.'),
    ],
    instruction: 'Conversa entre gestor e pessoa do time. Tom respeitoso; não julgue nem interprete além do que foi dito.',
  },
  {
    id: 'daily',
    name: 'Daily',
    sections: [
      s('Ontem', 'Por pessoa: o que terminou ou avançou.'),
      s('Hoje', 'Por pessoa: no que vai trabalhar.'),
      s('Bloqueios', 'Por pessoa: o que impede de avançar e quem ajuda.'),
    ],
    instruction: 'Agrupe por pessoa, com o nome em negrito. Frases curtas; uma linha por item.',
  },
  {
    id: 'cliente',
    name: 'Cliente (discovery)',
    sections: [
      s('Contexto do cliente', 'Empresa, papel de quem falou, tamanho do time e momento.'),
      s('Dores', 'Os problemas citados, com a frase do cliente quando houver.'),
      s('Como resolvem hoje', 'Ferramentas, gambiarras e quanto isso custa.'),
      s('Objeções', 'Dúvidas e resistências levantadas.'),
      s('Próximos passos', 'O que ficou combinado com o cliente, com dono e data.'),
    ],
    instruction: 'Conversa de descoberta com cliente. Separe o que o cliente disse do que a equipe propôs.',
  },
  {
    id: 'planejamento',
    name: 'Planejamento',
    sections: [
      s('Objetivo', 'O resultado que o ciclo ou projeto deve entregar.'),
      s('Escopo', 'O que entra.'),
      s('Fora do escopo', 'O que ficou de fora de propósito.'),
      s('Estimativas', 'Prazos e tamanhos citados, com quem estimou.'),
      s('Riscos', 'O que pode atrasar ou dar errado.'),
      s('Itens de ação', 'Quem faz o quê e até quando.'),
    ],
    instruction: 'Reunião de planejamento. Estimativa sem número dito fica sem número.',
  },
  {
    id: 'kickoff',
    name: 'Kickoff de projeto',
    sections: [
      s('Objetivo', 'Por que o projeto existe e como medir o sucesso.'),
      s('Papéis', 'Quem é responsável pelo quê.'),
      s('Marcos', 'Entregas e datas combinadas.'),
      s('Riscos', 'Dependências, dúvidas e o que pode dar errado.'),
      s('Itens de ação', 'Quem faz o quê e até quando.'),
    ],
    instruction: 'Início de projeto. Registre as datas como foram ditas ("fim de março"), sem converter.',
  },
  {
    id: 'retrospectiva',
    name: 'Retrospectiva',
    sections: [
      s('O que foi bem', 'O que o time quer manter.'),
      s('O que melhorar', 'O que atrapalhou, sem apontar culpados.'),
      s('Ações', 'Mudanças combinadas, com dono.'),
    ],
    instruction: 'Retrospectiva do time. Agrupe falas parecidas num item só e diga quantas pessoas trouxeram o tema.',
  },
  {
    id: 'entrevista',
    name: 'Entrevista',
    sections: [
      s('Perfil', 'Experiência e contexto de quem foi entrevistado.'),
      s('Respostas por tema', 'Um subtítulo por tema, com o resumo da resposta.'),
      s('Sinais', 'Pontos fortes e pontos de atenção, cada um com a fala que o sustenta.'),
      s('Recomendação', 'A recomendação de quem entrevistou, se foi dita; senão, deixe vazia.'),
    ],
    instruction: 'Entrevista (de emprego ou de pesquisa). Atenha-se aos fatos ditos; não dê nota nem recomende por conta própria.',
  },
]

/** As 6 receitas da spec ("Conversa e receitas"). */
export const BUILTIN_MEETING_RECIPES: readonly MeetingRecipe[] = [
  {
    id: 'follow-up',
    command: '/follow-up',
    name: 'E-mail de acompanhamento',
    prompt:
      'Escreva um e-mail de acompanhamento para os participantes: agradecimento curto, resumo em até cinco linhas, decisões e itens de ação com dono e prazo. Tom cordial e direto, em português.',
  },
  {
    id: 'decisoes',
    command: '/decisoes',
    name: 'Decisões',
    prompt: 'Liste o que foi decidido, um item por decisão, com quem decidiu e a citação do trecho. Não inclua o que ficou só em discussão.',
  },
  {
    id: 'tickets',
    command: '/tickets',
    name: 'Propor tickets',
    prompt:
      'Proponha tickets a partir da conversa: título no imperativo, contexto que se explica sozinho e critérios de aceite verificáveis. Um ticket por tarefa combinada; não invente tarefas sem fonte.',
  },
  {
    id: 'resumo',
    command: '/resumo',
    name: 'Resumo em três linhas',
    prompt: 'Resuma em exatamente três linhas, para colar num chat: do que se tratou, o que foi decidido e o próximo passo.',
  },
  {
    id: 'riscos',
    command: '/riscos',
    name: 'Riscos e dúvidas',
    prompt: 'Liste os riscos e as dúvidas em aberto: o que pode dar errado, o que ninguém respondeu e de quem depende a resposta.',
  },
  {
    id: 'prd',
    command: '/prd',
    name: 'Rascunho de PRD',
    prompt:
      'Escreva um rascunho de PRD no formato de docs/prd: Resumo, Problema, Para quem, Escopo, Requisitos funcionais, Riscos e Decisões em aberto. Use só o que foi dito; marque como "a definir" o que faltar.',
  },
]

/**
 * Embutidos, depois os próprios globais, depois os do andar. Cada camada substitui, no mesmo
 * lugar, o item de mesmo id da anterior; ids novos entram no fim. `floor` é o id do andar
 * ('terreo' no térreo); null mostra só embutidos e globais.
 */
function layered<T extends { id: string; floor?: string }>(builtin: readonly T[], custom: readonly T[] | undefined, floor: string | null | undefined): T[] {
  const out = [...builtin]
  const put = (t: T) => {
    const i = out.findIndex((x) => x.id === t.id)
    if (i >= 0) out[i] = t
    else out.push(t)
  }
  const list = custom ?? []
  for (const t of list) if (!t.floor) put(t)
  if (floor) for (const t of list) if (t.floor === floor) put(t)
  return out
}

/** Os modelos de ata que valem neste andar. */
export function templatesFor(floor: string | null | undefined, custom: readonly MeetingTemplate[] | undefined): MeetingTemplate[] {
  return layered(BUILTIN_MEETING_TEMPLATES, custom, floor)
}

/**
 * As receitas que valem neste andar. Duas com o mesmo comando (ids diferentes) não cabem no
 * autocompletar: fica a da camada mais específica, no lugar da outra.
 */
export function recipesFor(floor: string | null | undefined, custom: readonly MeetingRecipe[] | undefined): MeetingRecipe[] {
  const out: MeetingRecipe[] = []
  for (const r of layered(BUILTIN_MEETING_RECIPES, custom, floor)) {
    const i = out.findIndex((x) => x.command === r.command)
    if (i >= 0) out[i] = r
    else out.push(r)
  }
  return out
}

/** O modelo pelo id, no andar; o Geral quando ele sumiu (apagado ou de outro andar). */
export function templateById(id: string | undefined, floor: string | null | undefined, custom: readonly MeetingTemplate[] | undefined): MeetingTemplate {
  const list = templatesFor(floor, custom)
  return list.find((t) => t.id === id) ?? list.find((t) => t.id === DEFAULT_MEETING_TEMPLATE) ?? BUILTIN_MEETING_TEMPLATES[0]
}
