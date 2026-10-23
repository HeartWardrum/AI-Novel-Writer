import { useAgentStore } from '../../../stores/agent-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { requestAgentChatNavigate } from './chat-message-navigate'
import './chat-message-rail.css'

export interface ChatMessageRailItem {
  id: string
  content: string
}

function previewLabel(content: string): string {
  const compact = content.replace(/\s+/gu, ' ').trim()
  return compact || '…'
}

/** 本会话用户消息迷你轴：挂在对话列外侧右边栏；悬停展开左侧摘要，点击滚到对应气泡。 */
export default function ChatMessageRail({
  items: itemsProp,
  onJump,
}: {
  items?: readonly ChatMessageRailItem[]
  onJump?: (messageId: string) => void
} = {}) {
  const text = useLocaleStore(s => s.text)
  const showHistory = useAgentStore(s => s.showHistory)
  const recruitActive = useAgentStore(s => s.recruitActive)
  const activeConv = useAgentStore(s => s.getActiveConversation())

  const fromStore =
    !showHistory
    && !recruitActive
    && activeConv
    && activeConv.messages.length > 0
      ? activeConv.messages
        .filter(m => m.role === 'user' && m.content.trim())
        .map(m => ({ id: m.id, content: m.content }))
      : []

  const items = itemsProp ?? fromStore
  if (items.length === 0) return null

  const jump = onJump ?? requestAgentChatNavigate

  return (
    <nav
      className="chat-message-rail"
      data-testid="chat-message-rail"
      aria-label={text('本会话跳转', '本会话跳转')}
    >
      <div className="chat-message-rail-track">
        {items.map(item => {
          const label = previewLabel(item.content)
          return (
            <button
              key={item.id}
              type="button"
              className="chat-message-rail-item"
              title={label}
              data-testid={`chat-rail-jump-${item.id}`}
              onClick={() => jump(item.id)}
            >
              <span className="chat-message-rail-label">{label}</span>
              <span className="chat-message-rail-mark" aria-hidden />
            </button>
          )
        })}
      </div>
    </nav>
  )
}
