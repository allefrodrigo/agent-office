// Estúdio criativo: the node graph of a creative floor, shared by the main process and the page.
// The page draws and orders the graph; the main process runs one node at a time (Codex, ffmpeg, whisper).

/** What travels on a wire. A post (caption + hashtags) also feeds text inputs. */
export type PortType = 'video' | 'image' | 'text' | 'post' | 'audio'

export type NodeKind = 'video' | 'image' | 'text' | 'analyze-video' | 'generate-image' | 'edit-image' | 'overlay' | 'carousel' | 'narrate' | 'write-post'

export type ParamDef =
  | { key: string; label: string; type: 'text'; placeholder?: string; rows?: number }
  | { key: string; label: string; type: 'select'; options: [string, string][] }
  | { key: string; label: string; type: 'number'; min: number; max: number }
  | { key: string; label: string; type: 'file'; accept: 'video' | 'image'; multi?: boolean }
  /** An ElevenLabs voice, picked from the account's list. */
  | { key: string; label: string; type: 'voice' }

export interface PortDef {
  key: string
  label: string
  type: PortType
  /** Takes several wires (their values are joined). */
  multi?: boolean
  optional?: boolean
}

export interface NodeDef {
  kind: NodeKind
  title: string
  /** Palette group. */
  group: 'Entradas' | 'Agentes' | 'Gerar'
  /** Integration that runs it by default; input nodes run nothing. 'claude' nodes may switch to Codex (param `engine`). */
  engine?: 'codex' | 'claude' | 'local' | 'elevenlabs'
  hint: string
  inputs: PortDef[]
  outputs: PortDef[]
  params: ParamDef[]
}

/** Who writes and analyses: Claude by default (Codex is kept for images), ChatGPT when you want. */
export const TEXT_ENGINES: [string, string][] = [
  ['claude-sonnet', 'Claude Sonnet'],
  ['claude-haiku', 'Claude Haiku (mais barato)'],
  ['claude-opus', 'Claude Opus (mais caprichado)'],
  ['codex', 'ChatGPT (Codex)'],
]

/** Label of the engine a node runs on now. */
export function engineLabel(def: NodeDef, params: Record<string, unknown>): string {
  if (def.engine === 'elevenlabs') return 'ElevenLabs'
  const e = String(params.engine ?? 'claude-sonnet')
  const writer = e === 'codex' ? 'ChatGPT' : e === 'claude-opus' ? 'Opus' : e === 'claude-haiku' ? 'Haiku' : 'Sonnet'
  if (def.kind === 'carousel') return writer === 'ChatGPT' ? 'ChatGPT' : `${writer} + ChatGPT`
  if (def.engine === 'codex') return 'ChatGPT'
  return def.engine === 'claude' ? writer : ''
}

/** How text sits on an art (Arte com texto, Carrossel). */
const ART_PARAMS: ParamDef[] = [
  {
    key: 'layout',
    label: 'Posição do texto',
    type: 'select',
    options: [
      ['base', 'Faixa embaixo'],
      ['topo', 'Título no topo'],
      ['centro', 'No centro'],
    ],
  },
  {
    key: 'tema',
    label: 'Tema',
    type: 'select',
    options: [
      ['escuro', 'Escuro'],
      ['claro', 'Claro'],
      ['marca', 'Cor da marca'],
    ],
  },
  {
    key: 'fonte',
    label: 'Fonte',
    type: 'select',
    options: [
      ['sans', 'Moderna'],
      ['condensada', 'Condensada (impacto)'],
      ['serif', 'Serifada (editorial)'],
    ],
  },
  { key: 'cor', label: 'Cor da marca (#hex)', type: 'text', rows: 1, placeholder: '#9b7bf0' },
]

export const ASPECTS: [string, string][] = [
  ['4:5', 'Feed 4:5'],
  ['1:1', 'Quadrado 1:1'],
  ['9:16', 'Story/Reels 9:16'],
  ['16:9', 'Paisagem 16:9'],
]

