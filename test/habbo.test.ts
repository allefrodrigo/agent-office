import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync, deflateSync } from 'node:zlib'
import { habboFurni, habboLibrary, prefetchHabbo, zipEntry } from '../src/main/habbo'
import { unpackNitro } from '../src/renderer/src/pixel/nitro'
import { colorsOfHabbo, figureOf, randomHabbo, switchGender } from '../src/renderer/src/pixel/habbo-catalog'
import { cleanLook } from '../src/main/templates'
import { cleanHabboLook } from '../src/shared/habbo-look'
import type { HabboLook } from '../src/shared/types'

/** A .nitro bundle: u16 count, then per file u16 name length, name, u32 size, zlib data. */
function nitro(files: Record<string, string>): Uint8Array {
  const parts: Buffer[] = []
  const count = Buffer.alloc(2)
  count.writeUInt16BE(Object.keys(files).length)
  parts.push(count)
  for (const [name, body] of Object.entries(files)) {
    const n = Buffer.from(name)
    const data = deflateSync(Buffer.from(body))
    const head = Buffer.alloc(2 + n.length + 4)
    head.writeUInt16BE(n.length, 0)
    n.copy(head, 2)
    head.writeUInt32BE(data.length, 2 + n.length)
    parts.push(head, data)
  }
  return new Uint8Array(Buffer.concat(parts))
}

test('unpackNitro: every file, inflated, by name', async () => {
  const files = await unpackNitro(nitro({ 'hh_human_leg.json': '{"assets":{}}', 'hh_human_leg.png': 'PNG' }))
  assert.deepEqual([...files.keys()], ['hh_human_leg.json', 'hh_human_leg.png'])
  assert.equal(new TextDecoder().decode(files.get('hh_human_leg.json')), '{"assets":{}}')
})

test('unpackNitro: a truncated bundle is an error, not garbage', async () => {
  const whole = nitro({ 'a.json': 'x'.repeat(200) })
  await assert.rejects(unpackNitro(whole.subarray(0, whole.length - 5)), /truncado/)
})

let dir = ''
afterEach(() => {
  vi.unstubAllGlobals()
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

test('habboLibrary: refuses names that are not library names', async () => {
  dir = mkdtempSync(join(tmpdir(), 'habbo-'))
  for (const bad of ['../etc/passwd', 'a/b', '', 'x'.repeat(65), 42]) await assert.rejects(habboLibrary(dir, bad), /inválido/)
})

test('habboLibrary: downloads the newest revision from the CDN once, then reads the cache', async () => {
  dir = mkdtempSync(join(tmpdir(), 'habbo-'))
  const bundle = nitro({ 'hh_human_leg.json': '{}' })
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    if (url.endsWith('/clothing/hh_human_leg'))
      return Response.json({
        data: {
          revisions: [
            { revision: '100', nitro: 'https://cdn.habboassets.com/old.nitro' },
            { revision: '25379', nitro: 'https://cdn.habboassets.com/derived/clothing/hh_human_leg/25379/hh_human_leg.nitro' },
          ],
        },
      })
    return new Response(bundle)
  })
  const first = await habboLibrary(dir, 'hh_human_leg')
  assert.deepEqual(first, bundle)
  assert.deepEqual(calls, [
    'https://www.habboassets.com/api/v2/swfs/libraries/clothing/hh_human_leg',
    'https://cdn.habboassets.com/derived/clothing/hh_human_leg/25379/hh_human_leg.nitro',
  ])
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'hh_human_leg.nitro'))), bundle)
  await habboLibrary(dir, 'hh_human_leg')
  assert.equal(calls.length, 2)
})

test('habboLibrary: a bundle URL off the HabboAssets CDN is refused', async () => {
  dir = mkdtempSync(join(tmpdir(), 'habbo-'))
  vi.stubGlobal('fetch', async () => Response.json({ data: { revisions: [{ revision: '1', nitro: 'https://evil.example/x.nitro' }] } }))
  await assert.rejects(habboLibrary(dir, 'hh_human_leg'), /não tem o pacote/)
})

