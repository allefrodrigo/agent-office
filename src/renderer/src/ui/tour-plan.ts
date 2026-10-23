/**
 * Tour guiado (primeira abertura): os passos, a ordem, quais aparecem e a flag de visto.
 * Sem DOM, para os testes rodarem no node; a tela fica em tour.ts.
 */

/** A HUD element marked with data-tour="…", or a spot of the ground floor the camera travels to. */
export type TourTarget = { hud: string } | { world: string }

/** Side of the target the balloon prefers; `center` has no target. */
export type TourPlace = 'top' | 'bottom' | 'left' | 'right' | 'center'

export interface TourStep {
  id: string
  title: string
  /** One or two short sentences: the player reads each step in 3 seconds. */
  text: string
  /** Tried in order; a step with targets and none on screen is skipped. Empty: no target. */
  targets: TourTarget[]
  place: TourPlace
}

/** A step that will show, with the target it found (null: centered, no spotlight). */
export interface ResolvedStep extends TourStep {
  target: TourTarget | null
}

export const TOUR_DONE_KEY = 'agent-office:tour-done'

/** The part of localStorage the tour uses (a Map works in the tests). */
export interface FlagStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Every step, in order. `platform` picks ⌘ or Ctrl. */
export function tourSteps(platform: string): TourStep[] {
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl+'
  return [
    {
      id: 'welcome',
      title: 'Bem-vindo ao Agent Office',
      text: 'Seus agentes do Claude Code trabalham aqui. Em um minuto eu mostro o que fica escondido em teclas e ícones.',
      targets: [],
      place: 'center',
    },
    {
      id: 'desk',
      title: 'Sua mesa',
      text: 'Clique no seu computador ou aperte N para chamar um agente. Ele chega e espera a sua tarefa.',
      targets: [{ world: 'desk' }, { hud: 'new-agent' }],
      place: 'right',
    },
    {
      id: 'roster',
      title: 'Lista de agentes',
      text: 'Quem espera você fica no topo, e o LED da mesa dele acende amarelo. O botão ao lado de Agentes deixa a lista compacta.',
      targets: [{ hud: 'roster' }],
      place: 'right',
    },
    {
      id: 'panel',
      title: 'Painel do agente',
      text: 'Clique num agente para ver o log ao vivo e mandar mensagens. O clipe anexa arquivos e imagens.',
      targets: [{ hud: 'panel' }, { world: 'team' }],
      place: 'left',
    },
    {
      id: 'cards',
      title: 'Cartões até você',
      text: `Pedidos de permissão, perguntas e resultados vêm até a sua sala. Enter permite, ${mod}⌫ nega e I abre a caixa de entrada.`,
      targets: [{ hud: 'inbox' }],
      place: 'top',
    },
    {
      id: 'board',
      title: 'Quadro de tickets',
      text: 'Aperte T para abrir o kanban. Delegue um ticket e o agente o devolve em Revisão.',
      targets: [{ hud: 'board' }],
      place: 'top',
    },
    {
      id: 'resume',
      title: 'Central de resume',
      text: 'O relógio lista suas sessões recentes do Claude Code. Chame uma de volta e ela continua de onde parou.',
      targets: [{ hud: 'resume' }],
      place: 'top',
    },
    {
      id: 'floors',
      title: 'Elevador e andares',
      text: 'Cada andar é uma pasta de projeto, e quem você chama lá trabalha nela. Clique num andar para subir.',
      targets: [{ hud: 'floors' }],
      place: 'left',
    },
    {
      id: 'limits',
      title: 'Limites e contas',
      text: 'Veja quanto resta das janelas de 5h e da semana. Clique no card para os detalhes de cada conta.',
      targets: [{ hud: 'info' }],
      place: 'left',
    },
    {
      id: 'skull',
      title: 'A caveira',
      text: 'Clique na caveira para dispensar um agente. A sessão dele é encerrada.',
      targets: [{ world: 'skull' }],
      place: 'right',
    },
    {
      id: 'lounge',
      title: 'Lounge e TV',
      text: 'Agentes livres descansam aqui. Clique na TV para ligar a Claude FM.',
      targets: [{ world: 'tv' }],
      place: 'right',
    },
    {
      id: 'routines',
      title: 'Quadro de rotinas',
      text: 'Suas rotinas ficam neste quadro, aqui e na Diretoria de cada andar. Clique nele para ver e agendar.',
      targets: [{ world: 'routines' }],
      place: 'right',
    },
    {
      id: 'camera',
      title: 'Câmera',
      text: 'WASD ou setas andam, o botão direito arrasta e a roda dá zoom. A casinha leva você de volta à sua mesa.',
      targets: [{ hud: 'home' }],
      place: 'top',
    },
    {
      id: 'end',
      title: 'Pronto',
      text: 'Aperte ? para ver todos os atalhos e rever este tour.',
      targets: [],
      place: 'center',
    },
  ]
}

