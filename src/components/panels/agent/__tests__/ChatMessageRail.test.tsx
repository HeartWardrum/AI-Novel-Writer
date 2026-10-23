import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { useLocaleStore } from '../../../../stores/locale-store'
import AgentMessage from '../AgentMessage'
import ChatMessageRail from '../ChatMessageRail'

const originalLocale = useLocaleStore.getState()

afterEach(() => {
  useLocaleStore.setState(originalLocale)
})

describe('ChatMessageRail', () => {
  it('renders labels before marks for each user message', () => {
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    const onJump = vi.fn()
    const markup = renderToStaticMarkup(
      <ChatMessageRail
        items={[
          { id: 'u1', content: '第一章开头' },
          { id: 'u2', content: '继续写对白' },
        ]}
        onJump={onJump}
      />,
    )

    expect(markup).toContain('data-testid="chat-message-rail"')
    expect(markup).toContain('data-testid="chat-rail-jump-u1"')
    expect(markup).toContain('data-testid="chat-rail-jump-u2"')
    expect(markup).toContain('chat-message-rail-label')
    expect(markup).toContain('chat-message-rail-mark')
    expect(markup).not.toContain('chat-message-rail-dot')
    expect(markup).toContain('第一章开头')
    expect(markup).toContain('继续写对白')
    expect(markup).toContain('本会话跳转')

    const labelAt = markup.indexOf('chat-message-rail-label')
    const markAt = markup.indexOf('chat-message-rail-mark')
    expect(labelAt).toBeGreaterThan(-1)
    expect(markAt).toBeGreaterThan(labelAt)
  })

  it('hides when there are no user anchors', () => {
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    const markup = renderToStaticMarkup(
      <ChatMessageRail items={[]} onJump={() => undefined} />,
    )
    expect(markup).toBe('')
  })
})

describe('AgentMessage DOM anchors', () => {
  it('exposes stable agent-msg ids on user and assistant roots', () => {
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    const user = renderToStaticMarkup(
      <AgentMessage message={{ id: 'user-x', role: 'user', content: '你好', createdAt: 1 }} />,
    )
    const assistant = renderToStaticMarkup(
      <AgentMessage message={{ id: 'asst-x', role: 'assistant', content: '你好', createdAt: 2 }} />,
    )

    expect(user).toContain('id="agent-msg-user-x"')
    expect(user).toContain('data-message-id="user-x"')
    expect(user).toContain('data-role="user"')
    expect(assistant).toContain('id="agent-msg-asst-x"')
    expect(assistant).toContain('data-message-id="asst-x"')
    expect(assistant).toContain('data-role="assistant"')
  })
})

describe('mini-rail placement and hover labels', () => {
  it('lives on the chat workbench gutter with left labels and hover highlight', () => {
    const workbench = readFileSync(
      resolve(process.cwd(), 'src/components/stage/ChatWorkbench.tsx'),
      'utf8',
    )
    const conversation = readFileSync(
      resolve(process.cwd(), 'src/components/panels/agent/AgentConversation.tsx'),
      'utf8',
    )
    const navigate = readFileSync(
      resolve(process.cwd(), 'src/components/panels/agent/chat-message-navigate.ts'),
      'utf8',
    )
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/panels/agent/chat-message-rail.css'),
      'utf8',
    )
    const workbenchCss = readFileSync(
      resolve(process.cwd(), 'src/components/stage/chat-workbench.css'),
      'utf8',
    )

    expect(workbench).toContain('ChatMessageRail')
    expect(conversation).not.toContain('ChatMessageRail')
    expect(conversation).toContain('AGENT_CHAT_NAVIGATE_EVENT')
    expect(conversation).toContain('setIsAtBottom(false)')
    expect(conversation).toContain('chat-message-scroll')
    expect(navigate).toContain('scrollIntoView')
    expect(navigate).toContain('agent-msg-')

    expect(css).toContain('chat-message-rail-mark')
    expect(css).not.toContain('chat-message-rail-dot')
    expect(css).toContain('width: 12em')
    expect(css).toContain('text-overflow: ellipsis')
    expect(css).toMatch(/\.chat-message-rail:hover \.chat-message-rail-label/)
    expect(css).toMatch(/\.chat-message-rail-item:hover \.chat-message-rail-label/)

    expect(workbenchCss).toContain('.chat-message-scroll')
    expect(workbenchCss).toContain('scrollbar-width: none')
  })
})
