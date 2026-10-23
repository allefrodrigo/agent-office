import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AppInfo } from '../src/shared/types'
import { githubRepo, installLocation, packageFields, selfUpdateBrief } from '../src/main/about'

const REPO = 'https://github.com/allefrodrigo/agent-office'

describe('githubRepo', () => {
  it('reads every npm repository form', () => {
    expect(githubRepo('git+https://github.com/allefrodrigo/agent-office.git')).toBe(REPO)
    expect(githubRepo('https://github.com/allefrodrigo/agent-office')).toBe(REPO)
    expect(githubRepo('git@github.com:allefrodrigo/agent-office.git')).toBe(REPO)
    expect(githubRepo('github:allefrodrigo/agent-office')).toBe(REPO)
    expect(githubRepo('allefrodrigo/agent-office')).toBe(REPO)
  })

  it('leaves other hosts out: the releases live on GitHub', () => {
    expect(githubRepo('https://gitlab.com/a/b')).toBeUndefined()
    expect(githubRepo(undefined)).toBeUndefined()
  })
})

describe('packageFields', () => {
  it('reads this package.json', () => {
    const f = packageFields(JSON.parse(readFileSync('package.json', 'utf8')))
    expect(f.repo).toBe(REPO)
    expect(f.homepage).toBe(REPO)
    expect(f.license).toBe('MIT')
    expect(f.author).toBeTruthy()
    expect(f.description).toBeTruthy()
  })

  it('takes the author name from both forms', () => {
    expect(packageFields({ author: 'Ana Lima <ana@x.dev> (https://x.dev)' }).author).toBe('Ana Lima')
    expect(packageFields({ author: { name: 'Ana Lima', email: 'ana@x.dev' } }).author).toBe('Ana Lima')
  })

  it('drops what is malformed and falls back to the repository for the page', () => {
    const f = packageFields({ description: 42, homepage: 'javascript:alert(1)', repository: { url: 'github:o/r' } })
    expect(f.description).toBeUndefined()
    expect(f.homepage).toBe('https://github.com/o/r')
    expect(packageFields(null)).toEqual({
      description: undefined,
      author: undefined,
      license: undefined,
      homepage: undefined,
      repo: undefined,
    })
  })
})

describe('installLocation', () => {
  it('is the .app bundle on the Mac', () => {
    expect(installLocation('/Applications/Agent Office.app/Contents/MacOS/Agent Office', 'darwin', true, '')).toBe(
      '/Applications/Agent Office.app',
    )
  })

  it('is the install folder on Windows', () => {
    expect(installLocation('C:\\Users\\ana\\AppData\\Local\\Programs\\agent-office\\Agent Office.exe', 'win32', true, '')).toBe(
      'C:\\Users\\ana\\AppData\\Local\\Programs\\agent-office',
    )
  })

  it('is the checkout when running from source', () => {
    expect(
      installLocation('/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', 'darwin', false, '/code/agent-office'),
    ).toBe('/code/agent-office')
  })
})

describe('selfUpdateBrief', () => {
  const info: AppInfo & { repo: string } = {
    version: '0.3.4',
    repo: REPO,
    packaged: true,
    location: '/Applications/Agent Office.app',
    dataDir: '/Users/ana/Library/Application Support/Agent Office',
    os: 'macOS 26.0 (arm64)',
    platform: 'darwin',
    arch: 'arm64',
    electron: '44.5.1',
    chrome: '1',
    node: '22',
    claude: '2.1.0',
  }

  it('tells the agent where to look, what to download and which process to wait for', () => {
    const brief = selfUpdateBrief(info, 'stable', 4321, '/tmp/agent-office-update')
    expect(brief).toContain('https://api.github.com/repos/allefrodrigo/agent-office/releases/latest')
    expect(brief).toContain('Agent-Office-<versão>-arm64.zip')
    expect(brief).toContain('kill -0 4321')
    expect(brief).toContain('/Applications/Agent Office.app')
    expect(brief).toContain('/tmp/agent-office-update')
    expect(brief).toContain('Não mexa nessa pasta')
  })

  it('follows pre-releases only on the beta channel', () => {
    expect(selfUpdateBrief(info, 'beta', 1, '/tmp/u')).toContain('/releases?per_page=20')
    expect(selfUpdateBrief(info, 'stable', 1, '/tmp/u')).not.toContain('per_page')
  })

  it('runs the Windows installer instead of swapping a bundle', () => {
    const brief = selfUpdateBrief(
      { ...info, platform: 'win32', arch: 'x64', location: 'C:\\Programs\\agent-office' },
      'stable',
      1,
      'C:\\Temp\\u',
    )
    expect(brief).toContain('Agent-Office-Setup-<versão>.exe')
    expect(brief).not.toContain('ditto')
  })

  it('pulls the source instead of downloading when running from a checkout', () => {
    const brief = selfUpdateBrief({ ...info, packaged: false, location: '/code/agent-office' }, 'stable', 1, '/code/agent-office')
    expect(brief).toContain('git pull --ff-only')
    expect(brief).not.toContain('api.github.com')
  })
})
