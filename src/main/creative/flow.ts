import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, sep } from 'node:path'
import { FLOW_ID, FLOW_NAME_MAX, LIBRARY_DIRS, LIBRARY_EXT, LIBRARY_MAX, MAX_FLOWS, type FlowTab, type LibraryItem } from '@shared/creative-library'
import { FORMAT_IDS } from '@shared/social'
import { MEDIA_EXT, NODE_DEFS, type CreativeJob, type Flow, type FlowEdge, type FlowNode, type NodeKind, type PortValue } from '@shared/creative'

// The studio's graphs live in the floor folder (.criativo/fluxos/<id>.json, one per tab), so they travel with the project.
// Everything from the page is cleaned here: kinds and ids from a list, finite numbers, media paths only.

const ID = /^[\w-]{1,48}$/
const MAX_FLOW_BYTES = 4_000_000

export const flowFile = (root: string) => join(root, '.criativo', 'fluxo.json')

export function loadFlow(root: string): Flow | null {
  const file = flowFile(root)
  if (!existsSync(file)) return null
  try {
    return cleanFlow(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    // a broken file is kept aside, never overwritten silently
    renameSync(file, `${file}.quebrado-${Date.now()}`)
    return null
  }
}

export function saveFlow(root: string, raw: unknown): void {
  const flow = cleanFlow(raw)
  const text = JSON.stringify(flow, null, 1)
  if (text.length > MAX_FLOW_BYTES) throw new Error('O fluxo ficou grande demais para salvar. Apague nós ou resultados antigos.')
  const file = flowFile(root)
  mkdirSync(join(root, '.criativo'), { recursive: true })
  writeFileSync(`${file}.tmp`, text)
  renameSync(`${file}.tmp`, file)
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : d)
const isKind = (k: unknown): k is NodeKind => typeof k === 'string' && Object.hasOwn(NODE_DEFS, k)
const mediaPath = (p: unknown): p is string => typeof p === 'string' && p.length < 4096 && isAbsolute(p) && MEDIA_EXT.test(p)

function cleanParams(kind: NodeKind, raw: unknown): Record<string, unknown> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const d of NODE_DEFS[kind].params) {
    const v = r[d.key]
    if (d.type === 'text') out[d.key] = typeof v === 'string' ? v.slice(0, 20000) : ''
    else if (d.type === 'number') out[d.key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, Math.round(v))) : d.min
    else if (d.type === 'select') out[d.key] = d.options.some(([k]) => k === v) ? v : d.options[0][0]
    else if (d.type === 'formats') out[d.key] = Array.isArray(v) ? [...new Set(v.filter((x): x is string => FORMAT_IDS.includes(x as string)))] : []
    else if (d.type === 'voice') out[d.key] = typeof v === 'string' && /^[A-Za-z0-9]{0,40}$/.test(v) ? v : ''
    else if (d.type === 'file') out[d.key] = d.multi ? (Array.isArray(v) ? v.filter(mediaPath).slice(0, 20) : []) : mediaPath(v) ? v : ''
  }
  return out
}

export function cleanValue(raw: unknown): PortValue | null {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (v.type === 'video' && mediaPath(v.path)) return { type: 'video', path: v.path }
  if (v.type === 'image' && Array.isArray(v.paths)) return { type: 'image', paths: v.paths.filter(mediaPath).slice(0, 20) }
  if (v.type === 'audio' && mediaPath(v.path)) return { type: 'audio', path: v.path }
  if (v.type === 'text' && typeof v.text === 'string') return { type: 'text', text: v.text.slice(0, 100_000) }
  if (v.type === 'post' && v.post && typeof v.post === 'object') {
    const p = v.post as Record<string, unknown>
    const s = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '')
    return {
      type: 'post',
      post: {
        titulo: s(p.titulo, 80),
        legenda: s(p.legenda, 2200),
        hashtags: Array.isArray(p.hashtags) ? p.hashtags.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 60)).slice(0, 30) : [],
        alt: s(p.alt, 200),
        formato: p.formato === 'carrossel' || p.formato === 'story' ? p.formato : 'feed',
      },
    }
  }
  return null
}

function cleanNode(raw: unknown): FlowNode | null {
  const n = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (typeof n.id !== 'string' || !ID.test(n.id) || !isKind(n.kind)) return null
  const node: FlowNode = { id: n.id, kind: n.kind, x: num(n.x), y: num(n.y), params: cleanParams(n.kind, n.params) }
  const res = n.result as Record<string, unknown> | undefined
  if (res && typeof res === 'object' && res.outputs && typeof res.outputs === 'object') {
    const outputs: Record<string, PortValue> = {}
    for (const port of NODE_DEFS[n.kind].outputs) {
      const v = cleanValue((res.outputs as Record<string, unknown>)[port.key])
      if (v) outputs[port.key] = v
    }
    node.result = { outputs, sig: typeof res.sig === 'string' ? res.sig.slice(0, 200) : '', at: num(res.at), ...(typeof res.note === 'string' ? { note: res.note.slice(0, 300) } : {}) }
  }
  if (typeof n.error === 'string') node.error = n.error.slice(0, 1000)
  return node
}

