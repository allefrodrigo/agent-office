import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
// Shown in Settings so you can tell which build is open.
const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
const build = `${pad(now.getDate())}/${pad(now.getMonth() + 1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __APP_BUILD__: JSON.stringify(build),
    },
  },
})
