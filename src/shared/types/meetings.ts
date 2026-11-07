// Sala de reunião: a reunião, a transcrição por faixa e a ata em blocos (docs/prd/sala-de-reuniao.md).

import type { Ticket, TicketDraft } from './tickets'

export type MeetingStatus = 'recording' | 'paused' | 'finishing' | 'enhancing' | 'ready' | 'interrupted' | 'error'

/** Quem falou, sem diarização: `eu` é o microfone, `outros` o áudio do sistema, `sala` o modo presencial. */
export type Track = 'eu' | 'outros' | 'sala'

export interface Meeting {
  /** '2026-11-07-1430-kickoff-do-checkout' (meetingId). */
  id: string
  /** ProjectFloor.id ou 'terreo'. */
  floor: string
  title: string
  /** Id do modelo de ata. */
  template: string
  attendees: string[]
  sources: { mic: boolean; system: boolean }
  status: MeetingStatus
  startedAt: number
  endedAt?: number
  /** at = ms desde startedAt (relógio de parede) em que a pausa começou. */
  pauses: { at: number; ms: number }[]
  /** Pedaços do microfone que não chegaram (seq pulado); at em ms desde startedAt. */
  gaps?: MeetingGap[]
  /** Tempo gravado, sem as pausas; gravado ao encerrar. */
  durationMs?: number
  lang?: string
  /** 'ggml-small.bin'. */
  whisperModel?: string
  counts: { segments: number; actions: number; open: number }
  /** Soma das chamadas ao Claude desta reunião. */
  costUsd?: number
}

export interface Segment {
  /** Sequencial na reunião. */
  id: number
  track: Track
  /** ms desde o início. */
  start: number
  end: number
  text: string
}

export interface AtaBlock {
  id: string
  kind: 'heading' | 'paragraph' | 'bullet' | 'action'
  text: string
  origin: 'user' | 'ai'
  /** Ids de Segment que sustentam o bloco. */
  refs: number[]
  /** Só em 'action'. */
  owner?: string
  /** Só em 'action', texto livre ("até sexta"). */
  due?: string
  /** Chave do ticket criado (AO-31). */
  ticket?: string
}

export interface MeetingTemplate {
  id: string
  name: string
  /** Ausente = todos os andares. */
  floor?: string
  sections: { title: string; hint: string }[]
  /** Orientação extra para a ata. */
  instruction: string
}

/** Receita da conversa (`/resumo`, `/tickets`…): um prompt pronto, chamado com `/` e autocompletar. */
export interface MeetingRecipe {
  id: string
  /** '/follow-up': barra, minúsculas, números e hífens. */
  command: string
  name: string
  /** O que pedir ao Claude sobre a reunião (ou o andar). */
  prompt: string
  /** Ausente = todos os andares. */
  floor?: string
}

/** Idioma falado nas reuniões; 'auto' deixa o whisper detectar. */
export type MeetingLang = 'pt' | 'en' | 'auto'
/** Fontes de uma reunião nova: microfone e áudio do computador, ou só o microfone. */
export type MeetingSources = 'mic+system' | 'mic'
/** Modelo do Claude que escreve a ata. */
export type AtaModel = 'sonnet' | 'opus'

/** Configurações → Reuniões (padrões em DEFAULT_MEETING_SETTINGS, @shared/meetings). */
export interface MeetingSettings {
  lang: MeetingLang
  /** Nome do arquivo do modelo ('ggml-small.bin'); '' = o melhor achado na máquina. */
  whisperModel: string
  defaultSources: MeetingSources
  /** Gerar a ata ao encerrar. */
  autoAta: boolean
  ataModel: AtaModel
  /** Durante a gravação, pedidos e entregas vão para a caixa de entrada. */
  doNotDisturb: boolean
  /** Minutos sem fala até encerrar sozinha (5–120). */
  autoStopMin: number
  /** Guardar o áudio da reunião depois de transcrever. */
  keepAudio: boolean
  /** Apagar reuniões com mais de N dias; 0 = nunca (0–3650). */
  retentionDays: number
  /** Agentes podem ler as atas pelo MCP (padrão global; transcrições são por andar). */
  agentsReadAtas: boolean
  /** Modelos de ata próprios, globais e por andar. Mesmo id de um embutido o substitui. */
  templates: MeetingTemplate[]
  /** Receitas próprias, globais e por andar. Mesmo id de uma embutida a substitui. */
  recipes: MeetingRecipe[]
}

