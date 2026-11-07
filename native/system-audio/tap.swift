// system-audio-tap: captura o áudio global do sistema com um process tap do Core Audio
// (macOS 14.2+) e escreve PCM s16le 16 kHz mono no stdout. É o ajudante da sala de reunião
// (ADR 0011); src/main/meetings/system-audio.ts o inicia, um processo por reunião.
//
// Uso: system-audio-tap [--exclude-pid N]... [--seconds N] [--exit-on-stdin-eof]
//
//   --exclude-pid N       Tira do tap o processo N e os filhos diretos dele (repetível). O app
//                         passa o PID do main e dos helpers do Electron, para a voz do TTS e a
//                         rádio não voltarem na gravação. Os filhos que começam a tocar depois
//                         (o serviço de áudio do Electron nasce sob demanda) entram na lista
//                         quando aparecem no Core Audio. O próprio ajudante sempre fica de fora.
//   --seconds N           Para sozinho depois de N segundos de áudio.
//   --exit-on-stdin-eof   Para quando o stdin fecha: se o app morrer sem avisar, o ajudante vai junto.
//
// stderr: uma linha JSON por evento, só números e nomes fixos, nunca conteúdo de áudio.
//   ready, format, level (1/s), excluded, warning (all_zero, no_callbacks), error, summary, teardown.
// Para com SIGTERM, SIGINT, stdout fechado, stdin fechado (com a flag) ou --seconds.
// Saída: 0 ao parar normalmente, 1 em erro do Core Audio, 2 em argumento inválido.

import AVFoundation
import AudioToolbox
import CoreAudio
import Darwin
import Foundation

let startedAt = Date()

// MARK: - Saída

let stderrLock = NSLock()

func emit(_ fields: [String: Any]) {
    var f = fields
    f["t"] = (Date().timeIntervalSince1970 * 1000).rounded() / 1000
    guard let data = try? JSONSerialization.data(withJSONObject: f, options: [.sortedKeys]) else { return }
    stderrLock.lock()
    FileHandle.standardError.write(data + Data([0x0A]))
    stderrLock.unlock()
}

/// Escreve tudo no fd 1; devolve false se o leitor fechou o pipe.
func writeStdout(_ ptr: UnsafeRawPointer, _ count: Int) -> Bool {
    var off = 0
    while off < count {
        let n = write(1, ptr + off, count - off)
        if n < 0 {
            if errno == EINTR { continue }
            return false
        }
        off += n
    }
    return true
}

// MARK: - Argumentos

var excludePids = Set<pid_t>()
var maxSeconds: Double = 0
var exitOnStdinEof = false

func usageError(_ arg: String) -> Never {
    emit(["event": "error", "step": "args", "osstatus": 0, "arg_index": CommandLine.arguments.firstIndex(of: arg) ?? -1])
    exit(2)
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    var i = 0
    while i < args.count {
        let a = args[i]
        switch a {
        case "--exclude-pid":
            guard i + 1 < args.count, let n = Int32(args[i + 1]), n > 0 else { usageError(a) }
            excludePids.insert(n)
            i += 2
        case "--seconds":
            guard i + 1 < args.count, let s = Double(args[i + 1]), s > 0, s.isFinite else { usageError(a) }
            maxSeconds = s
            i += 2
        case "--exit-on-stdin-eof":
            exitOnStdinEof = true
            i += 1
        default:
            usageError(a)
        }
    }
}

// MARK: - Helpers Core Audio

func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
                               mElement: kAudioObjectPropertyElementMain)
}

func getProp<T>(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector, _ value: inout T,
                qualifier: UnsafeRawPointer? = nil, qualifierSize: UInt32 = 0) -> OSStatus {
    var addr = address(selector)
    var size = UInt32(MemoryLayout<T>.size)
    return withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(obj, &addr, qualifierSize, qualifier, &size, $0) }
}

let systemObject = AudioObjectID(kAudioObjectSystemObject)

