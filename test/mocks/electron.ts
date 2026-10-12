import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Just enough of Electron for the main process modules under test.
// Every path lives in a temporary folder made per test file; tests may move it with setPath.
const paths: Record<string, string> = { userData: mkdtempSync(join(tmpdir(), 'agent-office-test-')) }

export const app = {
  getPath: (name: string): string => paths[name] ?? paths.userData,
  setPath: (name: string, value: string): void => {
    paths[name] = value
  },
  isPackaged: false,
}

export default { app }