export const NODE_DEFS: Record<NodeKind, NodeDef> = {
  video: {
    kind: 'video',
    title: 'Vídeo',
    group: 'Entradas',
    hint: 'Um vídeo desta máquina: o criativo que você quer entender ou copiar.',
    inputs: [],
    outputs: [{ key: 'video', label: 'vídeo', type: 'video' }],
    params: [{ key: 'path', label: 'Arquivo', type: 'file', accept: 'video' }],
  },
  image: {
    kind: 'image',
    title: 'Imagem',
    group: 'Entradas',
    hint: 'Imagens de referência: produto, logo, um post que deu certo.',
    inputs: [],
    outputs: [{ key: 'image', label: 'imagens', type: 'image' }],
    params: [{ key: 'paths', label: 'Arquivos', type: 'file', accept: 'image', multi: true }],
  },
  text: {
    kind: 'text',
    title: 'Texto',
    group: 'Entradas',
    hint: 'Briefing, ideia, oferta ou prompt escrito por você.',
    inputs: [],
    outputs: [{ key: 'text', label: 'texto', type: 'text' }],
    params: [{ key: 'text', label: 'Texto', type: 'text', rows: 5, placeholder: 'Ex.: promoção de 20% no plano anual, público de donos de restaurante…' }],
  },
  'analyze-video': {
    kind: 'analyze-video',
    title: 'Analisar vídeo',
    group: 'Agentes',
    engine: 'claude',
    hint: 'Assiste o vídeo inteiro (quadros + fala transcrita) e devolve roteiro, gancho, cenas, CTA e por que funciona.',
    inputs: [
      { key: 'video', label: 'vídeo', type: 'video' },
      { key: 'context', label: 'contexto', type: 'text', optional: true, multi: true },
    ],
    outputs: [{ key: 'text', label: 'análise', type: 'text' }],
    params: [
      { key: 'engine', label: 'Quem analisa', type: 'select', options: TEXT_ENGINES },
      { key: 'focus', label: 'Foco da análise', type: 'text', rows: 2, placeholder: 'Opcional. Ex.: quero adaptar para o FoodWise.' },
      { key: 'frames', label: 'Quadros analisados', type: 'number', min: 4, max: 30 },
    ],
  },
  'generate-image': {
    kind: 'generate-image',
    title: 'Gerar imagem',
    group: 'Gerar',
    engine: 'codex',
    hint: 'ChatGPT (via Codex) cria a imagem a partir do texto e das referências. Só aqui o Codex gasta.',
    inputs: [
      { key: 'prompt', label: 'prompt', type: 'text', multi: true },
      { key: 'refs', label: 'referências', type: 'image', optional: true, multi: true },
    ],
    outputs: [{ key: 'image', label: 'imagens', type: 'image' }],
    params: [
      { key: 'aspect', label: 'Formato', type: 'select', options: ASPECTS },
      { key: 'count', label: 'Variações', type: 'number', min: 1, max: 4 },
      { key: 'style', label: 'Direção de arte', type: 'text', rows: 2, placeholder: 'Opcional. Ex.: foto realista, luz natural, sem texto na imagem.' },
    ],
  },
  'edit-image': {
    kind: 'edit-image',
    title: 'Editar imagem',
    group: 'Gerar',
    engine: 'codex',
    hint: 'ChatGPT (via Codex) muda uma imagem que já existe: troca fundo, cor, objeto, enquadramento. O resto fica igual.',
    inputs: [
      { key: 'image', label: 'imagem', type: 'image' },
      { key: 'instruction', label: 'pedido', type: 'text', optional: true, multi: true },
    ],
    outputs: [{ key: 'image', label: 'editada', type: 'image' }],
    params: [
      { key: 'request', label: 'O que mudar', type: 'text', rows: 3, placeholder: 'Ex.: troque o fundo por uma cozinha industrial, mantenha a pessoa e o produto.' },
      { key: 'aspect', label: 'Formato', type: 'select', options: [['igual', 'Igual ao original'], ...ASPECTS] },
    ],
  },
  overlay: {
    kind: 'overlay',
    title: 'Arte com texto',
    group: 'Gerar',
    engine: 'local',
    hint: 'Escreve título, subtítulo e chamada por cima da imagem, sem erro de letra. Campos vazios: o Claude Haiku tira do texto ligado.',
    inputs: [
      { key: 'images', label: 'imagens', type: 'image', multi: true },
      { key: 'copy', label: 'texto', type: 'text', optional: true, multi: true },
      { key: 'logo', label: 'logo', type: 'image', optional: true },
    ],
    outputs: [{ key: 'image', label: 'artes', type: 'image' }],
    params: [
      { key: 'titulo', label: 'Título', type: 'text', rows: 2, placeholder: 'Vazio = o Claude escreve a partir do texto ligado' },
      { key: 'subtitulo', label: 'Subtítulo', type: 'text', rows: 2, placeholder: 'Opcional' },
      { key: 'cta', label: 'Chamada / preço', type: 'text', rows: 1, placeholder: 'Ex.: Teste grátis por 7 dias' },
      ...ART_PARAMS,
    ],
  },
  carousel: {
    kind: 'carousel',
    title: 'Carrossel',
    group: 'Gerar',
    engine: 'codex',
    hint: 'O Claude roteiriza os slides (capa → conteúdo → CTA), o ChatGPT desenha cada um no mesmo estilo e o texto entra por cima.',
    inputs: [
      { key: 'brief', label: 'briefing', type: 'text', multi: true },
      { key: 'refs', label: 'referências', type: 'image', optional: true, multi: true },
      { key: 'logo', label: 'logo', type: 'image', optional: true },
    ],
    outputs: [
      { key: 'image', label: 'slides', type: 'image' },
      { key: 'text', label: 'roteiro', type: 'text' },
    ],
    params: [
      { key: 'slides', label: 'Slides', type: 'number', min: 3, max: 10 },
      { key: 'aspect', label: 'Formato', type: 'select', options: ASPECTS.filter(([k]) => k === '4:5' || k === '1:1') },
      { key: 'engine', label: 'Quem roteiriza', type: 'select', options: TEXT_ENGINES },
      { key: 'style', label: 'Direção de arte', type: 'text', rows: 2, placeholder: 'Opcional. Ex.: ilustração flat, fundo creme, mesma paleta em todos.' },
      ...ART_PARAMS,
    ],
  },
  narrate: {
    kind: 'narrate',
    title: 'Narração',
    group: 'Gerar',
    engine: 'elevenlabs',
    hint: 'ElevenLabs lê o roteiro em voz. Com "extrair roteiro", o Claude Haiku tira só a fala de uma análise longa.',
    inputs: [{ key: 'text', label: 'texto', type: 'text', multi: true }],
    outputs: [{ key: 'audio', label: 'áudio', type: 'audio' }],
    params: [
      { key: 'voice', label: 'Voz', type: 'voice' },
      {
        key: 'model',
        label: 'Modelo',
        type: 'select',
        options: [
          ['eleven_multilingual_v2', 'Multilingual v2 (qualidade)'],
          ['eleven_flash_v2_5', 'Flash v2.5 (rápido, metade do custo)'],
        ],
      },
      {
        key: 'script',
        label: 'Texto',
        type: 'select',
        options: [
          ['claude', 'Extrair o roteiro com Claude Haiku'],
          ['raw', 'Ler o texto como está'],
        ],
      },
    ],
  },
  'write-post': {
    kind: 'write-post',
    title: 'Escrever post',
    group: 'Agentes',
    engine: 'claude',
    hint: 'Escreve legenda, hashtags e texto alternativo a partir do briefing e das imagens.',
    inputs: [
      { key: 'brief', label: 'briefing', type: 'text', multi: true },
      { key: 'images', label: 'imagens', type: 'image', optional: true, multi: true },
    ],
    outputs: [{ key: 'post', label: 'post', type: 'post' }],
    params: [
      { key: 'engine', label: 'Quem escreve', type: 'select', options: TEXT_ENGINES },
      {
        key: 'format',
        label: 'Formato',
        type: 'select',
        options: [
          ['feed', 'Feed'],
          ['carrossel', 'Carrossel'],
          ['story', 'Story'],
        ],
      },
      { key: 'tone', label: 'Tom de voz', type: 'text', rows: 2, placeholder: 'Opcional. Ex.: direto, bem-humorado, sem emoji em excesso.' },
    ],
  },
}

