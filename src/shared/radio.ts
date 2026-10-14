// What the lounge TV plays: Claude FM, or any YouTube video or playlist the player pastes.

/** A video, a playlist, or a video inside a playlist (`list` keeps playing after it). */
export interface RadioSource {
  video?: string
  list?: string
}

const VIDEO_ID = /^[\w-]{11}$/
const LIST_ID = /^[\w-]{12,64}$/
// Playlist IDs pasted without a link: PL (user), OL (album), UU (uploads), RD (mix), FL/LL (likes).
const BARE_LIST = /^(PL|OL|UU|RD|FL|LL)[\w-]{10,62}$/
const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

/**
 * Reads a YouTube link (watch, playlist, youtu.be, live, shorts, embed, YouTube Music)
 * or a bare playlist ID. Only the IDs survive, so nothing else from the text reaches the embed.
 * Null when it is not something YouTube can play.
 */
export function parseYoutube(input: string): RadioSource | null {
  const text = input.trim()
  if (BARE_LIST.test(text)) return { list: text }
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  let video: string | undefined
  if (host === 'youtu.be') video = url.pathname.split('/')[1]
  else if (HOSTS.has(host)) {
    const [kind, id] = url.pathname.split('/').slice(1)
    video = kind === 'watch' ? (url.searchParams.get('v') ?? undefined) : ['live', 'shorts', 'embed', 'v'].includes(kind) ? id : undefined
    if (video === 'videoseries') video = undefined
  } else return null
  const list = url.searchParams.get('list') ?? undefined
  const source: RadioSource = {}
  if (video && VIDEO_ID.test(video)) source.video = video
  if (list && LIST_ID.test(list)) source.list = list
  return source.video || source.list ? source : null
}

/** Path and query of the embed player for a source, autoplaying and looping. */
export function embedPath(s: RadioSource): string {
  const params = new URLSearchParams({ autoplay: '1', controls: '0', rel: '0', playsinline: '1', enablejsapi: '1', loop: '1' })
  if (s.list) params.set('list', s.list)
  // A lone video only loops when it is its own playlist.
  else if (s.video) params.set('playlist', s.video)
  return `/embed/${s.video ?? 'videoseries'}?${params}`
}
