import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import type { CreativeJob, CreativeJobResult } from '@shared/creative'
import { brandPrompt, EXPORT_PLATFORMS, exportName, fileSlug, formatById, formatOfSize, safePrompt, type SocialFormat } from '@shared/social'
import { loadBrand } from './brand'
import { runCodex } from './codex'
import { brandFor, imagesOf, runDir, stamp, str, texts, type NodeRunCtx } from './helpers'
import { fitTo, imageSize, toJpeg } from './media'

// Nodes that get pieces ready for the networks:
//   Formatos  one image → a version at the exact size of each network (criativos/formatos)
//   Exportar  the pieces with standard names, in carousel order, plus the caption (exportar/<data>-<peça>/)

/** Outputs past this are dropped (a port carries at most 20 paths). */
const MAX_OUT = 20

export async function formats(job: CreativeJob, ctx: NodeRunCtx): Promise<CreativeJobResult> {
  const images = imagesOf(job.inputs.images)
  if (!images.length) throw new Error('Ligue as imagens que vão virar os formatos.')
  const fmts = (Array.isArray(job.params.formats) ? job.params.formats : []).map(formatById).filter((f): f is SocialFormat => !!f)
  if (!fmts.length) throw new Error('Marque pelo menos um formato no nó.')
  const total = images.length * fmts.length
  if (total > MAX_OUT) throw new Error(`Isso daria ${total} versões; o máximo é ${MAX_OUT} por vez. Ligue menos imagens ou marque menos formatos.`)
  const mode = job.params.engine === 'codex' ? 'codex' : job.params.engine === 'fundo' ? 'fundo' : 'recorte'
  const brand = mode === 'codex' ? brandFor(job, ctx.root) : null
  const dir = runDir(ctx.root, job)
  const folder = join(ctx.root, 'criativos', 'formatos')
  mkdirSync(folder, { recursive: true })
  const paths: string[] = []
  let k = 0
  for (const src of images) {
    const base = `${stamp()}-${fileSlug(basename(src, extname(src)), 30) || 'imagem'}`
    for (const f of fmts) {
      k++
      ctx.progress(`${f.platform} ${f.label}: versão ${k} de ${total}…`)
      const dest = join(folder, `${base}-${fileSlug(f.id.replace(':', 'x'))}-${f.w}x${f.h}.png`)
      let from = src
      if (mode === 'codex') {
        const { w, h } = await imageSize(src)
        if (formatOfSize(w, h)?.id !== f.id) {
          const r = await runCodex({
            prompt: [
              `Use a ferramenta de geração de imagem para ADAPTAR a imagem anexada para ${f.platform} ${f.label} (${f.w}x${f.h}).`,
              'Mesma cena, pessoas, produto, cores e estilo: estenda ou reenquadre o cenário para a nova proporção, sem distorcer nada.',
              safePrompt(f),
              brandPrompt(brand),
              'Não escreva código nem salve arquivos; responda numa linha.',
            ]
              .filter(Boolean)
              .join('\n\n'),
            cwd: dir,
            images: [src],
            signal: ctx.signal,
            onProgress: ctx.progress,
          })
          if (!r.images.length) throw new Error(r.message ? `O Codex não adaptou: ${r.message.slice(0, 240)}` : 'O Codex não devolveu a imagem adaptada. Rode de novo.')
          from = r.images[0]
        }
      }
      await fitTo(from, f, dest, mode === 'fundo' ? 'fundo' : 'recorte', ctx.signal)
      paths.push(dest)
    }
  }
  const how = mode === 'codex' ? 'redesenhadas com ChatGPT' : mode === 'fundo' ? 'com fundo desfocado' : 'recortadas'
  return { outputs: { image: { type: 'image', paths } }, note: `${paths.length} versões ${how} · ${fmts.map((f) => `${f.w}×${f.h}`).join(', ')} · ${relative(ctx.root, folder)}` }
}

