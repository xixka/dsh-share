// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShareMarkdown } from '../src/client/markdown.ts'
import type { ShareMessage } from '../src/client/content.ts'

const toPng = vi.hoisted(() => vi.fn())
vi.mock('html-to-image', () => ({ toPng }))

afterEach(() => {
  document.body.innerHTML = ''
  toPng.mockReset()
})

function user(turn: number, order: number, omittedBefore = 0): ShareMessage {
  const prompt = document.createElement('div')
  prompt.innerHTML = `<p>问题 ${turn}</p><ul><li>列表项</li></ul>`
  prompt.dataset.chatFlowKind = 'user'
  return { elements: [prompt], omittedBefore, order, role: 'user', turn }
}

function assistant(turn: number, order: number, omittedBefore = 0, process = false): ShareMessage {
  const intermediate = document.createElement('div')
  intermediate.dataset.chatFlowKind = 'assistant-step'
  intermediate.innerHTML = '<div data-variant="think">Think 过程</div><p>中间回答</p>'
  const tool = document.createElement('div')
  tool.dataset.chatFlowKind = 'tool-call'
  tool.innerHTML = '<div data-disclosure-row><span>Bash</span><span>pnpm test</span></div>'
  const answer = document.createElement('div')
  answer.dataset.chatFlowKind = 'assistant-step'
  answer.innerHTML = `<article><p>回答 ${turn}</p><pre><code class="language-ts">const value = ${turn}</code></pre></article>`
  return {
    elements: process ? [intermediate, tool, answer] : [answer],
    omittedBefore,
    order,
    role: 'assistant',
    turn,
  }
}

describe('Markdown 导出', () => {
  it('按问答组保留角色、列表、代码块和工具摘要，并标记不连续选择', async () => {
    const markdown = await createShareMarkdown([
      user(1, 2),
      assistant(1, 3, 0, true),
      user(3, 6, 1),
      assistant(3, 7),
    ], 'zh', { width: 'tablet', fontSize: 'normal', hideProcess: false })

    expect(markdown).toContain('# 对话分享')
    expect(markdown.match(/## 用户/g)).toHaveLength(2)
    expect(markdown.match(/## DeepSeek/g)).toHaveLength(2)
    expect(markdown).toMatch(/-\s+列表项/)
    expect(markdown).toContain('```ts')
    expect(markdown).toContain('> Bash · pnpm test')
    expect(markdown).toContain('> 中间省略 1 组对话')
    expect(markdown.indexOf('问题 1')).toBeLessThan(markdown.indexOf('回答 3'))
  })

  it('底层转换器仍能处理单独的用户或回答片段', async () => {
    const onlyUser = await createShareMarkdown([
      user(2, 4),
    ], 'zh', { width: 'tablet', fontSize: 'normal', hideProcess: false })
    const onlyAssistant = await createShareMarkdown([
      assistant(2, 5),
    ], 'zh', { width: 'tablet', fontSize: 'normal', hideProcess: false })

    expect(onlyUser).toContain('## 用户')
    expect(onlyUser).not.toContain('## DeepSeek')
    expect(onlyAssistant).toContain('## DeepSeek')
    expect(onlyAssistant).not.toContain('## 用户')
  })

  it('不展示过程时同步移除 Think、工具调用和中间回答', async () => {
    const markdown = await createShareMarkdown([
      assistant(1, 3, 0, true),
    ], 'zh', { width: 'tablet', fontSize: 'normal', hideProcess: true })

    expect(markdown).toContain('回答 1')
    expect(markdown).not.toContain('Think')
    expect(markdown).not.toContain('Bash')
    expect(markdown).not.toContain('中间回答')
  })

  it('按 alpha.3 的过程成员标记保留展开状态下的最终回答', async () => {
    const message = assistant(2, 5, 0, true)
    const [intermediate, tool, answer] = message.elements
    intermediate?.setAttribute('data-turn-process-member', 'true')
    tool?.setAttribute('data-turn-process-member', 'true')

    const markdown = await createShareMarkdown([
      message,
    ], 'zh', { width: 'tablet', fontSize: 'normal', hideProcess: true })

    expect(markdown).toContain('回答 2')
    expect(markdown).not.toContain('Think')
    expect(markdown).not.toContain('Bash')
    expect(markdown).not.toContain('中间回答')
  })

  it('将 GenUI 渲染内容内嵌为静态图片并清理临时节点', async () => {
    const entry = assistant(2, 5)
    const source = entry.elements[0]!
    source.innerHTML = '<p>图表前</p><div data-genui-artifact><div data-genui><strong>销售趋势</strong><svg><path /></svg><canvas></canvas><button>筛选</button></div></div><p>图表后</p>'
    const before = source.outerHTML
    toPng.mockImplementation(async (element: HTMLElement) => {
      expect(element.hasAttribute('data-genui')).toBe(true)
      expect(element.querySelector('svg,canvas')).not.toBeNull()
      expect(element.querySelector('button')).toBeNull()
      return 'data:image/png;base64,AQID'
    })

    const markdown = await createShareMarkdown([entry], 'zh', {
      width: 'tablet', fontSize: 'normal', hideProcess: false,
    })

    expect(markdown).toContain('图表前')
    expect(markdown).toContain('![GenUI 交互组件](data:image/png;base64,AQID)')
    expect(markdown).toContain('图表后')
    expect(markdown).not.toContain('销售趋势')
    expect(toPng).toHaveBeenCalledOnce()
    expect(source.outerHTML).toBe(before)
    expect(document.querySelector('[data-dsh-share-genui-host]')).toBeNull()
  })

  it('GenUI 静态化失败时不返回缺失组件的文件', async () => {
    const entry = assistant(2, 5)
    entry.elements[0]!.innerHTML = '<div data-genui><canvas></canvas></div>'
    toPng.mockRejectedValue(new Error('tainted canvas'))

    await expect(createShareMarkdown([entry], 'zh', {
      width: 'tablet', fontSize: 'normal', hideProcess: false,
    })).rejects.toThrow('tainted canvas')
    expect(document.querySelector('[data-dsh-share-genui-host]')).toBeNull()
  })
})
