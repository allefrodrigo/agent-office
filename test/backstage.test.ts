import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk'
import {
  childrenOf,
  commandLabel,
  isClaude,
  kindOf,
  mainPorts,
  OrphanBook,
  parseEtime,
  parseListen,
  parsePs,
  sessionOf,
  shellCommand,
  shellsUnder,
  taskOutputCandidates,
} from '../src/main/backstage/procs'
import { findSkills, mergeMcp, mergeSkills, serverKey, skillDescription, ToolsDesk } from '../src/main/backstage/tools'
import { parseLine, useKey } from '../src/main/stats/parse'

const NOW = Date.UTC(2026, 9, 15, 16, 0, 0)
const SID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
// What Claude Code's Bash tool runs, as ps prints it (newlines as \012).
const wrap = (cmd: string) =>
  `/bin/zsh -c source /Users/ana/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && setopt NO_EXTENDED_GLOB 2>/dev/null || true && { \\builtin unalias -- 'unsetenv'; } >/dev/null 2>&1 || true && eval '${cmd}' && pwd -P >| /tmp/claude-1a2b-cwd`

describe('procs: reading ps and lsof', () => {
  it('reads elapsed times', () => {
    expect(parseEtime('05')).toBeNull()
    expect(parseEtime('12:05')).toBe(725)
    expect(parseEtime('19:26:07')).toBe(19 * 3600 + 26 * 60 + 7)
    expect(parseEtime('2-01:00:00')).toBe(2 * 86400 + 3600)
  })

  it('parses ps lines and keeps args with spaces', () => {
    const rows = parsePs(
      [
        '  100     1     1-00:00:00  0.5  4000 /Users/ana/.local/bin/claude --resume=' + SID,
        '  200   100        00:30  0.0  1000 /bin/zsh -c echo hi',
        'garbage',
      ].join('\n'),
      NOW,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ pid: 100, ppid: 1, cpu: 0.5, rss: 4000, startedAt: NOW - 86_400_000 })
    expect(rows[1].args).toBe('/bin/zsh -c echo hi')
  })

  it('knows a claude CLI from the Chrome bridge', () => {
    expect(isClaude('claude')).toBe(true)
    expect(isClaude('/Users/ana/.local/bin/claude --output-format stream-json')).toBe(true)
    expect(isClaude('/Users/ana/.local/bin/claude --chrome-native-host')).toBe(false)
    expect(isClaude('/usr/bin/claudette')).toBe(false)
  })

  it('finds the session of an office CLI', () => {
    expect(sessionOf(`claude --resume=${SID} --verbose`)).toBe(SID)
    expect(sessionOf(`claude --session-id ${SID}`)).toBe(SID)
    expect(sessionOf('claude')).toBeUndefined()
  })

  it('takes the command out of the shell wrapper', () => {
    expect(shellCommand(wrap('npm run dev'))).toBe('npm run dev')
    expect(shellCommand(wrap(`grep '"'"'a b'"'"' x.txt\\012echo done`))).toBe("grep 'a b' x.txt\necho done")
    expect(shellCommand('/bin/zsh -c npm run dev')).toBeNull()
  })

  it('reads listening ports per process', () => {
    const map = parseListen(['p300', 'f12', 'n*:8787', 'n[::1]:8787', 'p301', 'n127.0.0.1:5173'].join('\n'))
    expect(map.get(300)).toEqual([8787])
    expect(map.get(301)).toEqual([5173])
  })

  it('labels a command without the output redirect Claude Code adds', () => {
    expect(commandLabel('npm run dev > /private/tmp/claude-501/-Users-ana-site/abc/tasks/b1.output 2>&1 &')).toBe('npm run dev')
    expect(commandLabel('\n  echo one\necho two')).toBe('echo one')
  })

  it('shows the ports a person opens, not the internal ones', () => {
    expect(mainPorts([61092, 8787, 9229, 58333, 8787])).toEqual([8787, 9229])
    expect(mainPorts([61092, 58333])).toEqual([58333, 61092])
  })

  it('names what a process is', () => {
    expect(kindOf('npm run dev', [5173])).toBe('server')
    expect(kindOf('tail -F logs/worker.log', [])).toBe('monitor')
    expect(kindOf('vitest --watch', [])).toBe('monitor')
    expect(kindOf('sleep 30', [])).toBe('shell')
    expect(kindOf('review the diff', [], 'local_agent')).toBe('helper')
  })

  it('collects each shell of a claude with its children', () => {
    const rows = parsePs(
      [
        `  100     1   1:00:00 0.0 300000 claude --resume=${SID}`,
        `  200   100     30:00 0.0   2000 ${wrap('npm run dev')}`,
        '  201   200     30:00 1.0  50000 node vite',
        `  210   100     00:05 0.0   1000 /Users/ana/.npm/bin/some-mcp-server`,
      ].join('\n'),
      NOW,
    )
    const found = shellsUnder(100, childrenOf(rows))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ command: 'npm run dev', pids: expect.arrayContaining([200, 201]), rss: 52000, cpu: 1 })
  })
})

