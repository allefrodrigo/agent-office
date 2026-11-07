// Spike S-1, caminho 2: captura o áudio global do sistema com um process tap do Core Audio
// (macOS 14.2+) e escreve PCM s16le 16 kHz mono no stdout. stderr recebe só linhas JSON
// com números (formato, RMS/pico por segundo, frames, erros), nunca conteúdo de áudio.
//
// Uso: ./tap [--seconds N] > saida.pcm      (para com SIGINT/SIGTERM ou após N segundos)
//
// Protótipo descartável. Não vai para src/.

import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

// MARK: - Saída

func log(_ fields: [String: Any]) {
    var f = fields
    f["t"] = (Date().timeIntervalSince1970 * 1000).rounded() / 1000
    if let data = try? JSONSerialization.data(withJSONObject: f, options: [.sortedKeys]),
       var line = String(data: data, encoding: .utf8) {
        line += "\n"
        FileHandle.standardError.write(line.data(using: .utf8)!)
    }
}

func fail(_ step: String, _ status: OSStatus) -> Never {
    log(["event": "error", "step": step, "osstatus": Int(status), "fourcc": fourCC(status)])
    teardown()
    exit(1)
}

func fourCC(_ s: OSStatus) -> String {
    let u = UInt32(bitPattern: s)
    let bytes = [24, 16, 8, 0].map { UInt8((u >> UInt32($0)) & 0xFF) }
    return bytes.allSatisfy({ $0 >= 32 && $0 < 127 }) ? String(bytes: bytes, encoding: .ascii)! : String(s)
}

/// Escreve tudo no fd 1; devolve false se o leitor fechou o pipe.
func writeStdout(_ ptr: UnsafeRawPointer, _ count: Int) -> Bool {
    var off = 0
    while off < count {
        let n = write(1, ptr + off, count - off)
        if n < 0 { if errno == EINTR { continue }; return false }
        off += n
    }
    return true
}

// MARK: - Helpers Core Audio

func getProp<T>(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector, _ value: inout T,
                qualifier: UnsafeRawPointer? = nil, qualifierSize: UInt32 = 0) -> OSStatus {
    var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<T>.size)
    return AudioObjectGetPropertyData(obj, &addr, qualifierSize, qualifier, &size, &value)
}

func ownProcessObject() -> AudioObjectID {
    var pid = getpid()
    var obj = AudioObjectID(kAudioObjectUnknown)
    _ = getProp(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyTranslatePIDToProcessObject,
                &obj, qualifier: &pid, qualifierSize: UInt32(MemoryLayout<pid_t>.size))
    return obj
}

func defaultOutputUID() -> String? {
    var dev = AudioObjectID(kAudioObjectUnknown)
    guard getProp(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, &dev) == noErr
    else { return nil }
    var uid: Unmanaged<CFString>?
    guard getProp(dev, kAudioDevicePropertyDeviceUID, &uid) == noErr, let u = uid else { return nil }
    return u.takeRetainedValue() as String
}

// MARK: - Estado

var tapID = AudioObjectID(kAudioObjectUnknown)
var aggID = AudioObjectID(kAudioObjectUnknown)
var procID: AudioDeviceIOProcID?
var tornDown = false

func teardown() {
    if tornDown { return }
    tornDown = true
    var steps: [String: Int] = [:]
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
    log(["event": "teardown", "osstatus": steps])
}

// MARK: - Argumentos

var maxSeconds: Double = 0
do {
    let args = CommandLine.arguments
    if let i = args.firstIndex(of: "--seconds"), i + 1 < args.count, let s = Double(args[i + 1]), s > 0 {
        maxSeconds = s
    }
}

// MARK: - Tap + aggregate device

let ioQueue = DispatchQueue(label: "s1.tap.io", qos: .userInitiated)
let ownObj = ownProcessObject()
let tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: ownObj == kAudioObjectUnknown ? [] : [ownObj])
tapDesc.uuid = UUID()
tapDesc.name = "s1-swift-tap"
tapDesc.isPrivate = true
tapDesc.muteBehavior = .unmuted

var st = AudioHardwareCreateProcessTap(tapDesc, &tapID)
if st != noErr || tapID == kAudioObjectUnknown {
    log(["event": "error", "step": "AudioHardwareCreateProcessTap", "osstatus": Int(st), "fourcc": fourCC(st),
         "hint": "falha ao criar o tap; macOS < 14.2 ou permissão negada"])
    exit(1)
}

var asbd = AudioStreamBasicDescription()
st = getProp(tapID, kAudioTapPropertyFormat, &asbd)
if st != noErr { fail("kAudioTapPropertyFormat", st) }
guard let inFormat = AVAudioFormat(streamDescription: &asbd) else { fail("AVAudioFormat(tap)", -1) }

var aggDesc: [String: Any] = [
    kAudioAggregateDeviceNameKey: "s1-swift-tap-agg",
    kAudioAggregateDeviceUIDKey: UUID().uuidString,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true,
                                       kAudioSubTapUIDKey: tapDesc.uuid.uuidString]],
]
// A saída padrão como relógio principal; sem ela o tap também funciona, mas sem referência de clock.
let outUID = defaultOutputUID()
if let u = outUID {
    aggDesc[kAudioAggregateDeviceMainSubDeviceKey] = u
    aggDesc[kAudioAggregateDeviceSubDeviceListKey] = [[kAudioSubDeviceUIDKey: u]]
}
st = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID)
if st != noErr { fail("AudioHardwareCreateAggregateDevice", st) }

// MARK: - Conversão para 16 kHz mono Int16

