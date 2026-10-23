import { NODE_DEFS, type Flow, type FlowNode, type PortValue } from './creative'

// Pure graph logic of the studio (no DOM, no IPC): what feeds each input, the run order,
// and whether a node's last result still matches what it would run on now.

/** Value on an output port right now: input nodes from their params, the rest from their last result. */
export function outputOf(node: FlowNode, port: string): PortValue | null {
  const p = node.params
  if (node.kind === 'video') return typeof p.path === 'string' && p.path ? { type: 'video', path: p.path } : null
  if (node.kind === 'image') return Array.isArray(p.paths) && p.paths.length ? { type: 'image', paths: p.paths as string[] } : null
  if (node.kind === 'text') return typeof p.text === 'string' && p.text.trim() ? { type: 'text', text: p.text } : null
  return node.result?.outputs[port] ?? null
}

/** Values on each input port of `node`, from the wires into it (in wire order). */
export function inputsOf(flow: Flow, node: FlowNode): Record<string, PortValue[]> {
  const out: Record<string, PortValue[]> = {}
  for (const port of NODE_DEFS[node.kind].inputs) {
    out[port.key] = flow.edges
      .filter((e) => e.to === node.id && e.toPort === port.key)
      .map((e) => {
        const from = flow.nodes.find((n) => n.id === e.from)
        return from ? outputOf(from, e.fromPort) : null
      })
      .filter((v): v is PortValue => !!v)
  }
  return out
}

/** Short stable hash (djb2) of a string. */
export function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** What the node would run on now: its kind, params and inputs. */
export function signature(flow: Flow, node: FlowNode): string {
  return hash(JSON.stringify([node.kind, node.params, inputsOf(flow, node)]))
}

/** Its last result matches its params and inputs (input nodes are always fresh). */
export function isFresh(flow: Flow, node: FlowNode): boolean {
  if (!NODE_DEFS[node.kind].engine) return true
  return !!node.result && node.result.sig === signature(flow, node)
}

/** Ids of `id` and everything upstream of it, upstream first (topological). */
export function upstreamOrder(flow: Flow, id: string): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  const visit = (n: string, path: Set<string>) => {
    if (seen.has(n) || path.has(n)) return
    path.add(n)
    for (const e of flow.edges) if (e.to === n) visit(e.from, path)
    path.delete(n)
    seen.add(n)
    order.push(n)
  }
  visit(id, new Set())
  return order
}

/** Every node, upstream first. */
export function topoOrder(flow: Flow): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const n of flow.nodes)
    for (const id of upstreamOrder(flow, n.id)) {
      if (seen.has(id)) continue
      seen.add(id)
      order.push(id)
    }
  return order
}

/** A wire from→to would close a loop. */
export function makesCycle(flow: Flow, from: string, to: string): boolean {
  return from === to || upstreamOrder(flow, from).includes(to)
}

/** Required inputs with nothing on them, as port labels. */
export function missingInputs(flow: Flow, node: FlowNode): string[] {
  const ins = inputsOf(flow, node)
  return NODE_DEFS[node.kind].inputs.filter((p) => !p.optional && !ins[p.key]?.length).map((p) => p.label)
}
