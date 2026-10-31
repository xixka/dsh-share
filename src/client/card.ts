import { shareExportBackground } from './background.ts'
import { applyExportTheme } from './export-theme.ts'
import type { ShareMessage } from './content.ts'
import {
  DEFAULT_SHARE_SETTINGS,
  FONT_SIZE_PRESETS,
  WIDTH_PRESETS,
  type ShareSettings,
} from './settings.ts'

export interface ShareCard {
  element: HTMLElement
  dispose(): void
}

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles)
}

function normalizeText(text: string | null): string {
  return text?.replace(/\s+/g, ' ').trim() ?? ''
}

/** 把摘要行里的交互控件转为静态元素，同时保留当前运行时的 class 和图标。 */
function makeToolSummaryStatic(row: HTMLElement): void {
  for (const button of row.querySelectorAll<HTMLButtonElement>('button')) {
    const replacement = row.ownerDocument.createElement('span')
    for (const attribute of button.attributes) {
      if (attribute.name === 'class' || attribute.name === 'style' || attribute.name.startsWith('data-')) {
        replacement.setAttribute(attribute.name, attribute.value)
      }
    }
    replacement.append(...button.childNodes)
    button.replaceWith(replacement)
  }
  for (const control of row.querySelectorAll('input, textarea, select, [role="tooltip"]')) {
    control.remove()
  }
  for (const element of [row, ...row.querySelectorAll<HTMLElement>('*')]) {
    element.removeAttribute('aria-expanded')
    element.removeAttribute('data-expandable')
    element.removeAttribute('role')
    element.removeAttribute('tabindex')
  }
}

/**
 * 工具卡片内部可能包含展开面板和终端输出；这里只克隆原生折叠摘要行。
 * 摘要的运行时 class、图标和内容结构会被保留，不依赖写死的 CSS Module 类名。
 */
function cloneToolCallSummary(
  source: HTMLElement,
  locale: 'zh' | 'en',
): HTMLElement {
  const clone = source.ownerDocument.createElement('div')
  clone.dataset.dshShareMessage = ''
  clone.dataset.dshShareToolCall = ''
  const summaryRows = source.querySelectorAll<HTMLElement>(
    '[data-disclosure-row], [data-sample="bash"]',
  )

  for (const summary of summaryRows) {
    if (!normalizeText(summary.textContent)) continue
    const row = summary.cloneNode(true) as HTMLElement
    row.dataset.dshShareToolSummary = ''
    makeToolSummaryStatic(row)
    clone.append(row)
  }

  if (clone.childElementCount === 0) {
    const fallback = source.ownerDocument.createElement('div')
    fallback.dataset.dshShareToolSummary = ''
    fallback.textContent = locale === 'zh' ? '工具调用' : 'Tool call'
    clone.append(fallback)
  }

  applyStyles(clone, {
    boxSizing: 'border-box',
    margin: '0',
    maxWidth: 'none',
    width: '100%',
  })
  return clone
}

export function cloneShareMessage(
  source: HTMLElement,
  locale: 'zh' | 'en',
  hideReasoning = false,
): HTMLElement {
  if (source.dataset.chatFlowKind === 'tool-call') {
    return cloneToolCallSummary(source, locale)
  }

  const clone = source.cloneNode(true) as HTMLElement
  clone.dataset.dshShareMessage = ''

  // 分享副本需要脱离页面的过程折叠状态；被选中导出的座位一律移除任何形式的 hidden。
  clone.removeAttribute('hidden')
  clone.removeAttribute('data-turn-process-member')
  clone.removeAttribute('data-turn-process-hidden')
  clone.removeAttribute('data-turn-process-answer')

  if (hideReasoning) {
    for (const reasoning of clone.querySelectorAll<HTMLElement>('[data-turn-process-inline]')) {
      reasoning.remove()
    }
    for (const reasoning of clone.querySelectorAll<HTMLElement>('[data-variant="think"]')) {
      reasoning.remove()
    }
  } else {
    for (const reasoning of clone.querySelectorAll<HTMLElement>('[data-turn-process-inline]')) {
      if (reasoning.getAttribute('hidden') === 'until-found') reasoning.removeAttribute('hidden')
      reasoning.removeAttribute('data-turn-process-inline')
    }
  }

  // 删除 hover 操作区，避免复制、分支和本插件按钮出现在分享图里。
  for (const hoverRoot of clone.querySelectorAll<HTMLElement>('[data-time-hover-root]')) {
    const last = hoverRoot.lastElementChild
    if (last?.querySelector('button')) last.remove()
  }
  for (const element of clone.querySelectorAll<HTMLElement>(
    'button, input, textarea, select, [data-dsh-share-button], [role="tooltip"]',
  )) {
    element.remove()
  }

  clone.removeAttribute('data-chat-anchor-key')
  clone.removeAttribute('data-chat-flow-key')
  clone.removeAttribute('data-chat-flow-kind')
  applyStyles(clone, {
    boxSizing: 'border-box',
    margin: '0',
    maxWidth: 'none',
    width: '100%',
  })
  return clone
}

