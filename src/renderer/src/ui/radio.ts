import { h, icon } from './dom'

const RADIO_ON = 'agent-office:radio'
const RADIO_VOLUME = 'agent-office:radio-volume'
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
 * Claude FM, Anthropic's 24/7 lo-fi live. It only exists on YouTube, so we embed
 * the player and show it on the lounge TV. The card is just the audio control.
 * When the TV is off screen or too small the video hides but keeps playing.
 * TODO: YouTube's terms want the player visible; give it a proper place.
 */
export class Radio {
  readonly button: HTMLButtonElement
  private card: HTMLDivElement
  private player: HTMLDivElement
  private frame: HTMLIFrameElement | null = null
  private volume: HTMLInputElement
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
    this.card = h(
      'div',
      { class: 'radio card hidden' },
      h(
        'div',
        { class: 'radio-head' },
        h('span', { class: 'radio-live' }),
        h('span', { class: 'radio-name' }, 'Claude FM'),
        h('span', { class: 'radio-sub' }, 'lo-fi ao vivo'),
        h('button', { class: 'radio-off', title: 'Desligar', onclick: () => this.toggle(false) }, icon('x', 14)),
      ),
      h('label', { class: 'radio-vol' }, icon('volume', 14), this.volume),
    )
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
    this.button.title = on ? 'Desligar a Claude FM' : 'Ligar a Claude FM'
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
    const frame = h('iframe', {
      allow: 'autoplay; encrypted-media',
      sandbox: 'allow-scripts allow-same-origin allow-presentation',
      referrerpolicy: 'strict-origin-when-cross-origin',
      title: 'Claude FM',
    })
    this.frame = frame
    const id = await window.office.radioVideo()
    if (this.frame !== frame) return // switched off while resolving
    const params = new URLSearchParams({ autoplay: '1', controls: '0', rel: '0', playsinline: '1', enablejsapi: '1' })
    frame.src = `${EMBED}/embed/${id}?${params}`
    // The player ignores commands until it has booted; resend a few times.
    frame.addEventListener('load', () => [500, 1500, 3000].forEach((ms) => setTimeout(() => this.applyVolume(), ms)))
    this.player.replaceChildren(frame)
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
