import { saveExportTheme } from './export-theme.ts'

export const TURN_TAIL_SELECTOR = '[data-turn-tail]'
export const TURN_FLOW_SELECTOR = '[data-chat-flow-kind="turn-tail"]'

export interface TurnSegment {
  prompts: HTMLElement[]
  answers: HTMLElement[]
}

export interface TurnContent {
  prompts: HTMLElement[]
  answers: HTMLElement[]
  /** 按 DOM 顺序切分的问答段；steering 追问插在回答中间时保留真实时序。 */
  segments: TurnSegment[]
  tail: HTMLElement
}

export interface RenderedTurn {
  content: TurnContent
  turn: number
}

/** 立即克隆消息节点，后续滚动卸载原 DOM 也不会影响导出。 */
export function snapshotElements(elements: readonly HTMLElement[]): HTMLElement[] {
  return elements.map(element => {
    const snapshot = element.cloneNode(true) as HTMLElement
    saveExportTheme(element, snapshot)
    return snapshot
  })
}

/**
 * 在用户勾选一轮时立即保存消息节点，避免后续滚动加载或视图切换影响导出内容。
 * tail 保留原节点引用，只用于判断会话顺序；真正渲染的问答均使用脱离页面的副本。
 */
export function snapshotTurnContent(content: TurnContent): TurnContent {
  const cloneOf = new Map<HTMLElement, HTMLElement>()
  const snapshot = (element: HTMLElement): HTMLElement => {
    const snapshot = element.cloneNode(true) as HTMLElement
    saveExportTheme(element, snapshot)
    cloneOf.set(element, snapshot)
    return snapshot
  }
  const prompts = content.prompts.map(snapshot)
  const answers = content.answers.map(snapshot)
  const segments = content.segments.map(segment => ({
    prompts: segment.prompts.map(element => cloneOf.get(element)!),
    answers: segment.answers.map(element => cloneOf.get(element)!),
  }))
  return { prompts, answers, segments, tail: content.tail }
}

/** 展开过程分组里的消息座位；层级结构变化（部分或全部嵌套）时补齐组内最外层座位，宁多勿缺。 */
function expandProcessMembers(group: HTMLElement): HTMLElement[] {
  const direct = [...group.querySelectorAll<HTMLElement>('[data-step-process-content] > [data-chat-flow-kind]')]
  const outermost = [...group.querySelectorAll<HTMLElement>('[data-chat-flow-kind]')].filter(member => {
    const ancestor = member.parentElement?.closest('[data-chat-flow-kind]')
    return ancestor == null || !group.contains(ancestor)
  })
  const members = outermost.some(member => !direct.includes(member)) ? outermost : direct
  return members.filter(member =>
    member.dataset.chatFlowKind === 'assistant-step' || member.dataset.chatFlowKind === 'tool-call',
  )
}

/**
 * 这里集中保存当前 DSH 页面结构的假设，方便上游 DOM 调整后只改一个地方。
 * 从 turn-tail 回溯到本轮开场输入（user 或 steering），并展开过程分组中的消息座位，保留原始顺序。
 */
export function findTurnContent(tail: HTMLElement): TurnContent | undefined {
  const flowTail = tail.closest<HTMLElement>(TURN_FLOW_SELECTOR)
  if (!flowTail) return undefined

  const prompts: HTMLElement[] = []
  const answers: HTMLElement[] = []
  // 回溯时同步记录座位顺序，供导出按真实时序切分问答段。
  const seats: Array<{ prompt: boolean, element: HTMLElement }> = []
  let sibling = flowTail.previousElementSibling

  while (sibling instanceof HTMLElement) {
    const kind = sibling.dataset.chatFlowKind

    if (kind === 'assistant-step' || kind === 'tool-call') {
      answers.unshift(sibling)
      seats.unshift({ prompt: false, element: sibling })
    } else if (sibling.hasAttribute('data-step-process')) {
      const members = expandProcessMembers(sibling)
      answers.unshift(...members)
      seats.unshift(...members.map(member => ({ prompt: false, element: member })))
    } else if (kind === 'steering') {
      prompts.unshift(sibling)
      seats.unshift({ prompt: true, element: sibling })
    } else if (kind === 'user') {
      prompts.unshift(sibling)
      seats.unshift({ prompt: true, element: sibling })
      break
    } else if (kind === 'turn-tail') {
      break
    }

    sibling = sibling.previousElementSibling
  }

  // DSH 会把被认领进运行中一轮的用户消息渲染成 steering，这类轮次没有 user 节点，同样以 steering 开场。
  if (prompts.length === 0 || answers.length === 0) return undefined

  // 按座位顺序切分：追问之前的回答归属上一段，连续追问合并进同一段用户消息。
  const segments: TurnSegment[] = []
  let current: TurnSegment | undefined
  for (const seat of seats) {
    if (seat.prompt) {
      if (current && current.answers.length === 0) {
        current.prompts.push(seat.element)
      } else {
        current = { prompts: [seat.element], answers: [] }
        segments.push(current)
      }
    } else {
      if (!current) {
        current = { prompts: [], answers: [] }
        segments.push(current)
      }
      current.answers.push(seat.element)
    }
  }
  return { prompts, answers, segments, tail }
}

/** 从官方 assistant-actions 插槽渲染的按钮定位并收集当前轮内容。 */
export function findTurnContentFromAction(action: HTMLElement): TurnContent | undefined {
  const tail = action.closest<HTMLElement>(TURN_TAIL_SELECTOR)
  return tail ? findTurnContent(tail) : undefined
}

/** 收集当前会话页面中已经渲染并完成的轮次，按 DSH 原始 turn 排序。 */
export function findRenderedTurns(root: ParentNode): RenderedTurn[] {
  return [...root.querySelectorAll<HTMLElement>(TURN_TAIL_SELECTOR)]
    .map((tail): RenderedTurn | undefined => {
      const turn = Number(tail.dataset.turnTail)
      if (!Number.isFinite(turn)) return undefined
      const content = findTurnContent(tail)
      return content ? { content, turn } : undefined
    })
    .filter((item): item is RenderedTurn => item !== undefined)
    .sort((left, right) => left.turn - right.turn)
}
