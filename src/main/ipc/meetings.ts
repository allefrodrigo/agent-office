import { app, ipcMain, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { ataToMarkdown } from '@shared/meetings-ata'
import { CHAT_SYSTEM } from '@shared/meetings-search'
import { GROUND_FLOOR, recipesFor, templateById, templatesFor } from '@shared/meeting-templates'
import type {
  AtaBlock,
  Meeting,
  MeetingAskResult,
  MeetingDetail,
  MeetingDoctorInfo,
  MeetingEnhanceResult,
  MeetingEvent,
  MeetingStartResult,
  MeetingTemplatesInfo,
  MeetingTicketResult,
  MeetingWarning,
} from '@shared/types'
import { accountEnv } from '../accounts'
import { runClaude } from '../claude-run'
import { findBin, listWhisperModels } from '../creative/tools'
import { log } from '../log'
import { onQuit } from '../quit'
import { isDir } from '../squads'
import { generateAta } from '../meetings/ata'
import { keepAwake } from '../meetings/capture'
import {
  agentsSummary,
  ataCounts,
  ataTitle,
  boardSummary,
  buildAskPrompt,
  checkMeetingAgent,
  excludedPids,
  ffmpegM4aArgs,
  meetingAgentBrief,
  meetingTicketDraft,
  mergeEditedBlocks,
  parseChat,
  resolveTicketFloor,
  setBlockTicket,
  validCitations,
} from '../meetings/flow'
import { MeetingRecorder } from '../meetings/recorder'
import { MeetingTray } from '../meetings/tray'
import type { MeetingPatch } from '../meetings/store'
import { SystemAudioCapture } from '../meetings/system-audio'
import { cleanMeetingRecipe, cleanMeetingTemplate, upsertMeetingRecipe, upsertMeetingTemplate } from '../meetings/templates'
import { doctor, WhisperServer } from '../meetings/whisper'
import {
  meetingAgentSchema,
  meetingAskSchema,
  meetingAudioSchema,
  meetingBlocksSchema,
  meetingControlSchema,
  meetingCreateSchema,
  meetingEnhanceSchema,
  meetingListSchema,
  meetingNotesSchema,
  meetingSaveTemplateSchema,
  meetingTemplatesSchema,
  meetingTicketSchema,
  parse,
} from '../validate'
import type { IpcContext } from './context'

// Sala de reunião (RN-06, RN-11, RN-18, RN-19, RN-21): the channels of the meeting room. Every
// argument passes through a strict zod schema (validate.ts). Logs carry counts and durations,
// never what was said or typed.

const run = promisify(execFile)
const FILE_MODE = 0o600
const BAD = 'Reunião inválida. Feche e abra a sala de novo.'
const GONE = 'Essa reunião não existe mais.'
const secs = (since: number) => Math.round((Date.now() - since) / 1000)
const cents = (n: number) => Math.round(n * 10_000) / 10_000

export function registerMeetingsIpc(ctx: IpcContext): void {
  const { store, meetings, board, desk, manager, accounts, book, broadcast, player, win } = ctx
  const settings = () => store.settings.meetings
  const projects = () => store.settings.projects
  // RN-08: the menu bar icon and the Dock dot follow every meeting:upsert (the recorder's included).
  const tray = new MeetingTray({
    win,
    pause: (id) => live().pause(id),
    resume: (id) => live().resume(id),
    stop: (id) => live().stop(id),
  })
  const emit = (ev: MeetingEvent | { type: 'meeting:removed'; meetingId: string }) => {
    if (ev.type === 'meeting:upsert') tray.update(ev.meeting)
    broadcast(ev)
  }
  const warn = (meetingId: string, kind: MeetingWarning['kind'], message: string) => emit({ type: 'meeting:warning', meetingId, kind, message })

  const get = (id: string): Meeting => {
    const m = meetings.get(id)
    if (!m) throw new Error(GONE)
    return m
  }
  /** Changes the index and tells the page. */
  const update = (id: string, patch: MeetingPatch): Meeting => {
    const m = meetings.update(id, patch)
    if (!m) throw new Error(GONE)
    emit({ type: 'meeting:upsert', meeting: m })
    return m
  }
  const checkFloor = (floor: string) => {
    if (floor !== GROUND_FLOOR && !projects().some((p) => p.id === floor)) throw new Error('Esse andar não existe mais.')
  }
  /** The floor's Claude Code account and the folder Claude runs in (the project, or the meeting's own folder). */
  const claudeFor = (floorId: string, meetingId?: string) => {
    const floor = projects().find((p) => p.id === floorId)
    const account = accounts.pick({ cwd: floor?.cwd ?? '', accounts: floor?.accounts })
    const cwd = floor && isDir(floor.cwd) ? floor.cwd : meetingId ? meetings.paths(meetingId).dir : app.getPath('userData')
    return { env: accountEnv(account), account: account.id, cwd }
  }

  // A meeting the app closed on while finishing has its audio on disk: it can be transcribed
  // again. One closed while writing the ata just has no new ata.
  for (const m of meetings.list()) {
    if (m.status === 'finishing') meetings.update(m.id, { status: 'interrupted' })
    else if (m.status === 'enhancing') meetings.update(m.id, { status: 'ready' })
  }

  // ---------- recorder ----------

  let modelName: string | undefined
  /** The whisper of a meeting: the model chosen in Configurações, or the best one on the machine. */
  const whisperFor = (lang: string): WhisperServer | undefined => {
    const wanted = settings().whisperModel
    const model = (wanted && listWhisperModels().find((p) => basename(p) === wanted)) || undefined
    const w = model ? machineWhisper(model, lang) : WhisperServer.fromMachine(lang)
    modelName = model ? basename(model) : listWhisperModels()[0] && basename(listWhisperModels()[0])
    return w
  }

  let recorder: MeetingRecorder | null = null
  let recorderLang = ''
  /** The recorder takes the language when made: a new one when it changed and no meeting runs. */
  const recorderFor = (): MeetingRecorder => {
    const lang = settings().lang
    if (recorder && (recorder.activeId || recorderLang === lang)) return recorder
    recorder = new MeetingRecorder({
      store: meetings,
      whisper: whisperFor,
      // macOS taps the system audio with the Swift helper; elsewhere the page sends the "outros" track.
      systemAudio: process.platform === 'darwin' ? () => new SystemAudioCapture() : undefined,
      emit,
      lang,
      onFinished: (m) => finished(m),
    })
    recorderLang = lang
    return recorder
  }
  const live = (): MeetingRecorder => {
    if (!recorder) throw new Error('Esta reunião não está gravando.')
    return recorder
  }

  /** Undoes keepAwake (throttling back, sleep allowed). */
  let release: (() => void) | null = null
  const wake = (on: boolean) => {
    release?.()
    release = null
    const w = win()
    if (on && w && !w.isDestroyed()) release = keepAwake(w.webContents)
  }

  /** Recording over (by hand, by silence, by the 4 h limit, or recovered): the ata comes by itself. */
  function finished(m: Meeting): void {
    wake(false)
    if (settings().autoAta) void enhance(m.id).catch((err: unknown) => log.warn('Reunião: ata automática não rodou:', (err as Error).message))
  }

  /** Context of the whisper prompt: names, so they come out spelled right. */
  const whisperContext = (m: Meeting) => ({
    attendees: m.attendees,
    floor: projects().find((p) => p.id === m.floor)?.name,
    agents: manager
      .list()
      .filter((a) => (a.project ?? GROUND_FLOOR) === m.floor)
      .map((a) => a.name)
      .slice(0, 30),
  })

  // Quitting with a meeting on: what was captured goes to disk and the meeting shows as
  // interrupted, so the next start offers "Transcrever o que ficou gravado".
  onQuit(() => {
    const id = recorder?.activeId
    if (!id) return
    try {
      if (recorder?.state !== 'finishing') void recorder?.stop(id).catch(() => undefined)
    } catch {
      // recovering: nothing to stop
    }
    meetings.update(id, { status: 'interrupted' })
    meetings.flush()
    wake(false)
    log.info('Reunião: app saindo durante a gravação; marcada como interrompida')
  })

  // ---------- ata ----------

  const enhancing = new Map<string, AbortController>()

  /** Writes (or rewrites) the ata with a template; the meeting goes enhancing → ready either way. */
  async function enhance(id: string, templateId?: string): Promise<MeetingEnhanceResult> {
    const m = get(id)
    if (enhancing.has(id)) throw new Error('A ata desta reunião já está sendo escrita.')
    if (m.status !== 'ready' && m.status !== 'error' && m.status !== 'enhancing') throw new Error('Encerre a reunião antes de gerar a ata.')
    const template = templateById(templateId ?? m.template, m.floor, settings().templates)
    const ctrl = new AbortController()
    enhancing.set(id, ctrl)
    const started = Date.now()
    const progress = (label: string) => emit({ type: 'meeting:progress', meetingId: id, stage: 'ata', pending: 0, delayMs: 0, label: label.slice(0, 200) })
    try {
      let meeting = update(id, { status: 'enhancing', template: template.id })
      try {
        const claude = claudeFor(meeting.floor, meeting.id)
        const segments = meetings.readSegments(id)
        const r = await generateAta({
          meeting,
          notes: meetings.readNotes(id),
          segments,
          template,
          previous: meetings.readAta(id) ?? undefined,
          ...claude,
          book,
          model: settings().ataModel,
          onProgress: progress,
          signal: ctrl.signal,
        })
        meetings.writeAta(id, r.blocks, r.markdown)
        meeting = update(id, { status: 'ready', costUsd: cents((meeting.costUsd ?? 0) + r.costUsd), counts: { ...meeting.counts, ...ataCounts(r.blocks) } })
        log.info(`Reunião: ata pronta em ${secs(started)} s (${segments.length} falas, ${r.blocks.length} blocos, ${template.id}, ${settings().ataModel})`)
        void tidyAudio(id)
        return { meeting, ata: r.blocks, ataMarkdown: r.markdown }
      } catch (err) {
        const raw = err instanceof Error ? err.message : ''
        const message = raw.startsWith('O plano do Claude') ? raw : 'O Claude não devolveu a ata. Tente gerar de novo.'
        // Never the message itself in the log: Claude's error may quote the transcript.
        log.warn(`Reunião: a ata falhou após ${secs(started)} s (${template.id}): ${errorKind(raw)}`)
        if (!meetings.get(id)) throw new Error(GONE, { cause: err })
        meeting = update(id, { status: 'ready' })
        warn(id, 'ata', message)
        return { meeting, ata: meetings.readAta(id), ataMarkdown: meetings.readAtaMd(id), error: message }
      }
    } finally {
      enhancing.delete(id)
    }
  }

  /**
   * The ata is ready: the raw audio goes. With "Guardar o áudio" each track becomes .m4a first
   * (ffmpeg); a track that fails to convert stays as PCM, with a warning.
   */
  async function tidyAudio(id: string): Promise<void> {
    if (recorder?.activeId === id || !meetings.get(id)) return
    const dir = meetings.paths(id).audio
    let files: string[]
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.pcm'))
    } catch {
      return
    }
    if (!files.length) return
    if (!settings().keepAudio) {
      for (const f of files) rmSync(join(dir, f), { force: true })
      log.info(`Reunião: áudio bruto apagado (${files.length} faixas)`)
      return
    }
    const ffmpeg = findBin('ffmpeg')
    if (!ffmpeg) return warn(id, 'audio', 'Não achei o ffmpeg para guardar o áudio em .m4a. Instale com `brew install ffmpeg`; o áudio bruto ficou guardado.')
    let failed = 0
    for (const f of files) {
      const pcm = join(dir, f)
      const out = pcm.replace(/\.pcm$/, '.m4a')
      try {
        if (statSync(pcm).size < 2) {
          rmSync(pcm, { force: true })
          continue
        }
        await run(ffmpeg, ffmpegM4aArgs(pcm, out), { timeout: 15 * 60_000 })
        try {
          chmodSync(out, FILE_MODE)
        } catch {
          // Windows has no Unix modes
        }
        rmSync(pcm, { force: true })
      } catch {
        failed++
        rmSync(out, { force: true })
      }
    }
    log.info(`Reunião: áudio guardado em .m4a (${files.length - failed}/${files.length} faixas)`)
    if (failed) warn(id, 'audio', 'O ffmpeg não converteu o áudio para .m4a. O áudio bruto ficou guardado; tente gerar a ata de novo.')
  }

  // ---------- channels ----------

  ipcMain.handle('office:meetings', (_e, raw: unknown): Meeting[] => meetings.list(parse(meetingListSchema, raw, 'Andar inválido.').floor))

  ipcMain.handle('office:meeting', (_e, raw: unknown): MeetingDetail => {
    const { id } = parse(meetingControlSchema, raw, BAD)
    const meeting = get(id)
    let chat: string | null = null
    try {
      chat = readFileSync(meetings.paths(id).chat, 'utf8')
    } catch {
      // no conversation yet
    }
    return {
      meeting,
      notes: meetings.readNotes(id),
      ata: meetings.readAta(id),
      ataMarkdown: meetings.readAtaMd(id),
      segments: meetings.readSegments(id),
      chat: parseChat(chat),
    }
  })

  ipcMain.handle('office:meetingCreate', (_e, raw: unknown): Meeting => {
    const d = parse(meetingCreateSchema, raw, BAD)
    checkFloor(d.floor)
    const s = settings()
    const sources = d.sources ?? { mic: true, system: s.defaultSources === 'mic+system' }
    if (!sources.mic && !sources.system) throw new Error('Escolha o microfone, o áudio do computador ou os dois.')
    const attendees = [...new Set((d.attendees ?? []).map((a) => a.replace(/\s+/g, ' ').trim()).filter(Boolean))]
    const m = meetings.create({
      floor: d.floor,
      title: d.title?.replace(/\s+/g, ' ').trim() || 'Reunião',
      template: templateById(d.template, d.floor, s.templates).id,
      attendees,
      sources,
    })
    emit({ type: 'meeting:upsert', meeting: m })
    log.info(`Reunião: criada (${attendees.length} participantes, microfone ${sources.mic ? 'sim' : 'não'}, sistema ${sources.system ? 'sim' : 'não'})`)
    return m
  })

  ipcMain.handle('office:meetingStart', async (_e, raw: unknown): Promise<MeetingStartResult> => {
    const { id } = parse(meetingControlSchema, raw, BAD)
    const m = get(id)
    const rec = recorderFor()
    const s = settings()
    wake(true)
    try {
      const r = await rec.start(m, {
        mic: m.sources.mic,
        system: m.sources.system,
        excludePids: excludedPids(process.pid, app.getAppMetrics()),
        context: whisperContext(m),
        silenceAutostopMin: s.autoStopMin,
      })
      const meeting = update(id, { lang: s.lang, ...(modelName ? { whisperModel: modelName } : {}) })
      return { meeting, ...r }
    } catch (err) {
      wake(false)
      throw err
    }
  })

  ipcMain.handle('office:meetingAudio', (_e, raw: unknown): boolean => {
    const c = parse(meetingAudioSchema, raw, 'Pedaço de áudio inválido (faixa desconhecida ou maior que 64 KB).')
    return live().pushChunk(c)
  })

  ipcMain.handle('office:meetingPause', (_e, raw: unknown): Meeting => live().pause(parse(meetingControlSchema, raw, BAD).id))
  ipcMain.handle('office:meetingResume', (_e, raw: unknown): Meeting => live().resume(parse(meetingControlSchema, raw, BAD).id))
  ipcMain.handle('office:meetingStop', (_e, raw: unknown): Promise<Meeting> => live().stop(parse(meetingControlSchema, raw, BAD).id))

  ipcMain.handle('office:meetingRecover', (_e, raw: unknown): Promise<Meeting> => {
    const { id } = parse(meetingControlSchema, raw, BAD)
    return recorderFor().recoverInterrupted(id, whisperContext(get(id)))
  })

  ipcMain.handle('office:meetingNotes', (_e, raw: unknown): void => {
    const { id, text } = parse(meetingNotesSchema, raw, 'Notas grandes demais (até 200 mil caracteres).')
    get(id)
    meetings.writeNotes(id, text)
  })

  ipcMain.handle('office:meetingEnhance', (_e, raw: unknown): Promise<MeetingEnhanceResult> => {
    const d = parse(meetingEnhanceSchema, raw, BAD)
    return enhance(d.id, d.template)
  })

  ipcMain.handle('office:meetingBlocks', (_e, raw: unknown): MeetingEnhanceResult => {
    const d = parse(meetingBlocksSchema, raw, 'Ata inválida. Recarregue a reunião e edite de novo.')
    const m = get(d.id)
    if (enhancing.has(d.id)) throw new Error('A ata está sendo escrita. Espere terminar para editar.')
    const blocks = mergeEditedBlocks(d.blocks as AtaBlock[], meetings.readAta(d.id))
    const markdown = ataToMarkdown(ataTitle(meetings.readAtaMd(d.id), m.title), blocks)
    meetings.writeAta(d.id, blocks, markdown)
    const meeting = update(d.id, { counts: { ...m.counts, ...ataCounts(blocks) } })
    return { meeting, ata: blocks, ataMarkdown: markdown }
  })

  ipcMain.handle('office:meetingAsk', async (_e, raw: unknown): Promise<MeetingAskResult> => {
    const d = parse(meetingAskSchema, raw, 'Pergunta inválida (até 4 mil caracteres).')
    checkFloor(d.floor)
    const m = d.id ? get(d.id) : undefined
    if (m && m.floor !== d.floor) throw new Error('Essa reunião é de outro andar.')
    const history = d.history ?? []
    const started = Date.now()
    let prompt: string
    let known: string[]
    if (d.scope === 'meeting' && m) {
      prompt = buildAskPrompt({ scope: 'meeting', question: d.question, history, meeting: { meeting: m, segments: meetings.readSegments(m.id), ata: meetings.readAta(m.id) ?? [] } })
      known = [m.id]
    } else {
      const list = meetings.list(d.floor)
      prompt = buildAskPrompt({
        scope: 'floor',
        question: d.question,
        history,
        floorMeetings: list.map((x) => ({ meeting: x, segments: meetings.readSegments(x.id), ata: meetings.readAta(x.id) ?? [] })),
        board: boardSummary(board.list(), projects(), d.floor),
        agents: agentsSummary(manager.list(), d.floor),
      })
      known = list.map((x) => x.id)
    }
    const claude = claudeFor(d.floor, m?.id)
    // No readRoots: no tools. What was said in a meeting is data, never an instruction.
    const out = await runClaude({
      prompt,
      system: CHAT_SYSTEM,
      cwd: claude.cwd,
      model: settings().ataModel,
      env: claude.env,
      ledger: { book, category: 'reunioes', cwd: claude.cwd, account: claude.account },
    })
    const citations = validCitations(out.text, known)
    if (m) {
      const at = Date.now()
      const lines = [
        { role: 'user', text: d.question, at, scope: d.scope },
        { role: 'assistant', text: out.text, at: Date.now(), scope: d.scope },
      ]
      appendFileSync(meetings.paths(m.id).chat, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: FILE_MODE })
      update(m.id, { costUsd: cents((get(m.id).costUsd ?? 0) + out.costUsd) })
    }
    log.info(`Reunião: pergunta respondida (${d.scope}, ${known.length} reuniões, ${citations.length} citações, ${secs(started)} s)`)
    return { text: out.text, citations }
  })

  ipcMain.handle('office:meetingTicket', async (_e, raw: unknown): Promise<MeetingTicketResult> => {
    const d = parse(meetingTicketSchema, raw, 'Ticket inválido. Confira a prévia e tente de novo.')
    const m = get(d.id)
    const ata = meetings.readAta(m.id)
    const block = ata?.find((b) => b.id === d.blockId)
    if (!ata || !block) throw new Error('Esse item da ata não existe mais.')
    if (block.ticket) throw new Error(`Esse item já virou o ticket ${block.ticket}.`)
    const floor = resolveTicketFloor(m.floor, d.floor, projects())
    // Before creating anything: the agent must be able to take it.
    if (d.agentId) checkMeetingAgent(manager.list().find((a) => a.id === d.agentId), floor.id)
    const ticket = board.create(meetingTicketDraft(m, block, meetings.readSegments(m.id), d.draft, floor), player())
    const blocks = setBlockTicket(ata, block.id, ticket.key)
    meetings.writeAta(m.id, blocks, ataToMarkdown(ataTitle(meetings.readAtaMd(m.id), m.title), blocks))
    update(m.id, { counts: { ...m.counts, ...ataCounts(blocks) } })
    let delegated = false
    let delegateError: string | undefined
    if (d.agentId) {
      try {
        await desk.delegate(ticket.id, { agentId: d.agentId }, player())
        delegated = true
      } catch (err) {
        delegateError = `Ticket ${ticket.key} criado, mas não foi entregue: ${(err as Error).message}`
      }
    }
    log.info(`Reunião: ticket criado de um item da ata${d.agentId ? (delegated ? ' e entregue a um agente' : '; a entrega falhou') : ''}`)
    const fresh = board.get(ticket.id) ?? ticket
    return { ticket: fresh, block: blocks.find((b) => b.id === block.id) as AtaBlock, delegated, ...(delegateError ? { delegateError } : {}) }
  })

  ipcMain.handle('office:meetingDelete', (_e, raw: unknown): void => {
    const { id } = parse(meetingControlSchema, raw, BAD)
    if (recorder?.activeId === id) throw new Error('Encerre a reunião antes de apagar.')
    enhancing.get(id)?.abort()
    if (!meetings.remove(id)) throw new Error(GONE)
    emit({ type: 'meeting:removed', meetingId: id })
    log.info('Reunião: apagada')
  })

  ipcMain.handle('office:meetingTemplates', (_e, raw: unknown): MeetingTemplatesInfo => {
    const { floor } = parse(meetingTemplatesSchema, raw ?? {}, 'Andar inválido.')
    const s = settings()
    return { templates: templatesFor(floor, s.templates), recipes: recipesFor(floor, s.recipes) }
  })

  ipcMain.handle('office:meetingSaveTemplate', (_e, raw: unknown) => {
    const d = parse(meetingSaveTemplateSchema, raw, 'Modelo inválido.')
    const s = settings()
    if (d.kind === 'template') {
      const t = cleanMeetingTemplate(d.item, projects())
      store.settings = { ...store.settings, meetings: { ...s, templates: upsertMeetingTemplate(s.templates, t) } }
      broadcast({ type: 'settings', settings: store.settings })
      return t
    }
    const r = cleanMeetingRecipe(d.item, projects())
    store.settings = { ...store.settings, meetings: { ...s, recipes: upsertMeetingRecipe(s.recipes, r) } }
    broadcast({ type: 'settings', settings: store.settings })
    return r
  })

  ipcMain.handle('office:meetingDoctor', (): MeetingDoctorInfo => meetingDoctor())

  ipcMain.handle('office:meetingAgent', (_e, raw: unknown): { agentId: string } => {
    const d = parse(meetingAgentSchema, raw, 'Pergunta inválida (até 4 mil caracteres).')
    const m = get(d.id)
    const agent = checkMeetingAgent(
      manager.list().find((a) => a.id === d.agentId),
      m.floor,
    )
    manager.sendMessage(agent.id, meetingAgentBrief(m, d.question), `Pergunta sobre a reunião "${m.title}"`)
    log.info('Reunião: pergunta entregue a um agente do andar')
    return { agentId: agent.id }
  })
}

