import * as THREE from 'three'
import type { Engine } from './engine'

export type BubbleKind = 'work' | 'wait' | 'done' | 'error' | 'idle' | 'talk'

/** HTML name tag + speech bubble that follows a 3D anchor. */
export class Tag {
  readonly el: HTMLDivElement
  private nameEl: HTMLSpanElement
  private dotEl: HTMLSpanElement
  private bubbleEl: HTMLDivElement
  private heartsEl: HTMLSpanElement
  private helpersEl: HTMLSpanElement
  private bubbleText = ''
  private bubbleKind: BubbleKind | null = null
  hidden = false

  constructor(
    readonly anchor: THREE.Object3D,
    name: string,
    you = false,
    onClick?: () => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'tag' + (you ? ' tag-you' : '')
    this.bubbleEl = document.createElement('div')
    this.bubbleEl.className = 'bubble hidden'
    const pill = document.createElement('div')
    pill.className = 'tag-pill'
    this.dotEl = document.createElement('span')
    this.dotEl.className = 'dot'
    this.nameEl = document.createElement('span')
    this.nameEl.textContent = name
    this.heartsEl = document.createElement('span')
    this.heartsEl.className = 'hearts hidden'
    this.helpersEl = document.createElement('span')
    this.helpersEl.className = 'helpers hidden'
    pill.append(this.dotEl, this.nameEl, this.helpersEl, this.heartsEl)
    this.el.append(this.bubbleEl, pill)
    if (onClick) {
      pill.addEventListener('click', onClick)
      this.bubbleEl.addEventListener('click', onClick)
    }
  }

  setName(name: string): void {
    if (this.nameEl.textContent !== name) this.nameEl.textContent = name
  }

  /** Health shown after the agent gets hit; null hides it. */
  setHearts(hp: number | null, max = 3): void {
    if (hp === null) {
      this.heartsEl.className = 'hearts hidden'
      return
    }
    this.heartsEl.className = 'hearts'
    this.heartsEl.textContent = '♥'.repeat(Math.max(0, hp)) + '♡'.repeat(Math.max(0, max - hp))
  }

  /** Subagents working for this agent; 0 hides the counter. */
  setHelpers(n: number): void {
    const text = n ? `+${n}` : ''
    if (this.helpersEl.textContent === text) return
    this.helpersEl.textContent = text
    this.helpersEl.className = n ? 'helpers' : 'helpers hidden'
    this.helpersEl.title = n === 1 ? '1 ajudante trabalhando' : `${n} ajudantes trabalhando`
  }

  setDot(status: string): void {
    const cls = `dot dot-${status}`
    if (this.dotEl.className !== cls) this.dotEl.className = cls
  }

  setBubble(text: string | null, kind: BubbleKind = 'work'): void {
    if (text === this.bubbleText && kind === this.bubbleKind) return
    this.bubbleText = text ?? ''
    this.bubbleKind = kind
    if (!text) {
      this.bubbleEl.className = 'bubble hidden'
      return
    }
    this.bubbleEl.className = `bubble bubble-${kind}`
    this.bubbleEl.textContent = text
  }
}

export class Overlays {
  private tags = new Set<Tag>()
  private labels: { el: HTMLDivElement; pos: THREE.Vector3; floor: number }[] = []
  private tmp = new THREE.Vector3()
  /** Floor on screen: labels of other floors hide. */
  floor = 0

  constructor(
    private root: HTMLElement,
    private engine: Engine,
  ) {}

  add(tag: Tag): Tag {
    this.tags.add(tag)
    this.root.appendChild(tag.el)
    return tag
  }

  remove(tag: Tag): void {
    this.tags.delete(tag)
    tag.el.remove()
  }

  label(text: string, x: number, z: number, floor = 0): void {
    const el = document.createElement('div')
    el.className = 'zone-label'
    el.textContent = text
    this.root.prepend(el)
    this.labels.push({ el, pos: new THREE.Vector3(x, 0, z), floor })
  }

  /** Drops the labels of a floor that is being rebuilt. */
  clearLabels(floor: number): void {
    for (const l of this.labels) if (l.floor === floor) l.el.remove()
    this.labels = this.labels.filter((l) => l.floor !== floor)
  }

  update(): void {
    for (const l of this.labels) {
      l.el.style.display = l.floor === this.floor ? '' : 'none'
      if (l.floor !== this.floor) continue
      const p = this.engine.project(l.pos)
      l.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
    }
    for (const t of this.tags) {
      t.anchor.getWorldPosition(this.tmp)
      const p = this.engine.project(this.tmp)
      t.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`
      t.el.style.zIndex = String(1000 + p.y)
      t.el.style.display = t.hidden ? 'none' : ''
    }
  }
}
