import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { CreativeJob, CreativeJobResult } from '@shared/creative'
import { renderArt, type ArtStyle, type ArtText } from './art'
import { runCodex } from './codex'
import { speak } from './elevenlabs'
import { imagesOf, int, runDir, slug, stamp, str, texts, think, type NodeRunCtx } from './helpers'
import { cropTo } from './media'

// Nodes that make finished pieces: edit an image, text over art, carousels, narration.
//   criativos/imagens (edits)  criativos/artes  criativos/carrosseis/<name>/  criativos/audios

const READ = 'Se o briefing citar pastas ou arquivos desta máquina, leia o que precisar deles (só leitura).'

function styleOf(p: Record<string, unknown>): ArtStyle {
  return {
    layout: p.layout === 'topo' || p.layout === 'centro' ? p.layout : 'base',
    tema: p.tema === 'claro' || p.tema === 'marca' ? p.tema : 'escuro',
    fonte: p.fonte === 'serif' || p.fonte === 'condensada' ? p.fonte : 'sans',
    cor: /^#[0-9a-f]{6}$/i.test(str(p.cor)) ? str(p.cor) : '#9b7bf0',
  }
}

const outDir = (root: string, ...parts: string[]) => {
  const d = join(root, 'criativos', ...parts)
  mkdirSync(d, { recursive: true })
  return d
}

// ---------- Editar imagem ----------

export async function editImage(job: CreativeJob, ctx: NodeRunCtx): Promise<CreativeJobResult> {
  const [src] = imagesOf(job.inputs.image)
  if (!src) throw new Error('Ligue a imagem que você quer editar.')
  const request = [str(job.params.request, 2000), ...texts(job.inputs.instruction)].filter(Boolean).join('\n\n')
  if (!request) throw new Error('Diga o que mudar (campo "O que mudar" ou um texto ligado).')
  const aspect = ['1:1', '4:5', '9:16', '16:9'].includes(String(job.params.aspect)) ? String(job.params.aspect) : 'igual'
  const dir = runDir(ctx.root, job)
  const prompt = [
    'Use a ferramenta de geração de imagem para EDITAR a imagem anexada (gere uma nova versão dela).',
    `Mudança pedida: ${request}`,
    'Mantenha tudo o que o pedido não mencionar: pessoas, rostos, produto, marca, composição, luz e estilo.',
    aspect === 'igual' ? 'Mantenha a proporção da imagem original.' : `A saída deve servir para ${aspect}: assunto principal no centro.`,
    'Não escreva código nem salve arquivos; responda numa linha o que mudou.',
  ].join('\n\n')
  ctx.progress('ChatGPT está editando…')
  const r = await runCodex({ prompt, cwd: dir, images: [src], signal: ctx.signal, onProgress: ctx.progress })
  if (!r.images.length) throw new Error(r.message ? `O Codex não editou: ${r.message.slice(0, 240)}` : 'O Codex não devolveu a imagem editada. Rode de novo.')
  const dest = join(outDir(ctx.root, 'imagens'), `${stamp()}-editada-${slug(request)}.png`)
  const out = aspect === 'igual' ? r.images[0] : await cropTo(r.images[0], aspect, dest)
  if (out !== dest) copyFileSync(out, dest)
  return { outputs: { image: { type: 'image', paths: [dest] } }, note: `editada · ${relative(ctx.root, dest)}` }
}

// ---------- Arte com texto ----------

const COPY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'subtitulo', 'cta'],
  properties: {
    titulo: { type: 'string', description: 'Título curto e forte, até 48 caracteres.' },
    subtitulo: { type: 'string', description: 'Apoio ao título, até 90 caracteres; vazio se não precisar.' },
    cta: { type: 'string', description: 'Chamada para ação ou preço, até 28 caracteres; vazio se não houver.' },
  },
}

async function copyFor(job: CreativeJob, ctx: NodeRunCtx, dir: string): Promise<{ text: ArtText; by?: string }> {
  const given: ArtText = { titulo: str(job.params.titulo, 120), subtitulo: str(job.params.subtitulo, 200), cta: str(job.params.cta, 60) }
  if (given.titulo) return { text: given }
  const brief = texts(job.inputs.copy).join('\n\n')
  if (!brief) throw new Error('Escreva o título ou ligue um texto para o Claude tirar o título dele.')
  const r = await think(
    'claude-haiku',
    {
      prompt: `Escreva o texto que vai por cima de uma arte de anúncio para Instagram, em português do Brasil, a partir do briefing abaixo. Curto, direto, sem hashtags e sem emoji. ${READ}\n\nBriefing:\n${brief.slice(0, 12000)}`,
      cwd: dir,
      images: [],
      schema: COPY_SCHEMA,
    },
    ctx,
  )
  const j = (r.structured ?? {}) as Partial<ArtText>
  return { text: { titulo: str(j.titulo, 120) || 'Título', subtitulo: given.subtitulo || str(j.subtitulo, 200), cta: given.cta || str(j.cta, 60) }, by: r.by }
}