/// Todos os processos que o Core Audio conhece agora (clientes de áudio).
func processObjects() -> [AudioObjectID] {
    var addr = address(kAudioHardwarePropertyProcessObjectList)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(systemObject, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
    var list = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(systemObject, &addr, 0, nil, &size, &list) == noErr else { return [] }
    return Array(list.prefix(Int(size) / MemoryLayout<AudioObjectID>.size))
}

func pidOf(_ obj: AudioObjectID) -> pid_t? {
    var pid: pid_t = -1
    return getProp(obj, kAudioProcessPropertyPID, &pid) == noErr && pid > 0 ? pid : nil
}

func parentPid(_ pid: pid_t) -> pid_t? {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    guard sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0) == 0, size > 0 else { return nil }
    return info.kp_eproc.e_ppid
}

/// Processos do Core Audio a tirar do tap: os PIDs pedidos, os filhos diretos deles e o próprio ajudante.
func excludedObjects() -> [AudioObjectID] {
    let me = getpid()
    var out: [AudioObjectID] = []
    for obj in processObjects() {
        guard let pid = pidOf(obj) else { continue }
        if pid == me || excludePids.contains(pid) {
            out.append(obj)
        } else if !excludePids.isEmpty, let pp = parentPid(pid), excludePids.contains(pp) {
            out.append(obj)
        }
    }
    return out.sorted()
}

func defaultOutputUID() -> String? {
    var dev = AudioObjectID(kAudioObjectUnknown)
    guard getProp(systemObject, kAudioHardwarePropertyDefaultSystemOutputDevice, &dev) == noErr else { return nil }
    var uid: Unmanaged<CFString>?
    guard getProp(dev, kAudioDevicePropertyDeviceUID, &uid) == noErr, let u = uid else { return nil }
    return u.takeRetainedValue() as String
}

// MARK: - Estado (mexido só na ioQueue depois da partida)

let ioQueue = DispatchQueue(label: "dev.allef.agentoffice.system-audio.io", qos: .userInitiated)
var tapID = AudioObjectID(kAudioObjectUnknown)
var aggID = AudioObjectID(kAudioObjectUnknown)
var procID: AudioDeviceIOProcID?
var tornDown = false
var finished = false
var processListListener: AudioObjectPropertyListenerBlock?

func teardown() {
    if tornDown { return }
    tornDown = true
    var steps: [String: Int] = [:]
    if let l = processListListener {
        var addr = address(kAudioHardwarePropertyProcessObjectList)
        steps["removeListener"] = Int(AudioObjectRemovePropertyListenerBlock(systemObject, &addr, ioQueue, l))
        processListListener = nil
    }
    if let p = procID {
        steps["stop"] = Int(AudioDeviceStop(aggID, p))
        steps["destroyIOProc"] = Int(AudioDeviceDestroyIOProcID(aggID, p))
        procID = nil
    }
    if aggID != kAudioObjectUnknown {
        steps["destroyAggregate"] = Int(AudioHardwareDestroyAggregateDevice(aggID))
        aggID = AudioObjectID(kAudioObjectUnknown)
    }
    if tapID != kAudioObjectUnknown {
        steps["destroyTap"] = Int(AudioHardwareDestroyProcessTap(tapID))
        tapID = AudioObjectID(kAudioObjectUnknown)
    }
    emit(["event": "teardown", "osstatus": steps])
}

func fail(_ step: String, _ status: OSStatus) -> Never {
    emit(["event": "error", "step": step, "osstatus": Int(status)])
    teardown()
    exit(1)
}

// MARK: - Tap + aggregate device

let tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: excludedObjects())
tapDesc.uuid = UUID()
tapDesc.name = "Agent Office system audio"
tapDesc.isPrivate = true
tapDesc.muteBehavior = .unmuted

var st = AudioHardwareCreateProcessTap(tapDesc, &tapID)
if st != noErr || tapID == kAudioObjectUnknown { fail("create_tap", st) }

var asbd = AudioStreamBasicDescription()
st = getProp(tapID, kAudioTapPropertyFormat, &asbd)
if st != noErr { fail("tap_format", st) }
guard let inFormat = AVAudioFormat(streamDescription: &asbd), inFormat.commonFormat == .pcmFormatFloat32 else {
    fail("tap_format", -1)
}

