import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests of the main process logic. Electron is swapped for test/mocks/electron.ts:
// app.getPath points at a temporary folder, so no test ever touches real user data.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      electron: resolve('test/mocks/electron.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The git tests start real git processes: under load, and on the Windows runners where
    // git is slower, 5 s was not always enough (AO-42).
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/main/store.ts',
        'src/main/tickets.ts',
        'src/main/ledger.ts',
        'src/main/stats.ts',
        'src/main/squads.ts',
        'src/main/validate.ts',
        'src/shared/pricing.ts',
        'src/renderer/src/world/pathfinding.ts',
      ],
      thresholds: { lines: 70 },
    },
  },
})