export async function overlay(job: CreativeJob, ctx: NodeRunCtx): Promise<CreativeJobResult> {
  const images = imagesOf(job.inputs.images)
  if (!images.length) throw new Error('Ligue a imagem (ou as imagens) que vão receber o texto.')
  const [logo] = imagesOf(job.inputs.logo)
  const dir = runDir(ctx.root, job)
  const { text, by } = await copyFor(job, ctx, dir)
  const style = styleOf(job.params)
  const folder = outDir(ctx.root, 'artes')
  const name = `${stamp()}-${slug(text.titulo)}`
  const paths: string[] = []
  for (const [i, src] of images.entries()) {
    ctx.progress(`Montando a arte ${i + 1} de ${images.length}…`)
    const dest = join(folder, `${name}-${i + 1}.png`)
    await renderArt(src, dest, text, style, logo)
    paths.push(dest)
  }
  return { outputs: { image: { type: 'image', paths } }, note: `${by ? `${by} · ` : ''}"${text.titulo}" · ${relative(ctx.root, folder)}` }
}

// ---------- Carrossel ----------

interface Slide {
  titulo: string
  texto: string
  imagem: string
}

export async function carousel(job: CreativeJob, ctx: NodeRunCtx): Promise<CreativeJobResult> {
  const brief = texts(job.inputs.brief).join('\n\n')
  if (!brief) throw new Error('Ligue um briefing: um nó de Texto ou uma análise.')
  const refs = imagesOf(job.inputs.refs)
  const [logo] = imagesOf(job.inputs.logo)
  const n = int(job.params.slides, 3, 10, 5)
  const aspect = job.params.aspect === '1:1' ? '1:1' : '4:5'
  const artDir = str(job.params.style, 1000)
  const dir = runDir(ctx.root, job)

  // 1. the script: one slide each, cover first, CTA last
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['slides'],
    properties: {
      slides: {
        type: 'array',
        minItems: n,
        maxItems: n,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['titulo', 'texto', 'imagem'],
          properties: {
            titulo: { type: 'string', description: 'Texto grande do slide, até 48 caracteres.' },
            texto: { type: 'string', description: 'Apoio, até 110 caracteres; vazio na capa se não precisar.' },
            imagem: { type: 'string', description: 'Descrição da imagem de fundo do slide, sem texto nela.' },
          },
        },
      },
    },
  }
  const plan = await think(
    job.params.engine,
    {
      prompt: [
        `Roteirize um carrossel de Instagram com exatamente ${n} slides, em português do Brasil, a partir do briefing.`,
        'Slide 1 é a capa (gancho forte). Os do meio entregam o conteúdo, um ponto por slide. O último é a chamada para ação.',
        'Para cada slide: título curto, texto de apoio e a descrição da imagem de fundo (cena concreta, sem texto escrito nela, todas no mesmo estilo visual).',
        artDir ? `Direção de arte: ${artDir}` : '',
        READ,
        `Briefing:\n${brief.slice(0, 16000)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      cwd: dir,
      images: refs,
      schema,
    },
    ctx,
  )
  const slides = ((plan.structured as { slides?: Slide[] } | undefined)?.slides ?? []).slice(0, n)
  if (slides.length < 2) throw new Error('O roteiro do carrossel voltou vazio. Rode de novo.')

  // 2. the backgrounds, one Codex turn so they share a style; missing ones get a second turn
  const size = aspect === '1:1' ? 'quadradas (1024x1024)' : 'retrato (1024x1536)'
  const draw = async (list: { i: number; s: Slide }[]) => {
    const prompt = [
      `Use a ferramenta de geração de imagem para criar ${list.length} imagens ${size}, uma por slide, NA ORDEM abaixo, todas com o mesmo estilo visual, paleta e luz (é um carrossel).`,
      'Não coloque texto, letras ou números nas imagens: o texto entra depois. Deixe respiro para o texto na parte de baixo.',
      artDir ? `Direção de arte: ${artDir}` : '',
      refs.length ? 'As imagens anexadas são referências de produto, marca e estilo.' : '',
      ...list.map(({ i, s }) => `Slide ${i + 1}: ${s.imagem}`),
      'Não escreva código nem salve arquivos; ao fim responda numa linha.',
    ]
      .filter(Boolean)
      .join('\n\n')
    ctx.progress(`ChatGPT está desenhando ${list.length} slides…`)
    return (await runCodex({ prompt, cwd: dir, images: refs, signal: ctx.signal, onProgress: ctx.progress })).images
  }
  const backs: string[] = await draw(slides.map((s, i) => ({ i, s })))
  if (backs.length < slides.length && backs.length > 0) {
    const missing = slides.slice(backs.length).map((s, k) => ({ i: backs.length + k, s }))
    backs.push(...(await draw(missing)))
  }
  if (!backs.length) throw new Error('O Codex não gerou as imagens do carrossel. Rode de novo.')

  // 3. text over each slide
  const style = styleOf(job.params)
  const folder = outDir(ctx.root, 'carrosseis', `${stamp()}-${slug(slides[0].titulo)}`)
  const paths: string[] = []
  for (const [i, s] of slides.entries()) {
    const back = backs[i] ?? backs[backs.length - 1]
    ctx.progress(`Montando o slide ${i + 1} de ${slides.length}…`)
    const fitted = await cropTo(back, aspect, join(dir, `fundo-${i + 1}.png`))
    const dest = join(folder, `slide-${String(i + 1).padStart(2, '0')}.png`)
    await renderArt(fitted, dest, { titulo: s.titulo, subtitulo: s.texto, selo: `${i + 1}/${slides.length}` }, style, i === 0 || i === slides.length - 1 ? logo : undefined)
    paths.push(dest)
  }
  const script = `# Carrossel: ${slides[0].titulo}\n\n${slides.map((s, i) => `**${i + 1}. ${s.titulo}**${s.texto ? `\n${s.texto}` : ''}`).join('\n\n')}`
  writeFileSync(join(folder, 'roteiro.md'), `${script}\n`)
  return {
    outputs: { image: { type: 'image', paths }, text: { type: 'text', text: script } },
    note: `${plan.by} + ChatGPT · ${paths.length} slides${backs.length < slides.length ? ` (${backs.length} fundos)` : ''} · ${relative(ctx.root, folder)}`,
  }
}

// ---------- Narração ----------

export async function narrate(job: CreativeJob, ctx: NodeRunCtx): Promise<CreativeJobResult> {
  const input = texts(job.inputs.text).join('\n\n')
  if (!input) throw new Error('Ligue o texto que vai ser narrado.')
  const voice = str(job.params.voice, 40)
  if (!voice) throw new Error('Escolha a voz no nó.')
  const model = job.params.model === 'eleven_flash_v2_5' ? 'eleven_flash_v2_5' : 'eleven_multilingual_v2'
  const dir = runDir(ctx.root, job)
  let script = input
  let by = ''
  if (job.params.script !== 'raw') {
    const r = await think(
      'claude-haiku',
      {
        prompt: `Do texto abaixo, tire só o que deve ser falado em voz alta numa narração de anúncio (o roteiro falado), em português do Brasil, pronto para um locutor. Sem marcações, títulos, emojis, tempos ou indicações de cena: só a fala, com pontuação natural. Se o texto já for a fala, devolva igual.\n\nTexto:\n${input.slice(0, 16000)}`,
        cwd: dir,
        images: [],
      },
      ctx,
    )
    script = r.text.trim()
    by = r.by
  }
  if (script.length > 5000) throw new Error(`O roteiro tem ${script.length} caracteres; o limite de uma narração é 5000. Encurte o texto.`)
  ctx.progress(`ElevenLabs está gravando (${script.length} caracteres)…`)
  const folder = outDir(ctx.root, 'audios')
  const dest = join(folder, `${stamp()}-${slug(script.split(/[.!?\n]/)[0])}.mp3`)
  await speak(script, voice, model, dest, ctx.signal)
  if (!existsSync(dest)) throw new Error('O ElevenLabs não devolveu o áudio.')
  writeFileSync(dest.replace(/\.mp3$/, '.txt'), `${script}\n`)
  return { outputs: { audio: { type: 'audio', path: dest } }, note: `${by ? `${by} · ` : ''}ElevenLabs · ${script.length} caracteres · ${relative(ctx.root, dest)}` }
}
