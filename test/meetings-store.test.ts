process.env.TZ = 'America/Sao_Paulo'

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AtaBlock, Meeting, Segment } from '@shared/types'
import { MeetingStore, isFloorName, isMeetingId, loadMeeting, type NewMeeting } from '../src/main/meetings/store'
import { dailyBackup } from '../src/main/backups'

let dir: string
let opened: MeetingStore[] = []
/** A store whose pending (debounced) writes stop before the folder goes away. */
const open = (d: string) => {
  const s = new MeetingStore(d)
  opened.push(s)
  return s
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-meetings-'))
})
afterEach(() => {
  for (const s of opened) s.lock()
  opened = []
  rmSync(dir, { recursive: true, force: true })
})

const at = (h: number, mi = 0) => new Date(2026, 10, 7, h, mi).getTime()
const input = (over: Partial<NewMeeting> = {}): NewMeeting => ({
  floor: 'p1',
  title: 'Kickoff do checkout',
  template: 'padrao',
  attendees: ['Ana', 'Bruno'],
  sources: { mic: true, system: true },
  ...over,
})
const seg = (id: number, text: string): Segment => ({ id, track: id % 2 ? 'eu' : 'outros', start: id * 1000, end: id * 1000 + 900, text })
const mode = (p: string) => statSync(p).mode & 0o777
const index = () => JSON.parse(readFileSync(join(dir, 'meetings.json'), 'utf8')) as { meetings: Meeting[] }

describe('MeetingStore: criar, listar e ler de volta', () => {
  it('cria a reunião gravando, com a pasta em meetings/<andar>/<id>', () => {
    const s = open(dir)
    const m = s.create(input(), at(14, 30))
    expect(m.id).toBe('2026-11-07-1430-kickoff-do-checkout')
    expect(m.status).toBe('recording')
    expect(m.counts).toEqual({ segments: 0, actions: 0, open: 0 })
    expect(existsSync(join(dir, 'meetings', 'p1', m.id))).toBe(true)
    expect(index().meetings[0].id).toBe(m.id)
  })

  it('o mesmo título no mesmo minuto ganha sufixo', () => {
    const s = open(dir)
    const a = s.create(input(), at(9))
    const b = s.create(input(), at(9))
    expect(b.id).toBe(`${a.id}-2`)
  })

  it('lista por andar, a mais nova primeiro', () => {
    const s = open(dir)
    s.create(input({ title: 'A' }), at(9))
    s.create(input({ title: 'B', floor: 'terreo' }), at(10))
    s.create(input({ title: 'C' }), at(11))
    expect(s.list('p1').map((m) => m.title)).toEqual(['C', 'A'])
    expect(s.list('terreo').map((m) => m.title)).toEqual(['B'])
    expect(s.list()).toHaveLength(3)
  })

  it('notas, transcrição, ata e áudio voltam depois de reabrir', () => {
    const s = open(dir)
    const { id } = s.create(input(), at(14, 30))
    s.writeNotes(id, '# Notas\n- prazo sexta')
    s.appendSegment(id, seg(1, 'bom dia'))
    s.appendSegment(id, seg(2, 'vamos começar'))
    const ata: AtaBlock[] = [{ id: 'b1', kind: 'action', text: 'Ana revisa o PR', origin: 'ai', refs: [1, 2], owner: 'Ana' }]
    s.writeAta(id, ata, '# Ata\n- [ ] Ana revisa o PR')
    s.update(id, { status: 'ready', endedAt: at(15) })
    s.flush()

    const again = open(dir)
    expect(again.get(id)?.status).toBe('ready')
    expect(again.get(id)?.counts.segments).toBe(2)
    expect(again.readNotes(id)).toBe('# Notas\n- prazo sexta')
    expect(again.readSegments(id).map((x) => x.text)).toEqual(['bom dia', 'vamos começar'])
    expect(again.readAta(id)).toEqual(ata)
    expect(again.readAtaMd(id)).toContain('Ana revisa')
    expect(again.audioPath(id, 'eu')).toBe(join(dir, 'meetings', 'p1', id, 'audio', 'eu.pcm'))
    expect(again.paths(id).chat).toBe(join(dir, 'meetings', 'p1', id, 'chat.jsonl'))
  })

  it('reunião sem notas nem ata lê vazio', () => {
    const s = open(dir)
    const { id } = s.create(input(), at(9))
    expect(s.readNotes(id)).toBe('')
    expect(s.readSegments(id)).toEqual([])
    expect(s.readAta(id)).toBeNull()
  })

  it('pula a linha cortada por uma queda no fim da transcrição', () => {
    const s = open(dir)
    const { id } = s.create(input(), at(9))
    s.appendSegment(id, seg(1, 'inteira'))
    writeFileSync(s.paths(id).transcript, readFileSync(s.paths(id).transcript, 'utf8') + '{"id":2,"tra', { flag: 'w' })
    expect(s.readSegments(id).map((x) => x.text)).toEqual(['inteira'])
  })

  it('update não muda id nem andar', () => {
    const s = open(dir)
    const { id } = s.create(input(), at(9))
    s.update(id, { title: 'Novo', ...({ id: 'x', floor: '../fora' } as object) })
    expect(s.get(id)).toMatchObject({ id, floor: 'p1', title: 'Novo' })
    expect(s.update('2026-01-01-0000-nao-existe', { title: 'x' })).toBeUndefined()
  })
})

