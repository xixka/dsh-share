// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  selectedTurnsToShareMessages,
  turnToShareMessages,
  type SelectedTurn,
} from '../src/client/content.ts'
import type { TurnContent } from '../src/client/dom.ts'

function selected(turn: number): SelectedTurn {
  const prompt = document.createElement('div')
  prompt.textContent = `问题 ${turn}`
  const answer = document.createElement('div')
  answer.textContent = `回答 ${turn}`
  return {
    content: {
      prompts: [prompt],
      answers: [answer],
      segments: [{ prompts: [prompt], answers: [answer] }],
      tail: document.createElement('div'),
    },
    id: String(turn),
    turn,
  }
}

describe('问答组多选排序', () => {
  it('忽略点击顺序，按轮次输出完整问答并计算不连续间隔', () => {
    const messages = selectedTurnsToShareMessages([
      selected(4),
      selected(1),
    ])

    expect(messages.map(message => message.order)).toEqual([2, 3, 8, 9])
    expect(messages.map(message => message.omittedBefore)).toEqual([0, 0, 2, 0])
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(messages.map(message => message.elements[0]?.textContent)).toEqual([
      '问题 1', '回答 1', '问题 4', '回答 4',
    ])
  })

  it('把单轮快速分享拆成连续的用户消息和回答消息', () => {
    const prompt = document.createElement('div')
    const answer = document.createElement('div')
    const content: TurnContent = {
      prompts: [prompt],
      answers: [answer],
      segments: [{ prompts: [prompt], answers: [answer] }],
      tail: document.createElement('div'),
    }

    const messages = turnToShareMessages(content, 7)
    expect(messages).toMatchObject([
      { role: 'user', turn: 7, order: 14, omittedBefore: 0 },
      { role: 'assistant', turn: 7, order: 15, omittedBefore: 0 },
    ])
    expect(messages[0]?.elements).toEqual([prompt])
    expect(messages[1]?.elements).toEqual([answer])
  })

  it('追问插在回答中间时按 DOM 顺序输出分段问答', () => {
    const user = document.createElement('div')
    const firstAnswer = document.createElement('div')
    const steering = document.createElement('div')
    const toolCall = document.createElement('div')
    const finalAnswer = document.createElement('div')
    const content: TurnContent = {
      prompts: [user, steering],
      answers: [firstAnswer, toolCall, finalAnswer],
      segments: [
        { prompts: [user], answers: [firstAnswer] },
        { prompts: [steering], answers: [toolCall, finalAnswer] },
      ],
      tail: document.createElement('div'),
    }

    const messages = turnToShareMessages(content, 1)
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(messages.map(message => message.elements)).toEqual([
      [user],
      [firstAnswer],
      [steering],
      [toolCall, finalAnswer],
    ])
    expect(messages.every(message => message.turn === 1)).toBe(true)
    expect(messages.map(message => message.order)).toEqual([2, 3, 4, 5])
  })

  it('没有分段信息时回退为整轮合并输出', () => {
    const prompt = document.createElement('div')
    const answer = document.createElement('div')
    const content = {
      prompts: [prompt],
      answers: [answer],
      segments: [],
      tail: document.createElement('div'),
    } as TurnContent

    const messages = turnToShareMessages(content, 2)
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant'])
    expect(messages[0]?.elements).toEqual([prompt])
    expect(messages[1]?.elements).toEqual([answer])
  })
})
