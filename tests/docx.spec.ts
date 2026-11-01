// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createShareDocx, DOCX_BODY_COLOR, DOCX_HALF_POINTS } from '../src/client/docx.ts'
import { DEFAULT_SHARE_SETTINGS } from '../src/client/settings.ts'
import type { ShareMessage } from '../src/client/content.ts'

const toPng = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,AQID'))
vi.mock('html-to-image', () => ({ toPng, toBlob: vi.fn() }))

function message(html: string, role: 'user' | 'assistant' = 'assistant', turn = 1): ShareMessage {
  const element = document.createElement('div')
  element.innerHTML = html
  return { elements: [element], role, turn, order: turn * 2, omittedBefore: 0 }
}

/** 解包 Store ZIP；从 central directory 定位条目，返回 文件名 -> 文本 与原始字节。 */
async function unpack(blob: Blob): Promise<Map<string, { text: string; bytes: Uint8Array }>> {
  const raw = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('Could not read docx bytes'))
    reader.readAsArrayBuffer(blob)
  })
  const bytes = new Uint8Array(raw)
  const view = new DataView(bytes.buffer)
  // 从尾部找 EOCD 签名
  let eocd = bytes.length - 22
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1
  if (eocd < 0) throw new Error('EOCD not found')
  const count = view.getUint16(eocd + 10, true)
  let header = view.getUint32(eocd + 16, true)
  const files = new Map<string, { text: string; bytes: Uint8Array }>()
  for (let index = 0; index < count; index++) {
    if (view.getUint32(header, true) !== 0x02014b50) break
    const nameLength = view.getUint16(header + 28, true)
    const extraLength = view.getUint16(header + 30, true)
    const commentLength = view.getUint16(header + 32, true)
    const localOffset = view.getUint32(header + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(header + 46, header + 46 + nameLength))
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const contentStart = localOffset + 30 + localNameLength + localExtraLength
    const contentLength = view.getUint32(localOffset + 18, true)
    const content = bytes.subarray(contentStart, contentStart + contentLength)
    files.set(name, { text: Buffer.from(content).toString('utf8'), bytes: content })
    header += 46 + nameLength + extraLength + commentLength
  }
  return files
}

describe('DOCX 装配', () => {
  it('生成包含最小 OOXML 部件集的 Word 文档', async () => {
    const blob = await createShareDocx(document, [message('<p>回答内容</p>')], 'zh', DEFAULT_SHARE_SETTINGS)
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    const files = await unpack(blob)
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
    ])
    expect(files.get('[Content_Types].xml')!.text).toContain('wordprocessingml.document.main+xml')
    expect(files.get('word/document.xml')!.text).toContain('<w:document')
    expect(files.get('word/styles.xml')!.text).toContain('Heading1')
  })

  it('标题/正文/列表/表格/代码块映射为可编辑 Word 对象', async () => {
    const entry = message(
      '<h2>退出清理清单</h2>'
      + '<ul><li><strong>greenGo H5</strong> 已停止</li><li>普通项</li></ul>'
      + '<div class="md-code-block"><div data-code-block-banner>TS</div><pre><code>const x = 1</code></pre></div>'
      + '<table><tr><th>项</th><th>状态</th></tr><tr><td>进程</td><td>停止</td></tr></table>'
      + '<blockquote>保留成果：login-jump.js</blockquote>',
    )
    const blob = await createShareDocx(document, [entry], 'zh', DEFAULT_SHARE_SETTINGS)
    const documentXml = (await unpack(blob)).get('word/document.xml')!.text
    expect(documentXml).toContain('<w:pStyle w:val="Heading2"/>')
    expect(documentXml).toContain('<w:t xml:space="preserve">退出清理清单</w:t>')
    expect(documentXml).toContain('<w:b/>')
    expect(documentXml).toContain('• ')
    expect(documentXml).toContain('w:fill="F8F8FA"')
    expect(documentXml).toContain('<w:tbl>')
    expect(documentXml).toContain('<w:t xml:space="preserve">保留成果：login-jump.js</w:t>')
  })

  it('行内代码胶囊与链接保留样式语义', async () => {
    const entry = message('<p>修改 <code>index.html</code> 与 <a href="https://example.org/docs">文档</a></p>')
    const blob = await createShareDocx(document, [entry], 'zh', DEFAULT_SHARE_SETTINGS)
    const documentXml = (await unpack(blob)).get('word/document.xml')!.text
    expect(documentXml).toContain('w:fill="F5F5F5"')
    expect(documentXml).toContain('Consolas')
    expect(documentXml).toContain('4D6BFE')
    expect(documentXml).not.toContain('w:hyperlink')
  })

  it('转义 XML 特殊字符并剔除控制字符', async () => {
    const entry = message('<p>a &lt; b &amp; c "quoted" d\u0007e</p>')
    const blob = await createShareDocx(document, [entry], 'zh', DEFAULT_SHARE_SETTINGS)
    const documentXml = (await unpack(blob)).get('word/document.xml')!.text
    expect(documentXml).toContain('a &lt; b &amp; c &quot;quoted&quot; de')
    expect(documentXml).not.toMatch(/[\u0007]/)
  })

  it('字号档位映射 Word 半点', () => {
    expect(DOCX_HALF_POINTS).toEqual({ normal: 24, large: 27, xlarge: 30 })
    expect(DOCX_BODY_COLOR).toBe('1F2329')
  })

  it('隐藏过程时只导出最终回答', async () => {
    const entry = message('<div data-variant="think">思考</div><p>最终回答</p>')
    entry.elements[0]!.dataset.chatFlowKind = 'assistant-step'
    const blob = await createShareDocx(document, [entry], 'zh', { ...DEFAULT_SHARE_SETTINGS, hideProcess: true })
    const documentXml = (await unpack(blob)).get('word/document.xml')!.text
    expect(documentXml).toContain('最终回答')
    expect(documentXml).not.toContain('思考')
  })
})
