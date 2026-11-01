// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { deflateSync } from 'node:zlib'
import { createPagesPdf, downloadPdfFile } from '../src/client/pdf.ts'
import { createDownloadFilename } from '../src/client/filename.ts'

/** 构造一张最小但结构完整的 PNG（canvas.toBlob 输出同构）：IHDR + IDAT + IEND。 */
function makePng(width: number, height: number, colorType: 0 | 2 | 4 | 6, interlace = 0): Blob {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4
  const raw = new Uint8Array(height * (1 + width * channels))
  for (let row = 0; row < height; row++) raw[row * (1 + width * channels)] = 0
  const compressed = deflateSync(raw)
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = colorType
  ihdr[12] = interlace
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index)
    out.set(data, 8)
    let crc = 0xffffffff
    for (const byte of out.subarray(4, 8 + data.length)) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]!
    }
    view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0)
    return out
  }
  const bytes = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())]
  const total = bytes.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of bytes) {
    out.set(part, offset)
    offset += part.length
  }
  return new Blob([out], { type: 'image/png' })
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(new Error('Could not read pdf bytes'))
    reader.readAsArrayBuffer(blob)
  })
}

function parsePdf(data: Uint8Array): { text: string; offsets: Map<number, number> } {
  const text = Buffer.from(data).toString('latin1')
  const offsets = new Map<number, number>()
  for (const match of text.matchAll(/(\d+) 0 obj/g)) {
    offsets.set(Number(match[1]), match.index ?? 0)
  }
  return { text, offsets }
}

describe('PDF 装配', () => {
  it('单页 PNG 装配为单页 PDF，页面尺寸等于像素尺寸', async () => {
    const blob = await createPagesPdf([makePng(768, 512, 2)], '标题', new Date(2026, 9, 10, 9, 8, 7))
    const bytes = await readBlobBytes(blob)
    const { text, offsets } = parsePdf(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 1')
    expect(text).toContain('/MediaBox [0 0 768 512]')
    expect(text).toContain('/Width 768')
    expect(text).toContain('/Height 512')
    expect(text).toContain('/ColorSpace /DeviceRGB')
    expect(text).toContain('/Predictor 15 /Colors 3')
    expect(text).toContain('/CreationDate (D:20261010090807)')
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    // xref 偏移指向真实对象头
    const xrefStart = Number(text.match(/startxref\n(\d+)/)![1])
    expect(text.slice(xrefStart, xrefStart + 4)).toBe('xref')
    for (const [id, offset] of offsets) {
      expect(text.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`)
    }
  })

  it('多页 PNG 装配顺序与页码一致，页对象互相独立', async () => {
    const pages = [makePng(100, 80, 2), makePng(120, 90, 2), makePng(140, 100, 2)]
    const blob = await createPagesPdf(pages)
    const { text } = parsePdf(await readBlobBytes(blob))
    expect(text).toContain('/Count 3')
    expect(text.match(/\/MediaBox \[0 0 \d+ \d+\]/g)).toHaveLength(3)
    expect(text).toContain('/MediaBox [0 0 100 80]')
    expect(text).toContain('/MediaBox [0 0 120 90]')
    expect(text).toContain('/MediaBox [0 0 140 100]')
  })

  it('带 Alpha 的 PNG 走 RGBA 通道和显式 Decode', async () => {
    const blob = await createPagesPdf([makePng(64, 48, 6)])
    const { text } = parsePdf(await readBlobBytes(blob))
    expect(text).toContain('/Predictor 15 /Colors 4')
    expect(text).toContain('/Decode [0 1 0 1 0 1 0 1]')
  })

  it('灰度与灰度+Alpha 的 PNG 映射 DeviceGray', async () => {
    const gray = parsePdf(await readBlobBytes(await createPagesPdf([makePng(32, 32, 0)]))).text
    expect(gray).toContain('/ColorSpace /DeviceGray')
    expect(gray).toContain('/Colors 1')
    const grayAlpha = parsePdf(await readBlobBytes(await createPagesPdf([makePng(32, 32, 4)]))).text
    expect(grayAlpha).toContain('/ColorSpace /DeviceGray')
    expect(grayAlpha).toContain('/Colors 2')
    expect(grayAlpha).toContain('/Decode [0 1 0 1]')
  })

  it('拒绝非 PNG 输入、隔行 PNG 和超预算归档', async () => {
    await expect(createPagesPdf([new Blob(['not a png'])])).rejects.toThrow('not a valid PNG')
    await expect(createPagesPdf([makePng(10, 10, 2, 1)])).rejects.toThrow('not a valid PNG')
    await expect(createPagesPdf([])).rejects.toThrow('budget')
  })

  it('下载文件名与 PNG/HTML 导出一致', () => {
    const downloads: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf-preview')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    downloadPdfFile(document, new Blob([new Uint8Array([1])]), '测试对话')
    expect(click).toHaveBeenCalledOnce()
    expect(downloads).toEqual(['dsh-测试对话.pdf'])
    click.mockRestore()
    revoke.mockRestore()
    expect(createDownloadFilename('pdf', undefined, undefined, new Date(2026, 9, 10, 9, 8, 7))).toBe('dsh-20261010-090807.pdf')
  })
})
