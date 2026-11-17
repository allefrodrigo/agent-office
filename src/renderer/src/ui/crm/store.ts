import { applyCrmDelta, crmWaiting } from '@shared/crm-view'
import type { CrmData, OfficeEvent } from '@shared/types'
import { crmError } from './util'

// O espelho do crm.json no renderer. Lê tudo com crmList() e segue o evento 'crm': itens no lugar
// pelo id, `removed`, as regras novas; `reload` (importação, restauração, demo) lê tudo de novo.
// Começa quando "CRM (prévia)" está ligado, para o botão "CRM" contar o que espera você.

type Listener = () => void

class CrmStore {
  data: CrmData | null = null
  /** Why crmList failed (a main process without the CRM, for one); null = fine. */
  error: string | null = null
  loaded = false
  private loading: Promise<void> | null = null
  private subscribed = false
  /** A delta that arrived while crmList was on its way: applied on top of the answer. */
  private early: OfficeEvent[] = []
  private inFlight = false
  private listeners = new Set<Listener>()
  private frame = 0

  /** Loads once and follows the events; later calls return the same promise. */
  start(): Promise<void> {
    if (!this.subscribed) {
      this.subscribed = true
      window.office.onEvent((e) => this.apply(e))
    }
    if (!this.loading) this.loading = this.reload()
    return this.loading
  }

  /** Reads everything again ("Tentar de novo", or a `reload` delta). */
  async reload(): Promise<void> {
    this.inFlight = true
    this.early = []
    try {
      let data = await window.office.crmList()
      for (const e of this.early) if (e.type === 'crm' && !e.delta.reload) data = applyCrmDelta(data, e.delta)
      this.data = data
      this.error = null
      this.loaded = true
    } catch (err) {
      this.error = crmError(err)
    } finally {
      this.inFlight = false
      this.early = []
    }
    this.changed()
  }

  /** Opening the screen after a failure tries again. */
  ensure(): Promise<void> {
    if (this.error && !this.inFlight) this.loading = this.reload()
    return this.start()
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Listeners run once per frame, however many events came in it. */
  private changed(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      for (const fn of this.listeners) fn()
    })
  }

  /** What waits for the player: the number on the "CRM" button. */
  waiting(): number {
    return crmWaiting(this.data)
  }

  /** Something the screen just saved: shown before the event brings it. */
  put(delta: Parameters<typeof applyCrmDelta>[1]): void {
    if (!this.data) return
    this.data = applyCrmDelta(this.data, delta)
    this.changed()
  }

  apply(e: OfficeEvent): void {
    if (e.type !== 'crm') return
    if (e.delta.reload) {
      void this.reload()
      return
    }
    if (this.inFlight) this.early.push(e)
    if (!this.data) return
    this.data = applyCrmDelta(this.data, e.delta)
    this.changed()
  }
}

export const crmStore = new CrmStore()
