import type { ProjectSessionContext } from '../../shared/ipc-channels'
import type { WorldbookResolveResult, WorldbookSelection } from '../../shared/worldbook'
import { resolveWorldbook } from '../worldbook-service'

/** 直连对话注入世界书时的 token 预算（与写章预演同量级）。 */
export const DIRECT_CHAT_WORLDBOOK_BUDGET = 4_000

export function formatDirectChatWorldbook(selections: readonly WorldbookSelection[]): string | null {
  const blocks = selections
    .map(item => {
      const title = item.title.trim() || item.entryId
      const body = item.content.trim()
      if (!body) return null
      return `### ${title}\n${body}`
    })
    .filter((block): block is string => Boolean(block))
  if (blocks.length === 0) return null
  return `【世界书】\n${blocks.join('\n\n')}`
}

/**
 * 按本轮用户消息匹配世界书，供直连 sendMessage 注入。
 * 无会话、无正文或 resolve 失败时返回 null（不阻断发送）。
 */
export async function loadDirectChatWorldbook(options: {
  projectSession?: ProjectSessionContext
  userText: string
}): Promise<{ block: string; result: WorldbookResolveResult } | null> {
  const { projectSession, userText } = options
  const text = userText.trim()
  if (!projectSession || !text) return null
  try {
    const result = await resolveWorldbook(projectSession, {
      stage: 'drafting',
      draftText: text,
      authorGuidance: text,
      budgetTokens: DIRECT_CHAT_WORLDBOOK_BUDGET,
    })
    const block = formatDirectChatWorldbook(result.selections)
    if (!block) return null
    return { block, result }
  } catch {
    return null
  }
}
