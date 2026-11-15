import { describe, expect, it } from 'vitest'
import type { HookCallbackMatcher, HookInput } from '@anthropic-ai/claude-agent-sdk'
import { appAllowed, appsHook, cliMode, guardHook, heldKind, modeAllows } from '../src/main/bots/guard'
import { SENSITIVE_KINDS } from '../src/shared/types/bots'

/** Runs the first hook of a matcher list as the CLI would, for a PreToolUse call. */
async function fire(matchers: HookCallbackMatcher[], tool: string, toolInput: unknown, mcp?: { name: string; source: string }) {
  const input = {
    hook_event_name: 'PreToolUse',
    session_id: 's',
    transcript_path: '/tmp/t',
    cwd: '/tmp',
    tool_name: tool,
    tool_input: toolInput,
    tool_use_id: 'u1',
    ...(mcp ? { mcp_server: mcp } : {}),
  } as unknown as HookInput
  return matchers[0].hooks[0](input, 'u1', { signal: new AbortController().signal })
}

describe('guardHook', () => {
  it('answers ask with the reason for a sensitive call', async () => {
    const out = await fire(guardHook(() => SENSITIVE_KINDS), 'Bash', { command: 'git push origin main' })
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'Git remoto: git push origin main' } })
  })

  it('says nothing for a call that is not sensitive, or a kind the bot does not hold', async () => {
    expect(await fire(guardHook(() => SENSITIVE_KINDS), 'Bash', { command: 'npm test' })).toEqual({})
    expect(await fire(guardHook(() => ['send']), 'Bash', { command: 'git push' })).toEqual({})
    expect(await fire(guardHook(() => []), 'Bash', { command: 'git push' })).toEqual({})
  })

  it('reads the kinds on every call', async () => {
    let kinds: ('push' | 'send')[] = []
    const hook = guardHook(() => kinds)
    expect(await fire(hook, 'Bash', { command: 'git push' })).toEqual({})
    kinds = ['push']
    expect(await fire(hook, 'Bash', { command: 'git push' })).toHaveProperty('hookSpecificOutput.permissionDecision', 'ask')
  })

  it('trusts the office server only from the app (source sdk)', async () => {
    const hook = guardHook(() => SENSITIVE_KINDS)
    expect(await fire(hook, 'mcp__office__delete_ticket', {}, { name: 'office', source: 'sdk' })).toEqual({})
    expect(await fire(hook, 'mcp__office__delete_ticket', {}, { name: 'office', source: 'project' })).toHaveProperty('hookSpecificOutput.permissionDecision', 'ask')
  })

  it('ignores other hook events', async () => {
    const out = await guardHook(() => SENSITIVE_KINDS)[0].hooks[0]({ hook_event_name: 'Stop' } as unknown as HookInput, undefined, { signal: new AbortController().signal })
    expect(out).toEqual({})
  })
})

describe('appsHook', () => {
  it('denies a connection the bot was not given, with what to do', async () => {
    const out = await fire(appsHook(() => ['gmail']), 'mcp__slack__post_message', {}, { name: 'slack', source: 'user' })
    expect(out).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny')
    expect(JSON.stringify(out)).toContain('perfil do bot')
  })

  it('lets through the ticked ones, the office and every tool that is not MCP', async () => {
    const hook = appsHook(() => ['gmail'])
    expect(await fire(hook, 'mcp__gmail__search', {}, { name: 'gmail', source: 'user' })).toEqual({})
    expect(await fire(hook, 'mcp__office__tickets_list', {}, { name: 'office', source: 'sdk' })).toEqual({})
    expect(await fire(hook, 'Bash', { command: 'ls' })).toEqual({})
    expect(await fire(appsHook(() => 'all'), 'mcp__slack__post', {})).toEqual({})
  })

  it('appAllowed: a configured server called office is not the office', () => {
    expect(appAllowed([], 'mcp__office__x', { name: 'office', source: 'user' })).toBe(false)
    expect(appAllowed([], 'mcp__office__x')).toBe(true)
    expect(appAllowed(['gmail'], 'mcp__gmail__send_email')).toBe(true)
    expect(appAllowed(['gmail'], 'mcp__gmail')).toBe(true)
    expect(appAllowed(['gmail'], 'Read')).toBe(true)
  })
})

describe('heldKind', () => {
  it('only the kinds the bot holds', () => {
    expect(heldKind('Bash', { command: 'rm -rf dist && git push' }, ['delete'])).toBe('delete')
    expect(heldKind('Bash', { command: 'rm -rf dist && git push' }, SENSITIVE_KINDS)).toBe('push')
    expect(heldKind('Bash', { command: 'git push' }, [])).toBeNull()
  })
})

describe('cliMode e modeAllows', () => {
  it('never runs a bot in bypassPermissions', () => {
    expect(cliMode('bypassPermissions', false)).toBe('default')
    expect(cliMode('bypassPermissions', true)).toBe('default')
    expect(cliMode('auto', false)).toBe('auto')
    expect(cliMode('acceptEdits', false)).toBe('acceptEdits')
    expect(cliMode('plan', false)).toBe('plan')
  })

  it('fallback: the CLI asks and the office lets through what the mode would have', () => {
    expect(cliMode('auto', true)).toBe('default')
    expect(cliMode('acceptEdits', true)).toBe('default')
    expect(modeAllows('auto', 'Bash', true)).toBe(true)
    expect(modeAllows('acceptEdits', 'Edit', true)).toBe(true)
    expect(modeAllows('acceptEdits', 'Bash', true)).toBe(false)
    expect(modeAllows('default', 'Edit', true)).toBe(false)
    expect(modeAllows('auto', 'AskUserQuestion', true)).toBe(false)
    expect(modeAllows('auto', 'ExitPlanMode', true)).toBe(false)
  })

  it('without the fallback, the office never allows on its own', () => {
    expect(modeAllows('auto', 'Bash', false)).toBe(false)
  })
})
