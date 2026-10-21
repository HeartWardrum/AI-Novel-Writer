import type { ProjectSessionContext } from '../../shared/ipc-channels'
import {
  WORLD_BOOK_SYSTEM_DIRECT_CHAT_ID,
  isWorldbookSystemEntry,
} from '../../shared/worldbook'
import { resolveWritingLanguage, type WritingLanguage } from '../../shared/writing-language'
import {
  composePromptSystemRole,
  getBuiltinPromptTemplate,
  renderPrompt,
  resolvePromptTemplate,
} from '../prompt-templates'
import { listWorldbookEntries } from '../worldbook-service'

/** 从提示词模板拼出世界书系统条目的初始正文（迁移/种子用）。 */
export async function composeDirectChatSystemSeed(options?: {
  writingLanguage?: WritingLanguage
  projectSession?: ProjectSessionContext
}): Promise<string> {
  const writingLanguage = resolveWritingLanguage(options?.writingLanguage)
  const template = await resolvePromptTemplate(
    'direct_chat_system',
    options?.projectSession,
    writingLanguage,
  ) ?? getBuiltinPromptTemplate('direct_chat_system', writingLanguage)

  if (!template) {
    throw new Error('Missing direct chat system prompt')
  }

  return `${composePromptSystemRole(template, writingLanguage)}\n\n${renderPrompt(
    template,
    {},
    writingLanguage,
  )}`.trim()
}

/** 工作台直连对话的系统提示：优先读世界书置顶常驻条目。 */
export async function buildDirectChatSystemPrompt(options?: {
  writingLanguage?: WritingLanguage
  projectSession?: ProjectSessionContext
}): Promise<string> {
  const writingLanguage = resolveWritingLanguage(options?.writingLanguage)
  const seed = await composeDirectChatSystemSeed({
    writingLanguage,
    projectSession: options?.projectSession,
  })

  const session = options?.projectSession
  if (!session) return seed

  try {
    const entries = await listWorldbookEntries(session, { systemPromptSeed: seed })
    const systemEntry = entries.find(entry => isWorldbookSystemEntry(entry)
      || entry.id === WORLD_BOOK_SYSTEM_DIRECT_CHAT_ID)
    const content = systemEntry?.content.trim()
    if (content) return content
  } catch {
    // 无会话库或加载失败时回退模板种子
  }

  return seed
}