/** Default params of a new node. */
export function defaultParams(kind: NodeKind): Record<string, unknown> {
  switch (kind) {
    case 'video':
      return { path: '' }
    case 'image':
      return { paths: [] }
    case 'text':
      return { text: '' }
    case 'analyze-video':
      return { engine: 'claude-sonnet', focus: '', frames: 16 }
    case 'generate-image':
      return { aspect: '4:5', count: 1, style: '' }
    case 'write-post':
      return { engine: 'claude-sonnet', format: 'feed', tone: '' }
    case 'edit-image':
      return { request: '', aspect: 'igual' }
    case 'overlay':
      return { titulo: '', subtitulo: '', cta: '', layout: 'base', tema: 'escuro', fonte: 'sans', cor: '' }
    case 'carousel':
      return { slides: 5, aspect: '4:5', engine: 'claude-sonnet', style: '', layout: 'base', tema: 'escuro', fonte: 'sans', cor: '' }
    case 'narrate':
      return { voice: '', model: 'eleven_multilingual_v2', script: 'claude' }
  }
}

/** A wire may join these types (output → input). */
export function accepts(input: PortType, output: PortType): boolean {
  return input === output || (input === 'text' && output === 'post')
}

/** Value on a port. */
export type PortValue =
  | { type: 'video'; path: string }
  | { type: 'image'; paths: string[] }
  | { type: 'text'; text: string }
  | { type: 'post'; post: PostDraft }
  | { type: 'audio'; path: string }

