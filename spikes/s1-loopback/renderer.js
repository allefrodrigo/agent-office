const btn = document.getElementById('go')
const status = document.getElementById('status')
const bar = document.getElementById('bar')
const say = (t) => { status.textContent = t }

let SELFTEST = false
// Autoteste do encanamento (worklet, IPC, gravação em segundo plano) sem TCC: tom de 440 Hz gerado na página.
function selfTestStream() {
  const g = new AudioContext({ sampleRate: 48000 })
  const osc = g.createOscillator()
  const amp = g.createGain()
  amp.gain.value = 0.25
  osc.frequency.value = 440
  const dst = g.createMediaStreamDestination()
  osc.connect(amp).connect(dst)
  osc.start()
  return dst.stream
}

async function record(seconds) {
  btn.disabled = true
  say('Pedindo a captura…')
  let stream
  try {
    stream = SELFTEST ? selfTestStream() : await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
  } catch (err) {
    say(`Falhou: ${err.name}`)
    window.s1.gdm({ gdm: { ok: false, errorName: err.name, errorMessage: String(err.message).slice(0, 200) }, audioTrack: null })
    btn.disabled = false
    return
  }
  stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t) })
  const at = stream.getAudioTracks()[0]
  const audioTrack = at
    ? { present: true, settings: at.getSettings(), muted: at.muted, readyState: at.readyState, enabled: at.enabled, count: stream.getAudioTracks().length }
    : { present: false }
  window.s1.gdm({ gdm: { ok: true }, audioTrack })
  if (!at) { say('Sem faixa de áudio.'); btn.disabled = false; return }

  at.addEventListener('ended', () => { say('A faixa de áudio terminou.'); window.s1.ended() })

  const ctx = new AudioContext({ sampleRate: 48000 })
  await ctx.audioWorklet.addModule('pcm16k-worklet.js')
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm16k', { numberOfInputs: 1, numberOfOutputs: 0 })
  src.connect(node)
  window.s1.start()
  let blocks = 0
  const total = seconds * 10
  node.port.onmessage = ({ data }) => {
    window.s1.chunk(data.seq, data.buf)
    blocks++
    const s = new Int16Array(data.buf)
    let peak = 0
    for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > peak) peak = a }
    bar.style.width = `${Math.min(100, (peak / 32768) * 100 * 2)}%`
    if (blocks % 10 === 0) say(`Gravando: ${blocks / 10} s de ${seconds} s`)
    if (blocks >= total) {
      say(`Pronto: ${seconds} s gravados.`)
      src.disconnect(); node.port.onmessage = null
      at.stop(); ctx.close()
      btn.disabled = false
    }
  }
}

window.s1.config().then(({ auto, seconds, selftest }) => {
  SELFTEST = selftest
  btn.textContent = `Gravar ${seconds} s`
  btn.addEventListener('click', () => record(seconds))
  if (auto) record(seconds)
})