export function cleanFlow(raw: unknown): Flow {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const nodes: FlowNode[] = []
  for (const r of Array.isArray(f.nodes) ? f.nodes.slice(0, 200) : []) {
    const n = cleanNode(r)
    if (n && !nodes.some((o) => o.id === n.id)) nodes.push(n)
  }
  const edges: FlowEdge[] = []
  for (const r of Array.isArray(f.edges) ? f.edges.slice(0, 600) : []) {
    const e = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const from = nodes.find((n) => n.id === e.from)
    const to = nodes.find((n) => n.id === e.to)
    if (typeof e.id !== 'string' || !ID.test(e.id) || !from || !to || from === to) continue
    if (!NODE_DEFS[from.kind].outputs.some((p) => p.key === e.fromPort) || !NODE_DEFS[to.kind].inputs.some((p) => p.key === e.toPort)) continue
    edges.push({ id: e.id, from: from.id, fromPort: String(e.fromPort), to: to.id, toPort: String(e.toPort) })
  }
  const v = f.view as Record<string, unknown> | undefined
  return { version: 1, nodes, edges, view: v && typeof v === 'object' ? { x: num(v.x), y: num(v.y), zoom: Math.min(2, Math.max(0.25, num(v.zoom, 1))) } : undefined }
}

export function cleanJob(raw: unknown, floorIds: string[]): CreativeJob {
  const j = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (typeof j.jobId !== 'string' || !ID.test(j.jobId) || typeof j.nodeId !== 'string' || !ID.test(j.nodeId)) throw new Error('Pedido inválido.')
  if (typeof j.floorId !== 'string' || !floorIds.includes(j.floorId)) throw new Error('Esse andar criativo não existe mais.')
  if (!isKind(j.kind) || !NODE_DEFS[j.kind].engine) throw new Error('Esse nó não roda: é uma entrada.')
  const inputs: Record<string, PortValue[]> = {}
  const raws = (j.inputs && typeof j.inputs === 'object' ? j.inputs : {}) as Record<string, unknown>
  for (const port of NODE_DEFS[j.kind].inputs) {
    const list = Array.isArray(raws[port.key]) ? (raws[port.key] as unknown[]) : []
    inputs[port.key] = list.slice(0, 20).map(cleanValue).filter((v): v is PortValue => !!v)
  }
  return { jobId: j.jobId, floorId: j.floorId, nodeId: j.nodeId, kind: j.kind, params: cleanParams(j.kind, j.params), inputs }
}

// ---------- tabs: several flows per floor ----------

const flowsDir = (root: string) => join(root, '.criativo', 'fluxos')
const indexFile = (root: string) => join(flowsDir(root), 'index.json')
const tabFile = (root: string, id: string) => join(flowsDir(root), `${id}.json`)

function atomicWrite(file: string, text: string): void {
  writeFileSync(`${file}.tmp`, text)
  renameSync(`${file}.tmp`, file)
}

