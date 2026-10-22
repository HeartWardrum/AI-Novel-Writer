/** 本轮实际注入的轻量回执（仅标题/章号，不含全文）。 */
export interface AgentContextReceiptChapter {
  chapterNumber: number
  chapterTitle?: string
}

export interface AgentContextReceipt {
  worldbookTitles: string[]
  continuityChapters: AgentContextReceiptChapter[]
}

export function hasAgentContextReceipt(receipt: AgentContextReceipt): boolean {
  return receipt.worldbookTitles.length > 0 || receipt.continuityChapters.length > 0
}

/** 从注入结果拼装回执；两边都空则返回 undefined。 */
export function buildAgentContextReceipt(options: {
  worldbookTitles?: readonly string[]
  continuityChapters?: readonly AgentContextReceiptChapter[]
}): AgentContextReceipt | undefined {
  const worldbookTitles = (options.worldbookTitles ?? [])
    .map(title => title.trim())
    .filter(Boolean)
  const continuityChapters = (options.continuityChapters ?? [])
    .filter(chapter => Number.isFinite(chapter.chapterNumber) && chapter.chapterNumber >= 1)
    .map(chapter => {
      const title = chapter.chapterTitle?.trim()
      return title
        ? { chapterNumber: chapter.chapterNumber, chapterTitle: title }
        : { chapterNumber: chapter.chapterNumber }
    })
  if (worldbookTitles.length === 0 && continuityChapters.length === 0) return undefined
  return { worldbookTitles, continuityChapters }
}

const DEFAULT_TITLE_LIMIT = 6

/** 用户可见的「本轮已带入」一行；无内容返回 null。 */
export function formatAgentContextReceiptHint(
  receipt: AgentContextReceipt,
  localize: (zh: string, en: string) => string = (zh) => zh,
  maxTitles = DEFAULT_TITLE_LIMIT,
): string | null {
  if (!hasAgentContextReceipt(receipt)) return null
  const parts: string[] = []
  if (receipt.worldbookTitles.length > 0) {
    if (receipt.worldbookTitles.length <= maxTitles) {
      parts.push(receipt.worldbookTitles.join('、'))
    } else {
      const shown = receipt.worldbookTitles.slice(0, maxTitles).join('、')
      const rest = receipt.worldbookTitles.length - maxTitles
      parts.push(`${shown}${localize(`等 ${rest} 项`, `等 ${rest} 项`)}`)
    }
  }
  if (receipt.continuityChapters.length > 0) {
    const numbers = receipt.continuityChapters.map(chapter => String(chapter.chapterNumber)).join('、')
    parts.push(localize(`前文：第 ${numbers} 章`, `前文：第 ${numbers} 章`))
  }
  return `${localize('本轮已带入', '本轮已带入')}：${parts.join('；')}`
}

/** 落盘用的对话消息（不含 streaming / requestDebug）。 */
export interface PersistedAgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  toolCalls?: unknown
  artifacts?: unknown
  /** 本轮注入回执（轻量，可复看） */
  contextReceipt?: AgentContextReceipt
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
