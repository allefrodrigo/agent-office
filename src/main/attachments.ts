import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AttachmentInfo, AttachmentInput, AttachmentKind } from '@shared/types'
import { ATTACH_LIMITS, formatBytes, limitError } from '@shared/attachments'

type Content = Exclude<SDKUserMessage['message']['content'], string>
type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

const SNIFF_BYTES = 8192

/**
 * Turns the composer's text and files into message blocks: images and PDFs go
 * as base64 blocks, text inline, anything else as a path the agent can open.
 * Throws with a message for the player when a file can't go.
 */
export function buildMessage(text: string, inputs: AttachmentInput[]): { content: Content; infos: AttachmentInfo[] } {
  if (inputs.length > ATTACH_LIMITS.count) throw new Error(`Dá para mandar até ${ATTACH_LIMITS.count} anexos por vez. Tire alguns e envie o resto na próxima mensagem.`)
  const content: Content = []
  const infos: AttachmentInfo[] = []
  let total = 0
  for (const input of inputs) {
    const a = load(input)
    total += a.inlineBytes
    if (total > ATTACH_LIMITS.total) {
      throw new Error(`Os anexos somam mais de ${formatBytes(ATTACH_LIMITS.total)}. Mande parte deles agora e o resto na próxima mensagem.`)
    }
    content.push(a.block)
    infos.push({ name: a.name, kind: a.kind, size: a.size })
  }
  if (text.trim()) content.push({ type: 'text', text })
  return { content, infos }
}

interface Loaded {
  name: string
  kind: AttachmentKind
  size: number
  /** Bytes that travel in the request (0 when only the path goes). */
  inlineBytes: number
  block: Content[number]
}

function load(input: AttachmentInput): Loaded {
  // No quotes or brackets: the name goes inside an <attachment name="…"> tag.
  const name = basename(String(input?.name ?? '')).replace(/["<>]/g, '_').slice(0, 120) || 'anexo'
  const path = typeof input?.path === 'string' && input.path ? input.path : undefined

  let head: Buffer
  let size: number
  let readAll: () => Buffer
  if (path) {
    let st
    try {
      st = statSync(path)
    } catch {
      throw new Error(`Não achei ${name} no disco. Ele pode ter sido movido; anexe de novo.`)
    }
    if (!st.isFile()) throw new Error(`${name} não é um arquivo. Para mandar uma pasta, escreva o caminho dela na mensagem.`)
    size = st.size
    head = readHead(path)
    readAll = () => readFileSync(path)
  } else if (typeof input?.dataBase64 === 'string' && input.dataBase64) {
    const data = Buffer.from(input.dataBase64, 'base64')
    size = data.length
    head = data.subarray(0, SNIFF_BYTES)
    readAll = () => data
  } else {
    throw new Error(`${name} chegou vazio. Anexe de novo.`)
  }

  const kind = sniff(head)
  if (kind === 'file' || (kind === 'text' && path && size > ATTACH_LIMITS.text)) {
    if (!path) throw new Error(`Não sei ler ${name} colado da área de transferência. Salve o arquivo e anexe pelo clipe.`)
    // Unknown format or a huge log: point the agent at it instead of loading it into the request.
    return { name, kind: 'file', size, inlineBytes: 0, block: { type: 'text', text: pathNote(name, path, size) } }
  }
  const tooBig = limitError(name, kind, size)
  if (tooBig) throw new Error(tooBig)

  const data = readAll()
  if (kind === 'image') {
    return { name, kind, size, inlineBytes: size, block: { type: 'image', source: { type: 'base64', media_type: imageMime(head)!, data: data.toString('base64') } } }
  }
  if (kind === 'pdf') {
    return { name, kind, size, inlineBytes: size, block: { type: 'document', title: name, source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') } } }
  }
  const body = utf8(data)
  if (body === null) {
    // Looked like text in the first bytes but isn't UTF-8 further down.
    if (!path) throw new Error(`${name} não é texto UTF-8. Salve o arquivo e anexe pelo clipe.`)
    return { name, kind: 'file', size, inlineBytes: 0, block: { type: 'text', text: pathNote(name, path, size) } }
  }
  const where = path ? ` path="${path}"` : ''
  return { name, kind, size, inlineBytes: size, block: { type: 'text', text: `<attachment name="${name}"${where}>\n${body}\n</attachment>` } }
}

function readHead(path: string): Buffer {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(SNIFF_BYTES)
    return buf.subarray(0, readSync(fd, buf, 0, SNIFF_BYTES, 0))
  } finally {
    closeSync(fd)
  }
}

/** What the bytes say the file is, whatever its extension claims. */
function sniff(head: Buffer): AttachmentKind {
  if (imageMime(head)) return 'image'
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (head.length && !head.includes(0) && utf8(head, true) !== null) return 'text'
  return 'file'
}

function imageMime(b: Buffer): ImageMime | null {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

/** `partial`: the buffer may end in the middle of a character. */
function utf8(b: Buffer, partial = false): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b, { stream: partial })
  } catch {
    return null
  }
}

function pathNote(name: string, path: string, size: number): string {
  return `The user attached ${name} (${formatBytes(size)}), a format that can't go inline. It is at: ${path}`
}
