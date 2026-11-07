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
        'src/main/claude-run.ts',
        'src/shared/meetings.ts',
        'src/shared/meeting-audio.ts',
        'src/shared/meeting-pcm.ts',
        'src/shared/media-permissions.ts',
        'src/shared/meetings-search.ts',
        'src/shared/meetings-view.ts',
        'src/shared/meeting-templates.ts',
        'src/main/stats.ts',
        'src/main/squads.ts',
        'src/main/validate.ts',
        'src/main/routines/*.ts',
        'src/shared/schedule.ts',
        'src/shared/routines.ts',
        'src/shared/pricing.ts',
        'src/shared/system-audio.ts',
        'src/main/meetings/*.ts',
        'src/shared/meetings-ata.ts',
        'src/shared/meeting-room.ts',
        'src/shared/meeting-map.ts',
        'src/shared/meeting-tray.ts',
        'src/renderer/src/world/pathfinding.ts',
      ],
      thresholds: { lines: 70 },
    },
  },
})
