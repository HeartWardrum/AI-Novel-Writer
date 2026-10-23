/** ActiveConversation 监听：迷你轴跳转时暂停贴底跟随 */
export const AGENT_CHAT_NAVIGATE_EVENT = 'agent-chat-navigate'

export function requestAgentChatNavigate(messageId: string): void {
  window.dispatchEvent(
    new CustomEvent(AGENT_CHAT_NAVIGATE_EVENT, { detail: { messageId } }),
  )
  const target = document.getElementById(`agent-msg-${messageId}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
