import { safeStorage } from 'electron'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CRM_LIMITS } from '@shared/types'
import { writeJsonAtomic } from '../fs-safe'
import { log, secret } from '../log'

// O cofre do WhatsApp do CRM (CR-08): userData/crm-evolution.json guarda o endereço da Evolution,
// a instância e o token da instância selado pelo cofre do sistema (safeStorage), no molde da
// chave do ElevenLabs. O token nunca vai para o renderer, o log, o prompt ou o backup. Sem cofre,
// o CRM não guarda o token e diz o que fazer.

export const VAULT_FILE = 'crm-evolution.json'
export const DEFAULT_EVOLUTION_URL = 'http://localhost:8080'
const FILE_MODE = 0o600

/** The part of Electron's safeStorage the vault uses (a fake in the tests). */
export interface Sealer {
  isEncryptionAvailable(): boolean
  encryptString(text: string): Buffer
  decryptString(data: Buffer): string
  /** Linux only: 'basic_text' means no keyring, the "encryption" is a fixed key. */
  getSelectedStorageBackend?(): string
}

/** What the screen may know: never the token, only whether there is one. */
export interface EvolutionSettings {
  url: string
  instance: string
  hasToken: boolean
}

export const NO_VAULT =
  'Este computador não oferece um cofre para guardar o token (no Linux, instale e destrave o gnome-keyring ou o KWallet). Sem cofre, o CRM não guarda o token.'

const fileSchema = z.object({
  url: z.string().max(CRM_LIMITS.url).catch(DEFAULT_EVOLUTION_URL),
  instance: z.string().max(CRM_LIMITS.instance).catch(''),
  sealed: z
    .string()
    .max(4_096)
    .regex(/^[A-Za-z0-9+/]+=*$/)
    .optional()
    .catch(undefined),
})
type VaultFile = z.infer<typeof fileSchema>

export class CrmVault {
  private file: string

  constructor(
    dir: string,
    private sealer: Sealer | undefined = safeStorage,
    private platform: NodeJS.Platform = process.platform,
  ) {
    this.file = join(dir, VAULT_FILE)
  }

  /** The OS vault works here (a Linux without keyring does not count: its "encryption" is a fixed key). */
  available(): boolean {
    try {
      if (!this.sealer?.isEncryptionAvailable()) return false
      return !(this.platform === 'linux' && this.sealer.getSelectedStorageBackend?.() === 'basic_text')
    } catch {
      return false
    }
  }

  private read(): VaultFile {
    if (!existsSync(this.file)) return { url: DEFAULT_EVOLUTION_URL, instance: '' }
    try {
      const r = fileSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')))
      if (r.success) return r.data
    } catch {
      // falls through to the defaults
    }
    log.warn('CRM: crm-evolution.json ilegível; o WhatsApp volta ao padrão (endereço local, sem token)')
    return { url: DEFAULT_EVOLUTION_URL, instance: '' }
  }

  private write(v: VaultFile): void {
    writeJsonAtomic(this.file, v, { mode: FILE_MODE })
    try {
      chmodSync(this.file, FILE_MODE)
    } catch {
      // Windows: the mode is not enforced there
    }
  }

  settings(): EvolutionSettings {
    const v = this.read()
    return { url: v.url || DEFAULT_EVOLUTION_URL, instance: v.instance, hasToken: !!v.sealed }
  }

  /** The instance token, opened by the OS vault; undefined when there is none or the vault cannot open it. */
  token(): string | undefined {
    const v = this.read()
    if (!v.sealed || !this.available()) return undefined
    try {
      const token = this.sealer!.decryptString(Buffer.from(v.sealed, 'base64'))
      if (!token || token.length > CRM_LIMITS.token || /\s/.test(token)) return undefined
      secret(token)
      return token
    } catch {
      log.warn('CRM: o cofre do sistema não abriu o token do WhatsApp; cole o token de novo')
      return undefined
    }
  }

  /**
   * Saves address and instance (already checked) and the token: undefined keeps the stored one,
   * '' clears it. A token goes with the server and the instance it opens: changing either without
   * a new token clears the old one, so it never reaches another server.
   */
  save(next: { url: string; instance: string; token?: string }): EvolutionSettings {
    const cur = this.read()
    let sealed = cur.sealed
    if (next.token !== undefined) {
      if (!next.token) sealed = undefined
      else {
        secret(next.token)
        if (!this.available()) throw new Error(NO_VAULT)
        sealed = this.sealer!.encryptString(next.token).toString('base64')
      }
    } else if (next.url !== cur.url || next.instance !== cur.instance) sealed = undefined
    this.write({ url: next.url, instance: next.instance, ...(sealed ? { sealed } : {}) })
    return this.settings()
  }
}
