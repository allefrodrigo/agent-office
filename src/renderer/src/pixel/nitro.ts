// A .nitro bundle (the Habbo asset format HabboAssets serves): a big-endian count of files, then
// for each one its name (u16 length + UTF-8) and its zlib-compressed bytes (u32 length + data).

/** The files of a .nitro bundle by name, inflated. */
export async function unpackNitro(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Map<string, Uint8Array>()
  let at = 0
  const need = (n: number) => {
    if (at + n > bytes.byteLength) throw new Error('Pacote .nitro truncado.')
  }
  need(2)
  const count = view.getUint16(at)
  at += 2
  const text = new TextDecoder()
  for (let i = 0; i < count; i++) {
    need(2)
    const nameLen = view.getUint16(at)
    at += 2
    need(nameLen)
    const name = text.decode(bytes.subarray(at, at + nameLen))
    at += nameLen
    need(4)
    const size = view.getUint32(at)
    at += 4
    need(size)
    out.set(name, await inflate(bytes.subarray(at, at + size)))
    at += size
  }
  return out
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // 'deflate' is the zlib format (RFC 1950), the one the bundle uses
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