let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
guard let converter = AVAudioConverter(from: inFormat, to: outFormat) else { fail("AVAudioConverter", -1) }
converter.downmix = true
converter.sampleRateConverterQuality = AVAudioQuality.high.rawValue

log(["event": "format", "in_rate": asbd.mSampleRate, "in_channels": Int(asbd.mChannelsPerFrame),
     "in_bits": Int(asbd.mBitsPerChannel), "in_float": (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0,
     "in_interleaved": inFormat.isInterleaved, "out_rate": 16000, "out_channels": 1, "out": "s16le",
     "tap_id": Int(tapID), "agg_id": Int(aggID), "own_process_obj": Int(ownObj),
     "main_subdevice": outUID != nil, "max_seconds": maxSeconds])

// Estatísticas (acessadas só na ioQueue)
var inFramesTotal: Int64 = 0
var outFramesTotal: Int64 = 0
var secFrames = 0
var secSumSq: Double = 0
var secPeak: Float = 0
var secCallbacks = 0
var nonZeroSeen = false
var zeroSeconds = 0
var silenceWarned = false
var convErrors = 0
var secondIndex = 0

func flushSecond() {
    let rms = secFrames > 0 ? sqrt(secSumSq / Double(secFrames)) : 0
    let dbfs = rms > 0 ? 20 * log10(rms) : -999
    log(["event": "level", "sec": secondIndex, "rms": (rms * 1e6).rounded() / 1e6,
         "rms_dbfs": (dbfs * 10).rounded() / 10, "peak": Double(secPeak), "in_frames": secFrames,
         "callbacks": secCallbacks, "out_frames_total": outFramesTotal, "all_zero": secPeak == 0])
    if secPeak == 0 { zeroSeconds += 1 }
    if !nonZeroSeen && zeroSeconds >= 3 && !silenceWarned {
        silenceWarned = true
        log(["event": "warning", "kind": "all_zero",
             "hint": "3 s de amostras exatamente zero: ou nada está tocando, ou a permissão 'Gravação de áudio do sistema' foi negada (o macOS entrega silêncio, não erro). Ajustes > Privacidade e Segurança > Gravação de Tela e Áudio do Sistema."])
    }
    secondIndex += 1
    secFrames = 0; secSumSq = 0; secPeak = 0; secCallbacks = 0
}

func finish(_ reason: String, code: Int32 = 0) {
    teardown()
    if secFrames > 0 { flushSecond() }
    log(["event": "summary", "reason": reason, "in_frames": inFramesTotal, "out_frames": outFramesTotal,
         "out_seconds": Double(outFramesTotal) / 16000, "out_bytes": outFramesTotal * 2,
         "all_zero": !nonZeroSeen, "zero_seconds": zeroSeconds, "conv_errors": convErrors,
         "permission_suspect": !nonZeroSeen && inFramesTotal > 0])
    exit(code)
}

let inRate = asbd.mSampleRate
st = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, ioQueue) { _, inData, _, _, _ in
    guard let inBuf = AVAudioPCMBuffer(pcmFormat: inFormat, bufferListNoCopy: inData, deallocator: nil) else { return }
    let n = Int(inBuf.frameLength)
    if n == 0 { return }
    inFramesTotal += Int64(n)
    secCallbacks += 1

    if let ch = inBuf.floatChannelData {
        let chans = Int(inFormat.channelCount)
        let stride = inBuf.stride
        for i in 0..<n {
            var m: Float = 0
            for c in 0..<chans { m += ch[c][i * stride] }
            m /= Float(chans)
            secSumSq += Double(m * m)
            let a = abs(m)
            if a > secPeak { secPeak = a }
        }
        if secPeak > 0 { nonZeroSeen = true }
    }
    secFrames += n

    let cap = AVAudioFrameCount(Double(n) * 16000 / inRate) + 64
    let outBuf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap)!
    var fed = false
    var err: NSError?
    let status = converter.convert(to: outBuf, error: &err) { _, outStatus in
        if fed { outStatus.pointee = .noDataNow; return nil }
        fed = true
        outStatus.pointee = .haveData
        return inBuf
    }
    if status == .error {
        convErrors += 1
        if convErrors <= 5 { log(["event": "error", "step": "convert", "code": err?.code ?? -1]) }
    } else if outBuf.frameLength > 0, let p = outBuf.int16ChannelData {
        let count = Int(outBuf.frameLength)
        if !writeStdout(p[0], count * 2) { finish("stdout_closed") }
        outFramesTotal += Int64(count)
    }

    if secFrames >= Int(inRate) { flushSecond() }
    if maxSeconds > 0 && Double(inFramesTotal) >= maxSeconds * inRate { finish("seconds") }
}
if st != noErr { fail("AudioDeviceCreateIOProcIDWithBlock", st) }

st = AudioDeviceStart(aggID, procID)
if st != noErr { fail("AudioDeviceStart", st) }
log(["event": "started"])

// MARK: - Sinais e watchdog

signal(SIGPIPE, SIG_IGN)
var sigSources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: ioQueue)
    src.setEventHandler { finish(sig == SIGINT ? "sigint" : "sigterm") }
    src.resume()
    sigSources.append(src)
}

// Se nenhum callback chegar em 3 s, avisa (o aggregate pode não ter iniciado).
ioQueue.asyncAfter(deadline: .now() + 3) {
    if inFramesTotal == 0 { log(["event": "warning", "kind": "no_callbacks", "hint": "nenhum buffer em 3 s"]) }
}
// --seconds também por relógio, caso os callbacks parem.
if maxSeconds > 0 {
    ioQueue.asyncAfter(deadline: .now() + maxSeconds + 2) { finish("seconds_wallclock") }
}

dispatchMain()
