// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { findTurnContent, findTurnContentFromAction, snapshotTurnContent } from '../src/client/dom.ts'
import { visibleAssistantElements, cloneShareMessage } from '../src/client/card.ts'

function renderFixture(): HTMLElement {
  document.body.innerHTML = `
    <div data-chat-flow-kind="turn-tail"><div data-turn-tail="old"><div><button></button></div></div></div>
    <div data-chat-flow-kind="user" id="user"><div>问题</div></div>
    <div data-chat-flow-kind="assistant-step" id="answer-1"><div>回答一</div></div>
    <div data-chat-flow-kind="tool-call" id="tool-call"><div>工具调用</div></div>
    <div data-chat-flow-kind="steering" id="steering"><div>补充问题</div></div>
    <div data-chat-flow-kind="assistant-step" id="answer-2"><div>回答二</div></div>
    <div data-chat-flow-kind="turn-tail"><div data-turn-tail="current"><div class="actions"><button></button></div></div></div>`
  return document.querySelector('[data-turn-tail="current"]') as HTMLElement
}

describe('DSH 对话 DOM 适配', () => {
  it.each(['compact', 'standard', 'detailed', 'verbose'])('收集 %s 视图中的嵌套过程与独立回答，不重复导出', mode => {
    document.body.innerHTML = `
      <div data-chat-flow-kind="user" id="user">问题</div>
      <div data-step-process data-chat-group-key="process" hidden="until-found">
        <button>过程摘要，不属于消息</button>
        <div data-step-process-body hidden="until-found"><div data-step-process-content data-chat-flow>
          <div data-chat-flow-kind="assistant-step" data-chat-group-part="reasoning" id="reasoning"><div data-variant="think">思考</div></div>
          <div data-chat-flow-kind="tool-call" id="tool"><div data-disclosure-row>工具摘要</div></div>
        </div></div>
      </div>
      <div data-chat-flow-kind="assistant-step" data-chat-group-part="response" id="response">最终回答</div>
      <div data-chat-flow-kind="turn-tail"><div data-turn-tail="1"><button>分享</button></div></div>`
    if (mode === 'compact') {
      document.querySelector<HTMLElement>('#reasoning')!.dataset.turnProcessMember = 'true'
      document.querySelector<HTMLElement>('#response')!.dataset.turnProcessAnswer = 'true'
    }
    const tail = document.querySelector<HTMLElement>('[data-turn-tail]')!
    const content = findTurnContent(tail)!
    expect(content.answers.map(item => item.id)).toEqual(['reasoning', 'tool', 'response'])
    expect(visibleAssistantElements(content.answers, true).map(item => item.id)).toEqual(['response'])
    const text = content.answers.map(item => cloneShareMessage(item, 'zh').textContent).join(' ')
    expect(text).toBe('思考 工具摘要 最终回答')
  })

  it('回溯并收集本轮提问、steering、回答和工具调用', () => {
    const content = findTurnContent(renderFixture())

    expect(content?.prompts.map((item) => item.id)).toEqual(['user', 'steering'])
    expect(content?.answers.map((item) => item.id)).toEqual(['answer-1', 'tool-call', 'answer-2'])
  })

  it('回溯收集以 steering 开场、没有 user 节点的轮次', () => {
    document.body.innerHTML = `
      <div data-chat-flow-kind="turn-tail"><div data-turn-tail="old"><div><button></button></div></div></div>
      <div data-chat-flow-kind="command"><div>/plan 命令行</div></div>
      <div data-chat-flow-kind="steering" id="opening"><div>开场问题</div></div>
      <div data-chat-flow-kind="context"><div>注入上下文</div></div>
      <div data-chat-flow-kind="assistant-step" id="answer"><div>回答</div></div>
      <div data-chat-flow-kind="turn-tail"><div data-turn-tail="current"><div class="actions"><button></button></div></div></div>`
    const tail = document.querySelector('[data-turn-tail="current"]') as HTMLElement

    const content = findTurnContent(tail)

    expect(content?.prompts.map((item) => item.id)).toEqual(['opening'])
    expect(content?.answers.map((item) => item.id)).toEqual(['answer'])
  })

  it('从官方操作插槽中的按钮找到当前轮内容', () => {
    const tail = renderFixture()
    const action = document.createElement('button')
    tail.querySelector('.actions')?.append(action)

    const content = findTurnContentFromAction(action)
    expect(content?.tail).toBe(tail)
    expect(content?.answers.map(item => item.id)).toEqual(['answer-1', 'tool-call', 'answer-2'])
  })
})

