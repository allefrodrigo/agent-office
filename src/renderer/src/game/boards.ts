import type { ProjectFloor } from '@shared/types'
import { accountPool } from '@shared/accounts'
import { projectFor } from '@shared/projects'
import { routinesView } from '@shared/routines'
import type { Office } from '../world/office'
import type { UpperFloor } from '../world/upper-floor'
import type { Tag } from '../world/overlays'
import { money } from '../world/props'
import { GameFloors } from './floors'

/** Spending boards, routines boards and limit alarms of every floor. */
export abstract class GameBoards extends GameFloors {
  // ---------- spending boards and limit alarms ----------

  /** Accounts at a plan limit, with when they come back (if known). */
  protected limitedAccounts(): Map<string, number | undefined> {
    const now = Date.now()
    const out = new Map<string, number | undefined>()
    for (const st of this.state.accounts) if (st.limitedUntil && st.limitedUntil > now) out.set(st.id, st.limitedUntil)
    for (const u of this.state.usage) {
      const full = u.windows.find((w) => w.percent >= 100 && (!w.resetsAt || w.resetsAt > now))
      if (full && !out.has(u.accountId)) out.set(u.accountId, full.resetsAt)
    }
    return out
  }

  /**
   * Each floor's board adds up what was spent today in its folder (the ground floor: every folder);
   * its alarm goes off while an account it runs on is at its limit (the ground floor: any).
   */
  protected syncBoards(): void {
    this.boardsIn = 5
    const limited = this.limitedAccounts()
    const floors: [Office, Tag, Tag, ProjectFloor | null][] = [
      [this.office, this.alarmTag, this.moneyTag, null],
      ...this.uppers.map((u): [UpperFloor, Tag, Tag, ProjectFloor] => [u.scene, u.alarmTag, u.moneyTag, u.project]),
    ]
    // Today's spend from the cost book: dismissing an agent keeps it, midnight zeroes it.
    const today = this.state.ledgerToday
    const floorOfCwd = (cwd: string) => {
      const id = projectFor(this.state.settings.projects, cwd)?.id
      return id ? this.uppers.findIndex((u) => u.project.id === id) + 1 : 0
    }
    const spenders = Object.values(today.agents)
    floors.forEach(([scene, tag, moneyTag, project], n) => {
      const total = Object.entries(today.costByCwd).reduce((sum, [cwd, usd]) => (n === 0 || floorOfCwd(cwd) === n ? sum + usd : sum), 0)
      const top = spenders.filter((a) => n === 0 || floorOfCwd(a.cwd) === n).sort((a, b) => b.usd - a.usd).slice(0, 8)
      scene.money.set(total, top.map((a) => ({ name: a.name, usd: a.usd })))
      moneyTag.setName(`${money(total)} hoje`)
      moneyTag.el.title = top.filter((a) => a.usd >= 0.005).map((a) => `${a.name}: ${money(a.usd)}`).join('\n') || 'Ninguém gastou nada hoje'
      const pool = project ? accountPool(this.state.settings, project.cwd) : [...limited.keys()]
      const hit = pool.filter((id) => limited.has(id))
      scene.alarm.setOn(hit.length > 0)
      if (!hit.length) return
      const names = hit.map((id) => this.state.account(id)?.name ?? id).join(', ')
      const back = hit.map((id) => limited.get(id)).filter((t): t is number => !!t).sort((a, b) => a - b)[0]
      const clock = back ? ` · volta ${new Date(back).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''
      tag.setName(`${hit.length > 1 ? 'Contas' : 'Conta'} ${names} no limite${clock}`)
    })
  }

  // ---------- routines boards ----------

  /**
   * Every floor's routines board shows the same thing: the next routine of the whole
   * office and the LED. The text is worked out once a second and each canvas is drawn
   * only when it changed (the countdown moves once a minute above one minute).
   */
  protected updateRoutines(dt: number): void {
    this.routinesIn -= dt
    if (this.routinesIn > 0) return
    this.routinesIn = 1
    const view = routinesView(this.state.routines, Date.now(), this.state.macJobs)
    const floors: [Office, Tag][] = [[this.office, this.routinesTag], ...this.uppers.map((u): [Office, Tag] => [u.scene, u.routinesTag])]
    floors.forEach(([scene, tag], n) => {
      // the tag is HTML: it only touches the DOM when its text changes
      tag.setDot(`routine-${view.led}`)
      // the board is pixel art: the balloon carries the line in letters people can read
      tag.setBubble(view.line, view.led === 'wait' ? 'wait' : 'idle')
      if (tag.el.title !== view.line) tag.el.title = view.line
      if (scene.routines.show(view) && n === this.player.floor) this.wake(100)
    })
  }
}
