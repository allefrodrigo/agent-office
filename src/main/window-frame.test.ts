import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TITLE_BAR, windowFrame } from './window-frame.ts'

test('windowFrame darwin: same options as v0.2.0', () => {
  assert.deepEqual(windowFrame('darwin'), { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } })
})

test('windowFrame win32: hidden title bar with the office-coloured overlay', () => {
  assert.deepEqual(windowFrame('win32'), {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1b1d2b', symbolColor: '#e6e6f0', height: 32 },
  })
  assert.deepEqual(TITLE_BAR, { color: '#1b1d2b', symbolColor: '#e6e6f0', height: 32 })
  // a copy, so nobody can mutate the shared constant through the window options
  assert.notEqual(windowFrame('win32').titleBarOverlay, TITLE_BAR)
})

test('windowFrame linux and others: default frame', () => {
  assert.deepEqual(windowFrame('linux'), {})
  assert.deepEqual(windowFrame('freebsd'), {})
})
