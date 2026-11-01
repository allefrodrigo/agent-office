import { ipcMain, systemPreferences } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VOICE_MAX_BYTES, type Dictation } from '@shared/voice'
import { dictate } from '../creative/media'
import { log } from '../log'

/** Modo voz: the microphone (macOS asks once) and the recording turned into text by whisper-cli, the studio's. */
export function registerVoiceIpc(): void {
  ipcMain.handle('office:micAccess', async () => {
    if (process.platform !== 'darwin') return true
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') return true
    if (status === 'not-determined') return systemPreferences.askForMediaAccess('microphone')
    return false
  })
  ipcMain.handle('office:transcribe', async (_e, audio: unknown): Promise<Dictation> => {
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0) throw new Error('A gravação chegou vazia. Grave de novo.')
    if (audio.byteLength > VOICE_MAX_BYTES) throw new Error('A gravação passou do limite. Grave um trecho mais curto.')
    const dir = await mkdtemp(join(tmpdir(), 'agent-office-voz-'))
    try {
      // ffmpeg reads the container from the bytes; webm is what the page records.
      const file = join(dir, 'fala.webm')
      await writeFile(file, audio)
      const d = await dictate(file, dir)
      // The length only: what the player said stays out of the log.
      log.info(`Voz: ${d.text.length} caracteres em ${d.ms} ms (${d.model}, idioma ${d.lang ?? '?'})`)
      return d
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
