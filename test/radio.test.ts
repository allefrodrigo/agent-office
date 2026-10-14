import { describe, expect, it } from 'vitest'
import { embedPath, parseYoutube } from '../src/shared/radio'

const LIST = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'

describe('parseYoutube', () => {
  it('lê link de playlist, com e sem https', () => {
    expect(parseYoutube(`https://www.youtube.com/playlist?list=${LIST}`)).toEqual({ list: LIST })
    expect(parseYoutube(`youtube.com/playlist?list=${LIST}`)).toEqual({ list: LIST })
    expect(parseYoutube(`https://music.youtube.com/playlist?list=${LIST}&si=abc`)).toEqual({ list: LIST })
  })
  it('vídeo dentro de playlist guarda os dois', () => {
    expect(parseYoutube(`https://www.youtube.com/watch?v=jfKfPfyJRdk&list=${LIST}&index=3`)).toEqual({ video: 'jfKfPfyJRdk', list: LIST })
    expect(parseYoutube(`https://youtu.be/jfKfPfyJRdk?list=${LIST}`)).toEqual({ video: 'jfKfPfyJRdk', list: LIST })
  })
  it('lê vídeo solto, live, shorts e embed', () => {
    expect(parseYoutube('https://youtu.be/jfKfPfyJRdk?t=10')).toEqual({ video: 'jfKfPfyJRdk' })
    expect(parseYoutube('https://www.youtube.com/live/jfKfPfyJRdk')).toEqual({ video: 'jfKfPfyJRdk' })
    expect(parseYoutube('https://m.youtube.com/shorts/jfKfPfyJRdk')).toEqual({ video: 'jfKfPfyJRdk' })
    expect(parseYoutube(`https://www.youtube-nocookie.com/embed/videoseries?list=${LIST}`)).toEqual({ list: LIST })
  })
  it('aceita ID de playlist colado sozinho', () => {
    expect(parseYoutube(`  ${LIST} `)).toEqual({ list: LIST })
  })
  it('recusa o que não é YouTube ou não tem ID válido', () => {
    expect(parseYoutube('https://evil.com/watch?v=jfKfPfyJRdk')).toBeNull()
    expect(parseYoutube('https://youtube.com.evil.com/playlist?list=' + LIST)).toBeNull()
    expect(parseYoutube('https://www.youtube.com/watch?v=curto')).toBeNull()
    expect(parseYoutube('https://www.youtube.com/@canal')).toBeNull()
    expect(parseYoutube('javascript:alert(1)')).toBeNull()
    expect(parseYoutube('')).toBeNull()
  })
})

describe('embedPath', () => {
  it('playlist usa videoseries e repete', () => {
    expect(embedPath({ list: LIST })).toMatch(new RegExp(`^/embed/videoseries\\?.*loop=1.*list=${LIST}`))
  })
  it('vídeo solto vira a própria playlist para repetir', () => {
    expect(embedPath({ video: 'jfKfPfyJRdk' })).toMatch(/^\/embed\/jfKfPfyJRdk\?.*playlist=jfKfPfyJRdk/)
  })
  it('vídeo na playlist começa nele e segue a lista', () => {
    const p = embedPath({ video: 'jfKfPfyJRdk', list: LIST })
    expect(p).toMatch(/^\/embed\/jfKfPfyJRdk\?/)
    expect(p).toContain(`list=${LIST}`)
    expect(p).not.toContain('playlist=')
  })
})
