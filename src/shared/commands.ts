/** Same check as `isSessionId` in main/sessions.ts (kept here so this module has no imports). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONTROL = /[\u0000-\u001f\u007f]/
/** ' and the typographic quotes ‘ ’ ‚ ‛, all read by PowerShell as a single quote. */
const PS_QUOTES = /['‘’‚‛]/g

/**
 * Command the user pastes to resume a session in the OS default shell.
 * darwin/linux: `cd '<cwd>' && claude --resume <id>` (same as v0.2.0).
 * win32 (Windows PowerShell 5.1): `Set-Location -LiteralPath '<cwd>'; claude --resume <id>`,
 * with ' and ‘ ’ ‚ ‛ doubled; -LiteralPath keeps [ ] * in folder names from acting as wildcards.
 * No cwd, or a cwd with a control character (a pasted newline would run early): only
 * `claude --resume <id>`. A sessionId that is not a UUID gives ''.
 */
export function resumeCommand(platform: string, cwd: string | undefined, sessionId: string): string {
  if (!UUID.test(sessionId)) return ''
  const resume = `claude --resume ${sessionId}`
  if (!cwd || CONTROL.test(cwd)) return resume
  if (platform === 'win32') return `Set-Location -LiteralPath '${cwd.replace(PS_QUOTES, (q) => q + q)}'; ${resume}`
  return `cd '${cwd.replace(/'/g, `'\\''`)}' && ${resume}`
}
