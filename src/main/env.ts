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