/** Configurações → Reuniões: os modelos do whisper achados na máquina e a memória dela. */
export interface WhisperModelsInfo {
  /** Nomes de arquivo ('ggml-small.bin'), sem repetir, o melhor primeiro. */
  models: string[]
  /** Memória total da máquina, em GB. */
  totalMemGb: number
}

/** Um segmento devolvido pelo whisper (server ou cli), em ms relativos ao trecho enviado. */
export interface WhisperSegment {
  start: number
  end: number
  text: string
  /** Só o whisper-server (verbose_json) informa. */
  noSpeechProb?: number
}

/** Buraco na gravação: pedaços de áudio que não chegaram ao main (seq pulado no IPC). */
export interface MeetingGap {
  track: Track
  /** ms desde startedAt. */
  at: number
  ms: number
}

/**
 * Avisos do gravador (RN-04) para a tela da sala. `message` já é o texto para o usuário.
 * - system-audio-waiting: o macOS está mostrando o pedido de permissão.
 * - system-audio-failed: o áudio do sistema não subiu; a reunião segue só com o microfone.
 * - system-audio-silent: zeros exatos do ajudante (permissão negada ou nada tocando).
 * - system-audio-lost: o ajudante saiu no meio; a reunião segue só com o microfone.
 * - gap: pedaços do microfone perdidos (track, at, ms).
 * - echo: o filtro de eco disparou muito; sugerir fone.
 * - delay: a fila do whisper passou de 40 s (delayMs).
 * - idle: 5 min sem fala ("Esqueceu de encerrar?").
 * - autostop: a reunião encerrou sozinha (reason).
 * - transcription: um trecho falhou no whisper.
 * - ata: a ata não saiu (limite do plano, erro do Claude); a reunião fica `ready` sem ata nova.
 * - audio: "Guardar o áudio" não conseguiu converter para .m4a; o PCM ficou no disco.
 */
export type MeetingWarningKind =
  | 'system-audio-waiting'
  | 'system-audio-failed'
  | 'system-audio-silent'
  | 'system-audio-lost'
  | 'gap'
  | 'echo'
  | 'delay'
  | 'idle'
  | 'autostop'
  | 'transcription'
  | 'ata'
  | 'audio'

export interface MeetingWarning {
  meetingId: string
  kind: MeetingWarningKind
  message: string
  track?: Track
  /** gap: ms desde startedAt. */
  at?: number
  /** gap: duração do buraco. */
  ms?: number
  /** delay. */
  delayMs?: number
  /** autostop. */
  reason?: 'silence' | 'limit'
}

/** Andamento da transcrição: trechos na fila do whisper e atraso. */
export interface MeetingProgress {
  meetingId: string
  /**
   * live: gravando; finishing: esvaziando a fila ao encerrar; recovering: transcrevendo o PCM que
   * ficou; ata: gerando a ata (label com a etapa: "Lendo 412 falas…", "Escrevendo a ata…").
   */
  stage: 'live' | 'finishing' | 'recovering' | 'ata'
  pending: number
  delayMs: number
  /** "Terminando a transcrição…" no finishing e no recovering. */
  label?: string
}

/** Eventos do gravador, no formato do OfficeEvent (o RN-06 os repassa em office:event). */
export type MeetingEvent =
  | { type: 'meeting:upsert'; meeting: Meeting }
  | { type: 'meeting:segment'; meetingId: string; segment: Segment }
  | ({ type: 'meeting:progress' } & MeetingProgress)
  | ({ type: 'meeting:warning' } & MeetingWarning)

// ---------- IPC da sala (RN-06, RN-11, RN-18, RN-19, RN-21) ----------

