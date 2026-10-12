import type { AgentSummary, SquadInfo, SquadMember } from '@shared/types'
import { helperActivity, lookFromSeed } from '@shared/describe'
import { Avatar } from '../world/avatar'
import * as L from '../world/layout'
import { Tag } from '../world/overlays'
import { GameSubagents } from './subagents'
import { clip, MEMBER_EXIT_S, MEMBER_MIN_S, SPAWN_POINT, SQUAD_SPEED, type Member } from './types'

/** Squad members: up the elevator, a desk in their sector, the delivery in the Diretoria, out. */
export abstract class GameSquads extends GameSubagents {
  // ---------- squad members ----------

  protected squadOf(a: AgentSummary): SquadInfo | undefined {
    return this.state.squads.find((q) => q.code === a.squad && q.cwd === a.cwd) ?? this.state.squads.find((q) => q.code === a.squad)
  }

  protected syncMembers(): void {
    const live = new Set<string>()
    for (const a of this.state.agents.values()) {
      if (a.role !== 'orchestrator' || !this.upperOf(this.homeFloor(a))) continue
      const parent = this.actors.get(a.id)
      if (!parent || parent.down || parent.goal === 'leave') continue
      const squad = this.squadOf(a)
      const find = (id: string): SquadMember =>
        squad?.members.find((m) => m.id === id) ?? { id, name: id, icon: '•', title: '', execution: 'subagent', sector: L.DEFAULT_SECTOR }
      for (const sub of a.subagents ?? []) {
        if (!sub.member) continue
        live.add(sub.id)
        const m = this.members.get(sub.id) ?? this.addMember(a, find(sub.member), sub.id, false)
        m.sub = sub
        this.memberBubble(m)
      }
      // Inline members have no subagent: the current step in state.json says who is on.
      const step = a.squadStep
      const busy = a.status === 'working' || a.status === 'starting' || a.status === 'waiting'
      const inline = step?.agent && step.status === 'running' && busy ? find(step.agent) : null
      if (inline && inline.execution === 'inline') {
        const id = `inline:${a.id}:${inline.id}`
        live.add(id)
        if (!this.members.has(id)) this.addMember(a, inline, id, true)
      }
    }
    for (const m of this.members.values()) {
      if (live.has(m.id) || m.endAt !== null) continue
      // Inline members just go; subagents show their delivery after a minimum stay.
      m.endAt = m.inline || !this.actors.has(m.parentId) ? this.time : Math.max(this.time, m.bornAt + MEMBER_MIN_S)
    }
    this.syncStepTags()
  }

  protected addMember(a: AgentSummary, info: SquadMember, id: string, inline: boolean): Member {
    // The same person every cycle: the look comes from the squad and the member id.
    const avatar = new Avatar(lookFromSeed(L.memberKey(a.squad ?? '', info.id)), `member:${id}`)
    avatar.floor = this.homeFloor(a)
    this.dress(avatar, a)
    avatar.speed = SQUAD_SPEED
    avatar.placeAt(SPAWN_POINT.x, SPAWN_POINT.z)
    avatar.face(0)
    this.engine.scene.add(avatar.root)
    const tag = this.overlays.add(new Tag(avatar.anchor, `${info.icon} ${info.name}`, false, () => this.memberClick(id)))
    tag.setDot('starting')
    const m: Member = { id, parentId: a.id, info, avatar, tag, inline, desk: null, tile: null, phase: 'arriving', bornAt: this.time, endAt: null, failed: null, sub: null, infoUntil: 0 }
    this.members.set(id, m)
    this.ding(avatar.floor)
    const arrive = () => {
      if (m.phase !== 'arriving') return
      m.phase = 'working'
      m.tag.setDot('working')
      this.memberPose(m)
      if (m.desk) this.floorOf(avatar.floor).deskScreens[m.desk.index]?.setMode('working')
    }
    if (inline) {
      const desk = this.directorDesk(a)
      if (desk) this.route(avatar, desk.sideApproach, desk.side, arrive)
      else arrive()
      return m
    }
    const spot = this.memberSpot(a, info)
    m.desk = spot.desk
    m.tile = spot.tile
    if (spot.desk) this.route(avatar, spot.desk.approach, spot.desk.seat, arrive)
    else if (spot.tile) this.route(avatar, spot.tile, null, arrive)
    else arrive()
    return m
  }

  /** A free desk in the member's sector; when all are taken, a free spot standing in the room. */
  protected memberSpot(a: AgentSummary, info: SquadMember): { desk: L.DeskSlot | null; tile: [number, number] | null } {
    const floor = this.homeFloor(a)
    const plan = this.upperOf(floor)!.scene.plan
    const name = plan.sectorOf.get(L.memberKey(a.squad ?? '', info.id)) ?? info.sector
    const room = plan.sectors.find((r) => r.name === name) ?? plan.sectors.find((r) => r.name === L.DEFAULT_SECTOR) ?? plan.sectors[0]
    if (!room) return { desk: null, tile: null }
    const taken = new Set<number>()
    const tiles = new Set<string>()
    for (const o of this.members.values()) {
      if (o.phase === 'leaving') continue
      if (o.desk) taken.add(o.desk.index)
      if (o.tile) tiles.add(o.tile.join(','))
    }
    const desk = room.desks.find((d) => !taken.has(d.index))
    if (desk) return { desk, tile: null }
    const grid = this.floorOf(floor).grid
    return { desk: null, tile: room.stand.find((t) => grid.walkable(t[0], t[1]) && !tiles.has(t.join(','))) ?? null }
  }

