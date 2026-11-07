// Meeting room, system audio on macOS (ADR 0011): the Swift helper (native/system-audio/tap.swift)
// writes 16 kHz mono s16le to stdout and one JSON line per event to stderr. This file holds
// the pure parts: the helper's arguments, the stderr parser, the macOS version gate and
// where the binary lives. src/main/meetings/system-audio.ts runs the process.

/** File name of the helper, in resources/bin (dev) or Contents/Resources/bin (packaged). */
export const SYSTEM_AUDIO_BIN = 'system-audio-tap'
/** The helper's PCM: 16 kHz, mono, signed 16-bit little endian. */
export const SYSTEM_AUDIO_RATE = 16_000
export const SYSTEM_AUDIO_BYTES_PER_SECOND = SYSTEM_AUDIO_RATE * 2
/** No 'ready' by now: macOS is probably showing the permission prompt. */
export const SYSTEM_AUDIO_PERMISSION_HINT_MS = 2_000
/** Gives up on the start after this long (the first prompt took ~27 s in the spike). */
export const SYSTEM_AUDIO_READY_TIMEOUT_MS = 45_000
/** After SIGTERM, how long the helper gets to tear the tap down before SIGKILL. */
export const SYSTEM_AUDIO_KILL_AFTER_MS = 2_000
/** Where the user turns the permission on (Privacy > Screen & System Audio Recording). */
export const SYSTEM_AUDIO_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

/** What the helper reports on stderr, camelCased. Only numbers and fixed names: never audio. */
export type SystemAudioEvent =
  | { event: 'format'; inRate: number; inChannels: number; inBits: number }
  /** The tap is running. startupMs is long on the first run, while the permission prompt is open. */
  | { event: 'ready'; startupMs: number; excluded: number }
  /** Once per second of audio. rmsDbfs is -120 for digital silence. */
  | { event: 'level'; sec: number; rmsDbfs: number; peak: number; allZero: boolean }
  /** The excluded process list changed (an app helper started playing audio). */
  | { event: 'excluded'; count: number }
  /**
   * all_zero: `seconds` of exact zeros. Nothing is playing, or the permission was denied
   * (macOS hands out silence, not an error). no_callbacks: no buffer at all.
   */
  | { event: 'warning'; kind: 'all_zero' | 'no_callbacks'; seconds: number; everNonzero?: boolean }
  | { event: 'error'; step: string; osstatus: number }
  | {
      event: 'summary'
      reason: string
      outSeconds: number
      allZero: boolean
      zeroSeconds: number
      convErrors: number
      permissionSuspect: boolean
      uptimeMs: number
    }
  /** The tap, aggregate device and IO proc are gone; ok = every Core Audio call returned 0. */
  | { event: 'teardown'; ok: boolean }

/** Events from SystemAudioCapture itself, on top of the helper's. */
export type SystemAudioStatus =
  | SystemAudioEvent
  /** No 'ready' after SYSTEM_AUDIO_PERMISSION_HINT_MS: show "Aguardando a permissão do macOS". */
  | { event: 'waiting-permission' }
  | { event: 'exit'; code: number | null; signal: string | null }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && /^[a-z_]{1,40}$/.test(v) ? v : undefined)