/** Keeps the steps whose target exists, each with the first target found. */
export function resolveSteps(steps: TourStep[], exists: (t: TourTarget) => boolean): ResolvedStep[] {
  return steps.flatMap((s): ResolvedStep[] => {
    if (!s.targets.length) return [{ ...s, target: null }]
    const target = s.targets.find(exists)
    return target ? [{ ...s, target }] : []
  })
}

export function tourDone(store: FlagStore): boolean {
  return store.getItem(TOUR_DONE_KEY) === '1'
}

export function markTourDone(store: FlagStore): void {
  try {
    store.setItem(TOUR_DONE_KEY, '1')
  } catch {
    // storage full or off: the tour shows again next time, nothing breaks
  }
}

/**
 * On boot: `start` now, `wait` until the card or window on screen closes, `never` when
 * the player has seen it. AGENT_OFFICE_TOUR=1 forces it.
 */
export function autoStart(o: { done: boolean; forced: boolean; blocked: boolean }): 'start' | 'wait' | 'never' {
  if (o.done && !o.forced) return 'never'
  return o.blocked ? 'wait' : 'start'
}

/** Where the tour is, and the flag once it ends (finished or skipped). */
export class TourFlow {
  index = 0
  ended: 'done' | 'skipped' | null = null

  constructor(
    readonly steps: ResolvedStep[],
    private store: FlagStore,
  ) {}

  get step(): ResolvedStep {
    return this.steps[this.index]
  }

  /** "3 de 12" */
  get label(): string {
    return `${this.index + 1} de ${this.steps.length}`
  }

  get first(): boolean {
    return this.index === 0
  }

  get last(): boolean {
    return this.index === this.steps.length - 1
  }

  /** False when it was the last step: the tour is over. */
  next(): boolean {
    if (this.ended) return false
    if (this.last) {
      this.finish('done')
      return false
    }
    this.index++
    return true
  }

  back(): boolean {
    if (this.ended || this.first) return false
    this.index--
    return true
  }

  skip(): void {
    if (!this.ended) this.finish('skipped')
  }

  private finish(how: 'done' | 'skipped'): void {
    this.ended = how
    markTourDone(this.store)
  }
}

export type Rect = { x: number; y: number; w: number; h: number }
type Side = Exclude<TourPlace, 'center'>
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/**
 * Where the balloon goes: on the preferred side of the target, else the opposite one,
 * else any side with room, else the middle of the window. Always inside the window.
 */
export function placeBalloon(
  target: Rect | null,
  size: { w: number; h: number },
  prefer: TourPlace,
  view: { w: number; h: number },
  gap = 14,
  margin = 12,
): { x: number; y: number; side: TourPlace } {
  const clampX = (x: number) => Math.round(Math.max(margin, Math.min(view.w - size.w - margin, x)))
  const clampY = (y: number) => Math.round(Math.max(margin, Math.min(view.h - size.h - margin, y)))
  const middle = { x: clampX((view.w - size.w) / 2), y: clampY((view.h - size.h) / 2), side: 'center' as const }
  if (!target || prefer === 'center') return middle
  const cx = target.x + target.w / 2 - size.w / 2
  const cy = target.y + target.h / 2 - size.h / 2
  const at: Record<Side, { x: number; y: number }> = {
    top: { x: cx, y: target.y - gap - size.h },
    bottom: { x: cx, y: target.y + target.h + gap },
    left: { x: target.x - gap - size.w, y: cy },
    right: { x: target.x + target.w + gap, y: cy },
  }
  const fits = (s: Side) => {
    const p = at[s]
    return s === 'top' || s === 'bottom' ? p.y >= margin && p.y + size.h <= view.h - margin : p.x >= margin && p.x + size.w <= view.w - margin
  }
  const order: Side[] = [prefer, OPPOSITE[prefer], ...(['bottom', 'top', 'right', 'left'] as Side[]).filter((s) => s !== prefer && s !== OPPOSITE[prefer])]
  const side = order.find(fits)
  return side ? { x: clampX(at[side].x), y: clampY(at[side].y), side } : middle
}
