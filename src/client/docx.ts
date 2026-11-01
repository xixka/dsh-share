import { createDownloadFilename } from './filename.ts'
import { escapeXml } from './docx-xml.ts'
import type { ShareMessage } from './content.ts'
import { cloneShareMessage, visibleAssistantElements } from './card.ts'
import type { ShareSettings } from './settings.ts'
import { replaceGenuiWithImages } from './static-genui.ts'

/**
 * 可编辑 DOCX 导出：把与图片相同的可见内容转换成 WordprocessingML。
 * 文本、标题、列表、表格、代码块全部是原生 Word 对象（可编辑、可搜索），
 * 图片颜色主题与字号档位映射到 w:color / w:sz / w:shd，观感尽量贴近导出图片。
 */

// 图片导出同一套字号档位（16/18/20px），Word 用半点：16px=12pt=24 半点。
const WORD_FONT_HALF_POINTS: Record<string, number> = { normal: 24, large: 27, xlarge: 30 }
const WORD_BODY_COLOR = '1F2329'
const WORD_MUTED_COLOR = '666666'
const WORD_LINK_COLOR = '4D6BFE'
const WORD_INLINE_CODE_BG = 'F5F5F5'
const WORD_CODE_BLOCK_BG = 'F8F8FA'
const WORD_BORDER_COLOR = 'DDDDDD'

interface WordRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  color?: string
  link?: string
}

interface WordBlock {
  kind: 'heading' | 'paragraph' | 'code' | 'quote' | 'list' | 'table' | 'image' | 'notice'
  level?: number
  ordered?: boolean
  runs?: WordRun[]
  codeText?: string
  cells?: string[][]
  src?: string
  text?: string
}

function textContent(node: Element): string {
  return node.textContent ?? ''
}