describe('procs: orphans', () => {
  const scan = (lines: string[], now = NOW) => {
    const rows = parsePs(lines.join('\n'), now)
    return { rows, kids: childrenOf(rows), byPid: new Map(rows.map((r) => [r.pid, r])) }
  }
  const owner = { kind: 'office' as const, name: 'Turing', agentId: 'a1' }

  it('a process left after its claude is gone becomes an orphan, named by its owner', () => {
    const book = new OrphanBook()
    const first = scan([
      `  100     1   1:00:00 0.0 1 claude --resume=${SID}`,
      `  200   100     30:00 0.0 1 ${wrap('npm run dev')}`,
      '  201   200     30:00 0.0 9 node vite',
    ])
    for (const f of shellsUnder(100, first.kids)) book.note(f, owner, first.byPid)
    expect(book.orphans(first.rows, new Set([200, 201]), first.kids)).toEqual([])

    // The agent was fired: claude and its shell ended, vite went on under launchd.
    const later = scan(['  201     1     30:05 0.0 9 node vite'], NOW + 5000)
    const orphans = book.orphans(later.rows, new Set(), later.kids)
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({ owner: { kind: 'gone', name: 'Turing' }, command: 'node vite', pids: [201] })
  })

  it('a reused pid is not mistaken for the old process', () => {
    const book = new OrphanBook()
    const first = scan([`  100     1   1:00:00 0.0 1 claude --resume=${SID}`, `  200   100     30:00 0.0 1 ${wrap('sleep 999')}`])
    for (const f of shellsUnder(100, first.kids)) book.note(f, owner, first.byPid)
    const reused = scan(['  200     1     00:03 0.0 1 /usr/bin/something-else'], NOW + 5000)
    expect(book.orphans(reused.rows, new Set(), reused.kids)).toEqual([])
  })

  it('only builds output paths from a valid session and task id', () => {
    const list = () => ['-Users-ana-site']
    expect(taskOutputCandidates(['/tmp'], 501, list, SID, 'bx12ab')).toEqual([`/tmp/claude-501/-Users-ana-site/${SID}/tasks/bx12ab.output`])
    expect(taskOutputCandidates(['/tmp'], 501, list, '../etc', 'bx12ab')).toEqual([])
    expect(taskOutputCandidates(['/tmp'], 501, list, SID, '../../passwd')).toEqual([])
  })
})

