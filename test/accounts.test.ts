import { describe, expect, it, vi } from 'vitest'
import type { Account, Settings } from '@shared/types'
import { Accounts } from '../src/main/accounts'

const acc = (id: string): Account => ({ id, name: id.toUpperCase(), provider: 'claude', configDir: `/tmp/.claude-${id}`, color: '#fff' })

// QT is the agent's only account; MKT and FDW sit outside its pool.
function setup() {
  const settings = { accounts: [acc('qt'), acc('mkt'), acc('fdw')], projects: [], defaultAccounts: [] } as unknown as Settings
  return new Accounts(
    () => settings,
    () => [],
  )
}
const agent = { cwd: '/proj', accounts: ['qt'], account: 'qt' }

describe('Accounts.pick with a borrowed account', () => {
  it('stays in the pool while it has room', () => {
    expect(setup().pick(agent, 'mkt').id).toBe('qt')
  })

  it('takes the borrowed account while the pool is out', () => {
    const accounts = setup()
    accounts.limitHit('qt', Date.now() + 60_000)
    expect(accounts.pick(agent, 'mkt').id).toBe('mkt')
  })

  it('skips a borrowed account that is out too', () => {
    const accounts = setup()
    accounts.limitHit('qt', Date.now() + 60_000)
    accounts.limitHit('mkt', Date.now() + 60_000)
    expect(accounts.pick(agent, 'mkt').id).toBe('qt')
  })

  it('goes back to the pool once it renews', () => {
    vi.useFakeTimers()
    const accounts = setup()
    accounts.limitHit('qt', Date.now() + 60_000)
    vi.advanceTimersByTime(61_000)
    expect(accounts.pick({ ...agent, account: 'mkt' }, 'mkt').id).toBe('qt')
    vi.useRealTimers()
  })
})