  protected memberPose(m: Member): void {
    const av = m.avatar
    if (av.isWalking || m.phase !== 'working') return
    if (m.inline) {
      const parent = this.actors.get(m.parentId)
      const a = this.state.agents.get(m.parentId)
      const desk = a && this.directorDesk(a)
      if (parent?.avatar.floor === av.floor) av.faceTowards(parent.avatar.position.x, parent.avatar.position.z)
      else if (desk) av.faceTowards(desk.seat.x, desk.seat.z)
      av.pose = 'sit'
    } else if (m.desk) {
      av.face(Math.PI)
      av.pose = 'type'
    } else {
      av.face(Math.PI)
      av.pose = 'stand'
    }
  }

  protected memberBubble(m: Member): void {
    if (m.failed) return m.tag.setBubble(`✗ ${clip(m.failed, 70)}`, 'error')
    if (this.time < m.infoUntil && m.sub) {
      const tokens = m.sub.tokens ? `${Math.round(m.sub.tokens / 1000)}k tokens` : ''
      return m.tag.setBubble([clip(m.sub.description, 50), tokens, m.sub.lastTool ?? ''].filter(Boolean).join(' · '), 'talk')
    }
    if (m.phase === 'delivering') return m.tag.setBubble('✓ Entregando', 'done')
    if (m.phase === 'leaving') return m.tag.setBubble(null)
    m.tag.setBubble(m.inline ? 'Neste passo com a Diretoria' : m.sub ? clip(m.sub.activity ? helperActivity(m.sub) : m.sub.description, 40) : null, 'work')
  }

  /** Click: what the member is doing (task, tokens, last tool) for a few seconds, and the orchestrator's panel. */
  protected memberClick(id: string): void {
    const m = this.members.get(id)
    if (!m) return
    m.infoUntil = this.time + 6
    this.memberBubble(m)
    this.hooks.onAgentClick(m.parentId, m.sub?.id)
  }

  /** The orchestrator reported a member failing: the bubble says why, then it leaves without delivering. */
  memberEnded(taskId: string, status: 'completed' | 'failed' | 'stopped', summary?: string): void {
    const m = this.members.get(taskId)
    if (!m || status === 'completed') return
    m.failed = status === 'failed' ? summary || 'Falhou.' : 'Interrompido.'
    m.tag.setDot('error')
    this.memberBubble(m)
    m.endAt = Math.min(m.endAt ?? Infinity, this.time + 4)
  }

  protected updateMembers(dt: number): void {
    for (const m of this.members.values()) {
      m.avatar.update(dt)
      if (m.infoUntil && this.time >= m.infoUntil) {
        m.infoUntil = 0
        this.memberBubble(m)
      }
      if (m.endAt === null || this.time < m.endAt) continue
      if (m.phase === 'arriving' || m.phase === 'working') this.memberDeliver(m)
      // safety net: nobody stays stuck on the floor
      else if (this.time > m.endAt + MEMBER_EXIT_S) this.memberGone(m)
    }
  }

  protected memberDeliver(m: Member): void {
    if (m.desk) this.floorOf(m.avatar.floor).deskScreens[m.desk.index]?.setMode(m.failed ? 'error' : 'done')
    m.avatar.pose = 'stand'
    m.avatar.seatY = 0
    const a = this.state.agents.get(m.parentId)
    const desk = a && this.directorDesk(a)
    if (m.failed || m.inline || !desk) return this.memberLeave(m)
    m.phase = 'delivering'
    m.tag.setDot('done')
    m.avatar.setProp('paper')
    this.memberBubble(m)
    const taken = new Set([...this.members.values()].filter((o) => o !== m && o.phase === 'delivering' && o.tile).map((o) => o.tile!.join(',')))
    const tile = desk.deliver.find((t) => !taken.has(t.join(','))) ?? desk.deliver[0]
    m.tile = tile
    this.route(m.avatar, tile, null, () => {
      m.avatar.faceTowards(desk.seat.x, desk.seat.z)
      m.avatar.pose = 'talk'
      setTimeout(() => {
        m.avatar.setProp('none')
        this.memberLeave(m)
      }, 1600)
    })
  }

  protected memberLeave(m: Member): void {
    if (m.phase === 'leaving') return
    m.phase = 'leaving'
    if (m.desk) {
      const screen = this.floorOf(m.avatar.floor).deskScreens[m.desk.index]
      setTimeout(() => screen?.setMode('off'), 2500)
    }
    m.desk = null
    m.tile = null
    if (!m.failed) this.memberBubble(m)
    this.route(m.avatar, L.SPAWN_TILE, SPAWN_POINT, () => {
      this.ding(m.avatar.floor)
      setTimeout(() => this.memberGone(m), 500)
    })
  }

  protected memberGone(m: Member): void {
    if (!this.members.has(m.id)) return
    this.members.delete(m.id)
    m.avatar.dispose()
    this.engine.scene.remove(m.avatar.root)
    this.overlays.remove(m.tag)
  }

  /** "Passo 3/6 · Texto" over the desk of each orchestrator, from squads/<code>/state.json. */
  protected syncStepTags(): void {
    this.uppers.forEach((u, i) => {
      const byDesk = this.directorsOn(i + 1)
      u.stepTags.forEach((tag, d) => {
        const st = byDesk.get(d)?.squadStep
        const text =
          st?.status === 'completed' ? '✓ Ciclo concluído' : st?.current ? `${st.type === 'checkpoint' ? '⏸' : '▸'} Passo ${st.current}/${st.total} · ${clip(st.label, 32)}` : 'Aguardando o próximo ciclo'
        tag.setName(text)
        tag.setDot(st?.type === 'checkpoint' && st.status !== 'completed' ? 'waiting' : st?.current && st.status !== 'completed' ? 'working' : 'idle')
      })
    })
  }
}