const cleanName = (raw: unknown, fallback: string) => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, FLOW_NAME_MAX) : '') || fallback
const flowId = (raw: unknown): string => {
  if (typeof raw !== 'string' || !FLOW_ID.test(raw)) throw new Error('Esse fluxo não existe mais.')
  return raw
}
const newFlowId = () => `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function readIndex(root: string): FlowTab[] {
  try {
    const raw = JSON.parse(readFileSync(indexFile(root), 'utf8')) as { flows?: unknown }
    const out: FlowTab[] = []
    for (const t of Array.isArray(raw.flows) ? raw.flows : []) {
      const r = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
      if (typeof r.id === 'string' && FLOW_ID.test(r.id) && !out.some((o) => o.id === r.id) && existsSync(tabFile(root, r.id))) out.push({ id: r.id, name: cleanName(r.name, `Fluxo ${out.length + 1}`) })
      if (out.length === MAX_FLOWS) break
    }
    return out
  } catch {
    return []
  }
}

function writeIndex(root: string, flows: FlowTab[]): void {
  mkdirSync(flowsDir(root), { recursive: true })
  atomicWrite(indexFile(root), JSON.stringify({ version: 1, flows }, null, 1))
}

function writeTab(root: string, id: string, raw: unknown): void {
  const text = JSON.stringify(cleanFlow(raw), null, 1)
  if (text.length > MAX_FLOW_BYTES) throw new Error('O fluxo ficou grande demais para salvar. Apague nós ou resultados antigos.')
  mkdirSync(flowsDir(root), { recursive: true })
  atomicWrite(tabFile(root, id), text)
}

/**
 * The floor's tabs, in order. The first time, the old single flow (.criativo/fluxo.json) becomes
 * "Fluxo 1" and is kept as fluxo.json.migrado. No flow at all: one empty list, the page starts one.
 */
export function listFlows(root: string): FlowTab[] {
  const tabs = readIndex(root)
  if (tabs.length) return tabs
  const old = flowFile(root)
  if (existsSync(old)) {
    const flow = loadFlow(root)
    if (flow) {
      const tab = { id: newFlowId(), name: 'Fluxo 1' }
      writeTab(root, tab.id, flow)
      writeIndex(root, [tab])
      renameSync(old, `${old}.migrado`)
      return [tab]
    }
  }
  return []
}

export function loadFlowTab(root: string, raw: unknown): Flow | null {
  const file = tabFile(root, flowId(raw))
  if (!existsSync(file)) return null
  try {
    return cleanFlow(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    renameSync(file, `${file}.quebrado-${Date.now()}`)
    return null
  }
}

export function saveFlowTab(root: string, raw: unknown, flow: unknown): void {
  const id = flowId(raw)
  if (!readIndex(root).some((t) => t.id === id)) throw new Error('Esse fluxo foi apagado.')
  writeTab(root, id, flow)
}

/** A new tab at the end (after `after` when given); returns it. */
export function createFlow(root: string, name: unknown, flow: unknown, after?: unknown): FlowTab {
  const tabs = listFlows(root)
  if (tabs.length >= MAX_FLOWS) throw new Error(`Um andar tem no máximo ${MAX_FLOWS} fluxos. Apague um antes.`)
  const tab = { id: newFlowId(), name: cleanName(name, `Fluxo ${tabs.length + 1}`) }
  writeTab(root, tab.id, flow ?? { version: 1, nodes: [], edges: [] })
  const at = typeof after === 'string' ? tabs.findIndex((t) => t.id === after) : -1
  writeIndex(root, at >= 0 ? [...tabs.slice(0, at + 1), tab, ...tabs.slice(at + 1)] : [...tabs, tab])
  return tab
}

export function renameFlow(root: string, raw: unknown, name: unknown): FlowTab[] {
  const id = flowId(raw)
  const tabs = listFlows(root).map((t) => (t.id === id ? { ...t, name: cleanName(name, t.name) } : t))
  writeIndex(root, tabs)
  return tabs
}

/** The file goes to .criativo/fluxos/lixeira, never straight to nothing. */
export function deleteFlow(root: string, raw: unknown): FlowTab[] {
  const id = flowId(raw)
  const tabs = listFlows(root)
  if (!tabs.some((t) => t.id === id)) return tabs
  const bin = join(flowsDir(root), 'lixeira')
  mkdirSync(bin, { recursive: true })
  if (existsSync(tabFile(root, id))) renameSync(tabFile(root, id), join(bin, `${id}-${Date.now()}.json`))
  const left = tabs.filter((t) => t.id !== id)
  writeIndex(root, left)
  return left
}

export function reorderFlows(root: string, order: unknown): FlowTab[] {
  const tabs = listFlows(root)
  const ids = Array.isArray(order) ? order.filter((x): x is string => typeof x === 'string') : []
  const sorted = [...ids.map((id) => tabs.find((t) => t.id === id)).filter((t): t is FlowTab => !!t), ...tabs.filter((t) => !ids.includes(t.id))]
  writeIndex(root, sorted)
  return sorted
}

// ---------- gallery: what the floor generated ----------

/** `p` resolved, if it is inside `root` (symlinks followed). */
export function insideRoot(root: string, p: unknown): string | null {
  if (typeof p !== 'string' || !isAbsolute(p) || p.length > 4096) return null
  try {
    const real = realpathSync(p)
    const base = realpathSync(root)
    return real.startsWith(base + sep) ? real : null
  } catch {
    return null
  }
}

/** Files of the gallery folders, newest first, at most LIBRARY_MAX. Carousels: one folder deeper. */
export function listLibrary(root: string): LibraryItem[] {
  const out: LibraryItem[] = []
  const add = (kind: LibraryItem['kind'], dir: string, depth: number) => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const path = join(dir, name)
      const real = insideRoot(root, path)
      if (!real) continue
      let st
      try {
        st = statSync(real)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (depth > 0) add(kind, path, depth - 1)
        continue
      }
      if (!st.isFile() || !LIBRARY_EXT.test(name)) continue
      if (kind === 'analise' ? extname(name).toLowerCase() !== '.md' : extname(name).toLowerCase() === '.md') continue
      out.push({ kind, path, name, size: st.size, mtime: st.mtimeMs })
    }
  }
  // carousels sit one folder deeper; exports two (exportar/<peça>/post-NN/)
  for (const [kind, rel] of LIBRARY_DIRS) add(kind, join(root, rel), kind === 'carrossel' ? 1 : kind === 'exportado' ? 2 : 0)
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, LIBRARY_MAX)
}

/** An analysis (.md) of the floor, up to 2 MB. */
export function readLibraryText(root: string, p: unknown): string {
  const real = insideRoot(root, p)
  if (!real || extname(real).toLowerCase() !== '.md') throw new Error('Esse arquivo não é uma análise deste andar.')
  if (statSync(real).size > 2_000_000) throw new Error('A análise é grande demais para abrir aqui. Abra pelo Finder.')
  return readFileSync(real, 'utf8')
}