export interface PostDraft {
  titulo: string
  legenda: string
  hashtags: string[]
  alt: string
  formato: 'feed' | 'carrossel' | 'story'
}

export interface FlowNode {
  id: string
  kind: NodeKind
  x: number
  y: number
  params: Record<string, unknown>
  /** Last good run: outputs by port key, and the signature of what it ran on. */
  result?: { outputs: Record<string, PortValue>; sig: string; at: number; note?: string }
  error?: string
}

export interface FlowEdge {
  id: string
  from: string
  fromPort: string
  to: string
  toPort: string
}

export interface Flow {
  version: 1
  nodes: FlowNode[]
  edges: FlowEdge[]
  view?: { x: number; y: number; zoom: number }
}

/** One node to run: its kind, params and the values on its inputs (by port key, several when multi). */
export interface CreativeJob {
  jobId: string
  floorId: string
  nodeId: string
  kind: NodeKind
  params: Record<string, unknown>
  inputs: Record<string, PortValue[]>
}

export interface CreativeJobResult {
  outputs: Record<string, PortValue>
  /** One line for the node footer (e.g. "3 imagens em criativos/imagens"). */
  note?: string
}

/** What the studio needs on this machine. */
export interface CreativeStatus {
  codex: { installed: boolean; path?: string; version?: string; loggedIn: boolean; account?: string; error?: string }
  ffmpeg: boolean
  /** whisper-cli and a ggml model: speech in videos gets transcribed. */
  whisper: { bin?: string; model?: string }
  elevenlabs: ElevenStatus
}

/** ElevenLabs: where the key comes from and the month's characters (never the key itself). */
export interface ElevenStatus {
  configured: boolean
  /** "~/.config/elevenlabs/api_key" or "chave guardada no app". */
  source?: string
  /** Key files found in ~/.config/elevenlabs (names). */
  files: string[]
  tier?: string
  used?: number
  limit?: number
  resetsAt?: number
  error?: string
}

export interface ElevenVoice {
  id: string
  name: string
  detail: string
}

/** Codex plan limits (account/rateLimits/read): what /status shows in the Codex CLI. */
export interface CodexUsage {
  /** "plus", "pro"… */
  plan?: string
  windows: { label: string; percent: number; resetsAt?: number }[]
  /** The plan limit was hit. */
  limited: boolean
  /** Extra credits left, when the account has them. */
  credits?: string
  updatedAt: number
  error?: string
}

export const creativeReady = (s: CreativeStatus | null | undefined): boolean => !!s?.codex.installed && !!s.codex.loggedIn

/** Media the studio may show: picked files and outputs, by extension. */
export const MEDIA_EXT = /\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm|mp3|wav|m4a)$/i

/** office-media://f/<path> — how the page shows local media (see main/creative/protocol.ts). */
export const mediaUrl = (path: string) => `office-media://f/${encodeURIComponent(path)}`

/** The starter flow: copy a creative that performs. */
export function starterFlow(): Flow {
  const n = (id: string, kind: NodeKind, x: number, y: number, params?: Record<string, unknown>): FlowNode => ({ id, kind, x, y, params: { ...defaultParams(kind), ...params } })
  return {
    version: 1,
    nodes: [
      n('n-video', 'video', 40, 60),
      n('n-brief', 'text', 40, 380, { text: '' }),
      n('n-analyze', 'analyze-video', 400, 60),
      n('n-image', 'generate-image', 780, 60),
      n('n-post', 'write-post', 780, 720),
    ],
    edges: [
      { id: 'e1', from: 'n-video', fromPort: 'video', to: 'n-analyze', toPort: 'video' },
      { id: 'e2', from: 'n-brief', fromPort: 'text', to: 'n-analyze', toPort: 'context' },
      { id: 'e3', from: 'n-analyze', fromPort: 'text', to: 'n-image', toPort: 'prompt' },
      { id: 'e4', from: 'n-analyze', fromPort: 'text', to: 'n-post', toPort: 'brief' },
      { id: 'e5', from: 'n-image', fromPort: 'image', to: 'n-post', toPort: 'images' },
    ],
    view: { x: 0, y: 0, zoom: 0.85 },
  }
}

const node = (id: string, kind: NodeKind, x: number, y: number, params?: Record<string, unknown>): FlowNode => ({ id, kind, x, y, params: { ...defaultParams(kind), ...params } })
const edge = (id: string, from: string, fromPort: string, to: string, toPort: string): FlowEdge => ({ id, from, fromPort, to, toPort })

