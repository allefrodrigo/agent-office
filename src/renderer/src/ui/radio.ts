import { embedPath, parseYoutube, type RadioSource } from '@shared/radio'
import { h, icon } from './dom'

const RADIO_ON = 'agent-office:radio'
const RADIO_VOLUME = 'agent-office:radio-volume'
/** The YouTube link the player pasted; absent means Claude FM. */
const RADIO_LINK = 'agent-office:radio-link'
const EMBED = 'https://www.youtube-nocookie.com'
/** Size the player lays out at; a CSS matrix scales it onto the TV. */
const PLAYER_W = 480
const PLAYER_H = 270
/** Below this on-screen width the TV is too small to watch: the video hides, the audio keeps playing. */
const MIN_TV_PX = 64

type Point = { x: number; y: number }

/** The in-world screen the radio plays on. */
export interface RadioTv {
  /** Page coordinates of the screen (top-left, top-right, bottom-left), or null when it is off view. */
  corners(): [Point, Point, Point] | null
  setOn(on: boolean): void
}

/**
 * Claude FM, Anthropic's 24/7 lo-fi live, or any YouTube video or playlist the player
 * pastes in the card. We embed the player and show it on the lounge TV.
 * When the TV is off screen or too small the video hides but keeps playing.
 * TODO: YouTube's terms want the player visible; give it a proper place.
 */
export class Radio {
  readonly button: HTMLButtonElement
  private card: HTMLDivElement
  private player: HTMLDivElement
  private frame: HTMLIFrameElement | null = null
  private volume: HTMLInputElement
  private name: HTMLSpanElement
  private sub: HTMLSpanElement
  private form: HTMLFormElement
  private link: HTMLInputElement
  private error: HTMLDivElement
  private back: HTMLButtonElement
  /** null = Claude FM. */
  private source: RadioSource | null = parseYoutube(localStorage.getItem(RADIO_LINK) ?? '')
  private tv: RadioTv | null = null
  private on = false

  /** `root` is the world overlay layer, so the video sits under name tags and HUD panels. */
  constructor(root: HTMLElement) {
    this.button = h('button', { class: 'dock-btn', title: 'Ligar a Claude FM', onclick: () => this.toggle() }, icon('radio'))
    this.player = h('div', { class: 'radio-player hidden' })
    this.volume = h('input', {
      type: 'range',
      min: '0',
      max: '100',
      value: localStorage.getItem(RADIO_VOLUME) ?? '60',
      title: 'Volume',
      oninput: () => {
        localStorage.setItem(RADIO_VOLUME, this.volume.value)
        this.applyVolume()
      },
    })
    this.name = h('span', { class: 'radio-name' })
    this.sub = h('span', { class: 'radio-sub' })
    this.link = h('input', {
      type: 'text',
      placeholder: 'Link de playlist ou vídeo do YouTube',
      spellcheck: 'false',
      'aria-label': 'Link do YouTube',
      oninput: () => this.error.classList.add('hidden'),
      onkeydown: (e: Event) => {
        if ((e as KeyboardEvent).key === 'Escape') this.toggleForm(false)
      },
    })
    this.error = h(
      'div',
      { class: 'radio-error hidden', role: 'alert' },
      'Link não reconhecido. Cole um link do YouTube com ?list= ou ?v=.',
    )
    this.back = h('button', { type: 'button', class: 'radio-back', onclick: () => this.setSource(null) }, 'Voltar para a Claude FM')
    this.form = h(
      'form',
      {
        class: 'radio-form hidden',
        onsubmit: (e: Event) => {
          e.preventDefault()
          this.submitLink()
        },
      },
      h('div', { class: 'radio-link' }, this.link, h('button', { type: 'submit', title: 'Tocar' }, icon('check', 14))),
      this.error,
      this.back,
    )
    this.card = h(
      'div',
      { class: 'radio card hidden' },
      h(
        'div',
        { class: 'radio-head' },
        h('span', { class: 'radio-live' }),
        this.name,
        this.sub,
        h('button', { class: 'radio-off radio-edit', title: 'Trocar o que toca', onclick: () => this.toggleForm() }, icon('edit', 14)),
        h('button', { class: 'radio-off', title: 'Desligar', onclick: () => this.toggle(false) }, icon('x', 14)),
      ),
      h('label', { class: 'radio-vol' }, icon('volume', 14), this.volume),
      this.form,
    )
    this.showSource()
    root.prepend(this.player)
    root.append(this.card)
    if (localStorage.getItem(RADIO_ON) === '1') void this.toggle(true)
  }

