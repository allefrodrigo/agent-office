/**
 * User-facing texts about the Claude Code install. Kept apart from agents.ts so
 * `node --test` can load it: this module imports nothing (agents.ts pulls in the
 * SDK and the `@shared` alias, which plain Node cannot resolve).
 */

/** Text delivered when Claude Code is missing, with the install command for this OS. */
export function claudeNotFoundMessage(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    // PowerShell is the default shell on Windows; the .sh installer does not run there.
    return (
      'Não encontrei o Claude Code neste computador.\n\n' +
      'Instale no PowerShell com `irm https://claude.ai/install.ps1 | iex`, ' +
      'faça login rodando `claude` uma vez e tente de novo.'
    )
  }
  // macOS/Linux: unchanged text (NFR-1, compared byte for byte in the tests).
  return (
    'Não encontrei o Claude Code neste computador.\n\n' +
    'Instale com `curl -fsSL https://claude.ai/install.sh | bash` (macOS/Linux) ou veja https://code.claude.com/docs, ' +
    'faça login rodando `claude` uma vez no terminal e tente de novo.'
  )
}
