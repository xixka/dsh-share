import { toPng } from 'html-to-image'
import { shareExportBackground } from './background.ts'
import { WIDTH_PRESETS, type ShareSettings } from './settings.ts'

const GENUI_SELECTOR = '[data-genui]'

function genuiBlocks(root: HTMLElement): HTMLElement[] {
  const blocks = [
    ...(root.matches(GENUI_SELECTOR) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(GENUI_SELECTOR),
  ]
  return blocks.filter(block => block === root || !block.parentElement?.closest(GENUI_SELECTOR))
}

/** 将 GenUI 的已渲染内容静态化，避免独立 HTML/Markdown 丢失组件样式、SVG 和画布。 */
export async function replaceGenuiWithImages(
  root: HTMLElement,
  locale: 'zh' | 'en',
  settings: ShareSettings,
): Promise<void> {
  const blocks = genuiBlocks(root)
  if (blocks.length === 0) return

  const document = root.ownerDocument
  const host = document.createElement('div')
  host.dataset.dshShareGenuiHost = ''
  host.ariaHidden = 'true'
  Object.assign(host.style, {
    left: '-100000px',
    position: 'fixed',
    top: '0',
    width: `${WIDTH_PRESETS[settings.width] - 48}px`,
    zIndex: '-1',
  })
  host.append(root)
  document.body.append(host)

  try {
    for (const block of blocks) {
      const data = await toPng(block, {
        backgroundColor: shareExportBackground(block),
        pixelRatio: 2,
        skipAutoScale: true,
        skipFonts: true,
      })
      if (!data.startsWith('data:image/png;base64,')) throw new Error('Could not render GenUI content')
      const image = document.createElement('img')
      image.dataset.dshShareGenui = ''
      image.alt = locale === 'zh' ? 'GenUI 交互组件' : 'GenUI interactive component'
      image.src = data
      block.replaceWith(image)
    }
  } finally {
    host.remove()
  }
}