var aggDesc: [String: Any] = [
    kAudioAggregateDeviceNameKey: "Agent Office system audio",
    kAudioAggregateDeviceUIDKey: UUID().uuidString,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true,
                                       kAudioSubTapUIDKey: tapDesc.uuid.uuidString]],
]
// A saída padrão como relógio principal; sem ela o tap também funciona, sem referência de clock.
let outUID = defaultOutputUID()
if let u = outUID {
    aggDesc[kAudioAggregateDeviceMainSubDeviceKey] = u
    aggDesc[kAudioAggregateDeviceSubDeviceListKey] = [[kAudioSubDeviceUIDKey: u]]
}
st = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID)
if st != noErr { fail("create_aggregate", st) }

// MARK: - Conversão para 16 kHz mono Int16

let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
guard let converter = AVAudioConverter(from: inFormat, to: outFormat) else { fail("converter", -1) }
converter.downmix = true
converter.sampleRateConverterQuality = AVAudioQuality.high.rawValue

emit(["event": "format", "in_rate": asbd.mSampleRate, "in_channels": Int(asbd.mChannelsPerFrame),
      "in_bits": Int(asbd.mBitsPerChannel), "out_rate": 16000, "out_channels": 1,
      "main_subdevice": outUID != nil, "max_seconds": maxSeconds])

// MARK: - Exclusão dinâmica

var lastExcluded = tapDesc.processes

/// Refaz a lista de processos excluídos quando um cliente de áudio aparece ou some.
func refreshExclusions() {
    if tornDown { return }
    let now = excludedObjects()
    if now == lastExcluded { return }
    tapDesc.processes = now
    var addr = address(kAudioTapPropertyDescription)
    var desc: CATapDescription = tapDesc
    let s = withUnsafeMutablePointer(to: &desc) {
        AudioObjectSetPropertyData(tapID, &addr, 0, nil, UInt32(MemoryLayout<CATapDescription>.size), $0)
    }
    if s == noErr {
        lastExcluded = now
        emit(["event": "excluded", "count": now.count])
    } else {
        emit(["event": "error", "step": "update_exclusions", "osstatus": Int(s)])
    }
}

// MARK: - Estatísticas (só na ioQueue)

var inFramesTotal: Int64 = 0
var outFramesTotal: Int64 = 0
var secFrames = 0
var secSumSq: Double = 0
var secPeak: Float = 0
var secCallbacks = 0
var nonZeroSeen = false
var zeroRun = 0
var zeroSecondsTotal = 0
var silenceWarned = false
var convErrors = 0
var secondIndex = 0

@Sendable func round3(_ x: Double) -> Double { (x * 1000).rounded() / 1000 }

@Sendable func flushSecond() {
    let rms = secFrames > 0 ? sqrt(secSumSq / Double(secFrames)) : 0
    let dbfs = rms > 0 ? max(-120, 20 * log10(rms)) : -120
    let zero = secPeak == 0
    emit(["event": "level", "sec": secondIndex, "rms_dbfs": (dbfs * 10).rounded() / 10,
          "peak": round3(Double(secPeak)), "frames": secFrames, "callbacks": secCallbacks, "all_zero": zero])
    if zero {
        zeroRun += 1
        zeroSecondsTotal += 1
    } else {
        zeroRun = 0
        silenceWarned = false
    }
    // 3 s de zeros exatos: nada tocando ou a permissão negada (o macOS entrega silêncio, não erro).
    if zeroRun >= 3 && !silenceWarned {
        silenceWarned = true
        emit(["event": "warning", "kind": "all_zero", "seconds": zeroRun, "ever_nonzero": nonZeroSeen])
    }
    secondIndex += 1
    secFrames = 0
    secSumSq = 0
    secPeak = 0
    secCallbacks = 0
}

func finish(_ reason: String, code: Int32 = 0) {
    if finished { return }
    finished = true
    teardown()
    if secFrames > 0 { flushSecond() }
    emit(["event": "summary", "reason": reason, "in_frames": inFramesTotal, "out_frames": outFramesTotal,
          "out_seconds": round3(Double(outFramesTotal) / 16000), "all_zero": !nonZeroSeen,
          "zero_seconds": zeroSecondsTotal, "conv_errors": convErrors,
          "permission_suspect": !nonZeroSeen && inFramesTotal > 0,
          "uptime_ms": Int(Date().timeIntervalSince(startedAt) * 1000)])
    exit(code)
}

