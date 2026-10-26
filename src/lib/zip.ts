// Dependency-free ZIP writer (STORE) and reader (STORE/DEFLATE).
// Nothing is extracted to disk; both declared and actual sizes are bounded.
const enc = new TextEncoder(),
  dec = new TextDecoder()
const MAX_TOTAL = 256 * 1024 * 1024
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
export function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const b of data) crc = table[(crc ^ b) & 255]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
export async function makeZip(files: Record<string, Blob | string>): Promise<Blob> {
  const entries = Object.entries(files)
  if (
    entries.length > 5000 ||
    entries.reduce(
      (n, [, value]) => n + (typeof value === 'string' ? enc.encode(value).length : value.size),
      0,
    ) >
      MAX_TOTAL - 2 * 1024 * 1024
  )
    throw new Error('数据包超过单包 254 MB / 5000 个文件的导出上限，请拆分项目。')
  const chunks: BlobPart[] = [],
    centers: BlobPart[] = []
  let offset = 0,
    count = 0
  for (const [name, value] of Object.entries(files)) {
    const data = new Uint8Array(
        await (typeof value === 'string' ? new Blob([value]) : value).arrayBuffer(),
      ),
      path = enc.encode(name),
      crc = crc32(data)
    const local = new Uint8Array(30 + path.length),
      v = new DataView(local.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 0x800, true)
    v.setUint32(14, crc, true)
    v.setUint32(18, data.length, true)
    v.setUint32(22, data.length, true)
    v.setUint16(26, path.length, true)
    local.set(path, 30)
    chunks.push(local, data)
    const central = new Uint8Array(46 + path.length),
      c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x800, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, path.length, true)
    c.setUint32(42, offset, true)
    central.set(path, 46)
    centers.push(central)
    offset += local.length + data.length
    count++
  }
  const directory = new Blob(centers),
    end = new Uint8Array(22),
    e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, count, true)
  e.setUint16(10, count, true)
  e.setUint32(12, directory.size, true)
  e.setUint32(16, offset, true)
  return new Blob([...chunks, directory, end], { type: 'application/zip' })
}
export async function readZip(blob: Blob): Promise<Map<string, Blob>> {
  if (blob.size > MAX_TOTAL) throw new Error('压缩包超过 256 MB 上限。')
  const bytes = new Uint8Array(await blob.arrayBuffer()),
    v = new DataView(bytes.buffer)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0) throw new Error('无效的 ZIP 文件。')
  if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) throw new Error('不支持分卷 ZIP。')
  const count = v.getUint16(end + 10, true)
  if (count > 5000 || count === 65535) throw new Error('文件数量超过限制，或文件为不支持的 ZIP64。')
  let pos = v.getUint32(end + 16, true),
    total = 0
  const files = new Map<string, Blob>()
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || v.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP 目录损坏。')
    const flags = v.getUint16(pos + 8, true),
      method = v.getUint16(pos + 10, true),
      crc = v.getUint32(pos + 16, true),
      compressed = v.getUint32(pos + 20, true),
      size = v.getUint32(pos + 24, true),
      len = v.getUint16(pos + 28, true),
      extra = v.getUint16(pos + 30, true),
      comment = v.getUint16(pos + 32, true),
      offset = v.getUint32(pos + 42, true)
    const name = dec.decode(bytes.slice(pos + 46, pos + 46 + len))
    pos += 46 + len + extra + comment
    if (
      /^(\/|\\|[a-z]:)/i.test(name) ||
      name.split(/[\\/]/).includes('..') ||
      name.includes('\0') ||
      files.has(name)
    )
      throw new Error('数据包含不安全或重复的路径。')
    total += size
    if (total > MAX_TOTAL || compressed > MAX_TOTAL || size > MAX_TOTAL || flags & 1)
      throw new Error('ZIP 超出展开大小上限，或已加密。')
    if (name.endsWith('/')) continue
    if (offset + 30 > bytes.length || v.getUint32(offset, true) !== 0x04034b50)
      throw new Error('ZIP 文件头损坏。')
    const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true)
    if (start + compressed > bytes.length) throw new Error('ZIP 文件内容不完整。')
    const packed = new Blob([bytes.slice(start, start + compressed)])
    let content: Blob
    if (method === 0) content = packed
    else if (method === 8) {
      const reader = packed
          .stream()
          .pipeThrough(new DecompressionStream('deflate-raw'))
          .getReader(),
        parts: Uint8Array<ArrayBuffer>[] = []
      let actual = 0
      while (true) {
        const result = await reader.read()
        if (result.done) break
        actual += result.value.byteLength
        if (actual > size || actual > MAX_TOTAL) {
          await reader.cancel()
          throw new Error('ZIP 实际展开内容超过申报大小。')
        }
        parts.push(new Uint8Array(result.value))
      }
      content = new Blob(parts)
    } else throw new Error(`不支持的 ZIP 压缩算法：${method}`)
    if (content.size !== size || crc32(new Uint8Array(await content.arrayBuffer())) !== crc)
      throw new Error(`文件校验失败：${name}`)
    files.set(name, content)
  }
  return files
}