  attach(tv: RadioTv): void {
    this.tv = tv
    tv.setOn(this.on)
  }

  async toggle(on = !this.on): Promise<void> {
    this.on = on
    localStorage.setItem(RADIO_ON, on ? '1' : '0')
    this.button.classList.toggle('on', on)
    this.showSource()
    this.card.classList.toggle('hidden', !on)
    this.player.classList.toggle('hidden', !on)
    this.tv?.setOn(on)
    if (!on) {
      // Removing the iframe is the only reliable way to stop the stream.
      this.frame?.remove()
      this.frame = null
      return
    }
    if (this.frame) return
    await this.play()
  }

  private async play(): Promise<void> {
    const frame = h('iframe', {
      allow: 'autoplay; encrypted-media',
      sandbox: 'allow-scripts allow-same-origin allow-presentation',
      referrerpolicy: 'strict-origin-when-cross-origin',
      title: this.source ? 'YouTube' : 'Claude FM',
    })
    this.frame = frame
    const source = this.source ?? { video: await window.office.radioVideo() }
    if (this.frame !== frame) return // switched off or to another source while resolving
    frame.src = EMBED + embedPath(source)
    // The player ignores commands until it has booted; resend a few times.
    frame.addEventListener('load', () => [500, 1500, 3000].forEach((ms) => setTimeout(() => this.applyVolume(), ms)))
    this.player.replaceChildren(frame)
  }

  private toggleForm(open = this.form.classList.contains('hidden')): void {
    this.form.classList.toggle('hidden', !open)
    this.error.classList.add('hidden')
    if (!open) return
    this.link.value = localStorage.getItem(RADIO_LINK) ?? ''
    this.link.focus()
    this.link.select()
  }

  private submitLink(): void {
    const text = this.link.value.trim()
    if (!text) return this.setSource(null)
    const source = parseYoutube(text)
    if (!source) {
      this.error.classList.remove('hidden')
      return
    }
    localStorage.setItem(RADIO_LINK, text)
    this.setSource(source)
  }

  private setSource(source: RadioSource | null): void {
    if (!source) localStorage.removeItem(RADIO_LINK)
    this.source = source
    this.toggleForm(false)
    this.showSource()
    if (!this.on) return
    this.frame?.remove()
    this.frame = null
    void this.play()
  }

  private showSource(): void {
    const label = this.source ? 'o YouTube' : 'a Claude FM'
    this.button.title = this.on ? `Desligar ${label}` : `Ligar ${label}`
    this.name.textContent = this.source ? 'YouTube' : 'Claude FM'
    this.sub.textContent = this.source ? (this.source.list ? 'playlist' : 'vídeo') : 'lo-fi ao vivo'
    this.back.classList.toggle('hidden', !this.source)
  }

  /** Lays the player over the TV screen, or hides it when the TV can't be seen. Call after each rendered frame. */
  update(): void {
    if (!this.on) return
    const c = this.tv?.corners()
    const onTv = !!c && visible(c)
    // visibility, not display: a display:none iframe may stop the stream.
    this.player.classList.toggle('off-view', !onTv)
    if (!c || !onTv) return
    const [tl, tr, bl] = c
    const m = [(tr.x - tl.x) / PLAYER_W, (tr.y - tl.y) / PLAYER_W, (bl.x - tl.x) / PLAYER_H, (bl.y - tl.y) / PLAYER_H, tl.x, tl.y]
    this.player.style.transform = `matrix(${m.join(', ')})`
  }

  private applyVolume(): void {
    const v = Number(this.volume.value)
    const send = (func: string, args: unknown[] = []) =>
      this.frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), EMBED)
    send('setVolume', [v])
    send(v === 0 ? 'mute' : 'unMute')
  }
}

/** Whole screen inside the window and big enough to watch. */
function visible([tl, tr, bl]: [Point, Point, Point]): boolean {
  if (Math.hypot(tr.x - tl.x, tr.y - tl.y) < MIN_TV_PX) return false
  const br = { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y }
  return [tl, tr, bl, br].every((p) => p.x >= 0 && p.y >= 0 && p.x <= innerWidth && p.y <= innerHeight)
}