describe('回答兜底序列', () => {
  function seat(id: string, kind: string, text: string, init?: (element: HTMLElement) => void): HTMLElement {
    const element = document.createElement('div')
    element.id = id
    element.dataset.chatFlowKind = kind
    element.textContent = text
    init?.(element)
    return element
  }

  /** 已核验 DSH 版本 → 回答座位标记形态矩阵；新增版本只需在此表加一行。 */
  const VERSION_CONTRACTS = [
    { version: '0.1.7-rc.2 回答座位带 answer 标记', answer: 'turn-process-answer' as const, membersMarked: false },
    { version: '0.2.0-rc.2 折叠，回答座位带 answer 标记', answer: 'turn-process-answer' as const, membersMarked: true },
    { version: '0.2.1-rc.5 折叠，回答座位带 answer 标记', answer: 'turn-process-answer' as const, membersMarked: true },
    { version: '0.2.2-alpha.2 回答座位带 groupPart=response', answer: 'group-part-response' as const, membersMarked: true },
    { version: '内部构建无回答标记，依赖成员反选', answer: 'none' as const, membersMarked: true },
  ]

  it.each(VERSION_CONTRACTS)('$version 时回答座位不被过滤', ({ answer, membersMarked }) => {
    const reasoning = seat('reasoning', 'assistant-step', '', element => {
      element.dataset.chatGroupPart = 'reasoning'
      if (membersMarked) element.dataset.turnProcessMember = 'true'
      element.setAttribute('hidden', 'until-found')
      element.innerHTML = '<div data-variant="think">思考</div>'
    })
    const tool = seat('tool', 'tool-call', '', element => {
      if (membersMarked) element.dataset.turnProcessMember = 'true'
      element.innerHTML = '<div data-disclosure-row>工具摘要</div>'
    })
    const response = seat('response', 'assistant-step', '最终回答', element => {
      if (answer === 'turn-process-answer') element.dataset.turnProcessAnswer = 'true'
      if (answer === 'group-part-response') element.dataset.chatGroupPart = 'response'
    })

    const visible = visibleAssistantElements([reasoning, tool, response], true)
    expect(visible.map(item => item.id)).toEqual(['response'])
    for (const element of visible) {
      expect(cloneShareMessage(element, 'zh').hasAttribute('hidden')).toBe(false)
    }
  })

  it('回答座位也是成员（全成员形态）时仍取末尾带正文的座位且不为空', () => {
    const reasoning = seat('reasoning', 'assistant-step', '', element => {
      element.dataset.chatGroupPart = 'reasoning'
      element.dataset.turnProcessMember = 'true'
      element.setAttribute('hidden', 'until-found')
      element.innerHTML = '<div data-variant="think">思考</div>'
    })
    const response = seat('response', 'assistant-step', '最终回答', element => {
      element.dataset.turnProcessMember = 'true'
      element.setAttribute('hidden', 'until-found')
    })

    const visible = visibleAssistantElements([reasoning, response], true)
    expect(visible.map(item => item.id)).toEqual(['response'])
    expect(cloneShareMessage(response, 'zh').textContent).toContain('最终回答')
  })

  it('D 内部构建把回答全部标成 reasoning 时兜底返回带正文的座位', () => {
    const steps = [
      seat('one', 'assistant-step', '第一段', element => {
        element.dataset.chatGroupPart = 'reasoning'
        element.innerHTML = '<div data-variant="think">错标思考</div>'
      }),
      seat('two', 'assistant-step', '第二段', element => {
        element.dataset.chatGroupPart = 'reasoning'
      }),
    ]

    const visible = visibleAssistantElements(steps, true)
    expect(visible.map(item => item.id)).toEqual(['two'])
  })

  it('错标座位只有 Think 内容时返回全部座位，宁多勿缺', () => {
    const steps = [
      seat('one', 'assistant-step', '', element => {
        element.dataset.chatGroupPart = 'reasoning'
        element.innerHTML = '<div data-variant="think">思考一</div>'
      }),
      seat('two', 'assistant-step', '', element => {
        element.dataset.chatGroupPart = 'reasoning'
        element.innerHTML = '<div data-variant="think">思考二</div>'
      }),
    ]

    expect(visibleAssistantElements(steps, true).map(item => item.id)).toEqual(['one', 'two'])
  })

  it('E 没有任何 assistant-step 时退回工具调用摘要，回答区不为空', () => {
    const tool = seat('tool', 'tool-call', '', element => {
      element.innerHTML = '<div data-disclosure-row>工具摘要</div>'
    })
    const unknown = seat('unknown', 'custom-block', '未知座位')

    expect(visibleAssistantElements([tool, unknown], true).map(item => item.id)).toEqual(['tool'])
    expect(visibleAssistantElements([unknown], true).map(item => item.id)).toEqual(['unknown'])
    expect(visibleAssistantElements([], true)).toEqual([])
  })

  it('F 选中座位带任意形态的 hidden 时克隆后必然可见', () => {
    const untilFound = seat('until-found', 'assistant-step', '折叠回答', element => {
      element.dataset.turnProcessMember = 'true'
      element.setAttribute('hidden', 'until-found')
    })
    const empty = seat('empty', 'assistant-step', '隐藏回答', element => {
      element.setAttribute('hidden', '')
    })

    for (const element of [untilFound, empty]) {
      const clone = cloneShareMessage(element, 'zh')
      expect(clone.hasAttribute('hidden')).toBe(false)
      expect(clone.textContent).toContain('回答')
    }
  })

  it('过程分组嵌套层级变化时仍展开收集成员座位', () => {
    document.body.innerHTML = `
      <div data-chat-flow-kind="user">问题</div>
      <div data-step-process data-chat-group-key="process">
        <div data-step-process-body><div data-step-process-content data-chat-flow>
          <div><div data-chat-flow-kind="assistant-step" id="reasoning" data-chat-group-part="reasoning"><div data-variant="think">思考</div></div></div>
          <div data-chat-flow-kind="tool-call" id="tool"><div data-disclosure-row>工具摘要</div></div>
        </div></div>
      </div>
      <div data-chat-flow-kind="assistant-step" data-chat-group-part="response" id="response">最终回答</div>
      <div data-chat-flow-kind="turn-tail"><div data-turn-tail="1"><button>分享</button></div></div>`

    const content = findTurnContent(document.querySelector('[data-turn-tail]') as HTMLElement)
    expect(content?.answers.map(item => item.id)).toEqual(['reasoning', 'tool', 'response'])
  })

  it('G GenUI 段所在座位不会被过程过滤丢弃', () => {
    const genui = seat('genui', 'assistant-step', '图表', element => {
      element.dataset.chatGroupPart = 'response'
      element.innerHTML = '结论文字<div data-genui><canvas></canvas></div>'
    })
    const reasoning = seat('reasoning', 'assistant-step', '', element => {
      element.dataset.chatGroupPart = 'reasoning'
      element.innerHTML = '<div data-variant="think">思考</div>'
    })

    const visible = visibleAssistantElements([reasoning, genui], true)
    expect(visible.map(item => item.id)).toEqual(['genui'])
    expect(visible[0]!.querySelector('[data-genui]')).not.toBeNull()
  })

  it('追问插在回答中间时按 DOM 顺序切分问答段', () => {
    document.body.innerHTML = `
      <div data-chat-flow-kind="user" id="user">开场问题</div>
      <div data-chat-flow-kind="assistant-step" id="answer-1">第一段回答</div>
      <div data-chat-flow-kind="steering" id="steering">追问</div>
      <div data-chat-flow-kind="assistant-step" id="answer-2">第二段回答</div>
      <div data-chat-flow-kind="turn-tail"><div data-turn-tail="1"><button>分享</button></div></div>`

    const content = findTurnContent(document.querySelector('[data-turn-tail]') as HTMLElement)
    expect(content?.prompts.map(item => item.id)).toEqual(['user', 'steering'])
    expect(content?.answers.map(item => item.id)).toEqual(['answer-1', 'answer-2'])
    expect(content?.segments.map(segment => ({
      prompts: segment.prompts.map(item => item.id),
      answers: segment.answers.map(item => item.id),
    }))).toEqual([
      { prompts: ['user'], answers: ['answer-1'] },
      { prompts: ['steering'], answers: ['answer-2'] },
    ])

    const snapshot = snapshotTurnContent(content!)
    expect(snapshot.segments.map(segment => ({
      prompts: segment.prompts.map(item => item.id),
      answers: segment.answers.map(item => item.id),
    }))).toEqual([
      { prompts: ['user'], answers: ['answer-1'] },
      { prompts: ['steering'], answers: ['answer-2'] },
    ])
    expect(snapshot.segments[0]!.prompts[0]).not.toBe(content!.prompts[0])
  })

  it('连续追问合并进同一段用户消息', () => {
    document.body.innerHTML = `
      <div data-chat-flow-kind="user" id="user">开场问题</div>
      <div data-chat-flow-kind="steering" id="steering-1">追问一</div>
      <div data-chat-flow-kind="steering" id="steering-2">追问二</div>
      <div data-chat-flow-kind="assistant-step" id="answer">合并回答</div>
      <div data-chat-flow-kind="turn-tail"><div data-turn-tail="1"><button>分享</button></div></div>`

    const content = findTurnContent(document.querySelector('[data-turn-tail]') as HTMLElement)
    expect(content?.segments).toHaveLength(1)
    expect(content?.segments[0]?.prompts.map(item => item.id)).toEqual(['user', 'steering-1', 'steering-2'])
    expect(content?.segments[0]?.answers.map(item => item.id)).toEqual(['answer'])
  })
})
