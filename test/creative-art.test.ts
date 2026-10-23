import { describe, expect, it } from 'vitest'
import { artHtml } from '../src/main/creative/art'
import { cleanJob } from '../src/main/creative/flow'

const style = { layout: 'base', tema: 'escuro', fonte: 'sans', cor: '#9b7bf0' } as const

describe('arte com texto', () => {
  it('escapes the copy and runs no script', () => {
    const html = artHtml('data:image/png;base64,AA', 1024, 1280, { titulo: '<img src=x onerror=alert(1)>', cta: 'R$ 9,90 & "grátis"' }, style)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('R$ 9,90 &amp; &quot;grátis&quot;')
    expect(html).toContain("default-src 'none'")
  })

  it('ignores a color that is not #rrggbb', () => {
    const html = artHtml('data:image/png;base64,AA', 1080, 1080, { titulo: 'Oi' }, { ...style, cor: 'red;}body{display:none' })
    expect(html).not.toContain('display:none')
    expect(html).toContain('#9b7bf0')
  })
})

describe('new nodes', () => {
  it('jobs keep their params in range', () => {
    const c = cleanJob({ jobId: 'j', floorId: 'f', nodeId: 'n', kind: 'carousel', params: { slides: 40, aspect: '9:16' }, inputs: {} }, ['f'])
    expect(c.params.slides).toBe(10)
    expect(c.params.aspect).toBe('4:5')
    const e = cleanJob({ jobId: 'j', floorId: 'f', nodeId: 'n', kind: 'edit-image', params: { aspect: 'igual' }, inputs: { image: [{ type: 'image', paths: ['/a.png', '/b.sh'] }] } }, ['f'])
    expect(e.inputs.image).toEqual([{ type: 'image', paths: ['/a.png'] }])
  })
})
