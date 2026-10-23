import './studio.css'
import { accepts, creativeReady, defaultParams, engineLabel, mediaUrl, NODE_DEFS, type ElevenVoice, type Flow, type FlowEdge, type FlowNode, type NodeDef, type NodeKind, type ParamDef, type PortDef, type PortValue, FLOW_TEMPLATES } from '@shared/creative'
import type { FlowTab } from '@shared/creative-library'
import { isFresh, makesCycle, outputOf, topoOrder, upstreamOrder } from '@shared/flow-graph'
import type { ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { modalA11y } from '../a11y'
import { h, icon } from '../dom'
import { renderMarkdown } from '../markdown'
import { cleanError, confirmDialog, modal } from '../modals'
import { integrationsView, readStatus } from './integrations'
import { galleryPanel } from './gallery'
import { dropSession, floorTabs, isBusy, newId, onBusyChange, sessionFor, type StudioSession } from './session'
import { tabBar } from './tabs'
import { usageStrip } from './usage'

// Estúdio criativo: a node canvas (like ComfyUI) over the creative floor. Inputs (video, images,
// text) feed agents (video analysis, post writing) and ChatGPT image generation; the results land
// in the floor folder. Pan by dragging the background or scrolling, zoom with pinch or ⌘/Ctrl+wheel.

type Toast = (t: string, k?: 'info' | 'ok' | 'err') => void

const GROUPS: NodeDef['group'][] = ['Entradas', 'Agentes', 'Gerar']
const KIND_ICON: Partial<Record<NodeKind, string>> = {
  video: 'eye',
  image: 'image',
  text: 'edit',
  'analyze-video': 'search',
  'generate-image': 'spark',
  'edit-image': 'edit',
  overlay: 'file',
  carousel: 'copy',
  narrate: 'volume',
  'write-post': 'message',
}
const kindIcon = (k: NodeKind) => KIND_ICON[k] ?? 'spark'
/** Nodes that spend Codex (images), whatever else the plan does. */
const CODEX_KINDS = new Set<NodeKind>(['generate-image', 'edit-image', 'carousel'])
const LAST_TAB = (floorId: string) => `agent-office:studio-tab:${floorId}`

// ElevenLabs voices, read once per app run (a failed read is tried again next time).
let voices: Promise<ElevenVoice[]> | null = null
const loadVoices = () => {
  voices ??= window.office.elevenVoices().catch((err) => {
    voices = null
    throw err
  })
  return voices
}
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

let openFloor: string | null = null

export function studioOpen(): boolean {
  return openFloor !== null
}

/** Opens the studio of a creative floor (full screen, over the office). */
export async function openStudio(root: HTMLElement, state: State, floor: ProjectFloor, opts: { toast: Toast; openAgent(id: string): void }): Promise<void> {
  if (openFloor) return
  openFloor = floor.id
  let s: StudioSession
  let tabs: FlowTab[]
  try {
    tabs = await floorTabs(floor)
    const last = localStorage.getItem(LAST_TAB(floor.id))
    s = await sessionFor(floor, tabs.find((t) => t.id === last) ?? tabs[0])
  } catch (err) {
    openFloor = null
    return opts.toast(cleanError(err), 'err')
  }
  const flow = () => s.flow
  const view = { x: 0, y: 0, zoom: 1, ...flow().view }
  let selected: { kind: 'node' | 'edge'; id: string } | null = null
  const nodeEls = new Map<string, HTMLElement>()

  // ---------- frame ----------
  const title = h('div', { class: 'st-title' }, icon('spark', 18), h('span', {}, 'Estúdio criativo'), h('span', { class: 'st-floor' }, floor.name))
  const runAllBtn = h('button', { class: 'btn btn-primary', title: 'Roda o que mudou, na ordem das ligações' }, icon('send', 15), 'Executar fluxo')
  const stopBtn = h('button', { class: 'btn btn-danger-soft', title: 'Para o nó que está rodando' }, icon('stop', 15), 'Parar')
  const codexChip = h('button', { class: 'st-chip', title: 'Integrações' })
  const galleryBtn = h('button', { class: 'btn', title: 'Tudo o que este andar já gerou' }, icon('image', 15), 'Galeria')
  const head = h(
    'div',
    { class: 'st-head' },
    title,
    h('div', { class: 'st-head-actions' }, usageStrip(state, floor), codexChip, galleryBtn, h('button', { class: 'btn', title: floor.cwd, onclick: () => void window.office.revealPath(floor.cwd) }, icon('folder', 15), 'Pasta'), stopBtn, runAllBtn, h('button', { class: 'icon-btn', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: () => close() }, icon('x', 18))),
  )
  const palette = h('aside', { class: 'st-palette', 'aria-label': 'Nós' })
  const canvas = h('div', { class: 'st-canvas', tabindex: 0 })
  const world = h('div', { class: 'st-world' })
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('st-wires')
  world.append(svg)
  canvas.append(world)
  const zoomLabel = h('span', { class: 'st-zoom-label' })
  const zoomBar = h(
    'div',
    { class: 'st-zoombar' },
    h('button', { class: 'icon-btn', title: 'Afastar', onclick: () => zoomAt(view.zoom / 1.2) }, icon('zoomOut', 16)),
    zoomLabel,
    h('button', { class: 'icon-btn', title: 'Aproximar', onclick: () => zoomAt(view.zoom * 1.2) }, icon('zoomIn', 16)),
    h('button', { class: 'icon-btn', title: 'Enquadrar tudo', onclick: () => fit() }, icon('expand', 16)),
  )
  canvas.append(zoomBar)
  const tabsUi = tabBar({
    switch: (id) => void switchTo(id),
    create: (tpl) => void createTab(tpl),
    rename: (id, name) => void renameTab(id, name),
    duplicate: (id) => void duplicateTab(id),
    remove: (id) => void removeTab(id),
    busy: (id) => isBusy(floor.id, id),
  })
  const renderTabs = () => tabsUi.render(tabs, s.flowId)
  const gallery = galleryPanel(floor, {
    toast: opts.toast,
    preview: (p) => preview(p),
    showText: (t, text) => showText(t, text),
    useAsRef: (p) => useAsRef(p),
  })
  galleryBtn.addEventListener('click', () => {
    gallery.toggle()
    galleryBtn.classList.toggle('on', gallery.open)
  })
  const box = h('div', { class: 'st-box' }, head, tabsUi.el, h('div', { class: 'st-main' }, palette, canvas, gallery.el))
  const el = h('div', { class: 'backdrop backdrop-studio' }, box)
  modalA11y(el, box, title)
  root.append(el)

  const close = () => {
    s.save(true)
    off()
    openFloor = null
    el.remove()
  }
  el.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
    if (e.key === 'Escape' && !el.querySelector('.backdrop')) {
      if (typing) (e.target as HTMLElement).blur()
      else close()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selected) {
      e.preventDefault()
      removeSelected()
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void runAll()
    }
    e.stopPropagation()
  })

  // ---------- integrations / gate ----------
  const integrations = h('div', { class: 'st-palette-int' })
  const setChip = () => {
    void readStatus().then((st) => {
      const ok = creativeReady(st)
      codexChip.className = `st-chip${ok ? ' ok' : ' bad'}`
      codexChip.replaceChildren(h('span', { class: 'st-int-dot' }), ok ? 'ChatGPT conectado' : 'Configurar ChatGPT')
      runAllBtn.toggleAttribute('disabled', !ok || s.busy)
    })
  }
  codexChip.addEventListener('click', () => integrations.scrollIntoView({ behavior: 'smooth' }))
  integrations.append(h('div', { class: 'st-group' }, 'Integrações'), integrationsView({ toast: opts.toast, onChange: () => setChip() }))

  // ---------- palette ----------
  for (const g of GROUPS) {
    const defs = Object.values(NODE_DEFS).filter((d) => d.group === g)
    palette.append(
      h('div', { class: 'st-group' }, g),
      ...defs.map((d) =>
        h(
          'button',
          { class: `st-pal-item k-${d.group}`, title: d.hint, onclick: () => addNode(d.kind) },
          h('span', { class: 'st-pal-icon' }, icon(kindIcon(d.kind), 15)),
          h('span', { class: 'st-pal-text' }, h('b', {}, d.title), h('small', {}, d.engine === 'codex' ? 'ChatGPT via Codex' : d.engine === 'claude' ? 'Claude (ou ChatGPT)' : d.engine === 'elevenlabs' ? 'ElevenLabs' : d.engine === 'local' ? 'nesta máquina' : 'entrada')),
        ),
      ),
    )
  }
  palette.append(
    h('div', { class: 'st-group' }, 'Modelos de fluxo'),
    ...FLOW_TEMPLATES.map((t) =>
      h('button', { class: 'st-pal-item', title: `Abre este modelo numa aba nova (${t.hint})`, onclick: () => void createTab(t.id) }, h('span', { class: 'st-pal-icon' }, icon(t.id === 'blank' ? 'reset' : 'list', 15)), h('span', { class: 'st-pal-text' }, h('b', {}, t.title), h('small', {}, t.hint))),
    ),
    integrations,
  )

  // ---------- view ----------
  const applyView = () => {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
    canvas.style.backgroundPosition = `${view.x}px ${view.y}px`
    canvas.style.backgroundSize = `${24 * view.zoom}px ${24 * view.zoom}px`
    zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`
    flow().view = { ...view }
  }
  const zoomAt = (z: number, cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2) => {
    const nz = Math.min(2, Math.max(0.25, z))
    view.x = cx - ((cx - view.x) * nz) / view.zoom
    view.y = cy - ((cy - view.y) * nz) / view.zoom
    view.zoom = nz
    applyView()
    s.save()
  }
  const fit = () => {
    const ns = flow().nodes
    if (!ns.length) return
    const rects = ns.map((n) => ({ x: n.x, y: n.y, w: nodeEls.get(n.id)?.offsetWidth ?? 300, h: nodeEls.get(n.id)?.offsetHeight ?? 200 }))
    const minX = Math.min(...rects.map((r) => r.x))
    const minY = Math.min(...rects.map((r) => r.y))
    const maxX = Math.max(...rects.map((r) => r.x + r.w))
    const maxY = Math.max(...rects.map((r) => r.y + r.h))
    const z = Math.min(1.2, Math.max(0.25, Math.min((canvas.clientWidth - 80) / (maxX - minX), (canvas.clientHeight - 80) / (maxY - minY))))
    view.zoom = z
    view.x = (canvas.clientWidth - (maxX - minX) * z) / 2 - minX * z
    view.y = (canvas.clientHeight - (maxY - minY) * z) / 2 - minY * z
    applyView()
    s.save()
  }
  const toWorld = (cx: number, cy: number) => {
    const r = canvas.getBoundingClientRect()
    return { x: (cx - r.left - view.x) / view.zoom, y: (cy - r.top - view.y) / view.zoom }
  }

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(view.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top)
      else {
        view.x -= e.deltaX
        view.y -= e.deltaY
        applyView()
        s.save()
      }
    },
    { passive: false },
  )
  // pan by dragging the background
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas && e.target !== world && e.target !== svg) return
    select(null)
    canvas.focus()
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
    canvas.setPointerCapture(e.pointerId)
    canvas.classList.add('panning')
    const move = (m: PointerEvent) => {
      view.x = start.vx + m.clientX - start.x
      view.y = start.vy + m.clientY - start.y
      applyView()
    }
    const up = () => {
      canvas.classList.remove('panning')
      canvas.removeEventListener('pointermove', move)
      s.save()
    }
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up, { once: true })
  })

  // ---------- nodes ----------
  function addNode(kind: NodeKind, at?: { x: number; y: number }): void {
    const c = at ?? toWorld(canvas.getBoundingClientRect().left + canvas.clientWidth / 2 - 150, canvas.getBoundingClientRect().top + canvas.clientHeight / 2 - 100)
    const n: FlowNode = { id: newId('n'), kind, x: Math.round(c.x), y: Math.round(c.y), params: defaultParams(kind) }
    flow().nodes.push(n)
    s.save()
    renderAll()
    select({ kind: 'node', id: n.id })
  }

  function removeSelected(): void {
    if (!selected) return
    const sel = selected
    if (sel.kind === 'edge') flow().edges = flow().edges.filter((e) => e.id !== sel.id)
    else {
      if (s.running.has(sel.id)) return opts.toast('Esse nó está rodando. Pare antes de apagar.', 'err')
      flow().nodes = flow().nodes.filter((n) => n.id !== sel.id)
      flow().edges = flow().edges.filter((e) => e.from !== sel.id && e.to !== sel.id)
    }
    selected = null
    s.save()
    renderAll()
  }

  // ---------- tabs ----------
  let unsub: () => void = () => undefined
  const listen = () => {
    unsub()
    unsub = s.onChange((nodeId) => {
      if (nodeId) refreshNode(nodeId)
      else renderAll()
    })
  }
  async function switchTo(id: string): Promise<void> {
    const tab = tabs.find((t) => t.id === id)
    if (!tab || tab.id === s.flowId) return
    s.save(true)
    try {
      s = await sessionFor(floor, tab)
    } catch (err) {
      return opts.toast(cleanError(err), 'err')
    }
    localStorage.setItem(LAST_TAB(floor.id), tab.id)
    selected = null
    Object.assign(view, { x: 0, y: 0, zoom: 1 }, s.flow.view)
    const fresh = !s.flow.view
    listen()
    applyView()
    renderTabs()
    renderAll()
    if (fresh) requestAnimationFrame(fit)
  }
  async function createTab(templateId: string | null, from?: Flow, name?: string): Promise<void> {
    const t = templateId ? FLOW_TEMPLATES.find((x) => x.id === templateId) : undefined
    try {
      const tab = await window.office.createFlow(floor.id, name ?? t?.title ?? `Fluxo ${tabs.length + 1}`, from ?? t?.build() ?? { version: 1, nodes: [], edges: [] }, s.flowId)
      tabs = await window.office.listFlows(floor.id)
      await switchTo(tab.id)
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    }
  }
  async function renameTab(id: string, name: string): Promise<void> {
    try {
      tabs = await window.office.renameFlow(floor.id, id, name)
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    }
    renderTabs()
  }
  async function duplicateTab(id: string): Promise<void> {
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    const src = id === s.flowId ? s : await sessionFor(floor, tab)
    src.save(true)
    await createTab(null, JSON.parse(JSON.stringify(src.flow)) as Flow, `${tab.name} (cópia)`.slice(0, 40))
  }
  async function removeTab(id: string): Promise<void> {
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    if (isBusy(floor.id, id)) return opts.toast('Esse fluxo está rodando. Pare antes de apagar.', 'err')
    const yes = await confirmDialog(el, { title: `Apagar "${tab.name}"?`, text: 'O fluxo sai das abas e o arquivo vai para .criativo/fluxos/lixeira. Imagens e análises geradas continuam na pasta do andar.', confirm: 'Apagar fluxo', cancel: 'Manter', danger: true })
    if (!yes) return
    try {
      const wasOpen = id === s.flowId
      tabs = await window.office.deleteFlow(floor.id, id)
      dropSession(floor.id, id)
      if (!tabs.length) tabs = await floorTabs(floor)
      if (wasOpen) {
        s = await sessionFor(floor, tabs[0])
        Object.assign(view, { x: 0, y: 0, zoom: 1 }, s.flow.view)
        selected = null
        listen()
        applyView()
        renderAll()
      }
      renderTabs()
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    }
  }

  /** Galeria → "Referência": into the selected Image node, or a new one near the middle of the view. */
  function useAsRef(path: string): void {
    const sel = selected?.kind === 'node' ? s.node(selected.id) : undefined
    if (sel?.kind === 'image') {
      sel.params.paths = [...new Set([...((sel.params.paths as string[]) ?? []), path])].slice(0, 20)
      s.save()
      renderAll()
      return opts.toast('Imagem adicionada ao nó selecionado.', 'ok')
    }
    addNode('image')
    const n = flow().nodes.at(-1)
    if (n) {
      n.params.paths = [path]
      s.save()
      renderAll()
    }
    opts.toast('Nó de Imagem criado com a referência. Ligue-o onde quiser.', 'ok')
  }

  /** "Editar" on an image result: an Editar imagem node to the right, already wired. */
  function editFrom(node: FlowNode, port: string): void {
    const el2 = nodeEls.get(node.id)
    const n: FlowNode = { id: newId('n'), kind: 'edit-image', x: node.x + (el2?.offsetWidth ?? 320) + 80, y: node.y, params: defaultParams('edit-image') }
    flow().nodes.push(n)
    flow().edges.push({ id: newId('e'), from: node.id, fromPort: port, to: n.id, toPort: 'image' })
    s.save()
    renderAll()
    select({ kind: 'node', id: n.id })
  }

  function select(sel: typeof selected): void {
    selected = sel
    for (const [id, nel] of nodeEls) nel.classList.toggle('selected', sel?.kind === 'node' && sel.id === id)
    drawWires()
  }

  function portEl(node: FlowNode, port: PortDef, dir: 'in' | 'out'): HTMLElement {
    const dot = h('span', { class: `st-port-dot t-${port.type}`, 'data-node': node.id, 'data-port': port.key, 'data-dir': dir, 'data-type': port.type, title: `${port.label} (${port.type})${port.optional ? ' · opcional' : ''}` })
    if (dir === 'out') dot.addEventListener('pointerdown', (e) => startWire(e, node, port))
    else
      dot.addEventListener('pointerdown', (e) => {
        // dragging off a connected input picks its wire up again
        const edge = flow().edges.find((x) => x.to === node.id && x.toPort === port.key)
        if (!edge) return
        e.stopPropagation()
        flow().edges = flow().edges.filter((x) => x !== edge)
        const from = flow().nodes.find((n) => n.id === edge.from)
        const fromPort = from && NODE_DEFS[from.kind].outputs.find((p) => p.key === edge.fromPort)
        if (from && fromPort) startWire(e, from, fromPort)
        renderAll()
      })
    return h('div', { class: `st-port ${dir}` }, dir === 'in' ? dot : null, h('span', { class: 'st-port-label' }, port.label, port.optional ? h('i', {}, ' · opc.') : null), dir === 'out' ? dot : null)
  }

  function paramControl(node: FlowNode, d: ParamDef): HTMLElement {
    const p = node.params
    const commit = () => {
      s.save()
      refreshNode(node.id)
    }
    if (d.type === 'text') {
      const ta = h('textarea', { class: 'input st-input', rows: d.rows ?? 2, placeholder: d.placeholder ?? '' })
      ta.value = String(p[d.key] ?? '')
      ta.addEventListener('input', () => {
        p[d.key] = ta.value
        s.save()
      })
      ta.addEventListener('change', commit)
      return h('label', { class: 'st-field' }, h('span', {}, d.label), ta)
    }
    if (d.type === 'select') {
      const sel = h('select', { class: 'input st-input' }, ...d.options.map(([v, l]) => h('option', { value: v }, l)))
      sel.value = String(p[d.key] ?? d.options[0][0])
      sel.addEventListener('change', () => {
        p[d.key] = sel.value
        if (d.key === 'engine') {
          s.save()
          return renderAll()
        }
        commit()
      })
      return h('label', { class: 'st-field' }, h('span', {}, d.label), sel)
    }
    if (d.type === 'number') {
      const inp = h('input', { class: 'input st-input', type: 'number', min: d.min, max: d.max, step: 1 })
      inp.value = String(p[d.key] ?? d.min)
      inp.addEventListener('change', () => {
        p[d.key] = Math.min(d.max, Math.max(d.min, Math.round(Number(inp.value) || d.min)))
        inp.value = String(p[d.key])
        commit()
      })
      return h('label', { class: 'st-field st-field-row' }, h('span', {}, d.label), inp)
    }
    if (d.type === 'voice') {
      const sel = h('select', { class: 'input st-input' }, h('option', { value: String(p[d.key] ?? '') }, 'Lendo as vozes…'))
      sel.addEventListener('change', () => {
        p[d.key] = sel.value
        commit()
      })
      void loadVoices()
        .then((list) => {
          sel.replaceChildren(h('option', { value: '' }, 'Escolha a voz'), ...list.map((v) => h('option', { value: v.id }, `${v.name} — ${v.detail}`)))
          sel.value = String(p[d.key] ?? '')
        })
        .catch(() => {
          sel.replaceChildren(h('option', { value: '' }, 'Configure o ElevenLabs em Integrações'))
          sel.disabled = true
        })
      return h('label', { class: 'st-field' }, h('span', {}, d.label), sel)
    }
    // file
    const pick = async () => {
      const paths = await window.office.pickMedia(d.accept, d.multi)
      if (!paths.length) return
      if (d.multi) p[d.key] = [...new Set([...((p[d.key] as string[]) ?? []), ...paths])].slice(0, 20)
      else p[d.key] = paths[0]
      s.save()
      renderAll()
    }
    const list = d.multi ? ((p[d.key] as string[]) ?? []) : p[d.key] ? [String(p[d.key])] : []
    const media = list.map((path) =>
      h(
        'div',
        { class: `st-media${d.accept === 'video' ? ' video' : ''}` },
        d.accept === 'video' ? h('video', { src: mediaUrl(path), controls: true, preload: 'metadata', muted: true, playsinline: true }) : h('img', { src: mediaUrl(path), alt: fileName(path), loading: 'lazy' }),
        h('div', { class: 'st-media-name', title: path }, fileName(path)),
        h(
          'button',
          {
            class: 'st-media-x',
            title: 'Tirar',
            'aria-label': `Tirar ${fileName(path)}`,
            onclick: () => {
              p[d.key] = d.multi ? list.filter((x) => x !== path) : ''
              s.save()
              renderAll()
            },
          },
          icon('x', 12),
        ),
      ),
    )
    return h(
      'div',
      { class: 'st-field' },
      h('div', { class: `st-media-grid${d.accept === 'video' ? ' one' : ''}` }, ...media),
      h('button', { class: 'btn btn-small st-pick', onclick: () => void pick() }, icon(d.accept === 'video' ? 'eye' : 'image', 14), list.length ? (d.multi ? 'Adicionar…' : 'Trocar…') : d.accept === 'video' ? 'Escolher vídeo…' : 'Escolher imagens…'),
      h('span', { class: 'st-drop-hint' }, 'ou arraste do Finder para cá'),
    )
  }

  function outputView(node: FlowNode): HTMLElement | null {
    const def = NODE_DEFS[node.kind]
    if (!def.engine) return null
    const run = s.running.get(node.id)
    if (run) {
      const secs = Math.round((Date.now() - run.started) / 1000)
      return h('div', { class: 'st-out running' }, h('span', { class: 'st-spinner', 'aria-hidden': 'true' }), h('span', { class: 'st-out-text' }, run.text, h('small', {}, ` · ${secs} s`)))
    }
    const parts: HTMLElement[] = []
    if (node.error) parts.push(h('div', { class: 'st-error' }, icon('alert', 14), h('span', {}, node.error)))
    const res = node.result
    if (res) {
      const stale = !isFresh(flow(), node)
      for (const port of def.outputs) {
        const v = res.outputs[port.key]
        if (v) parts.push(valueView(v, node, port.key))
      }
      parts.push(h('div', { class: `st-note${stale ? ' stale' : ''}` }, stale ? 'Desatualizado: algo mudou antes deste nó. ' : '', res.note ?? '', ` · ${new Date(res.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`))
    } else if (!node.error) parts.push(h('div', { class: 'st-note' }, def.hint))
    return h('div', { class: 'st-out' }, ...parts)
  }

  function valueView(v: PortValue, node: FlowNode, port: string): HTMLElement {
    if (v.type === 'audio')
      return h(
        'div',
        { class: 'st-text' },
        h('audio', { class: 'st-audio', controls: true, preload: 'metadata', src: mediaUrl(v.path) }),
        h('div', { class: 'st-text-actions' }, h('button', { class: 'btn btn-small', title: v.path, onclick: () => void window.office.revealPath(v.path) }, icon('folder', 13), 'Mostrar no Finder')),
      )
    if (v.type === 'image')
      return h(
        'div',
        { class: 'st-text' },
        h(
          'div',
          { class: 'st-media-grid' },
          ...v.paths.map((p) => h('button', { class: 'st-thumb', title: `${fileName(p)} — clique para ampliar`, onclick: () => preview(p) }, h('img', { src: mediaUrl(p), alt: fileName(p), loading: 'lazy' }))),
        ),
        v.paths[0]
          ? h(
              'div',
              { class: 'st-text-actions' },
              h('button', { class: 'btn btn-small', title: v.paths[0], onclick: () => void window.office.revealPath(v.paths[0]) }, icon('folder', 13), 'Mostrar no Finder'),
              h('button', { class: 'btn btn-small', title: 'Um nó "Editar imagem" ligado a este resultado', onclick: () => editFrom(node, port) }, icon('edit', 13), 'Editar'),
            )
          : null,
      )
    if (v.type === 'text') {
      const md = renderMarkdown(v.text)
      md.classList.add('st-md')
      return h(
        'div',
        { class: 'st-text' },
        md,
        h(
          'div',
          { class: 'st-text-actions' },
          h('button', { class: 'btn btn-small', onclick: () => void window.office.copyText(v.text).then(() => opts.toast('Copiado.', 'ok')) }, icon('copy', 13), 'Copiar'),
          h('button', { class: 'btn btn-small', onclick: () => showText('Resultado', v.text) }, icon('expand', 13), 'Abrir'),
        ),
      )
    }
    if (v.type === 'post') {
      const full = `${v.post.legenda}\n\n${v.post.hashtags.map((t) => `#${t}`).join(' ')}`
      return h(
        'div',
        { class: 'st-text st-post' },
        h('b', {}, v.post.titulo),
        h('p', {}, v.post.legenda),
        h('p', { class: 'st-tags' }, v.post.hashtags.map((t) => `#${t}`).join(' ')),
        h('div', { class: 'st-text-actions' }, h('button', { class: 'btn btn-small', onclick: () => void window.office.copyText(full).then(() => opts.toast('Legenda copiada.', 'ok')) }, icon('copy', 13), 'Copiar legenda')),
      )
    }
    return h('div', { class: 'st-note' }, fileName(v.path))
  }

  function nodeEl(node: FlowNode): HTMLElement {
    const def = NODE_DEFS[node.kind]
    const running = s.running.has(node.id)
    const runBtn = def.engine
      ? h(
          'button',
          {
            class: 'icon-btn st-run',
            title: running ? 'Parar' : 'Rodar este nó (e o que ele precisa antes)',
            'aria-label': running ? 'Parar' : `Rodar ${def.title}`,
            onclick: () => (running ? s.stop() : void runNode(node.id)),
          },
          icon(running ? 'stop' : 'send', 14),
        )
      : null
    const header = h(
      'div',
      { class: 'st-node-head' },
      h('span', { class: 'st-node-icon' }, icon(kindIcon(node.kind), 14)),
      h('span', { class: 'st-node-title' }, def.title),
      engineLabel(def, node.params) ? h('span', { class: `st-badge${engineLabel(def, node.params) === 'ChatGPT' ? ' gpt' : ' claude'}` }, engineLabel(def, node.params)) : null,
      runBtn,
      h('button', { class: 'icon-btn', title: 'Apagar nó (Delete)', 'aria-label': `Apagar ${def.title}`, onclick: () => (select({ kind: 'node', id: node.id }), removeSelected()) }, icon('trash', 13)),
    )
    const ports = h(
      'div',
      { class: 'st-ports' },
      h('div', { class: 'st-ins' }, ...def.inputs.map((p) => portEl(node, p, 'in'))),
      h('div', { class: 'st-outs' }, ...def.outputs.map((p) => portEl(node, p, 'out'))),
    )
    const body = h('div', { class: 'st-node-body' }, ...def.params.map((d) => paramControl(node, d)))
    const out = h('div', { class: 'st-node-out' })
    const o = outputView(node)
    if (o) out.append(o)
    const fresh = isFresh(flow(), node)
    const nel = h(
      'div',
      {
        class: `st-node g-${def.group}${running ? ' running' : ''}${node.error ? ' failed' : ''}${def.engine && node.result && fresh ? ' done' : ''}${selected?.kind === 'node' && selected.id === node.id ? ' selected' : ''}`,
        style: `left:${node.x}px;top:${node.y}px`,
        'data-id': node.id,
      },
      header,
      ports,
      def.params.length ? body : null,
      out,
    )
    // drag by the header
    header.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return
      e.preventDefault()
      select({ kind: 'node', id: node.id })
      const start = { x: e.clientX, y: e.clientY, nx: node.x, ny: node.y }
      header.setPointerCapture(e.pointerId)
      const move = (m: PointerEvent) => {
        node.x = Math.round(start.nx + (m.clientX - start.x) / view.zoom)
        node.y = Math.round(start.ny + (m.clientY - start.y) / view.zoom)
        nel.style.left = `${node.x}px`
        nel.style.top = `${node.y}px`
        drawWires()
      }
      const up = () => {
        header.removeEventListener('pointermove', move)
        s.save()
      }
      header.addEventListener('pointermove', move)
      header.addEventListener('pointerup', up, { once: true })
    })
    nel.addEventListener('pointerdown', () => {
      if (selected?.id !== node.id) select({ kind: 'node', id: node.id })
    })
    // files dropped from Finder land on the node's file param
    const fileParam = def.params.find((p): p is Extract<ParamDef, { type: 'file' }> => p.type === 'file')
    if (fileParam) {
      nel.addEventListener('dragover', (e) => {
        e.preventDefault()
        nel.classList.add('drop')
      })
      nel.addEventListener('dragleave', () => nel.classList.remove('drop'))
      nel.addEventListener('drop', (e) => {
        e.preventDefault()
        nel.classList.remove('drop')
        const ok = fileParam.accept === 'video' ? /\.(mp4|mov|m4v|webm)$/i : /\.(png|jpe?g|webp|gif)$/i
        const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.office.pathForFile(f)).filter((p) => p && ok.test(p))
        if (!paths.length) return opts.toast(fileParam.accept === 'video' ? 'Solte um vídeo (mp4, mov, m4v ou webm).' : 'Solte imagens (png, jpg, webp ou gif).', 'err')
        if (fileParam.multi) node.params[fileParam.key] = [...new Set([...((node.params[fileParam.key] as string[]) ?? []), ...paths])].slice(0, 20)
        else node.params[fileParam.key] = paths[0]
        s.save()
        renderAll()
      })
    }
    return nel
  }

  function renderAll(): void {
    for (const nel of nodeEls.values()) nel.remove()
    nodeEls.clear()
    for (const n of flow().nodes) {
      const nel = nodeEl(n)
      nodeEls.set(n.id, nel)
      world.append(nel)
    }
    if (!flow().nodes.length) world.append(h('div', { class: 'st-empty' }, 'Escolha um nó à esquerda para começar.'))
    else world.querySelector('.st-empty')?.remove()
    stopBtn.hidden = !s.busy
    setChip()
    requestAnimationFrame(drawWires)
  }

  /** Only the status and output of one node: typing in its fields keeps the focus. */
  function refreshNode(id: string): void {
    const n = s.node(id)
    const nel = nodeEls.get(id)
    if (!n || !nel) return renderAll()
    const fresh = isFresh(flow(), n)
    const def = NODE_DEFS[n.kind]
    nel.classList.toggle('running', s.running.has(id))
    nel.classList.toggle('failed', !!n.error)
    nel.classList.toggle('done', !!def.engine && !!n.result && fresh)
    const out = nel.querySelector('.st-node-out')
    const o = outputView(n)
    out?.replaceChildren(...(o ? [o] : []))
    // downstream badges may have changed too
    for (const e of flow().edges) if (e.from === id) refreshOutOnly(e.to)
    requestAnimationFrame(drawWires)
  }
  function refreshOutOnly(id: string): void {
    const n = s.node(id)
    const nel = nodeEls.get(id)
    if (!n || !nel || s.running.has(id)) return
    const o = outputView(n)
    nel.querySelector('.st-node-out')?.replaceChildren(...(o ? [o] : []))
    nel.classList.toggle('done', !!NODE_DEFS[n.kind].engine && !!n.result && isFresh(flow(), n))
  }

  // ---------- wires ----------
  const portPos = (nodeId: string, port: string, dir: 'in' | 'out') => {
    const dot = nodeEls.get(nodeId)?.querySelector<HTMLElement>(`.st-port-dot[data-port="${port}"][data-dir="${dir}"]`)
    if (!dot) return null
    const r = dot.getBoundingClientRect()
    return toWorld(r.left + r.width / 2, r.top + r.height / 2)
  }
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5)
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`
  }
  let temp: SVGPathElement | null = null
  function drawWires(): void {
    const paths: SVGElement[] = []
    for (const e of flow().edges) {
      const a = portPos(e.from, e.fromPort, 'out')
      const b = portPos(e.to, e.toPort, 'in')
      if (!a || !b) continue
      const from = s.node(e.from)
      const type = from ? NODE_DEFS[from.kind].outputs.find((p) => p.key === e.fromPort)?.type : 'text'
      const live = from && outputOf(from, e.fromPort)
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      hit.setAttribute('d', curve(a, b))
      hit.classList.add('st-wire-hit')
      hit.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation()
        select({ kind: 'edge', id: e.id })
        canvas.focus()
      })
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('d', curve(a, b))
      p.classList.add('st-wire', `t-${type}`)
      if (!live) p.classList.add('idle')
      if (selected?.kind === 'edge' && selected.id === e.id) p.classList.add('selected')
      if (s.running.has(e.to)) p.classList.add('flowing')
      paths.push(hit, p)
    }
    if (temp) paths.push(temp)
    svg.replaceChildren(...paths)
  }

  function startWire(e: PointerEvent, node: FlowNode, port: PortDef): void {
    e.preventDefault()
    e.stopPropagation()
    const a = portPos(node.id, port.key, 'out')
    if (!a) return
    temp = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    temp.classList.add('st-wire', `t-${port.type}`, 'temp')
    canvas.classList.add('wiring')
    // compatible inputs light up
    for (const dot of world.querySelectorAll<HTMLElement>('.st-port-dot[data-dir="in"]')) {
      const ok = accepts(dot.dataset.type as PortDef['type'], port.type) && dot.dataset.node !== node.id && !makesCycle(flow(), node.id, dot.dataset.node!)
      dot.classList.toggle('can', ok)
    }
    const move = (m: PointerEvent) => {
      temp?.setAttribute('d', curve(a, toWorld(m.clientX, m.clientY)))
      drawWires()
    }
    const up = (u: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      canvas.classList.remove('wiring')
      for (const dot of world.querySelectorAll('.st-port-dot.can')) dot.classList.remove('can')
      temp = null
      const target = (document.elementFromPoint(u.clientX, u.clientY) as HTMLElement | null)?.closest<HTMLElement>('.st-port, .st-node')
      const dot = target?.classList.contains('st-port') ? target.querySelector<HTMLElement>('.st-port-dot[data-dir="in"]') : null
      let toNode = dot?.dataset.node
      let toPort = dot?.dataset.port
      // dropped on a node body: the first free compatible input
      if (!dot && target?.classList.contains('st-node')) {
        const n = s.node(target.dataset.id ?? '')
        const free = n && NODE_DEFS[n.kind].inputs.find((p) => accepts(p.type, port.type) && (p.multi || !flow().edges.some((x) => x.to === n.id && x.toPort === p.key)))
        if (n && free) [toNode, toPort] = [n.id, free.key]
      }
      if (toNode && toPort) connect(node, port, toNode, toPort)
      else drawWires()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  function connect(from: FlowNode, port: PortDef, toId: string, toPort: string): void {
    const to = s.node(toId)
    const inp = to && NODE_DEFS[to.kind].inputs.find((p) => p.key === toPort)
    if (!to || !inp) return drawWires()
    if (!accepts(inp.type, port.type)) {
      opts.toast(`"${inp.label}" recebe ${inp.type}, não ${port.type}.`, 'err')
      return drawWires()
    }
    if (makesCycle(flow(), from.id, to.id)) {
      opts.toast('Essa ligação faria um laço.', 'err')
      return drawWires()
    }
    let edges = flow().edges.filter((x) => !(x.from === from.id && x.fromPort === port.key && x.to === to.id && x.toPort === toPort))
    if (!inp.multi) edges = edges.filter((x) => !(x.to === to.id && x.toPort === toPort))
    const edge: FlowEdge = { id: newId('e'), from: from.id, fromPort: port.key, to: to.id, toPort }
    flow().edges = [...edges, edge]
    s.save()
    renderAll()
  }

  // ---------- running ----------
  /** Codex only when the plan draws (images, edits, carousels) or a node picked ChatGPT. */
  const gate = async (ids: string[]): Promise<boolean> => {
    const needs = ids.some((id) => {
      const n = s.node(id)
      return !!n && (CODEX_KINDS.has(n.kind) || n.params.engine === 'codex')
    })
    if (!needs) return true
    const st = await readStatus()
    if (creativeReady(st)) return true
    opts.toast('Conecte o ChatGPT (Codex) em Integrações, na coluna da esquerda.', 'err')
    integrations.scrollIntoView({ behavior: 'smooth' })
    return false
  }
  async function runNode(id: string): Promise<void> {
    if (s.busy) return opts.toast('Já tem um nó rodando. Espere ou clique em Parar.', 'err')
    if (!(await gate(upstreamOrder(flow(), id)))) return
    const run = s
    const ok = await run.runNode(id)
    gallery.refresh()
    const n = run.node(id)
    if (ok && n) opts.toast(`${NODE_DEFS[n.kind].title}: pronto.`, 'ok')
  }
  async function runAll(): Promise<void> {
    if (s.busy) return
    if (!(await gate(topoOrder(flow())))) return
    const ok = await s.runAll()
    gallery.refresh()
    opts.toast(ok ? 'Fluxo executado.' : 'O fluxo parou. Veja o nó em vermelho.', ok ? 'ok' : 'err')
  }
  runAllBtn.addEventListener('click', () => void runAll())
  stopBtn.addEventListener('click', () => s.stop())

  // ---------- dialogs ----------
  function preview(path: string): void {
    const img = h('img', { class: 'st-preview-img', src: mediaUrl(path), alt: fileName(path) })
    const m = modal(fileName(path), [img], [h('button', { class: 'btn', onclick: () => void window.office.revealPath(path) }, icon('folder', 15), 'Mostrar no Finder'), h('button', { class: 'btn btn-primary', onclick: () => m.remove() }, 'Fechar')], () => m.remove())
    m.classList.add('backdrop-st-preview')
    el.append(m)
  }
  function showText(t: string, text: string): void {
    const md = renderMarkdown(text)
    md.classList.add('st-md', 'full')
    const m = modal(t, [md], [h('button', { class: 'btn', onclick: () => void window.office.copyText(text).then(() => opts.toast('Copiado.', 'ok')) }, icon('copy', 15), 'Copiar'), h('button', { class: 'btn btn-primary', onclick: () => m.remove() }, 'Fechar')], () => m.remove())
    m.classList.add('backdrop-st-text')
    el.append(m)
  }

  // ---------- live ----------
  const ticker = setInterval(() => {
    for (const id of s.running.keys()) refreshNode(id)
  }, 1000)
  listen()
  const offBusy = onBusyChange(() => renderTabs())
  const off = () => {
    clearInterval(ticker)
    unsub()
    offBusy()
  }

  localStorage.setItem(LAST_TAB(floor.id), s.flowId)
  renderTabs()
  applyView()
  renderAll()
  canvas.focus()
  if (!flow().view) requestAnimationFrame(fit)
}
