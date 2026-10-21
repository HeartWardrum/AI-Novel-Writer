/** 落盘用的对话消息（不含 streaming / requestDebug）。 */
export interface PersistedAgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  toolCalls?: unknown
  artifacts?: unknown
}

/** 落盘用的整段会话。 */
export interface PersistedAgentConversation {
  id: string
  title: string
  modelId: string | null
  messages: PersistedAgentMessage[]
  createdAt: number
  updatedAt: number
}

export interface AgentChatLoadResult {
  conversations: PersistedAgentConversation[]
  activeConversationId: string | null
}
