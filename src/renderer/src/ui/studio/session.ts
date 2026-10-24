import { NODE_DEFS, starterFlow, type Flow, type FlowNode } from '@shared/creative'
import { inputsOf, isFresh, missingInputs, signature, topoOrder, upstreamOrder } from '@shared/flow-graph'
import type { FlowTab } from '@shared/creative-library'
import type { ProjectFloor } from '@shared/types'
import { cleanError } from '../modals'

// One session per flow (tab) of a creative floor, alive while the app runs: closing the window or
// switching tabs does not stop a run.
// The page orders the graph; the main process runs one node at a time and streams its progress.

export interface Running {
  jobId: string
  text: string
  started: number
}

const sessions = new Map<string, StudioSession>()
const byJob = new Map<string, StudioSession>()

const extraProgress = new Map<string, (text: string) => void>()

/** creative:progress from the main process. */
export function studioProgress(jobId: string, text: string): void {
  byJob.get(jobId)?.progress(jobId, text)
  extraProgress.get(jobId)?.(text)
}

/** Progress of work that is not a node (e.g. "ads:<floorId>", the ads capture). Returns the unsubscribe. */
export function onStudioProgress(jobId: string, fn: (text: string) => void): () => void {
  extraProgress.set(jobId, fn)
  return () => {
    if (extraProgress.get(jobId) === fn) extraProgress.delete(jobId)
  }
}

const key = (floorId: string, flowId: string) => `${floorId}/${flowId}`

/** The floor's tabs; a floor with none gets "Fluxo 1" with the starter flow. */
export async function floorTabs(floor: ProjectFloor): Promise<FlowTab[]> {
  const tabs = await window.office.listFlows(floor.id)
  if (tabs.length) return tabs
  return [await window.office.createFlow(floor.id, 'Fluxo 1', starterFlow())]
}

export async function sessionFor(floor: ProjectFloor, tab: FlowTab): Promise<StudioSession> {
  let s = sessions.get(key(floor.id, tab.id))
  if (!s) {
    const flow = (await window.office.loadFlowTab(floor.id, tab.id)) ?? { version: 1 as const, nodes: [], edges: [] }
    s = sessions.get(key(floor.id, tab.id)) ?? new StudioSession(floor, flow, tab.id)
    sessions.set(key(floor.id, tab.id), s)
  }
  s.floor = floor
  return s
}

/** A tab was deleted: its session goes too (after stopping what it ran). */
export function dropSession(floorId: string, flowId: string): void {
  const s = sessions.get(key(floorId, flowId))
  if (!s) return
  s.stop()
  sessions.delete(key(floorId, flowId))
}

/** A flow of the floor is running right now. */
export const isBusy = (floorId: string, flowId: string) => !!sessions.get(key(floorId, flowId))?.busy

const busyListeners = new Set<() => void>()
/** Called when any session starts or ends a run (tabs show a dot). */
export function onBusyChange(fn: () => void): () => void {
  busyListeners.add(fn)
  return () => busyListeners.delete(fn)
}

let seq = 0
export const newId = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`

export class StudioSession {
  readonly running = new Map<string, Running>()
  /** A plan is going: "Executar fluxo" or a node with its upstream. */
  busy = false
  private stopAsked = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<(nodeId?: string) => void>()

  constructor(
    public floor: ProjectFloor,
    public flow: Flow,
    readonly flowId: string,
  ) {}

  /** nodeId = only that node changed (status, output); none = redraw everything. */
  onChange(fn: (nodeId?: string) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  changed(nodeId?: string): void {
    for (const fn of this.listeners) fn(nodeId)
  }

  node(id: string): FlowNode | undefined {
    return this.flow.nodes.find((n) => n.id === id)
  }

  /** Saves a moment after the last change, and right away on close. */
  save(now = false): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    const go = () => {
      this.saveTimer = null
      window.office.saveFlowTab(this.floor.id, this.flowId, this.flow).catch((err) => console.warn('Estúdio: não salvou o fluxo', err))
    }
    if (now) go()
    else this.saveTimer = setTimeout(go, 600)
  }

  progress(jobId: string, text: string): void {
    for (const [nodeId, r] of this.running) {
      if (r.jobId !== jobId) continue
      r.text = text
      this.changed(nodeId)
    }
  }

  /** Runs `ids` in order; `force` ones run even when fresh. Stops at the first failure. */
  private async runPlan(ids: string[], force: Set<string>): Promise<boolean> {
    if (this.busy) return false
    this.busy = true
    this.stopAsked = false
    this.changed()
    for (const fn of busyListeners) fn()
    try {
      for (const id of ids) {
        if (this.stopAsked) return false
        const node = this.node(id)
        if (!node || !NODE_DEFS[node.kind].engine) continue
        if (!force.has(id) && isFresh(this.flow, node)) continue
        if (!(await this.runOne(node))) return false
      }
      return true
    } finally {
      this.busy = false
      this.changed()
      for (const fn of busyListeners) fn()
    }
  }

  private async runOne(node: FlowNode): Promise<boolean> {
    const missing = missingInputs(this.flow, node)
    if (missing.length) {
      node.error = `Falta ligar: ${missing.join(', ')}.`
      this.changed(node.id)
      this.save()
      return false
    }
    const jobId = newId('job')
    const sig = signature(this.flow, node)
    this.running.set(node.id, { jobId, text: 'Começando…', started: Date.now() })
    byJob.set(jobId, this)
    delete node.error
    this.changed(node.id)
    try {
      const r = await window.office.runCreative({ jobId, floorId: this.floor.id, nodeId: node.id, kind: node.kind, params: node.params, inputs: inputsOf(this.flow, node) })
      node.result = { outputs: r.outputs, sig, at: Date.now(), ...(r.note ? { note: r.note } : {}) }
      return true
    } catch (err) {
      node.error = cleanError(err)
      return false
    } finally {
      this.running.delete(node.id)
      byJob.delete(jobId)
      this.save()
      // downstream nodes may have turned stale
      this.changed()
    }
  }

  /** ▶ on a node: what it needs upstream (when stale), then the node itself. */
  runNode(id: string): Promise<boolean> {
    return this.runPlan(upstreamOrder(this.flow, id), new Set([id]))
  }

  /** "Executar fluxo": every stale node, upstream first. */
  runAll(): Promise<boolean> {
    return this.runPlan(topoOrder(this.flow), new Set())
  }

  /** Stops the running node and what was queued after it. */
  stop(): void {
    this.stopAsked = true
    for (const r of this.running.values()) void window.office.cancelCreative(r.jobId)
  }
}