test('habboLibrary: a 429 waits for Retry-After and tries again', async () => {
  dir = mkdtempSync(join(tmpdir(), 'habbo-'))
  const bundle = nitro({ 'x.json': '{}' })
  let calls = 0
  vi.stubGlobal('fetch', async (url: string) => {
    calls++
    if (calls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } })
    if (url.includes('/api/'))
      return Response.json({ data: { revisions: [{ revision: '1', nitro: 'https://cdn.habboassets.com/x.nitro' }] } })
    return new Response(bundle)
  })
  assert.deepEqual(await habboLibrary(dir, 'hh_human_hats'), bundle)
  assert.equal(calls, 3)
})

/** A zip of local headers only (what zipEntry reads): each file stored (0) or deflated (8). */
function zip(files: [name: string, body: Uint8Array, method: 0 | 8][]): Uint8Array {
  const parts: Buffer[] = []
  for (const [name, body, method] of files) {
    const data = method === 8 ? deflateRawSync(body) : Buffer.from(body)
    const n = Buffer.from(name)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(method, 8)
    head.writeUInt32LE(data.length, 18)
    head.writeUInt32LE(body.length, 22)
    head.writeUInt16LE(n.length, 26)
    parts.push(head, n, data)
  }
  return new Uint8Array(Buffer.concat(parts))
}

test('zipEntry: finds a stored or a deflated file by name; null when missing', () => {
  const a = new TextEncoder().encode('monitor')
  const b = new TextEncoder().encode('teclado e mouse')
  const z = zip([
    ['icons/x.png', a, 0],
    ['a.nitro', a, 0],
    ['b.nitro', b, 8],
  ])
  assert.deepEqual(zipEntry(z, 'a.nitro'), a)
  assert.deepEqual(zipEntry(z, 'b.nitro'), b)
  assert.equal(zipEntry(z, 'c.nitro'), null)
})

test('habboFurni: takes the .nitro out of the HabboAssets zip once, then reads the cache; refuses bad names', async () => {
  dir = mkdtempSync(join(tmpdir(), 'habbo-'))
  const bundle = nitro({ 'computer_flatscreen.json': '{}' })
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    return new Response(zip([['computer_flatscreen.nitro', bundle, 0]]))
  })
  assert.deepEqual(await habboFurni(dir, 'computer_flatscreen'), bundle)
  assert.deepEqual(calls, ['https://www.habboassets.com/api/v2/furniture/zip?classnames=computer_flatscreen&format=nitro'])
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'furni', 'computer_flatscreen.nitro'))), bundle)
  await habboFurni(dir, 'computer_flatscreen')
  assert.equal(calls.length, 1)
  await assert.rejects(habboFurni(dir, '../x'), /inválido/)
})

test('prefetchHabbo: skips what is cached and what is not a library name; refuses a bad list', async () => {
  dir = mkdtempSync(join(tmpdir(), 'habbo-'))
  writeFileSync(join(dir, 'hh_human_body.nitro'), Buffer.from([1]))
  vi.stubGlobal('fetch', async () => {
    throw new Error('no network expected')
  })
  assert.equal(await prefetchHabbo(dir, ['hh_human_body', '../evil', 7, 'hh_human_body']), 0)
  await assert.rejects(prefetchHabbo(dir, 'hh_human_body'), /inválida/)
  await assert.rejects(prefetchHabbo(dir, Array(1001).fill('a')), /inválida/)
})

test('habboLibrary: a cached bundle needs no network', async () => {
  dir = mkdtempSync(join(tmpdir(), 'habbo-'))
  writeFileSync(join(dir, 'hh_human_body.nitro'), Buffer.from([1, 2, 3]))
  vi.stubGlobal('fetch', async () => {
    throw new Error('offline')
  })
  assert.deepEqual(await habboLibrary(dir, 'hh_human_body'), new Uint8Array([1, 2, 3]))
})

const habboLook = {
  gender: 'F',
  parts: {
    hd: { set: 600, colors: [1] },
    hr: { set: 3020, colors: [45] },
    ha: { set: 1010, colors: [62] },
    lg: { set: 716, colors: [82, 110] },
  },
}

