import type { AttachmentKind } from './types'

const MB = 1024 * 1024

/**
 * The API caps an image at 5 MB of base64 (about 3.75 MB of file) and a whole
 * request at 32 MB, base64 included, so the raw total has to stay near 24 MB.
 */
export const ATTACH_LIMITS = {
  image: Math.floor((5 * MB * 3) / 4),
  pdf: 24 * MB,
  /** Text goes inline and eats context; a bigger file from disk goes as a path instead. */
  text: 1 * MB,
  total: 24 * MB,
  count: 10,
}

export const ATTACH_KIND_LABEL: Record<AttachmentKind, string> = {
  image: 'imagem',
  pdf: 'PDF',
  text: 'texto',
  file: 'arquivo',
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < MB) return `${Math.round(n / 1024)} KB`
  return `${(n / MB).toFixed(1).replace('.', ',')} MB`
}

/** Guess from the name, only to warn early in the composer; the main process checks the bytes. */
export function kindFromName(name: string, mime = ''): AttachmentKind {
  if (/^image\/(png|jpeg|gif|webp)$/.test(mime) || /\.(png|jpe?g|gif|webp)$/i.test(name)) return 'image'
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  if (mime.startsWith('text/') || /\.(txt|md|log|csv|json|ya?ml|toml|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|zsh|sql|ini|env|conf)$/i.test(name)) return 'text'
  return 'file'
}

/** Why this file can't go, with what to do instead; null when it fits. */
export function limitError(name: string, kind: AttachmentKind, size: number): string | null {
  const max = kind === 'image' ? ATTACH_LIMITS.image : kind === 'pdf' ? ATTACH_LIMITS.pdf : kind === 'text' ? ATTACH_LIMITS.text : null
  if (max === null || size <= max) return null
  const tip =
    kind === 'image'
      ? 'Reduza a resolução ou salve como JPG e anexe de novo.'
      : kind === 'pdf'
        ? 'Divida o PDF em partes menores e mande uma de cada vez.'
        : 'Salve o texto num arquivo e anexe pelo clipe: o agente lê pelo caminho.'
  return `${name} tem ${formatBytes(size)}; o limite para ${ATTACH_KIND_LABEL[kind]} é ${formatBytes(max)}. ${tip}`
}