describe('tools: MCP and skills', () => {
  const st = (name: string, status: string, extra: Partial<McpServerStatus> = {}) => ({ name, status, ...extra }) as McpServerStatus

  it('reads a skill description in every YAML form', () => {
    expect(skillDescription('---\nname: a\ndescription: Faz algo útil\n---\n# A')).toBe('Faz algo útil')
    expect(skillDescription('---\ndescription: "Com aspas: sim"\n---')).toBe('Com aspas: sim')
    expect(skillDescription('---\ndescription: >\n  Linha um\n  linha dois\nother: x\n---')).toBe('Linha um linha dois')
    expect(skillDescription('# sem front matter')).toBeUndefined()
  })

  it('keys usage the way tool names carry the server', () => {
    expect(serverKey('claude.ai Notion')).toBe('claude_ai_Notion')
    expect(useKey({ name: 'mcp__claude_ai_Notion__search' })).toBe('mcp:claude_ai_Notion')
    expect(useKey({ name: 'Skill', input: { skill: 'pdf' } })).toBe('skill:pdf')
    expect(useKey({ name: 'Bash' })).toBeNull()
  })

  it('merges the CLIs: the best status wins, usage joins by key, office stays on', () => {
    const usage = new Map([
      ['mcp:claude_ai_Notion', { n: 3, last: '2026-10-14' }],
      ['mcp:office', { n: 40, last: '2026-10-15' }],
      ['mcp:old-server', { n: 1, last: '2026-10-10' }],
    ])
    const rows = mergeMcp(
      [
        [
          st('office', 'connected', { tools: [{ name: 't' }] as McpServerStatus['tools'] }),
          st('claude.ai Notion', 'failed', { error: 'boom' }),
          st('sentry', 'connected'),
        ],
        [st('office', 'connected'), st('claude.ai Notion', 'connected')],
      ],
      [],
      usage,
      ['sentry'],
    )
    const by = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(rows[0].name).toBe('office')
    expect(by.office).toMatchObject({ locked: true, agents: 2, uses: 40, tools: 1 })
    expect(by['claude.ai Notion']).toMatchObject({ status: 'connected', uses: 3, agents: 2 })
    expect(by.sentry).toMatchObject({ off: true, status: 'disabled' })
    expect(by['old-server']).toMatchObject({ status: 'unknown', uses: 1 })
  })

  it('finds skills on disk once and joins their use, plugin skills by their full name', () => {
    const root = mkdtempSync(join(tmpdir(), 'ao-skills-'))
    const mk = (dir: string, name: string, desc: string) => {
      mkdirSync(join(root, dir, name), { recursive: true })
      writeFileSync(join(root, dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n`)
    }
    mk('user', 'release-notes', 'Escreve as notas')
    mk('plug/skills', 'chrome', 'Usa o Chrome')
    const found = findSkills([
      { dir: join(root, 'user'), source: 'user' },
      { dir: join(root, 'user'), source: 'user' },
      { dir: join(root, 'plug/skills'), source: 'plugin', plugin: 'tools' },
      { dir: join(root, 'missing'), source: 'project' },
    ])
    expect(found.map((s) => s.name).sort()).toEqual(['chrome', 'release-notes'])
    const usage = new Map([
      ['skill:tools:chrome', { n: 2, last: '2026-10-13' }],
      ['skill:release-notes', { n: 5, last: '2026-10-15' }],
      ['skill:simplify', { n: 1, last: '2026-10-12' }],
    ])
    const rows = mergeSkills(
      found,
      ['simplify', 'release-notes'],
      [{ name: 'simplify', description: 'Limpa o código', argumentHint: '' }],
      usage,
    )
    expect(rows.map((r) => [r.name, r.uses, r.source])).toEqual([
      ['release-notes', 5, 'user'],
      ['chrome', 2, 'plugin'],
      ['simplify', 1, 'builtin'],
    ])
    expect(rows[2].description).toBe('Limpa o código')
  })

  it('turns a plugin off keeping the rest of settings.json', () => {
    const home = mkdtempSync(join(tmpdir(), 'ao-home-'))
    mkdirSync(join(home, '.claude'), { recursive: true })
    const file = join(home, '.claude', 'settings.json')
    writeFileSync(file, JSON.stringify({ hooks: { Stop: [] }, enabledPlugins: { 'a@m': true, 'b@m': false } }))
    const desk = new ToolsDesk(
      {
        live: () => [],
        mcpStatus: async () => [],
        commands: async () => [],
        usage: async () => ({ uses: new Map(), since: '2026-10-09', reading: false }),
        settings: () => ({ accounts: [], projects: [] }) as never,
      },
      home,
    )
    desk.setPlugin('a@m', false)
    const after = JSON.parse(readFileSync(file, 'utf8'))
    expect(after).toEqual({ hooks: { Stop: [] }, enabledPlugins: { 'a@m': false, 'b@m': false } })
    expect(() => desk.setPlugin('not-installed@x', true)).toThrow()
  })
})

describe('stats: skill and MCP calls in the transcripts', () => {
  it('a line counts each Skill and MCP call it makes', () => {
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: SID,
      timestamp: '2026-10-15T12:00:00Z',
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          { type: 'tool_use', name: 'Skill', input: { skill: 'pdf' } },
          { type: 'tool_use', name: 'mcp__office__ticket_get', input: {} },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    })
    expect(parseLine(line)?.uses).toEqual(['skill:pdf', 'mcp:office'])
  })
})
