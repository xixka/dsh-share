// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const toPng = vi.hoisted(() => vi.fn(async (element: HTMLElement) => {
  void element
  return 'data:image/png;base64,AQID'
}))

vi.mock('html-to-image', () => ({ toPng }))

afterEach(() => {
  document.body.innerHTML = ''
  toPng.mockClear()
})

describe('GenUI 静态化', () => {
  it('已挂载的分享卡片原位静态化，不移出原宿主', async () => {
    const { replaceGenuiWithImages } = await import('../src/client/static-genui.ts')
    const { DEFAULT_SHARE_SETTINGS } = await import('../src/client/settings.ts')
    const host = document.createElement('div')
    const card = document.createElement('article')
    card.innerHTML = '<p>结论</p><div data-genui><canvas></canvas></div>'
    host.append(card)
    document.body.append(host)

    await replaceGenuiWithImages(card, 'zh', DEFAULT_SHARE_SETTINGS)

    expect(card.parentElement).toBe(host)
    expect(card.isConnected).toBe(true)
    expect(card.querySelector('canvas')).toBeNull()
    const image = card.querySelector<HTMLImageElement>('img[data-dsh-share-genui]')
    expect(image?.src).toBe('data:image/png;base64,AQID')
    expect(image?.alt).toBe('GenUI 交互组件')
    expect(document.querySelector('[data-dsh-share-genui-host]')).toBeNull()
  })

  it('离线副本仍通过临时宿主静态化并恢复脱离状态', async () => {
    const { replaceGenuiWithImages } = await import('../src/client/static-genui.ts')
    const { DEFAULT_SHARE_SETTINGS } = await import('../src/client/settings.ts')
    const root = document.createElement('div')
    root.innerHTML = '<div data-genui><button>交互</button></div>'

    await replaceGenuiWithImages(root, 'en', DEFAULT_SHARE_SETTINGS)

    expect(root.isConnected).toBe(false)
    expect(root.querySelector('img[data-dsh-share-genui]')?.alt).toBe('GenUI interactive component')
    expect(document.querySelector('[data-dsh-share-genui-host]')).toBeNull()
  })

  it('没有 GenUI 块时不触发渲染', async () => {
    const { replaceGenuiWithImages } = await import('../src/client/static-genui.ts')
    const { DEFAULT_SHARE_SETTINGS } = await import('../src/client/settings.ts')
    const root = document.createElement('div')
    root.textContent = '纯文本'

    await replaceGenuiWithImages(root, 'zh', DEFAULT_SHARE_SETTINGS)

    expect(toPng).not.toHaveBeenCalled()
  })
})