/** One stderr line into an event; null for anything else (a crash trace, a partial line). */
export function parseStatusLine(line: string): SystemAudioEvent | null {
  const text = line.trim()
  if (!text.startsWith('{')) return null
  let o: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    o = parsed as Record<string, unknown>
  } catch {
    return null
  }
  switch (o.event) {
    case 'format': {
      const inRate = num(o.in_rate)
      const inChannels = num(o.in_channels)
      const inBits = num(o.in_bits)
      return inRate !== undefined && inChannels !== undefined && inBits !== undefined ? { event: 'format', inRate, inChannels, inBits } : null
    }
    case 'ready':
      return { event: 'ready', startupMs: num(o.startup_ms) ?? 0, excluded: num(o.excluded) ?? 0 }
    case 'level': {
      const sec = num(o.sec)
      const rmsDbfs = num(o.rms_dbfs)
      const peak = num(o.peak)
      if (sec === undefined || rmsDbfs === undefined || peak === undefined) return null
      return { event: 'level', sec, rmsDbfs, peak, allZero: o.all_zero === true }
    }
    case 'excluded': {
      const count = num(o.count)
      return count === undefined ? null : { event: 'excluded', count }
    }
    case 'warning': {
      if (o.kind !== 'all_zero' && o.kind !== 'no_callbacks') return null
      const ev: SystemAudioEvent = { event: 'warning', kind: o.kind, seconds: num(o.seconds) ?? 0 }
      if (typeof o.ever_nonzero === 'boolean') ev.everNonzero = o.ever_nonzero
      return ev
    }
    case 'error':
      return { event: 'error', step: str(o.step) ?? 'unknown', osstatus: num(o.osstatus) ?? 0 }
    case 'summary':
      return {
        event: 'summary',
        reason: str(o.reason) ?? 'unknown',
        outSeconds: num(o.out_seconds) ?? 0,
        allZero: o.all_zero === true,
        zeroSeconds: num(o.zero_seconds) ?? 0,
        convErrors: num(o.conv_errors) ?? 0,
        permissionSuspect: o.permission_suspect === true,
        uptimeMs: num(o.uptime_ms) ?? 0,
      }
    case 'teardown': {
      const steps = o.osstatus && typeof o.osstatus === 'object' ? Object.values(o.osstatus as Record<string, unknown>) : []
      return { event: 'teardown', ok: steps.every((s) => s === 0) }
    }
    default:
      return null
  }
}

/** Longest stderr line kept while waiting for its newline; the helper's are ~250 bytes. */
const MAX_LINE = 4096

/** Splits stderr chunks into whole lines; the tail waits for the next chunk. */
export class LineSplitter {
  private rest = ''

  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split('\n')
    this.rest = parts.pop() ?? ''
    if (this.rest.length > MAX_LINE) this.rest = ''
    return parts.filter((l) => l.trim())
  }

  /** What is left when the stream ends. */
  end(): string[] {
    const last = this.rest.trim()
    this.rest = ''
    return last ? [last] : []
  }
}

/** Biggest pid_t. */
const MAX_PID = 2 ** 31 - 1

export interface SystemAudioArgsInput {
  /** Processes kept out of the tap, with their direct children (the app's main and helpers). */
  excludePids?: readonly number[]
  /** Stops by itself after this much audio. */
  seconds?: number
}

/**
 * The helper's argv (spawned without a shell). Invalid PIDs are dropped, repeats merged.
 * --exit-on-stdin-eof always: if the app dies without stopping it, the helper goes too.
 */
export function buildSystemAudioArgs(input: SystemAudioArgsInput = {}): string[] {
  const args: string[] = []
  const pids = new Set((input.excludePids ?? []).filter((p) => Number.isInteger(p) && p > 0 && p <= MAX_PID))
  for (const pid of [...pids].sort((a, b) => a - b)) args.push('--exclude-pid', String(pid))
  if (input.seconds !== undefined && Number.isFinite(input.seconds) && input.seconds > 0) args.push('--seconds', String(input.seconds))
  args.push('--exit-on-stdin-eof')
  return args
}

/** Process taps need macOS 14.2, which is Darwin 23.2 (os.release()). */
export function darwinSupportsTap(release: string): boolean {
  const m = /^(\d+)\.(\d+)/.exec(release.trim())
  if (!m) return false
  const major = Number(m[1])
  const minor = Number(m[2])
  return major > 23 || (major === 23 && minor >= 2)
}

/** Whether this system can record system audio through the helper. */
export function systemAudioSupported(platform: string, release: string): boolean {
  return platform === 'darwin' && darwinSupportsTap(release)
}

/** Where the helper lives: Contents/Resources/bin when packaged, resources/bin in the repo in dev. */
export function systemAudioBinPath(p: { packaged: boolean; resourcesPath: string; appPath: string }): string {
  const base = p.packaged ? p.resourcesPath : `${p.appPath.replace(/[\\/]+$/, '')}/resources`
  return `${base}/bin/${SYSTEM_AUDIO_BIN}`
}