/** Ready-made flows of the palette ("Modelos"). Picking one replaces the canvas. */
export const FLOW_TEMPLATES: { id: string; title: string; hint: string; build(): Flow }[] = [
  {
    id: 'image',
    title: 'Só gerar imagem',
    hint: 'Texto + referências → imagem',
    build: () => ({
      version: 1,
      nodes: [node('n-text', 'text', 40, 40), node('n-refs', 'image', 40, 340), node('n-image', 'generate-image', 420, 120)],
      edges: [edge('e1', 'n-text', 'text', 'n-image', 'prompt'), edge('e2', 'n-refs', 'image', 'n-image', 'refs')],
      view: { x: 40, y: 40, zoom: 1 },
    }),
  },
  {
    id: 'post',
    title: 'Post a partir de briefing',
    hint: 'Texto → imagem → legenda',
    build: () => ({
      version: 1,
      nodes: [node('n-text', 'text', 40, 40), node('n-refs', 'image', 40, 340), node('n-image', 'generate-image', 420, 40), node('n-post', 'write-post', 820, 40)],
      edges: [
        edge('e1', 'n-text', 'text', 'n-image', 'prompt'),
        edge('e2', 'n-refs', 'image', 'n-image', 'refs'),
        edge('e3', 'n-text', 'text', 'n-post', 'brief'),
        edge('e4', 'n-image', 'image', 'n-post', 'images'),
      ],
      view: { x: 20, y: 20, zoom: 0.8 },
    }),
  },
  {
    id: 'art',
    title: 'Anúncio com texto',
    hint: 'Texto → imagem → título por cima → legenda',
    build: () => ({
      version: 1,
      nodes: [node('n-text', 'text', 40, 40), node('n-refs', 'image', 40, 340), node('n-image', 'generate-image', 420, 40), node('n-art', 'overlay', 820, 40), node('n-post', 'write-post', 820, 760)],
      edges: [
        edge('e1', 'n-text', 'text', 'n-image', 'prompt'),
        edge('e2', 'n-refs', 'image', 'n-image', 'refs'),
        edge('e3', 'n-image', 'image', 'n-art', 'images'),
        edge('e4', 'n-text', 'text', 'n-art', 'copy'),
        edge('e5', 'n-text', 'text', 'n-post', 'brief'),
        edge('e6', 'n-art', 'image', 'n-post', 'images'),
      ],
      view: { x: 20, y: 20, zoom: 0.7 },
    }),
  },
  {
    id: 'carousel',
    title: 'Carrossel',
    hint: 'Briefing → slides com texto → legenda',
    build: () => ({
      version: 1,
      nodes: [node('n-text', 'text', 40, 40), node('n-refs', 'image', 40, 340), node('n-car', 'carousel', 420, 40), node('n-post', 'write-post', 840, 40)],
      edges: [
        edge('e1', 'n-text', 'text', 'n-car', 'brief'),
        edge('e2', 'n-refs', 'image', 'n-car', 'refs'),
        edge('e3', 'n-car', 'text', 'n-post', 'brief'),
        edge('e4', 'n-car', 'image', 'n-post', 'images'),
      ],
      view: { x: 20, y: 20, zoom: 0.75 },
    }),
  },
  {
    id: 'voice',
    title: 'Narração de um criativo',
    hint: 'Vídeo → roteiro → voz no ElevenLabs',
    build: () => ({
      version: 1,
      nodes: [node('n-video', 'video', 40, 40), node('n-analyze', 'analyze-video', 420, 40), node('n-voice', 'narrate', 840, 40)],
      edges: [edge('e1', 'n-video', 'video', 'n-analyze', 'video'), edge('e2', 'n-analyze', 'text', 'n-voice', 'text')],
      view: { x: 40, y: 40, zoom: 0.85 },
    }),
  },
  { id: 'copy', title: 'Copiar criativo', hint: 'Vídeo → análise → imagem → post', build: () => starterFlow() },
  {
    id: 'analyze',
    title: 'Só analisar vídeo',
    hint: 'Vídeo → roteiro e por que performa',
    build: () => ({
      version: 1,
      nodes: [node('n-video', 'video', 40, 40), node('n-text', 'text', 40, 440), node('n-analyze', 'analyze-video', 420, 40)],
      edges: [edge('e1', 'n-video', 'video', 'n-analyze', 'video'), edge('e2', 'n-text', 'text', 'n-analyze', 'context')],
      view: { x: 40, y: 40, zoom: 0.9 },
    }),
  },
  { id: 'blank', title: 'Em branco', hint: 'Monte do zero', build: () => ({ version: 1, nodes: [], edges: [], view: { x: 0, y: 0, zoom: 1 } }) },
]