/** 行内元素 → runs，保留加粗/斜体/下划线/行内代码/链接/颜色。 */
function collectRuns(source: Node, inherited: WordRun = { text: '' }): WordRun[] {
  if (source.nodeType === 3) {
    const text = source.textContent ?? ''
    return text ? [{ ...inherited, text }] : []
  }
  if (source.nodeType !== 1) return []
  const element = source as Element
  const tag = element.localName.toLowerCase()
  if (tag === 'br') return [{ ...inherited, text: '\n' }]
  const next: WordRun = { ...inherited }
  switch (tag) {
    case 'strong': case 'b': next.bold = true; break
    case 'em': case 'i': next.italic = true; break
    case 'u': next.underline = true; break
    case 'del': case 's': next.strike = true; break
    case 'a': {
      const href = element.getAttribute('href') ?? ''
      // 只保留公共外链，内网/带认证链接退化为纯文本，口径与 HTML 导出一致。
      if (/^https:\/\//.test(href) && !/token|secret|auth|key|signature|credential/i.test(href)) next.link = href
      next.color = WORD_LINK_COLOR
      break
    }
    case 'code': next.code = true; break
    case 'span': {
      const color = (element as HTMLElement).style?.color
      if (/^#[\da-f]{6}$/i.test(color)) next.color = color.slice(1).toUpperCase()
      break
    }
    case 'button': case 'svg': case 'script': case 'style': return []
    default: break
  }
  const runs: WordRun[] = []
  for (const child of element.childNodes) runs.push(...collectRuns(child, next))
  return runs
}

/** 把克隆的对话 DOM 转成 Word 块序列；块级元素递归，行内内容归并为段落。 */
function collectBlocks(source: Node, blocks: WordBlock[], inheritedQuote = false): void {
  for (const child of source.childNodes) {
    if (child.nodeType === 3) {
      const text = (child.textContent ?? '').trim()
      if (text) blocks.push({ kind: 'paragraph', runs: [{ text }] })
      continue
    }
    if (child.nodeType !== 1) continue
    const element = child as Element
    const tag = element.localName.toLowerCase()
    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        blocks.push({ kind: 'heading', level: Number(tag.slice(1)), runs: collectRuns(element) })
        break
      case 'pre': {
        // 代码块：整块等宽文本，带底色段落底纹。
        const codeElement = element.querySelector('code')
        blocks.push({ kind: 'code', codeText: textContent(codeElement ?? element).replace(/\n$/, '') })
        break
      }
      case 'blockquote':
        collectBlocks(element, blocks, true)
        break
      case 'ul': case 'ol':
        for (const item of element.children) {
          if (item.localName.toLowerCase() !== 'li') continue
          blocks.push({ kind: 'list', ordered: tag === 'ol', runs: collectRuns(item) })
        }
        break
      case 'table': {
        const rows: string[][] = []
        for (const row of element.querySelectorAll('tr')) {
          const cells = [...row.querySelectorAll('th, td')].map(cell => textContent(cell).trim())
          if (cells.length) rows.push(cells)
        }
        if (rows.length) blocks.push({ kind: 'table', cells: rows })
        break
      }
      case 'img': {
        const src = element.getAttribute('src') ?? ''
        const alt = element.getAttribute('alt') ?? ''
        if (src.startsWith('data:image/png;base64,')) blocks.push({ kind: 'image', src, text: alt })
        else if (alt) blocks.push({ kind: 'notice', text: alt })
        break
      }
      case 'svg': case 'button': case 'canvas': break
      case 'p': case 'div': {
        // 触发器卡片等容器：标题行加粗、正文弱化色，仍保持可编辑文本。
        const runs = collectRuns(element)
        const text = runs.map(run => run.text).join('').trim()
        if (text) blocks.push({ kind: 'paragraph', runs })
        break
      }
      default: {
        // 行内标签落在块级上下文（如 details/summary）：按内容归并。
        const runs = collectRuns(element)
        const text = runs.map(run => run.text).join('').trim()
        if (text) blocks.push({ kind: inheritedQuote ? 'quote' : 'paragraph', runs })
        break
      }
    }
  }
}

function runXml(run: WordRun): string {
  const props: string[] = []
  if (run.code) {
    props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')
    props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${WORD_INLINE_CODE_BG}"/>`)
  }
  if (run.bold) props.push('<w:b/>')
  if (run.italic) props.push('<w:i/>')
  if (run.underline) props.push('<w:u w:val="single"/>')
  if (run.strike) props.push('<w:strike/>')
  if (run.color) props.push(`<w:color w:val="${run.color}"/>`)
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  // split text with newlines into separate <w:br/> segments
  const segments = run.text.split('\n')
  const body = segments.map((segment, index) => {
    const escaped = escapeXml(segment)
    const br = index > 0 ? '<w:br/>' : ''
    if (!escaped) return br
    return `${br}<w:t xml:space="preserve">${escaped}</w:t>`
  }).join('')
  return `<w:r>${rPr}${body}</w:r>`
}

function paragraphXml(runs: WordRun[], options: { style?: string; shade?: string; indent?: number; spacingBefore?: number } = {}): string {
  const pPr: string[] = []
  if (options.style) pPr.push(`<w:pStyle w:val="${options.style}"/>`)
  if (options.shade) pPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${options.shade}"/>`)
  if (options.indent) pPr.push(`<w:ind w:left="${options.indent}"/>`)
  pPr.push(`<w:spacing w:before="${options.spacingBefore ?? 0}" w:after="120" w:line="300" w:lineRule="auto"/>`)
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${runs.map(runXml).join('')}</w:p>`
}

function blocksToXml(blocks: readonly WordBlock[]): string {
  const out: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        const level = Math.min(4, block.level ?? 2)
        out.push(`<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>${(block.runs ?? []).map(runXml).join('')}</w:p>`)
        break
      }
      case 'code': {
        const lines = (block.codeText ?? '').split('\n')
        for (const line of lines) {
          const runs: WordRun[] = [{ text: line || ' ', code: true }]
          out.push(paragraphXml(runs, { shade: WORD_CODE_BLOCK_BG }))
        }
        break
      }
      case 'quote':
        out.push(paragraphXml((block.runs ?? []).map(run => ({ ...run, italic: true, color: run.color ?? WORD_MUTED_COLOR })), { indent: 420 }))
        break
      case 'list': {
        const marker = block.ordered ? '1.' : '•'
        const runs: WordRun[] = [{ text: `${marker} ` }, ...(block.runs ?? [])]
        out.push(paragraphXml(runs, { indent: 240 }))
        break
      }
      case 'table': {
        const rows = block.cells ?? []
        if (!rows.length) break
        const columnCount = Math.max(...rows.map(row => row.length))
        const grid = `<w:tblGrid>${Array.from({ length: columnCount }, () => `<w:gridCol w:w="1600"/>`).join('')}</w:tblGrid>`
        const body = rows.map((row, rowIndex) => {
          const cells = Array.from({ length: columnCount }, (_, column) => {
            const text = row[column] ?? ''
            const shade = rowIndex === 0 ? `<w:shd w:val="clear" w:color="auto" w:fill="F1F1F4"/>` : ''
            return `<w:tc><w:tcPr>${shade}<w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="${WORD_BORDER_COLOR}"/></w:tcBorders></w:tcPr><w:p>${runXml({ text })}</w:p></w:tc>`
          }).join('')
          return `<w:tr>${cells}</w:tr>`
        }).join('')
        out.push(`<w:tbl><w:tblPr><w:tblBorders><w:insideH w:val="single" w:sz="4" w:color="${WORD_BORDER_COLOR}"/></w:tblBorders></w:tblPr>${grid}${body}</w:tbl>`)
        out.push('<w:p/>')
        break
      }
      case 'image': {
        // 图片在 DOCX 里需要媒体部件与关系项；为保持文档轻量可编辑，统一退化为占位说明。
        out.push(paragraphXml([{ text: block.text || '[图片]', color: WORD_MUTED_COLOR }], { indent: 240 }))
        break
      }
      case 'notice':
        out.push(paragraphXml([{ text: block.text ?? '', color: WORD_MUTED_COLOR }], { shade: WORD_INLINE_CODE_BG }))
        break
      default:
        out.push(paragraphXml(block.runs ?? []))
        break
    }
  }
  return out.join('')
}

/** 纯 Store ZIP 装配（与 zip.ts 同构，支持 UTF-8 文件名和空压缩方法）。 */
async function storeZip(entries: ReadonlyArray<{ name: string; content: Uint8Array<ArrayBuffer> }>, now: Date): Promise<Blob> {
  const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
    return value >>> 0
  })
  const crc32 = (data: Uint8Array): number => {
    let crc = 0xffffffff
    for (const byte of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]!
    return (crc ^ 0xffffffff) >>> 0
  }
  const encoder = new TextEncoder()
  const local: BlobPart[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  const date = ((Math.min(2107, Math.max(1980, now.getFullYear())) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  let offset = 0
  let directorySize = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const content = entry.content
    const crc = crc32(content)
    const header = new Uint8Array(30 + name.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0x800, true)
    view.setUint16(10, time, true)
    view.setUint16(12, date, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, content.length, true)
    view.setUint32(22, content.length, true)
    view.setUint16(26, name.length, true)
    header.set(name, 30)
    const centralEntry = new Uint8Array(46 + name.length)
    const centralView = new DataView(centralEntry.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 0x800, true)
    centralEntry.set(header.subarray(4, 30), 6)
    centralView.setUint32(42, offset, true)
    centralEntry.set(name, 46)
    local.push(header, content)
    central.push(centralEntry)
    offset += header.length + content.length
    directorySize += centralEntry.length
  }
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, directorySize, true)
  endView.setUint32(16, offset, true)
  // 单一 Blob part：规避 jsdom 等旧实现把多个 Uint8Array part 拼接错位的兼容问题。
  const total = offset + directorySize + end.length
  const bytes = new Uint8Array(total)
  let cursor = 0
  for (const part of [...local, ...central, end]) {
    bytes.set(part, cursor)
    cursor += part.length
  }
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:color w:val="${WORD_BODY_COLOR}"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="42"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="38"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>`

/** 将与图片相同的可见内容导出为可编辑 DOCX。 */
export async function createShareDocx(
  document: Document,
  messages: readonly ShareMessage[],
  locale: 'zh' | 'en',
  settings: ShareSettings,
): Promise<Blob> {
  const blocks: WordBlock[] = []
  blocks.push({ kind: 'heading', level: 1, runs: [{ text: locale === 'zh' ? '对话分享' : 'Shared conversation' }] })
  for (const message of messages) {
    if (message.omittedBefore > 0) {
      blocks.push({
        kind: 'notice',
        text: locale === 'zh'
          ? `中间省略 ${message.omittedBefore} 组对话`
          : `${message.omittedBefore} conversation ${message.omittedBefore === 1 ? 'group was' : 'groups were'} omitted`,
      })
    }
    blocks.push({
      kind: 'heading',
      level: 2,
      runs: [{ text: message.role === 'user' ? (locale === 'zh' ? '用户' : 'User') : 'DeepSeek' }],
    })
    const elements = message.role === 'assistant'
      ? visibleAssistantElements(message.elements, settings.hideProcess)
      : message.elements
    for (const element of elements) {
      const clone = cloneShareMessage(element, locale, message.role === 'assistant' && settings.hideProcess)
      await replaceGenuiWithImages(clone, locale, settings)
      collectBlocks(clone, blocks)
    }
  }

  const halfPoints = WORD_FONT_HALF_POINTS[settings.fontSize] ?? 24
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${blocksToXml(blocks)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`

  const encoder = new TextEncoder()
  return storeZip([
    { name: '[Content_Types].xml', content: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', content: encoder.encode(ROOT_RELS) },
    { name: 'word/document.xml', content: encoder.encode(documentXml) },
    { name: 'word/_rels/document.xml.rels', content: encoder.encode(DOCUMENT_RELS) },
    { name: 'word/styles.xml', content: encoder.encode(STYLES_XML) },
  ], new Date())
}

/** 下载 DOCX，命名与其它导出一致。 */
export function downloadDocxFile(document: Document, blob: Blob, title?: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = createDownloadFilename('docx', title)
  anchor.click()
  document.defaultView?.setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export const DOCX_BODY_COLOR = WORD_BODY_COLOR
export const DOCX_HALF_POINTS = WORD_FONT_HALF_POINTS
