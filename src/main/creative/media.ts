import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findBin, findWhisperModel } from './tools'

// ffmpeg/ffprobe/whisper-cli for the studio: what is in a video, its frames, its speech; crops and JPEGs.

function run(bin: string, args: string[], signal?: AbortSignal, timeout = 10 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, signal, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${bin.split('/').pop()} falhou: ${(stderr || err.message).toString().trim().split('\n').pop()?.slice(0, 240)}`))
      else resolve(stdout.toString())
    })
  })
}

const need = (name: string) => {
  const bin = findBin(name)
  if (!bin) throw new Error(`Falta o ${name} nesta máquina. Instale com "brew install ffmpeg" e rode de novo.`)
  return bin
}

export interface VideoInfo {
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
}

export async function probe(path: string, signal?: AbortSignal): Promise<VideoInfo> {
  const out = await run(need('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], signal, 30_000)
  const j = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }[] }
  const v = j.streams?.find((s) => s.codec_type === 'video')
  if (!v) throw new Error('Esse arquivo não tem vídeo.')
  const [a, b] = (v.avg_frame_rate ?? '0/1').split('/').map(Number)
  return {
    duration: Number(j.format?.duration ?? v.duration ?? 0),
    width: v.width ?? 0,
    height: v.height ?? 0,
    fps: b ? a / b : 0,
    hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio'),
  }
}

/** `count` frames spread over the video (the middle of each slice), 768 px on the long side. */
export async function frames(path: string, info: VideoInfo, count: number, dir: string, signal?: AbortSignal): Promise<{ file: string; t: number }[]> {
  const ffmpeg = need('ffmpeg')
  const step = info.duration / count
  const out: { file: string; t: number }[] = []
  // One seek per frame: fast on long videos, exact enough for a storyboard.
  for (let i = 0; i < count; i++) {
    const t = Math.min(info.duration - 0.05, step * (i + 0.5))
    const file = join(dir, `quadro-${String(i + 1).padStart(2, '0')}.jpg`)
    await run(ffmpeg, ['-y', '-v', 'error', '-ss', t.toFixed(2), '-i', path, '-frames:v', '1', '-vf', "scale='if(gt(iw,ih),768,-2)':'if(gt(iw,ih),-2,768)'", '-q:v', '4', file], signal, 60_000)
    if (existsSync(file)) out.push({ file, t })
  }
  return out
}

/** The speech with timestamps (SRT), or null when there is no audio or no whisper here. */
export async function transcribe(path: string, dir: string, signal?: AbortSignal): Promise<{ srt: string; model: string } | null> {
  const whisper = findBin('whisper-cli')
  const model = whisper && findWhisperModel()
  if (!whisper || !model) return null
  const wav = join(dir, 'audio.wav')
  await run(need('ffmpeg'), ['-y', '-v', 'error', '-i', path, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], signal)
  const base = join(dir, 'fala')
  await run(whisper, ['-m', model, '-f', wav, '-l', 'auto', '-osrt', '-of', base, '-np'], signal)
  const srt = existsSync(`${base}.srt`) ? readFileSync(`${base}.srt`, 'utf8').trim() : ''
  return { srt, model: model.split('/').pop() ?? model }
}

export async function imageSize(path: string): Promise<{ w: number; h: number }> {
  const out = await run(need('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', path], undefined, 30_000)
  const [w, h] = out.trim().split('x').map(Number)
  return { w, h }
}

/** Center crop to the aspect ("4:5"), written as PNG. No-op when already within 1%. */
export async function cropTo(src: string, aspect: string, dest: string): Promise<string> {
  const [aw, ah] = aspect.split(':').map(Number)
  const { w, h } = await imageSize(src)
  const want = aw / ah
  if (!w || !h || Math.abs(w / h - want) / want < 0.01) return src
  const [cw, ch] = w / h > want ? [Math.round(h * want), h] : [w, Math.round(w / want)]
  await run(need('ffmpeg'), ['-y', '-v', 'error', '-i', src, '-vf', `crop=${cw - (cw % 2)}:${ch - (ch % 2)}`, dest], undefined, 60_000)
  return dest
}

/** JPEG for the Meta API (≤ 8 MB, no alpha). */
export async function toJpeg(src: string, dest: string): Promise<void> {
  await run(need('ffmpeg'), ['-y', '-v', 'error', '-i', src, '-q:v', '2', '-pix_fmt', 'yuvj420p', dest], undefined, 60_000)
}

/** A JPEG of at most 1024 px on the long side (what a model needs to see an image). */
export async function toJpegSmall(src: string, dest: string): Promise<void> {
  await run(need('ffmpeg'), ['-y', '-v', 'error', '-i', src, '-vf', "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease", '-q:v', '3', '-pix_fmt', 'yuvj420p', dest], undefined, 60_000)
}

export const listDir = (dir: string) => (existsSync(dir) ? readdirSync(dir) : [])
