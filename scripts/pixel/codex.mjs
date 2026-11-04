// One non-interactive Codex turn that draws one image with its image_gen tool (on your ChatGPT login).
// Shared by `npm run pixel:gerar` (2D office) and `npm run pet:gerar` (modo mini).
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')

export function codexBin() {
  try {
    return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['codex'], { encoding: 'utf8' })
      .split(/\r?\n/)[0]
      .trim()
  } catch {
    return null
  }
}

/** Resolves with the path of the image Codex generated for `prompt`; `refs` ride along as reference images. */
export function drawImage(bin, prompt, refs = []) {
  const cwd = mkdtempSync(join(tmpdir(), 'pixel-gen-'))
  const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--disable', 'hooks', '-C', cwd]
  for (const r of refs) if (existsSync(r)) args.push('-i', r)
  args.push('-')
  const ask = `Use your image generation tool to create exactly ONE image. Do not run shell commands and do not write files; just generate the image and reply "ok".\n\n${prompt}`
  return new Promise((done, fail) => {
    const p = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let thread = ''
    let out = ''
    let err = ''
    p.stdout.on('data', (b) => {
      out += b.toString()
      const m = out.match(/"thread_id":"([^"]+)"/)
      if (m) thread = m[1]
    })
    p.stderr.on('data', (b) => (err = (err + b.toString()).slice(-1500)))
    p.on('close', (code) => {
      rmSync(cwd, { recursive: true, force: true })
      const dir = join(codexHome, 'generated_images', thread)
      const images =
        thread && existsSync(dir)
          ? readdirSync(dir)
              .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
              .map((f) => join(dir, f))
          : []
      images.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
      if (images.length) return done(images.at(-1))
      fail(new Error(`o Codex não devolveu imagem (código ${code}). ${err.trim().split('\n').pop() ?? ''}`))
    })
    p.stdin.end(ask)
  })
}
