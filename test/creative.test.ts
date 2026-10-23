import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { accepts, starterFlow, type Flow } from '@shared/creative'
import { inputsOf, isFresh, makesCycle, missingInputs, signature, topoOrder, upstreamOrder } from '@shared/flow-graph'
import { cleanFlow, cleanJob, loadFlow, saveFlow } from '../src/main/creative/flow'
import { cleanProjects } from '../src/main/validate'

const dir = mkdtempSync(join(tmpdir(), 'ao-creative-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const flowWith = (patch: (f: Flow) => void): Flow => {
  const f = starterFlow()
  patch(f)
  return f
}

describe('flow graph', () => {
  it('runs upstream first', () => {
    const f = starterFlow()
    const order = topoOrder(f)
    expect(order.indexOf('n-video')).toBeLessThan(order.indexOf('n-analyze'))
    expect(order.indexOf('n-analyze')).toBeLessThan(order.indexOf('n-image'))
    expect(order.indexOf('n-image')).toBeLessThan(order.indexOf('n-post'))
    expect(order.at(-1)).toBe('n-pauta')
    expect(upstreamOrder(f, 'n-image')).toEqual(['n-video', 'n-brief', 'n-analyze', 'n-image'])
  })

  it('refuses wires that close a loop', () => {
    const f = starterFlow()
    expect(makesCycle(f, 'n-post', 'n-analyze')).toBe(true)
    expect(makesCycle(f, 'n-analyze', 'n-post')).toBe(false)
    expect(makesCycle(f, 'n-image', 'n-image')).toBe(true)
  })

  it('feeds inputs from params and results, and goes stale when they change', () => {
    const f = flowWith((x) => (x.nodes[0].params.path = '/v/a.mp4'))
    const analyze = f.nodes.find((n) => n.id === 'n-analyze')!
    expect(inputsOf(f, analyze).video).toEqual([{ type: 'video', path: '/v/a.mp4' }])
    // the empty brief sends nothing
    expect(inputsOf(f, analyze).context).toEqual([])
    expect(isFresh(f, analyze)).toBe(false)
    analyze.result = { outputs: { text: { type: 'text', text: 'ok' } }, sig: signature(f, analyze), at: 1 }
    expect(isFresh(f, analyze)).toBe(true)
    f.nodes[0].params.path = '/v/b.mp4'
    expect(isFresh(f, analyze)).toBe(false)
  })

  it('lists required inputs with nothing on them', () => {
    const f = starterFlow()
    const pauta = f.nodes.find((n) => n.id === 'n-pauta')!
    expect(missingInputs(f, pauta)).toEqual(['imagens', 'post'])
  })

  it('a post feeds text inputs, not the other way round', () => {
    expect(accepts('text', 'post')).toBe(true)
    expect(accepts('post', 'text')).toBe(false)
    expect(accepts('image', 'video')).toBe(false)
  })
})

describe('flow file', () => {
  it('drops unknown kinds, bad wires and non-media paths', () => {
    const f = cleanFlow({
      nodes: [
        { id: 'a', kind: 'video', x: 1, y: 2, params: { path: '/etc/passwd' } },
        { id: 'b', kind: 'analyze-video', x: 0, y: 0, params: { frames: 999 } },
        { id: 'c', kind: 'rm-rf', x: 0, y: 0, params: {} },
        { id: 'a', kind: 'text', x: 0, y: 0, params: {} },
      ],
      edges: [
        { id: 'e1', from: 'a', fromPort: 'video', to: 'b', toPort: 'video' },
        { id: 'e2', from: 'a', fromPort: 'nope', to: 'b', toPort: 'video' },
        { id: 'e3', from: 'c', fromPort: 'x', to: 'b', toPort: 'video' },
      ],
    })
    expect(f.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(f.nodes[0].params.path).toBe('')
    expect(f.nodes[1].params.frames).toBe(30)
    expect(f.edges.map((e) => e.id)).toEqual(['e1'])
  })

  it('saves and loads the floor flow', () => {
    saveFlow(dir, starterFlow())
    expect(loadFlow(dir)?.nodes.length).toBe(6)
  })

  it('a job names a creative floor and a node that runs', () => {
    const job = { jobId: 'j1', floorId: 'p-1', nodeId: 'n', kind: 'generate-image', params: { aspect: '9:16', count: 9 }, inputs: { prompt: [{ type: 'text', text: 'x' }], refs: [{ type: 'image', paths: ['/a.txt', '/b.png'] }] } }
    const clean = cleanJob(job, ['p-1'])
    expect(clean.params).toEqual({ aspect: '9:16', count: 4, style: '' })
    expect(clean.inputs.refs).toEqual([{ type: 'image', paths: ['/b.png'] }])
    expect(() => cleanJob(job, ['p-2'])).toThrow(/não existe/)
    expect(() => cleanJob({ ...job, kind: 'text' }, ['p-1'])).toThrow(/entrada/)
  })
})

describe('creative floors', () => {
  it('keep their kind through the settings', () => {
    const [p] = cleanProjects([{ id: 'p-1', name: 'Estúdio', cwd: dir, kind: 'creative' }], [])
    expect(p.kind).toBe('creative')
    const [q] = cleanProjects([{ id: 'p-1', name: 'X', cwd: dir, kind: 'evil' }], [])
    expect(q.kind).toBeUndefined()
  })
})

describe('flow templates', () => {
  it('build clean flows with their wires', async () => {
    const { FLOW_TEMPLATES } = await import('@shared/creative')
    for (const t of FLOW_TEMPLATES) {
      const f = t.build()
      expect(cleanFlow(f).edges.length).toBe(f.edges.length)
    }
    const only = FLOW_TEMPLATES.find((t) => t.id === 'image')!.build()
    expect(topoOrder(only).at(-1)).toBe('n-image')
  })
})

describe('the roof', () => {
  it('creative floors go to the top of the elevator', () => {
    const other = mkdtempSync(join(tmpdir(), 'ao-proj-'))
    const out = cleanProjects([{ id: 'c', name: 'Estúdio', cwd: dir, kind: 'creative' }, { id: 'p', name: 'Projeto', cwd: other }], [])
    expect(out.map((p) => p.id)).toEqual(['p', 'c'])
    rmSync(other, { recursive: true, force: true })
  })
})
