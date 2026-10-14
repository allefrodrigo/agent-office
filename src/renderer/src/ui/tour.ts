import './tour.css'
import { announce, asDialog, FocusReturn } from './a11y'
import { h } from './dom'
import { placeBalloon, resolveSteps, TourFlow, tourSteps, type FlagStore, type Rect, type TourTarget } from './tour-plan'

type Point = { x: number; y: number }

export interface TourHooks {
  /** The world spot exists (the routines totem may not, yet). */
  hasSpot(id: string): boolean
  /** Sends the camera to a spot of the ground floor; `instant` under reduced motion. */
  showSpot(id: string, instant: boolean): void
  /** The spot on the page now, or null when its floor is not on screen. */
  spotOnPage(id: string): Point | null
  /** The camera follows the player again. */
  release(): void
  /** A card, a window or the board is on screen: the tour waits behind it. */
  blocked(): boolean
  /** The tour stepped aside for a card: hand it the focus. */
  paused(): void
  toast(text: string): void
}

/** Size of a world spot's spotlight, in CSS pixels. */
const SPOT = 150
/** Room around a HUD target inside the spotlight. */
const PAD = 8
const AGAIN = 'Tour fechado. Aperte ? para rever.'

/**
 * Tour guiado: dims the screen, cuts a hole over each feature (a HUD element or a spot of
 * the office the camera travels to) and explains it in a balloon. → and Enter go on,
 * ← goes back, Esc skips; a click anywhere else closes it. Steps and the "seen" flag live
 * in tour-plan.ts.
 */
export class Tour {
  private flow: TourFlow | null = null
  /** Behind a card or window: hidden until it closes, then back on the same step. */
  private paused = false
  private root: HTMLDivElement
  private dim: HTMLDivElement
  private ring: HTMLDivElement
  private balloon: HTMLDivElement
  private count: HTMLDivElement
  private title: HTMLHeadingElement
  private text: HTMLParagraphElement
  private backBtn: HTMLButtonElement
  private nextBtn: HTMLButtonElement
  private skipBtn: HTMLButtonElement
  private focus = new FocusReturn()
  private reduced = matchMedia('(prefers-reduced-motion: reduce)')

