/**
 * Interface texts that name something of the operating system (file manager,
 * task manager, shell). No imports, so `node --test` runs it as is.
 * darwin keeps the exact texts the app had before Windows support.
 */
export interface OsText {
  /** Tooltip of the folder path in the agent panel. */
  revealTitle: string
  /** Tooltip of the CPU bar in the System card. */
  cpuTitle: string
  /** Tooltip of the RAM bar in the System card. */
  ramTitle: string
  /** Tooltip of the "Agentes" line in the System card. */
  agentsTitle: string
  /** Body of the "Fechar sessão" confirmation; `folder` is the short path (last two parts). */
  closeSessionText: (folder: string) => string
  /** Toast after "Copiar comando" in the resume center. */
  copiedToast: string
}

const RESUME_HINT = 'A conversa fica salva: dá para voltar com claude --resume.'
const AGENTS_TITLE = 'Todos os processos claude: agentes do escritório e sessões do terminal'
const COPIED = 'Comando copiado. Cole no terminal.'
const closeGently = (folder: string): string =>
  `O Claude Code rodando no terminal em …/${folder} vai ser encerrado, como se você fechasse aquela aba.\n${RESUME_HINT}`

const DARWIN: OsText = {
  revealTitle: 'Mostrar no Finder',
  cpuTitle: 'Uso de CPU do Mac inteiro',
  ramTitle: 'Memória em uso, como no Monitor de Atividade',
  agentsTitle: AGENTS_TITLE,
  closeSessionText: closeGently,
  copiedToast: COPIED,
}

const WIN32: OsText = {
  revealTitle: 'Mostrar no Explorador',
  cpuTitle: 'Uso de CPU do computador inteiro',
  ramTitle: 'Memória em uso, como no Gerenciador de Tarefas',
  agentsTitle: 'Processos do Claude Code: agentes do escritório e sessões do terminal, sem o app Claude Desktop',
  closeSessionText: (folder) =>
    `O Claude Code rodando no terminal em …/${folder} vai ser encerrado na hora (o Windows não tem fechamento suave).\n${RESUME_HINT}`,
  copiedToast: 'Comando copiado para o PowerShell.',
}

/** Linux and anything else: neutral texts, no product names. */
const OTHER: OsText = {
  revealTitle: 'Mostrar na pasta',
  cpuTitle: 'Uso de CPU do computador inteiro',
  ramTitle: 'Memória em uso',
  agentsTitle: AGENTS_TITLE,
  closeSessionText: closeGently,
  copiedToast: COPIED,
}

export function osText(platform: string): OsText {
  return platform === 'darwin' ? DARWIN : platform === 'win32' ? WIN32 : OTHER
}

/** Same values as TerminalVia in shared/types.ts (kept local: this module has no imports). */
export type TerminalViaName = 'terminal-app' | 'windows-terminal' | 'console'

/** Toast after "Abrir no terminal" succeeds, by where the main process opened the session. */
export function terminalToast(via: TerminalViaName | undefined, platform: string): string {
  if (via === 'windows-terminal') return 'Abrindo a sessão no Windows Terminal.'
  if (via === 'console' || (via === undefined && platform !== 'darwin')) return 'Abrindo a sessão num terminal novo.'
  return 'Abrindo a sessão no Terminal.'
}

/** Toast when "Abrir no terminal" fails: the main process message, or a fallback by OS. */
export function terminalError(message: string | undefined, platform: string): string {
  return message ?? (platform === 'darwin' ? 'Não consegui abrir o Terminal.' : 'Não consegui abrir o terminal. Use "Copiar comando".')
}