describe('MeetingStore: índice corrompido', () => {
  it('cai para o .bak e regrava o arquivo', () => {
    const s = open(dir)
    const { id } = s.create(input(), at(9))
    open(dir) // a good load refreshes meetings.json.bak
    writeFileSync(join(dir, 'meetings.json'), '{"meetings": [')
    const again = open(dir)
    expect(again.get(id)?.title).toBe('Kickoff do checkout')
    expect(index().meetings[0].id).toBe(id)
    expect(readdirSync(dir).some((f) => f.startsWith('meetings.corrupt-'))).toBe(true)
  })

  it('formato errado conta como corrompido e cai para o backup diário', () => {
    const s = open(dir)
    const { id } = s.create(input(), at(9))
    dailyBackup(dir, new Date(2026, 10, 7))
    writeFileSync(join(dir, 'meetings.json'), '{"meetings": {"nao": "lista"}}')
    rmSync(join(dir, 'meetings.json.bak'), { force: true })
    expect(open(dir).get(id)).toBeDefined()
  })

  it('descarta entradas que não podem nomear a pasta', () => {
    const good = { id: '2026-11-07-0900-ok', floor: 'p1', title: 'Ok', status: 'ready', startedAt: 1 }
    writeFileSync(
      join(dir, 'meetings.json'),
      JSON.stringify({
        meetings: [
          good,
          { ...good, id: '../../etc' },
          { ...good, id: '2026-11-07-0900-b', floor: '..' },
          { ...good, id: '2026-11-07-0900-c', status: 'x' },
          good,
        ],
      }),
    )
    expect(
      open(dir)
        .list()
        .map((m) => m.id),
    ).toEqual(['2026-11-07-0900-ok'])
  })
})

describe('MeetingStore: apagar', () => {
  it('remove a pasta inteira e a entrada do índice', () => {
    const s = open(dir)
    const keep = s.create(input({ title: 'Fica' }), at(9))
    const { id } = s.create(input(), at(10))
    s.writeNotes(id, 'x')
    s.appendSegment(id, seg(1, 'oi'))
    s.writeAta(id, [], '')
    writeFileSync(s.audioPath(id, 'outros'), Buffer.alloc(32))
    const folder = s.paths(id).dir
    expect(s.remove(id)).toBe(true)
    expect(existsSync(folder)).toBe(false)
    expect(s.get(id)).toBeUndefined()
    expect(index().meetings.map((m) => m.id)).toEqual([keep.id])
    expect(existsSync(s.paths(keep.id).dir)).toBe(true)
    expect(s.remove(id)).toBe(false)
    expect(() => s.readNotes(id)).toThrow('não existe mais')
  })
})

