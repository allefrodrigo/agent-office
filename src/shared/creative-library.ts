// Estúdio criativo: the floor's flows (tabs) and its gallery of everything it generated.

/** One tab of the studio: a flow saved in .criativo/fluxos/<id>.json. */
export interface FlowTab {
  id: string
  name: string
}

export const MAX_FLOWS = 20
export const FLOW_NAME_MAX = 40
export const FLOW_ID = /^f-[\w-]{1,40}$/

/** What a gallery item is, by the folder it came from. */
export type LibraryKind = 'imagem' | 'analise' | 'audio' | 'arte' | 'carrossel'

export interface LibraryItem {
  kind: LibraryKind
  path: string
  name: string
  size: number
  /** Last change (ms). */
  mtime: number
}

/** Gallery folders, relative to the floor folder. Carousels may sit one folder deeper. */
export const LIBRARY_DIRS: [LibraryKind, string][] = [
  ['imagem', 'criativos/imagens'],
  ['arte', 'criativos/artes'],
  ['carrossel', 'criativos/carrosseis'],
  ['audio', 'criativos/audios'],
  ['analise', 'criativos/analises'],
]

export const LIBRARY_LABEL: Record<LibraryKind, string> = {
  imagem: 'Imagens',
  arte: 'Artes',
  carrossel: 'Carrosséis',
  audio: 'Áudios',
  analise: 'Análises',
}

export const LIBRARY_MAX = 500
export const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg)$/i
export const LIBRARY_EXT = /\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm|mp3|wav|m4a|aac|ogg|md)$/i