  constructor(
    private ui: HTMLElement,
    private hooks: TourHooks,
    private platform: string,
    private store: FlagStore = localStorage,
  ) {
    this.count = h('div', { class: 'tour-count' })
    this.title = h('h2', { class: 'tour-title' })
    this.text = h('p', { class: 'tour-text' })
    this.skipBtn = h('button', { class: 'btn tour-skip', type: 'button', onclick: () => this.end('skipped') }, 'Pular tour')
    this.backBtn = h('button', { class: 'btn', type: 'button', onclick: () => this.back() }, 'Voltar')
    this.nextBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.next() }, 'Próximo')
    this.balloon = h('div', { class: 'tour-balloon card' }, this.count, this.title, this.text, h('div', { class: 'tour-foot' }, this.skipBtn, this.backBtn, this.nextBtn))
    asDialog(this.balloon, { title: [this.count, this.title], description: this.text })
    this.dim = h('div', { class: 'tour-dim' })
    this.ring = h('div', { class: 'tour-ring hidden' })
    this.root = h('div', { class: 'tour' }, this.dim, this.ring, this.balloon)
  }

  get isOpen(): boolean {
    return this.flow !== null
  }

  /** On screen and taking the keys (not waiting behind a card). */
  get showing(): boolean {
    return this.flow !== null && !this.paused
  }

  /** Opens the tour on its first step, whether or not the player has seen it. */
  start(): void {
    if (this.flow) return
    this.flow = new TourFlow(resolveSteps(tourSteps(this.platform), (t) => this.exists(t)), this.store)
    this.paused = this.hooks.blocked()
    this.focus.save(this.balloon)
    this.ui.append(this.root)
    window.addEventListener('keydown', this.onKey, true)
    document.addEventListener('pointerdown', this.onPointer, true)
    window.addEventListener('resize', this.onResize)
    this.show()
  }

  /** Each drawn frame: follows the camera, and steps aside while a card or window is open. */
  update(): void {
    if (!this.flow) return
    const blocked = this.hooks.blocked()
    if (blocked !== this.paused) {
      this.paused = blocked
      if (!blocked) return this.show()
      this.root.classList.add('hidden')
      // the camera goes back to the player meanwhile; show() brings it back to the spot
      this.hooks.release()
      this.hooks.paused()
      return
    }
    if (!this.paused && this.flow.step.target && 'world' in this.flow.step.target) this.place()
  }

  private show(): void {
    const flow = this.flow!
    const step = flow.step
    this.count.textContent = flow.label
    this.title.textContent = step.title
    this.text.textContent = step.text
    this.backBtn.disabled = flow.first
    this.nextBtn.textContent = flow.last ? 'Concluir' : 'Próximo'
    this.skipBtn.classList.toggle('hidden', flow.last)
    if (step.target && 'world' in step.target) this.hooks.showSpot(step.target.world, this.reduced.matches)
    this.root.classList.toggle('hidden', this.paused)
    if (this.paused) return
    this.place()
    // replay the fade-in for the new step
    this.balloon.classList.remove('tour-in')
    void this.balloon.offsetWidth
    this.balloon.classList.add('tour-in')
    const a = document.activeElement
    const entering = !this.balloon.contains(a)
    if (entering || (a instanceof HTMLButtonElement && (a.disabled || a.classList.contains('hidden')))) this.nextBtn.focus({ preventScroll: true })
    // Entering the dialog reads its title and text; afterwards the focus stays put, so say it.
    if (!entering) announce(`${flow.label}. ${step.title}. ${step.text}`)
  }

  private next(): void {
    if (!this.flow) return
    if (this.flow.next()) this.show()
    else this.end('done')
  }

  private back(): void {
    if (this.flow?.back()) this.show()
  }

  /** `outside`: the player clicked elsewhere; it counts as skipping. */
  private end(how: 'done' | 'skipped' | 'outside'): void {
    const flow = this.flow
    if (!flow) return
    flow.skip()
    this.flow = null
    this.paused = false
    window.removeEventListener('keydown', this.onKey, true)
    document.removeEventListener('pointerdown', this.onPointer, true)
    window.removeEventListener('resize', this.onResize)
    this.root.remove()
    this.hooks.release()
    this.focus.restore(this.balloon)
    if (how === 'outside') this.hooks.toast(AGAIN)
    else if (how === 'skipped') announce(AGAIN)
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.showing) return
    // Tab stays with the balloon's focus trap.
    if (e.key === 'Tab') return
    // Nothing else reaches the office: arrows would walk the player, letters open windows.
    // Immediate: a key sent to the window itself would still reach its other listeners.
    e.stopImmediatePropagation()
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const a = document.activeElement
    if (e.key === 'Escape') {
      e.preventDefault()
      this.end('skipped')
    } else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !(a instanceof HTMLButtonElement && a !== this.nextBtn && this.balloon.contains(a)))) {
      // Enter on Voltar or Pular tour clicks that button instead.
      e.preventDefault()
      if (!e.repeat) this.next()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (!e.repeat) this.back()
    }
  }

  private onPointer = (e: PointerEvent): void => {
    if (this.showing && !this.balloon.contains(e.target as Node)) this.end('outside')
  }

  private onResize = (): void => {
    if (this.showing) this.place()
  }

  private hudEl(name: string): HTMLElement | null {
    const el = this.ui.querySelector<HTMLElement>(`[data-tour="${name}"]`)
    return el && el.getClientRects().length > 0 ? el : null
  }

  private exists(t: TourTarget): boolean {
    return 'hud' in t ? this.hudEl(t.hud) !== null : this.hooks.hasSpot(t.world)
  }

  /** The spotlight's box on the page, or null when the target is gone or off this floor. */
  private targetRect(t: TourTarget | null): Rect | null {
    if (!t) return null
    if ('hud' in t) {
      const r = this.hudEl(t.hud)?.getBoundingClientRect()
      return r ? { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 } : null
    }
    const p = this.hooks.spotOnPage(t.world)
    return p ? { x: p.x - SPOT / 2, y: p.y - SPOT / 2, w: SPOT, h: SPOT } : null
  }

  /** Cuts the spotlight and puts the balloon beside it, inside the window. */
  private place(): void {
    const step = this.flow!.step
    const r = this.targetRect(step.target)
    const view = { w: innerWidth, h: innerHeight }
    const radius = step.target && 'world' in step.target ? SPOT / 2 : 12
    this.dim.style.clipPath = r ? holePath(view, r, radius) : ''
    this.ring.classList.toggle('hidden', !r)
    if (r) Object.assign(this.ring.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, borderRadius: `${Math.min(radius, r.w / 2, r.h / 2)}px` })
    const at = placeBalloon(r, { w: this.balloon.offsetWidth, h: this.balloon.offsetHeight }, step.place, view)
    this.balloon.style.left = `${at.x}px`
    this.balloon.style.top = `${at.y}px`
    this.balloon.dataset.side = at.side
  }
}

/** The whole window minus a rounded box (evenodd), so clicks in the hole reach what is under it. */
function holePath(view: { w: number; h: number }, r: Rect, radius: number): string {
  const k = Math.round(Math.min(radius, r.w / 2, r.h / 2))
  const [x, y, w, hh] = [r.x, r.y, r.w, r.h].map(Math.round)
  const arc = (ex: number, ey: number) => `A${k} ${k} 0 0 1 ${ex} ${ey}`
  const hole = `M${x + k} ${y}H${x + w - k}${arc(x + w, y + k)}V${y + hh - k}${arc(x + w - k, y + hh)}H${x + k}${arc(x, y + hh - k)}V${y + k}${arc(x + k, y)}Z`
  return `path(evenodd, "M0 0H${view.w}V${view.h}H0Z${hole}")`
}
