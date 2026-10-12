import { describe, expect, it } from 'vitest'
import { stressDataDirError } from '../src/main/env'

describe('modo de carga (AO-31)', () => {
  it('sem AGENT_OFFICE_DATA_DIR o app não abre, com mensagem que diz o que fazer', () => {
    expect(stressDataDirError({ AGENT_OFFICE_DEMO: 'stress' })).toMatch(/AGENT_OFFICE_DATA_DIR=/)
    expect(stressDataDirError({ AGENT_OFFICE_DEMO: 'stress', AGENT_OFFICE_DATA_DIR: '  ' })).not.toBeNull()
  })

  it('com pasta própria, ou fora do modo de carga, segue normal', () => {
    expect(stressDataDirError({ AGENT_OFFICE_DEMO: 'stress', AGENT_OFFICE_DATA_DIR: '/tmp/x' })).toBeNull()
    expect(stressDataDirError({ AGENT_OFFICE_DEMO: '1' })).toBeNull()
    expect(stressDataDirError({})).toBeNull()
  })
})
