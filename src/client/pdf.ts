import { createDownloadFilename } from './filename.ts'

/**
 * 把 PNG 分页原样嵌入单文件 PDF：每页一个等比页面 + 一张整页图片。
 * 图片走 PDF 原生 PNG（FlateDecode）路径，不做任何重压缩或重排版，
 * 视觉结果与预览中的分页 PNG 逐像素一致；PDF 装配本身不引入额外渲染差异。
 */

// PNG 数据块标签，用于在不解析 zlib 流的前提下抽取 IDAT 原始字节。
const PNG_TYPE = new Uint8Array([0x49, 0x44, 0x41, 0x54])
const PNG_SIGNATURE = 0x89504e47

interface PngImage {
  data: Uint8Array<ArrayBuffer>
  width: number
  height: number
  colorType: number
}

interface PdfPage {
  image: PngImage
}

function concatBytes(parts: readonly Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) out[index] = text.charCodeAt(index) & 0x7f
  return out
}

/** 逐块扫描 PNG，抽取 IHDR 元数据和 IDAT 像素流；非 PNG 输入返回 undefined。 */
function parsePng(blob: ArrayBuffer): (PngImage & { colorType: number }) | undefined {
  const bytes = new Uint8Array(blob) as Uint8Array<ArrayBuffer>
  const view = new DataView(blob)
  if (bytes.length < 33 || view.getUint32(0) !== PNG_SIGNATURE) return undefined
  if (view.getUint32(12) !== 0x49484452) return undefined // IHDR
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const colorType = view.getUint8(25)
  const interlace = view.getUint8(28)
  if (!width || !height || width > 32767 || height > 32767) return undefined
  // 隔行 PNG 的扫描线布局与 Predictor 期望不同；canvas.toBlob 不会产出隔行图，遇到即拒绝。
  if (interlace !== 0) return undefined
  if (!pngColorSpace(colorType)) return undefined
  const idat: Uint8Array<ArrayBuffer>[] = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    if (length > bytes.length - offset - 12) break
    const type = bytes.subarray(offset + 4, offset + 8)
    if (type[0] === PNG_TYPE[0] && type[1] === PNG_TYPE[1] && type[2] === PNG_TYPE[2] && type[3] === PNG_TYPE[3]) {
      idat.push(bytes.subarray(offset + 8, offset + 8 + length))
    }
    const isEnd = type[0] === 0x49 && type[1] === 0x45 && type[2] === 0x4e && type[3] === 0x44
    offset += 12 + length
    if (isEnd) break
  }
  if (!idat.length) return undefined
  return { data: concatBytes(idat), width, height, colorType }
}

/** PDF 1.4 起内建 PNG Predictor；把 PNG 的颜色类型映射到 PDF 色空间。 */
function pngColorSpace(colorType: number): string | undefined {
  switch (colorType) {
    case 0: return '/DeviceGray'
    case 2: return '/DeviceRGB'
    case 4: return '/DeviceGray'
    case 6: return '/DeviceRGB'
    default: return undefined
  }
}

/** 逐对象拼装 PDF；字符串与二进制段分开累积，避免 TextEncoder 二次编码。 */
function assemblePdf(pages: readonly PdfPage[], now: Date): Blob {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const created = `D:${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  const offsets: number[] = []
  const push = (part: Uint8Array): void => {
    chunks.push(part as Uint8Array<ArrayBuffer>)
    offset += part.length
  }
  const beginObject = (id: number): void => {
    offsets[id] = offset
    push(asciiBytes(`${id} 0 obj\n`))
  }

  push(asciiBytes('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'))

  const pageCount = pages.length
  // 对象编号：1 目录，2 页树，3 信息，4.. 页，之后每页 3 个（图片、内容流、页面对象）。
  const firstPageObject = 4
  const imageId = (index: number): number => firstPageObject + index * 3
  const contentId = (index: number): number => firstPageObject + index * 3 + 1
  const pageId = (index: number): number => firstPageObject + index * 3 + 2
  const kids = pages.map((_, index) => `${pageId(index)} 0 R`).join(' ')

  beginObject(1)
  push(asciiBytes(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`))
  beginObject(2)
  push(asciiBytes(`<< /Type /Pages /Count ${pageCount} /Kids [ ${kids} ] >>\nendobj\n`))
  beginObject(3)
  push(asciiBytes(`<< /Producer (dsh-share) /CreationDate (${created}) >>\nendobj\n`))

  for (const [index, page] of pages.entries()) {
    const { image } = page
    // 页面尺寸 = 像素尺寸（1px = 1pt，96dpi 视觉与 PNG 相同），内容边距为零。
    const colorSpace = pngColorSpace(image.colorType)
    const colors = image.colorType === 0 ? 1 : image.colorType === 2 ? 3 : 4
    // /Decode 让带 Alpha 的 PNG 按预乘不透明处理：透明底叠在页面白底上，观感与预览一致。
    const decode = image.colorType === 4 || image.colorType === 6 ? ' /Decode [0 1 0 1 0 1 0 1]' : ''

    beginObject(imageId(index))
    push(asciiBytes(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}`
      + ` /ColorSpace ${colorSpace ?? '/DeviceRGB'} /BitsPerComponent 8${decode}`
      + ` /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${colors} /BitsPerComponent 8 /Columns ${image.width} >>`
      + ` /Length ${image.data.length} >>\nstream\n`,
    ))
    push(image.data)
    push(asciiBytes('\nendstream\nendobj\n'))

    const content = `${image.width} 0 0 ${image.height} 0 0 cm /Im0 Do\n`
    beginObject(contentId(index))
    push(asciiBytes(
      `<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    ))

    beginObject(pageId(index))
    push(asciiBytes(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}]`
      + ` /Resources << /XObject << /Im0 ${imageId(index)} 0 R >> >>`
      + ` /Contents ${contentId(index)} 0 R >>\nendobj\n`,
    ))
  }

  const xrefOffset = offset
  const maxId = firstPageObject + pageCount * 3 - 1
  const xref = [`xref\n0 ${maxId + 1}\n0000000000 65535 f \n`]
  for (let id = 1; id <= maxId; id++) xref.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  xref.push(
    `trailer\n<< /Size ${maxId + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  )
  push(asciiBytes(xref.join('')))
  return new Blob(chunks, { type: 'application/pdf' })
}

/** 读取 Blob 字节；Blob.arrayBuffer 缺失时（旧 jsdom）用 FileReader 兜底。 */
async function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('Could not read page bytes'))
    reader.readAsArrayBuffer(blob)
  })
}

/** 把分页 PNG 装配为单文件 PDF；单页同样生成，保证格式选择行为一致。 */
export async function createPagesPdf(pages: readonly Blob[], title?: string, now = new Date(), signal?: AbortSignal): Promise<Blob> {
  if (!pages.length || pages.length > 10000 || pages.reduce((sum, page) => sum + page.size, 0) > 512 * 1024 * 1024) {
    throw new Error('Archive exceeds export budget')
  }
  const pdfPages: PdfPage[] = []
  for (const page of pages) {
    signal?.throwIfAborted()
    const image = parsePng(await readBlobBytes(page))
    // 预览页始终是插件自己生成的 PNG；异常输入直接失败而不是产出坏页。
    if (!image) throw new Error('Share page is not a valid PNG')
    pdfPages.push({ image })
  }
  return assemblePdf(pdfPages, now)
}

/** 下载装配好的 PDF，命名与 PNG/HTML 导出一致。 */
export function downloadPdfFile(document: Document, blob: Blob, title?: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = createDownloadFilename('pdf', title)
  anchor.click()
  document.defaultView?.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