/** First line of the caption, without emoji or hashtags: the piece name when none was given. */
export function pieceName(given: string, caption: string): string {
  if (given) return given
  const line = caption.split('\n').find((l) => l.trim() && !l.trim().startsWith('#')) ?? ''
  return line.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 5).join(' ') || 'peca'
}

export async function exportPieces(job: CreativeJob, ctx: NodeRunCtx): Promise<CreativeJobResult> {
  const images = imagesOf(job.inputs.images)
  if (!images.length) throw new Error('Ligue as peças que vão ser exportadas.')
  const caption = texts(job.inputs.caption).join('\n\n').trim()
  const platform = EXPORT_PLATFORMS.find(([k]) => k === job.params.platform) ?? EXPORT_PLATFORMS[0]
  const fixed = job.params.aspect === 'auto' ? undefined : formatById(job.params.aspect)
  const carousel = job.params.group !== 'separados'
  const ext = job.params.file === 'png' ? 'png' : 'jpg'
  const piece = pieceName(str(job.params.piece, 60), caption)
  const brand = loadBrand(ctx.root).nome || basename(ctx.root)
  if (carousel && platform[0] === 'instagram' && images.length > 20) throw new Error('O Instagram aceita até 20 imagens num carrossel. Ligue menos peças.')

  // a carousel keeps one ratio for every slide (Instagram crops the others)
  const sizes = await Promise.all(images.map((p) => imageSize(p)))
  if (carousel && !fixed && images.length > 1 && new Set(sizes.map((s) => (s.w / s.h).toFixed(2))).size > 1)
    throw new Error('As peças têm proporções diferentes. Escolha um Tamanho no nó para padronizar o carrossel, ou exporte como "Um post por imagem".')

  const date = new Date()
  const day = date.toISOString().slice(0, 10)
  let folder = join(ctx.root, 'exportar', `${day}-${fileSlug(piece, 32) || 'peca'}-${platform[0]}`)
  for (let n = 2; existsSync(folder); n++) folder = join(ctx.root, 'exportar', `${day}-${fileSlug(piece, 32) || 'peca'}-${platform[0]}-${n}`)
  mkdirSync(folder, { recursive: true })

  const paths: string[] = []
  const files: { arquivo: string; largura: number; altura: number }[] = []
  for (const [i, src] of images.entries()) {
    ctx.progress(`Exportando ${i + 1} de ${images.length}…`)
    const fmt = fixed ?? formatOfSize(sizes[i].w, sizes[i].h)
    const where = carousel ? folder : join(folder, `post-${String(i + 1).padStart(2, '0')}`)
    mkdirSync(where, { recursive: true })
    const name = exportName({ date, brand, platform: platform[0], format: fmt, piece, index: i + 1, ext })
    const dest = join(where, name)
    if (fixed) await fitTo(src, fixed, dest, 'recorte', ctx.signal)
    else if (ext === 'jpg') await toJpeg(src, dest, ctx.signal)
    else copyFileSync(src, dest)
    if (caption && !carousel) writeFileSync(join(where, 'legenda.txt'), `${caption}\n`)
    paths.push(dest)
    files.push({ arquivo: relative(folder, dest), largura: fixed?.w ?? sizes[i].w, altura: fixed?.h ?? sizes[i].h })
  }
  if (caption && carousel) writeFileSync(join(folder, 'legenda.txt'), `${caption}\n`)
  writeFileSync(
    join(folder, 'exportacao.json'),
    `${JSON.stringify({ rede: platform[1], formato: fixed ? `${fixed.label} (${fixed.w}x${fixed.h})` : 'original', tipo: carousel ? 'carrossel' : 'posts separados', peca: piece, marca: brand, criado_em: date.toISOString(), arquivos: files, legenda: caption || undefined }, null, 2)}\n`,
  )
  return {
    outputs: { image: { type: 'image', paths: paths.slice(0, MAX_OUT) } },
    note: `${platform[1]} · ${paths.length} ${carousel && paths.length > 1 ? 'slides em ordem' : paths.length === 1 ? 'peça' : 'posts'}${caption ? ' + legenda.txt' : ''} · ${relative(ctx.root, folder)}`,
  }
}