/** Uma linha de chat.jsonl: a conversa com a reunião ou com o andar. */
export interface MeetingChatEntry {
  role: 'user' | 'assistant'
  text: string
  at: number
  scope: 'meeting' | 'floor'
}

/** office:meeting: tudo o que a tela da sala mostra de uma reunião. */
export interface MeetingDetail {
  meeting: Meeting
  notes: string
  /** null antes da primeira ata. */
  ata: AtaBlock[] | null
  /** A ata em Markdown (ata.md), para copiar e salvar. */
  ataMarkdown: string | null
  segments: Segment[]
  chat: MeetingChatEntry[]
}

/** office:meetingCreate: o que falta vem dos padrões (Configurações → Reuniões). */
export interface MeetingCreateInput {
  floor: string
  title?: string
  template?: string
  attendees?: string[]
  sources?: { mic: boolean; system: boolean }
}

/** office:meetingStart: como a captura ficou. */
export interface MeetingStartResult {
  meeting: Meeting
  /** A faixa do microfone ('eu' com o áudio do sistema, 'sala' sem); null sem microfone. */
  micTrack: Track | null
  /** native: o ajudante do macOS grava o sistema; renderer: o renderer manda a faixa 'outros'; none: sem sistema. */
  systemAudio: 'native' | 'renderer' | 'none'
  whisperMode: 'idle' | 'server' | 'cli' | 'stopped'
}

/** office:meetingAudio: um pedaço de PCM 16 kHz mono s16le, até 64 KB. */
export interface MeetingAudioChunk {
  id: string
  track: Track
  seq: number
  pcm: Int16Array | Uint8Array | ArrayBuffer
}

/** office:meetingEnhance: a ata nova, ou o erro (a reunião fica `ready`, a ata anterior fica). */
export interface MeetingEnhanceResult {
  meeting: Meeting
  ata: AtaBlock[] | null
  ataMarkdown: string | null
  /** Mensagem em pt-BR quando a ata não saiu; também vem como meeting:warning kind 'ata'. */
  error?: string
}

/** office:meetingAsk. */
export interface MeetingAskInput {
  scope: 'meeting' | 'floor'
  /** Obrigatório no escopo 'meeting'; no 'floor', a conversa fica no chat.jsonl desta reunião. */
  id?: string
  floor: string
  question: string
  history?: { role: 'user' | 'assistant'; text: string }[]
}

export interface MeetingAskResult {
  text: string
  /** As marcas [r:<id>#s<n>] da resposta que existem no andar. */
  citations: { meetingId: string; segment: number }[]
}

/** office:meetingTicket. */
export interface MeetingTicketInput {
  id: string
  blockId: string
  /** A prévia editada (actionToDraft é o ponto de partida). cwd, tags e a citação o main refaz. */
  draft: TicketDraft
  /** Entregar a um agente do andar depois de criar. */
  agentId?: string
  /** Andar do ticket: obrigatório em reuniões do térreo. */
  floor?: string
}

export interface MeetingTicketResult {
  ticket: Ticket
  block: AtaBlock
  delegated: boolean
  /** O ticket foi criado, mas a entrega ao agente falhou (motivo em pt-BR). */
  delegateError?: string
}

export interface MeetingDoctorItem {
  ok: boolean
  /** Nome do binário ou do arquivo do modelo (nunca a pasta). */
  found?: string
  message?: string
}

/** office:meetingDoctor: o que há na máquina para gravar e transcrever. */
export interface MeetingDoctorInfo {
  whisperCli: MeetingDoctorItem
  whisperServer: MeetingDoctorItem
  model: MeetingDoctorItem
  ffmpeg: MeetingDoctorItem
  canTranscribe: boolean
  /** As mensagens do que falta, na ordem em que importam. */
  problems: string[]
  systemAudio: { supported: boolean; message?: string }
  microphone: { status: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'; message?: string }
  /** Ajustes do macOS para liberar o áudio do sistema (abrir com openExternal não vale: use o botão do app). */
  permissionHints: string[]
}

/** office:meetingTemplates. */
export interface MeetingTemplatesInfo {
  templates: MeetingTemplate[]
  recipes: MeetingRecipe[]
}