test('cleanHabboLook: keeps a well-formed look, refuses anything off', () => {
  assert.deepEqual(cleanHabboLook(habboLook), habboLook)
  for (const bad of [
    null,
    [],
    { ...habboLook, gender: 'X' },
    { ...habboLook, extra: 1 },
    { gender: 'M', parts: { zz: { set: 1, colors: [] } } },
    { gender: 'M', parts: { hr: { set: 1.5, colors: [] } } },
    { gender: 'M', parts: { hr: { set: 1, colors: [1, 2, 3] } } },
    { gender: 'M', parts: { hr: { set: 1, colors: ['#fff'] } } },
    { gender: 'M', parts: { hr: { set: 1, colors: [], x: 1 } } },
    { gender: 'M', parts: { hr: { set: 100_000, colors: [] } } },
  ])
    assert.equal(cleanHabboLook(bad), undefined, JSON.stringify(bad))
})

test('cleanLook: a template look carries its Habbo figure, and a bad one is refused whole', () => {
  const base = { skin: '#f1c9a5', hair: '#2b1d14', hairStyle: 1, shirt: '#4a8fe0', pants: '#2f3542', shoes: '#222222' }
  assert.deepEqual(cleanLook({ ...base, habbo: habboLook }), { ...base, habbo: habboLook })
  assert.deepEqual(cleanLook(base), base)
  assert.equal(cleanLook({ ...base, habbo: { gender: 'M', parts: { hr: { set: -1, colors: [] } } } }), undefined)
})

test('figureOf: a hair with a full version (hrb) never draws its short twin (hr); a hat hides the full one', () => {
  const fig = figureOf(habboLook as HabboLook)
  const types = fig.parts.map((p) => p.type)
  assert.ok(types.includes('ha') && !types.includes('hrb'), types.join())
  // both pieces of 3020 have a full version: under the hat no hair is left
  assert.deepEqual(
    fig.parts.filter((p) => p.type.startsWith('hr')),
    [],
  )
  const bare = figureOf({ ...habboLook, parts: { ...habboLook.parts, ha: undefined } } as unknown as HabboLook)
  assert.deepEqual(
    bare.parts.filter((p) => p.type.startsWith('hr')).map((p) => `${p.type}${p.id}`),
    ['hrb2031', 'hrb2032'],
  )
  assert.ok(fig.parts.every((p) => p.lib))
  // the two-color pants: each piece in its own color
  const legs = fig.parts.filter((p) => p.type === 'lg').map((p) => p.color)
  assert.equal(new Set(legs).size, 2)
})

test('switchGender: unisex pieces stay, the basics become the new gender, the rest comes off', () => {
  const m = switchGender(habboLook as HabboLook, 'M')
  assert.equal(m.gender, 'M')
  assert.equal(m.parts.hd?.set, 180)
  assert.deepEqual(m.parts.hd?.colors, [1])
  assert.equal(m.parts.hr?.set, 3020) // unisex hair
  assert.equal(m.parts.ha?.set, 1010) // unisex hat
  assert.equal(m.parts.lg?.set, 270)
  assert.ok(m.parts.ch, 'a shirt is mandatory')
})

test('randomHabbo and the 3D colors: always dressed, colors from the palettes', () => {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let i = 0; i < 50; i++) {
    const r = randomHabbo(i % 2 ? 'M' : 'F', rand)
    for (const slot of ['hd', 'ch', 'lg'] as const) assert.ok(r.parts[slot], slot)
    assert.deepEqual(cleanHabboLook(r), r)
  }
  const look = colorsOfHabbo(habboLook as HabboLook, {
    skin: '#000000',
    hair: '#000000',
    hairStyle: 0,
    shirt: '#000000',
    pants: '#000000',
    shoes: '#000000',
  })
  assert.match(look.skin, /^#[0-9a-f]{6}$/)
  assert.notEqual(look.hair, '#000000')
  assert.equal(look.shirt, '#000000') // no shirt picked: the old color stays
  assert.equal(look.habbo, habboLook)
})
