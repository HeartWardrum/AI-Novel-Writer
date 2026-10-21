import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { resolveWritingLanguage, type WritingLanguage } from '../../shared/writing-language'
import {
  composePromptSystemRole,
  getBuiltinPromptTemplate,
  renderPrompt,
  resolvePromptTemplate,
} from '../prompt-templates'

/** 工作台直连对话的系统提示：从提示词目录读取。 */
export async function buildDirectChatSystemPrompt(options?: {
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
