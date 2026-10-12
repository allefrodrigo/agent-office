import { execFile } from 'node:child_process'

/**
 * Apps launched from Finder/Dock get a minimal PATH, so agents could not find
 * node, git, brew tools, etc. Read the PATH from the user's login shell once.
 * Windows GUI apps already inherit the user PATH, so this is a no-op there.
 */
export function loadShellPath(): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve()
  const shell = process.env.SHELL || '/bin/zsh'
  const marker = '__AGENT_OFFICE_PATH__'
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf "${marker}%s${marker}" "$PATH"`],
      { timeout: 4000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (err, stdout) => {
        if (!err) {
          const match = stdout.match(new RegExp(`${marker}(.*)${marker}`))
          if (match?.[1]) process.env.PATH = match[1]
        }
        resolve()
      },
    )
  })
}

/**
 * Variables a Claude Code session hands to the processes it starts. When the app is
 * opened from inside one (`open`, `npm run dev`), they leak in: CLAUDE_CONFIG_DIR would
 * point the main account at that session's login, and the rest would make agents think
 * they run inside it. Dropped at startup; each account sets its own CLAUDE_CONFIG_DIR.
 */
const INHERITED_CLAUDE_ENV = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_PLUGIN_DIRS',
  'AI_AGENT',
]

export function dropInheritedClaudeEnv(): void {
  for (const name of INHERITED_CLAUDE_ENV) delete process.env[name]
}