describe('MeetingStore: recuperação', () => {
  it('gravando ou pausada vira interrupted; as outras ficam', () => {
    const s = open(dir)
    const a = s.create(input({ title: 'A' }), at(9))
    const b = s.create(input({ title: 'B' }), at(10))
    const c = s.create(input({ title: 'C' }), at(11))
    s.update(b.id, { status: 'paused' })
    s.update(c.id, { status: 'ready' })
    s.flush()
    const again = open(dir)
    expect(
      again
        .recoverInterrupted()
        .map((m) => m.id)
        .sort(),
    ).toEqual([a.id, b.id].sort())
    expect(again.get(a.id)?.status).toBe('interrupted')
    expect(again.get(b.id)?.status).toBe('interrupted')
    expect(again.get(c.id)?.status).toBe('ready')
    expect(index().meetings.find((m) => m.id === a.id)?.status).toBe('interrupted')
    expect(again.recoverInterrupted()).toEqual([])
  })
})

describe.skipIf(process.platform === 'win32')('MeetingStore: permissões', () => {
  it('pastas 0700, arquivos 0600', () => {
    const s = open(dir)
    const { id } = s.create(input(), at(9))
    s.writeNotes(id, 'x')
    s.appendSegment(id, seg(1, 'oi'))
    s.writeAta(id, [], '# Ata')
    const audio = s.audioPath(id, 'eu')
    writeFileSync(audio, Buffer.alloc(8), { mode: 0o600 })
    s.flush()
    const p = s.paths(id)
    for (const d of [join(dir, 'meetings'), join(dir, 'meetings', 'p1'), p.dir, p.audio]) expect(mode(d)).toBe(0o700)
    for (const f of [p.notes, p.transcript, p.ataJson, p.ataMd, join(dir, 'meetings.json')]) expect(mode(f)).toBe(0o600)
  })

  it('aperta a pasta que já existia aberta', () => {
    mkdirSync(join(dir, 'meetings', 'p1'), { recursive: true, mode: 0o755 })
    const s = open(dir)
    s.create(input(), at(9))
    expect(mode(join(dir, 'meetings', 'p1'))).toBe(0o700)
  })
})

describe('MeetingStore: caminhos', () => {
  it('recusa andar que sairia da pasta', () => {
    const s = open(dir)
    for (const floor of ['..', '../x', 'a/b', 'a\\b', '', '.', 'x'.repeat(41)])
      expect(() => s.create(input({ floor })), floor).toThrow('Andar inválido')
    expect(s.list()).toEqual([])
    expect(readdirSync(dir).filter((f) => f !== 'meetings.json')).toEqual([])
  })

  it('recusa id malformado em toda operação de arquivo', () => {
    const s = open(dir)
    s.create(input(), at(9))
    for (const id of ['../../etc/passwd', '2026-11-07-0900-../x', '2026-11-07-0900-a/b', '']) {
      expect(() => s.readNotes(id)).toThrow('Reunião inválida')
      expect(() => s.writeNotes(id, 'x')).toThrow('Reunião inválida')
      expect(() => s.audioPath(id, 'eu')).toThrow('Reunião inválida')
    }
  })

  it('recusa faixa desconhecida', () => {
    const s = open(dir)
    const { id } = s.create(input(), at(9))
    expect(() => s.audioPath(id, '../x' as never)).toThrow('Faixa')
  })

  it('padrões de andar e id', () => {
    expect(isFloorName('terreo')).toBe(true)
    expect(isFloorName('p-1a2b3c4d')).toBe(true)
    expect(isFloorName('..')).toBe(false)
    expect(isMeetingId('2026-11-07-1430-kickoff-do-checkout-2')).toBe(true)
    expect(isMeetingId('2026-11-07-1430-')).toBe(false)
    expect(loadMeeting({ id: '2026-11-07-1430-x', floor: 'terreo', title: 't', status: 'ready' })).toMatchObject({
      attendees: [],
      pauses: [],
    })
  })
})

describe('MeetingStore: lock', () => {
  it('depois do lock nada vai para o índice', () => {
    const s = open(dir)
    const { id } = s.create(input(), at(9))
    s.lock()
    s.update(id, { title: 'Depois' })
    s.flush()
    expect(index().meetings[0].title).toBe('Kickoff do checkout')
  })
})