/** whisper-server (or whisper-cli) with a given model file; undefined without either binary. */
function machineWhisper(model: string, lang: string): WhisperServer | undefined {
  const serverBin = findBin('whisper-server')
  const cliBin = findBin('whisper-cli')
  if (!serverBin && !cliBin) return undefined
  return new WhisperServer({ model, serverBin, cliBin, lang })
}

const SCREEN_AUDIO_HINT =
  'Áudio do computador: na primeira gravação o macOS pede permissão. Se negou, libere o Agent Office em Ajustes do Sistema > Privacidade e Segurança > Gravação de Tela e Áudio do Sistema.'
const MIC_HINT = 'Microfone: libere o Agent Office em Ajustes do Sistema > Privacidade e Segurança > Microfone e abra a sala de novo.'

/** What the machine has to record and transcribe, with file names only (never the folders). */
function meetingDoctor(): MeetingDoctorInfo {
  const d = doctor()
  const item = (i: { ok: boolean; found?: string; message?: string }) => ({
    ok: i.ok,
    ...(i.found ? { found: basename(i.found) } : {}),
    ...(i.message ? { message: i.message } : {}),
  })
  const mac = process.platform === 'darwin'
  const cap = new SystemAudioCapture()
  const supported = mac ? cap.supported() : process.platform === 'win32'
  let systemMessage: string | undefined
  if (mac && !supported) systemMessage = 'Gravar o áudio do computador precisa do macOS 14.2 ou mais novo. Grave só o microfone.'
  else if (mac && !existsSync(cap.binPath())) systemMessage = 'O ajudante de áudio do sistema não foi encontrado. Rode "npm run native" e tente de novo.'
  else if (!supported) systemMessage = 'Neste sistema a reunião grava só o microfone.'
  let status: MeetingDoctorInfo['microphone']['status'] = 'unknown'
  if (mac || process.platform === 'win32') {
    try {
      status = systemPreferences.getMediaAccessStatus('microphone') as MeetingDoctorInfo['microphone']['status']
    } catch {
      status = 'unknown'
    }
  }
  const micBlocked = status === 'denied' || status === 'restricted'
  const permissionHints: string[] = []
  if (micBlocked) permissionHints.push(MIC_HINT)
  if (mac && supported) permissionHints.push(SCREEN_AUDIO_HINT)
  return {
    whisperCli: item(d.whisperCli),
    whisperServer: item(d.whisperServer),
    model: item(d.model),
    ffmpeg: item(d.ffmpeg),
    canTranscribe: d.canTranscribe,
    problems: d.problems,
    systemAudio: { supported: supported && !systemMessage, ...(systemMessage ? { message: systemMessage } : {}) },
    microphone: { status, ...(micBlocked ? { message: MIC_HINT } : {}) },
    permissionHints,
  }
}

/** A content-free label for the log: the error class, never its text (it may quote the transcript). */
function errorKind(message: string): string {
  if (/json.?schema/i.test(message)) return 'schema recusado pelo CLI'
  if (/exited with code/i.test(message)) return 'o processo do Claude saiu com erro'
  if (/abort|cancel/i.test(message)) return 'cancelada'
  if (/timeout|timed out/i.test(message)) return 'tempo esgotado'
  return 'erro desconhecido'
}
