import { appendFileSync, chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { AtaBlock, Meeting, MeetingStatus, Segment, Track } from '@shared/types'
import { meetingId } from '@shared/meetings'
import { backupCopies, shapeOf } from '../backups'
import { loadJson, reportLoad, writeFileAtomic, writeJsonAtomic } from '../fs-safe'

/**
 * Meetings (docs/prd/sala-de-reuniao.md, "Armazenamento"). The index is userData/meetings.json,
 * kept like routines.json: atomic, debounced, never written over a file that did not parse.
 * What was said and typed lives in one folder per meeting, userData/meetings/<andar>/<id>/,
 * never inside a project. Folders 0700, files 0600: a meeting is private.
 */

interface Data {
  meetings: Meeting[]
}

export type NewMeeting = Pick<Meeting, 'floor' | 'title' | 'template' | 'attendees' | 'sources'>
/** id and floor name the folder: they never change. */
export type MeetingPatch = Partial<Omit<Meeting, 'id' | 'floor'>>

const DIR_MODE = 0o700
const FILE_MODE = 0o600
const STATUSES = new Set<MeetingStatus>(['recording', 'paused', 'finishing', 'enhancing', 'ready', 'interrupted', 'error'])
const TRACKS = new Set<Track>(['eu', 'outros', 'sala'])

/** ProjectFloor.id as cleanProjects accepts it, or 'terreo'. No dots or slashes: it is a folder name. */
export const FLOOR_RE = /^[\w-]{1,40}$/
/** meetingId: '2026-11-07-1430-kickoff-do-checkout', maybe with '-2'. */
export const MEETING_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_ID = 80

export const isFloorName = (v: unknown): v is string => typeof v === 'string' && FLOOR_RE.test(v)
export const isMeetingId = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_ID && MEETING_ID_RE.test(v)

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** A meeting read from meetings.json, or null when it cannot name its folder or has no status. */
export function loadMeeting(raw: unknown): Meeting | null {
  if (!isObj(raw)) return null
  if (!isMeetingId(raw.id) || !isFloorName(raw.floor)) return null
  if (typeof raw.title !== 'string' || !STATUSES.has(raw.status as MeetingStatus)) return null
  const sources = isObj(raw.sources) ? raw.sources : {}
  const counts = isObj(raw.counts) ? raw.counts : {}
  return {
    ...(raw as unknown as Meeting),
    template: typeof raw.template === 'string' ? raw.template : '',
    attendees: Array.isArray(raw.attendees) ? raw.attendees.filter((a): a is string => typeof a === 'string') : [],
    sources: { mic: sources.mic !== false, system: sources.system === true },
    startedAt: num(raw.startedAt, Date.now()),
    pauses: Array.isArray(raw.pauses)
      ? raw.pauses.filter((p): p is Meeting['pauses'][number] => isObj(p) && typeof p.at === 'number' && typeof p.ms === 'number')
      : [],
    counts: { segments: num(counts.segments), actions: num(counts.actions), open: num(counts.open) },
  }
}

export class MeetingStore {
  private file: string
  private root: string
  private list_: Meeting[]
  private timer: NodeJS.Timeout | null = null
  /** Set while a restore or import replaces the files: nothing in memory may land on them. */
  private locked = false

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'meetings.json')
    this.root = resolve(dir, 'meetings')
    const r = loadJson<Partial<Data>>(this.file, { valid: shapeOf('meetings.json'), fallbacks: backupCopies(dir, 'meetings.json') })
    reportLoad(this.file, r)
    const raw = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    const seen = new Set<string>()
    this.list_ = (raw.meetings ?? []).map(loadMeeting).filter((m): m is Meeting => !!m && !seen.has(m.id) && !!seen.add(m.id))
    // The copy that loaded goes back under the real name, or the next start would find no file.
    if (r.status === 'restored') this.flush()
  }

  // ---------- index ----------

  /** Newest first; only one floor's when given. */
  list(floor?: string): Meeting[] {
    return this.list_
      .filter((m) => floor === undefined || m.floor === floor)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((m) => ({ ...m }))
  }

  get(id: string): Meeting | undefined {
    const m = this.list_.find((x) => x.id === id)
    return m && { ...m }
  }

  /** A new meeting, recording now. Its folder exists when this returns. */
  create(input: NewMeeting, now = Date.now()): Meeting {
    if (!isFloorName(input.floor)) throw new Error('Andar inválido para a reunião.')
    const id = meetingId(
      now,
      input.title,
      this.list_.map((m) => m.id),
    )
    if (!isMeetingId(id)) throw new Error('Não deu para criar o id da reunião. Tente outro título.')
    const m: Meeting = {
      id,
      floor: input.floor,
      title: input.title,
      template: input.template,
      attendees: [...input.attendees],
      sources: { mic: !!input.sources.mic, system: !!input.sources.system },
      status: 'recording',
      startedAt: now,
      pauses: [],
      counts: { segments: 0, actions: 0, open: 0 },
    }
    this.mkdir(this.dirOf(m))
    this.list_.push(m)
    this.flush()
    return { ...m }
  }

  /** Changes what may change (never id or floor). Undefined when the meeting is gone. */
  update(id: string, patch: MeetingPatch): Meeting | undefined {
    const m = this.list_.find((x) => x.id === id)
    if (!m) return undefined
    const { id: _id, floor: _floor, ...rest } = patch as Partial<Meeting>
    if (rest.status !== undefined && !STATUSES.has(rest.status)) throw new Error('Status de reunião inválido.')
    Object.assign(m, rest)
    this.save()
    return { ...m }
  }

  /** Deletes the meeting's folder (notes, transcript, ata, audio) and its index entry. */
  remove(id: string): boolean {
    const m = this.list_.find((x) => x.id === id)
    if (!m) return false
    rmSync(this.dirOf(m), { recursive: true, force: true })
    this.list_ = this.list_.filter((x) => x !== m)
    this.flush()
    return true
  }

  /** At startup: a meeting still recording or paused lost its recorder when the app closed. */
  recoverInterrupted(): Meeting[] {
    const hit = this.list_.filter((m) => m.status === 'recording' || m.status === 'paused')
    for (const m of hit) m.status = 'interrupted'
    if (hit.length) this.flush()
    return hit.map((m) => ({ ...m }))
  }

  save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 500)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.locked) return
    writeJsonAtomic(this.file, { meetings: this.list_ } satisfies Data, { mode: FILE_MODE })
  }

  /** Writes what is pending, then stops writing for good (the app restarts next). */
  lock(): void {
    this.flush()
    this.locked = true
  }

  // ---------- the meeting's folder ----------

  /** Where each file of the meeting lives. Throws for an unknown or malformed id. */
  paths(id: string): { dir: string; notes: string; transcript: string; ataJson: string; ataMd: string; chat: string; audio: string } {
    const dir = this.dirOf(this.find(id))
    return {
      dir,
      notes: join(dir, 'notes.md'),
      transcript: join(dir, 'transcript.jsonl'),
      ataJson: join(dir, 'ata.json'),
      ataMd: join(dir, 'ata.md'),
      chat: join(dir, 'chat.jsonl'),
      audio: join(dir, 'audio'),
    }
  }

  readNotes(id: string): string {
    return readText(this.paths(id).notes) ?? ''
  }

  writeNotes(id: string, text: string): void {
    const p = this.paths(id)
    this.mkdir(p.dir)
    writeFileAtomic(p.notes, text, FILE_MODE)
  }

  /** One line of transcript.jsonl per segment; counts.segments follows. */
  appendSegment(id: string, seg: Segment): void {
    const p = this.paths(id)
    this.mkdir(p.dir)
    appendFileSync(p.transcript, JSON.stringify(seg) + '\n', { mode: FILE_MODE })
    const m = this.find(id)
    m.counts = { ...m.counts, segments: m.counts.segments + 1 }
    this.save()
  }

  /** The transcript in order of writing. A line cut short by a crash is skipped. */
  readSegments(id: string): Segment[] {
    const text = readText(this.paths(id).transcript)
    if (!text) return []
    const out: Segment[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const s = JSON.parse(line) as Segment
        if (isObj(s) && typeof s.id === 'number' && typeof s.text === 'string' && TRACKS.has(s.track)) out.push(s)
      } catch {
        // half a line from a crash
      }
    }
    return out
  }

  /** The ata as blocks (ata.json) and, when given, as Markdown (ata.md). */
  writeAta(id: string, blocks: AtaBlock[], markdown?: string): void {
    const p = this.paths(id)
    this.mkdir(p.dir)
    writeJsonAtomic(p.ataJson, blocks, { mode: FILE_MODE })
    if (markdown !== undefined) writeFileAtomic(p.ataMd, markdown, FILE_MODE)
  }

  /** Null before the first ata, or when ata.json does not parse. */
  readAta(id: string): AtaBlock[] | null {
    const text = readText(this.paths(id).ataJson)
    if (text === null) return null
    try {
      const v = JSON.parse(text) as unknown
      return Array.isArray(v) ? (v.filter(isObj) as unknown as AtaBlock[]) : null
    } catch {
      return null
    }
  }

  readAtaMd(id: string): string | null {
    return readText(this.paths(id).ataMd)
  }

  /** audio/<track>.pcm, with its folder made. */
  audioPath(id: string, track: Track): string {
    if (!TRACKS.has(track)) throw new Error('Faixa de áudio inválida.')
    const p = this.paths(id)
    this.mkdir(p.audio)
    return join(p.audio, `${track}.pcm`)
  }

  // ---------- helpers ----------

  private find(id: string): Meeting {
    if (!isMeetingId(id)) throw new Error('Reunião inválida.')
    const m = this.list_.find((x) => x.id === id)
    if (!m) throw new Error('Essa reunião não existe mais.')
    return m
  }

  /** userData/meetings/<floor>/<id>, checked to stay under userData/meetings. */
  private dirOf(m: Meeting): string {
    if (!isFloorName(m.floor) || !isMeetingId(m.id)) throw new Error('Reunião inválida.')
    const dir = resolve(this.root, m.floor, m.id)
    if (!dir.startsWith(this.root + sep)) throw new Error('Reunião inválida.')
    return dir
  }

  /** Makes the folder and its parents under userData/meetings, all 0700. */
  private mkdir(dir: string): void {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE })
    // mkdir's mode is masked by the umask and skips folders that already exist.
    for (let d = dir; d.startsWith(this.root); d = resolve(d, '..')) {
      try {
        chmodSync(d, DIR_MODE)
      } catch {
        // Windows has no Unix modes
      }
      if (d === this.root) break
    }
  }
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