/** 判断座位里除思考块与行内推理外是否还有可见正文。 */
function hasVisibleAnswerText(element: HTMLElement): boolean {
  const copy = element.cloneNode(true) as HTMLElement
  for (const reasoning of copy.querySelectorAll('[data-turn-process-inline], [data-variant="think"]')) {
    reasoning.remove()
  }
  return normalizeText(copy.textContent) !== ''
}

/** 与图片和 Markdown 共用的回答过程过滤规则。 */
export function visibleAssistantElements(
  elements: readonly HTMLElement[],
  hideProcess: boolean,
): HTMLElement[] {
  if (!hideProcess) return [...elements]

  const assistantSteps = elements.filter(element =>
    element.dataset.chatFlowKind === 'assistant-step' && element.dataset.chatGroupPart !== 'reasoning',
  )
  const explicitAnswers = assistantSteps.filter(element =>
    element.dataset.turnProcessAnswer === 'true' || element.dataset.chatGroupPart === 'response',
  )
  if (explicitAnswers.length > 0) return explicitAnswers

  const hasTurnProcessMembers = elements.some(element => element.dataset.turnProcessMember === 'true')
  if (hasTurnProcessMembers) {
    const answers = assistantSteps.filter(element => element.dataset.turnProcessMember !== 'true')
    if (answers.length > 0) return answers
  }

  // 没有显式标记时取末尾连续非成员的回答座位段；工具调用等其他座位视为过程边界。
  const trailing: HTMLElement[] = []
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index]!
    if (element.dataset.chatFlowKind !== 'assistant-step'
      || element.dataset.chatGroupPart === 'reasoning'
      || element.dataset.turnProcessMember === 'true') break
    trailing.unshift(element)
  }
  if (trailing.length > 0) return trailing

  // 座位标记缺失或被全部标成 reasoning 时，无视 groupPart 找最后一个带可见正文的座位。
  const steps = elements.filter(element => element.dataset.chatFlowKind === 'assistant-step')
  const lastWithText = [...steps].reverse().find(element => hasVisibleAnswerText(element))
  if (lastWithText) return [lastWithText]

  // 仍拿不到时保留全部回答座位（宁多勿缺），最后退回工具调用摘要，绝不让回答区为空。
  if (steps.length > 0) return steps
  const toolCalls = elements.filter(element => element.dataset.chatFlowKind === 'tool-call')
  if (toolCalls.length > 0) return toolCalls
  return [...elements]
}

export function createShareCard(
  document: Document,
  messages: readonly ShareMessage[],
  locale: 'zh' | 'en',
  settings: ShareSettings = DEFAULT_SHARE_SETTINGS,
): ShareCard {
  const host = document.createElement('div')
  host.dataset.dshShareCardHost = ''
  applyStyles(host, {
    left: '-100000px',
    position: 'fixed',
    top: '0',
    zIndex: '-1',
  })

  const card = document.createElement('article')
  card.dataset.dshShareCard = ''
  card.style.setProperty('--dsh-share-font-size', `${FONT_SIZE_PRESETS[settings.fontSize]}px`)
  applyStyles(card, {
    background: 'var(--dsw-alias-bg-base, #f7f8fa)',
    boxSizing: 'border-box',
    color: 'var(--dsw-alias-label-primary, #111827)',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    overflowWrap: 'anywhere',
    padding: '28px 24px 24px',
    width: `${WIDTH_PRESETS[settings.width]}px`,
    wordBreak: 'break-word',
  })

  for (const [index, message] of messages.entries()) {
    if (message.omittedBefore > 0) {
      const omission = document.createElement('div')
      omission.dataset.dshShareOmission = ''
      omission.textContent = '···'
      applyStyles(omission, {
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
        fontSize: '18px',
        letterSpacing: '8px',
        margin: '30px 0',
        textAlign: 'center',
      })
      card.append(omission)
    }

    const messageSection = document.createElement('section')
    messageSection.dataset.dshShareMessageGroup = message.role
    messageSection.dataset.dshShareTurn = String(message.turn)
    if (index > 0 && message.omittedBefore === 0) {
      const previous = messages[index - 1]
      applyStyles(messageSection, {
        borderTop: previous?.turn === message.turn
          ? '0'
          : '1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, 0.16))',
        marginTop: '30px',
        paddingTop: previous?.turn === message.turn ? '0' : '30px',
      })
    }

    const visible = message.role === 'assistant'
      ? visibleAssistantElements(message.elements, settings.hideProcess)
      : message.elements
    // 隐藏过程时按兜底序列只保留最终回答座位，并从中移除 Think；
    // 工具调用和中间步骤不会进入图片，用户消息不受该开关影响。
    for (const element of visible) {
      messageSection.append(cloneShareMessage(
        element,
        locale,
        message.role === 'assistant' && settings.hideProcess,
      ))
    }
    card.append(messageSection)
  }

  applyExportTheme(card, messages.flatMap(message => message.elements))
  host.append(card)
  document.body.append(host)
  // 皮肤可能把 --dsw-alias-bg-base 设成 transparent；分享图需要不透明底色。
  card.style.backgroundColor = shareExportBackground(card)

  return {
    element: card,
    dispose: () => host.remove(),
  }
}
