import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { type } from 'node:os'
import { join, posix, win32 } from 'node:path'
import type { AppInfo, UpdateChannel } from '@shared/types'
import { claudeVersion } from './crash'

// The "Sobre" window (click on the version chip) and the agent that updates the app.

const OS_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

type PackageFields = Pick<AppInfo, 'description' | 'author' | 'license' | 'homepage' | 'repo'>

const text = (v: unknown, max = 300): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

/** https://github.com/<owner>/<repo> from any npm repository form: "owner/repo", "github:owner/repo", git+https or ssh URLs. */
export function githubRepo(url: string | undefined): string | undefined {
  if (!url) return undefined
  const m = /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(url) ?? /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url)
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined
}

/** The fields of package.json the window shows; anything malformed is left out. */
export function packageFields(raw: unknown): PackageFields {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const field = (v: unknown, key: string) => text(v) ?? (v && typeof v === 'object' ? text((v as Record<string, unknown>)[key]) : undefined)
  // "Name <email> (url)" or { name, email, url }: the name is enough.
  const author = field(p.author, 'name')?.replace(/\s*[<(].*$/, '')
  const homepage = text(p.homepage)
  const repo = githubRepo(field(p.repository, 'url')) ?? githubRepo(homepage)
  return {
    description: text(p.description),
    author: author || undefined,
    license: text(p.license, 60),
    homepage: homepage && /^https?:\/\//.test(homepage) ? homepage : repo,
    repo,
  }
}

/** Where this copy runs from: the .app bundle on the Mac, the install folder on Windows, the checkout in dev. */
export function installLocation(execPath: string, platform: string, packaged: boolean, appPath: string): string {
  if (!packaged) return appPath
  const bundle = execPath.indexOf('.app/Contents/MacOS/')
  if (platform === 'darwin' && bundle >= 0) return execPath.slice(0, bundle + 4)
  return (platform === 'win32' ? win32 : posix).dirname(execPath)
}

export async function appInfo(): Promise<AppInfo> {
  let pkg: unknown = {}
  try {
    pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
  } catch {
    // The window still has the version and the machine.
  }
  return {
    version: app.getVersion(),
    ...packageFields(pkg),
    packaged: app.isPackaged,
    location: installLocation(process.execPath, process.platform, app.isPackaged, app.getAppPath()),
    dataDir: app.getPath('userData'),
    os: `${OS_NAMES[process.platform] ?? type()} ${process.getSystemVersion()} (${process.arch})`,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    claude: await claudeVersion(),
  }
}

/** Installer names, as artifactName in electron-builder.yml makes them. */
function assetHint(info: AppInfo): string {
  if (info.platform === 'darwin')
    return `\`Agent-Office-<versão>-${info.arch}.zip\` (o .zip tem o app pronto; o .dmg é o mesmo app para instalar à mão)`
  if (info.platform === 'win32') return '`Agent-Office-Setup-<versão>.exe`'
  return 'nenhum: não há instalador publicado para este sistema'
}

function installSteps(info: AppInfo, pid: number): string[] {
  if (info.platform === 'darwin') {
    return [
      `4. Abra o .zip com \`ditto -x -k\` numa subpasta desta pasta e confira a versão em \`Contents/Info.plist\` (CFBundleShortVersionString). Tire a quarentena do app novo: \`xattr -dr com.apple.quarantine\`.`,
      `5. O app não pode ser trocado aberto, e você roda dentro dele: se ele fechar, você fecha junto. Escreva um script que espera o processo ${pid} terminar (\`while kill -0 ${pid}; do sleep 1; done\`), guarda o app antigo nesta pasta, copia o novo com \`ditto\` para o lugar dele, volta o antigo se a cópia falhar e abre o app com \`open\`. Grave a saída num log nesta pasta. Rode o script com \`nohup ... &\`, desligado do seu processo, e confira com \`ps\` que ele ficou esperando.`,
      '6. Termine dizendo, em uma linha, o que o usuário faz agora: fechar o Agent Office pelo menu Agent Office → Sair (⌘Q). Fechar só a janela não basta. O app abre sozinho na versão nova.',
      '',
      'Se o caminho do app tiver `/AppTranslocation/`, o macOS está rodando uma cópia temporária: o app de verdade costuma estar em `/Applications`; confirme com `mdfind "kMDItemCFBundleIdentifier == dev.allef.agentoffice"`. Se começar com `/Volumes/`, o app está rodando de dentro do DMG: instale em `/Applications` e diga para abrir de lá.',
      'Se copiar para `/Applications` pedir senha de administrador, não tente contornar: explique e diga para arrastar o app à mão.',
    ]
  }
  if (info.platform === 'win32') {
    return [
      '4. Rode o instalador desligado do seu processo (por exemplo com `Start-Process` no PowerShell). Ele mostra o assistente de instalação, avisa que o Agent Office está aberto e o fecha. Você roda dentro do app e fecha junto: rode o instalador por último.',
      '5. Termine dizendo, em uma linha, o que o usuário faz agora: seguir o assistente (Avançar até Concluir). No fim ele abre o Agent Office na versão nova.',
    ]
  }
  return ['4. Não há instalador para este sistema. Explique isso e passe o link das releases para o usuário baixar o código-fonte.']
}

/**
 * The brief of the agent hired by "Pedir para um agente me atualizar". Written for
 * people who downloaded the app and may not know git or a terminal: the agent
 * explains each step and never needs a GitHub account (the repository is public).
 */
export function selfUpdateBrief(info: AppInfo & { repo: string }, channel: UpdateChannel, pid: number, workDir: string): string {
  const repo = info.repo
  const api = repo.replace('https://github.com/', 'https://api.github.com/repos/')
  const lines = [
    '# Atualizar o Agent Office',
    '',
    'O usuário clicou em "Pedir para um agente me atualizar", na janela Sobre do Agent Office. Atualize o app desta máquina para a versão mais nova publicada. O usuário pode não saber programar: fale simples, em português, e diga o que cada passo faz antes de rodar.',
    '',
    '## Situação',
    '',
    `- Versão instalada: ${info.version}`,
    `- Canal: ${channel === 'beta' ? 'beta (aceita versões de teste, como v0.4.0-beta.1)' : 'estável (só versões finais, sem -beta)'}`,
    `- Sistema: ${info.os}`,
    info.packaged ? `- App instalado em: \`${info.location}\`` : `- Rodando do código-fonte (\`npm run dev\`) em: \`${info.location}\``,
    `- Processo do app: ${pid}`,
    `- Dados do usuário: \`${info.dataDir}\`. Não mexa nessa pasta: a versão nova usa os mesmos dados.`,
    `- Releases: ${repo}/releases (repositório público: não precisa de conta nem de token)`,
    '',
    '## Passos',
    '',
  ]
  if (info.packaged) {
    lines.push(
      `1. Ache a versão mais nova: ${channel === 'beta' ? `\`curl -fsSL "${api}/releases?per_page=20"\` e fique com a de maior versão (semver)` : `\`curl -fsSL ${api}/releases/latest\``}. Se ela não for maior que ${info.version}, diga que o app já está na versão mais nova e pare.`,
      `2. Baixe nesta pasta (\`${workDir}\`) o arquivo desta máquina, escolhido na lista \`assets\` da release: ${assetHint(info)}.`,
      '3. Confira o download: o tamanho bate com o `size` do asset, e o sha512 (em base64) bate com o do `.yml` de atualização da mesma release (`latest-mac.yml`, `latest.yml` ou a versão `beta` deles). Se não bater, apague e pare.',
      ...installSteps(info, pid),
    )
  } else {
    lines.push(
      '1. Veja se há mudanças locais com `git status`. Se houver, não descarte nada: explique e pergunte o que fazer.',
      '2. Traga a versão nova com `git pull --ff-only` e instale as dependências com `npm install`.',
      '3. Termine dizendo que é preciso fechar o app e rodar `npm run dev` de novo. Não feche o app você mesmo: você roda dentro dele.',
    )
  }
  lines.push(
    '',
    '## Se algo der errado',
    '',
    `Sem internet, sem permissão, arquivo faltando: não force nem improvise outro caminho. Diga o que aconteceu e como atualizar à mão: baixar o instalador em ${repo}/releases/latest e abrir. Não mexa em nada fora desta pasta e do app instalado.`,
  )
  return lines.join('\n')
}
