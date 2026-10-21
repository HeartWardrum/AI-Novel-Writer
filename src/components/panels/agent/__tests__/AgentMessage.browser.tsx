import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { useLocaleStore } from '../../../../stores/locale-store'
import AgentMessage from '../AgentMessage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AgentMessage copy action', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    useLocaleStore.setState({ locale: 'en-US', initialized: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it.each(['user', 'assistant'] as const)('copies only the visible %s message content', async (role) => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await act(async () => root.render(<AgentMessage message={{
      id: `${role}-1`, role, content: 'Visible message', createdAt: 1,
      ...(role === 'assistant' ? { toolCalls: [{
        id: 'hidden-tool', toolName: 'write_file', arguments: { secret: 'do not copy' }, status: 'completed' as const,
      }] } : {}),
    }} />))

    await act(async () => page.getByRole('button', { name: 'Copy message' }).click())

    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith('Visible message')
  })

  it('disables copying for empty streaming content', async () => {
    await act(async () => root.render(<AgentMessage message={{
      id: 'streaming', role: 'assistant', content: '', createdAt: 1, streaming: true,
    }} />))

    expect(page.getByRole('button', { name: 'Copy message' })).toBeDisabled()
  })

  it('shows a localized clipboard failure without hiding the message', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await act(async () => root.render(<AgentMessage message={{
      id: 'assistant-1', role: 'assistant', content: 'Keep this visible', createdAt: 1,
    }} />))

    await act(async () => page.getByRole('button', { name: 'Copy message' }).click())

    expect(page.getByRole('alert')).toHaveTextContent('Could not copy this message')
    expect(container.textContent).toContain('Keep this visible')
  })

  it('expands requestDebug context for the assistant turn', async () => {
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    await act(async () => root.render(<AgentMessage message={{
      id: 'assistant-debug',
      role: 'assistant',
      content: '助手回复',
      createdAt: 1,
      requestDebug: {
        at: 1,
        modelId: 'model-a',
        messages: [
          { role: 'system', content: '你是写作助手' },
          { role: 'user', content: '写一篇捉鬼小说' },
        ],
        meta: { purpose: 'generation', reasoningStage: 'drafting', historyCount: 0 },
      },
    }} />))

    expect(container.textContent).toContain('本次请求上下文')
    const summary = container.querySelector('summary')
    expect(summary).not.toBeNull()
    await act(async () => { summary!.click() })
    expect(container.textContent).toContain('你是写作助手')
    expect(container.textContent).toContain('写一篇捉鬼小说')
    expect(container.textContent).toContain('模型: model-a')
  })
})