let inRate = asbd.mSampleRate
let inChannels = Int(inFormat.channelCount)

st = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, ioQueue) { _, inData, _, _, _ in
    if finished { return }
    guard let inBuf = AVAudioPCMBuffer(pcmFormat: inFormat, bufferListNoCopy: inData, deallocator: nil) else { return }
    let n = Int(inBuf.frameLength)
    if n == 0 { return }
    inFramesTotal += Int64(n)
    secCallbacks += 1

    if let ch = inBuf.floatChannelData {
        let stride = inBuf.stride
        for i in 0..<n {
            var m: Float = 0
            for c in 0..<inChannels { m += ch[c][i * stride] }
            m /= Float(inChannels)
            secSumSq += Double(m * m)
            let a = abs(m)
            if a > secPeak { secPeak = a }
        }
        if secPeak > 0 { nonZeroSeen = true }
    }
    secFrames += n

    let cap = AVAudioFrameCount(Double(n) * 16000 / inRate) + 64
    guard let outBuf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return }
    var fed = false
    var err: NSError?
    let status = converter.convert(to: outBuf, error: &err) { _, outStatus in
        if fed {
            outStatus.pointee = .noDataNow
            return nil
        }
        fed = true
        outStatus.pointee = .haveData
        return inBuf
    }
    if status == .error {
        convErrors += 1
        if convErrors <= 5 { emit(["event": "error", "step": "convert", "osstatus": err?.code ?? -1]) }
    } else if outBuf.frameLength > 0, let p = outBuf.int16ChannelData {
        let count = Int(outBuf.frameLength)
        if !writeStdout(p[0], count * 2) {
            finish("stdout_closed")
            return
        }
        outFramesTotal += Int64(count)
    }

    if secFrames >= Int(inRate) { flushSecond() }
    if maxSeconds > 0 && Double(inFramesTotal) >= maxSeconds * inRate { finish("seconds") }
}
if st != noErr { fail("create_io_proc", st) }

// Sinais antes da partida: o primeiro AudioDeviceStart pode esperar o pedido de permissão.
signal(SIGPIPE, SIG_IGN)
var sigSources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: ioQueue)
    src.setEventHandler { finish(sig == SIGINT ? "sigint" : "sigterm") }
    src.resume()
    sigSources.append(src)
}

st = AudioDeviceStart(aggID, procID)
if st != noErr { fail("device_start", st) }

let listener: AudioObjectPropertyListenerBlock = { _, _ in refreshExclusions() }
var listAddr = address(kAudioHardwarePropertyProcessObjectList)
if AudioObjectAddPropertyListenerBlock(systemObject, &listAddr, ioQueue, listener) == noErr {
    processListListener = listener
}

emit(["event": "ready", "startup_ms": Int(Date().timeIntervalSince(startedAt) * 1000),
      "excluded": lastExcluded.count, "exclude_pids": excludePids.count])

// MARK: - Vigias

// Se nenhum buffer chegar em 3 s, o aggregate pode não ter iniciado.
ioQueue.asyncAfter(deadline: .now() + 3) {
    if inFramesTotal == 0 && !finished { emit(["event": "warning", "kind": "no_callbacks", "seconds": 3]) }
}
// --seconds também pelo relógio, caso os buffers parem.
if maxSeconds > 0 {
    ioQueue.asyncAfter(deadline: .now() + maxSeconds + 2) { finish("seconds_wallclock") }
}
// stdin fechado = o app saiu sem avisar.
var stdinSource: DispatchSourceRead?
if exitOnStdinEof {
    let src = DispatchSource.makeReadSource(fileDescriptor: 0, queue: ioQueue)
    src.setEventHandler {
        var buf = [UInt8](repeating: 0, count: 256)
        let n = read(0, &buf, buf.count)
        if n <= 0 { finish("stdin_closed") }
    }
    src.resume()
    stdinSource = src
}

dispatchMain()
