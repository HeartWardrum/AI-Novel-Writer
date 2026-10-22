import type { WorldbookEntry, WorldbookEntryKind } from '../../shared/worldbook'
import { isWorldbookSystemEntry } from '../../shared/worldbook'
import { getBuiltinPromptTemplate } from '../builtin-prompt-templates'
import { composePromptSystemRole } from '../prompt-templates'
import { resolveWritingLanguage, type WritingLanguage } from '../../shared/writing-language'

/** 角色模式允许带入的公开常驻设定类型（不含人物/剧情向）。 */
export const CHARACTER_MODE_SHARED_KINDS = Object.freeze([
  'world',
  'rule',
  'location',
  'premise',
] as const satisfies readonly WorldbookEntryKind[])

const SHARED_KIND_SET = new Set<string>(CHARACTER_MODE_SHARED_KINDS)

export function listCharacterModeSharedEntries(
  entries: readonly WorldbookEntry[],
): WorldbookEntry[] {
  return entries.filter(entry => (
    !isWorldbookSystemEntry(entry)
    && entry.kind !== 'character'
    && SHARED_KIND_SET.has(entry.kind)
    && entry.activation.enabled
    && entry.activation.alwaysOn
    && entry.content.trim().length > 0
  ))
}

export function formatCharacterSharedBlock(entries: readonly WorldbookEntry[]): string | null {
  const blocks = entries.map(entry => {
    const title = entry.title.trim() || entry.id
    return `### ${title}\n${entry.content.trim()}`
  })
  if (blocks.length === 0) return null
  return `【公开常驻设定】\n${blocks.join('\n\n')}`
}

export function formatCharacterPersonaBlock(entry: WorldbookEntry): string {
  const name = entry.title.trim() || '未名'
  const lines = [
    `【扮演角色】${name}`,
    '【公开人设】',
    entry.content.trim() || '（暂无公开人设）',
  ]
  const privateContent = entry.privateContent?.trim()
  if (privateContent) {
    lines.push('', '【私有认知｜只有此人知道】', privateContent)
  }
  return lines.join('\n')
}

export function buildCharacterPlaySystemPrompt(writingLanguage?: WritingLanguage): string {
  const lang = resolveWritingLanguage(writingLanguage)
  const template = getBuiltinPromptTemplate('direct_chat_character_system', lang)
  if (!template) {
    return '你正在扮演小说中的一个角色。只用该角色的口吻、身份与所知范围说话；不要跳出角色当写作助手；不要输出 tool_call 或类似协议标签。'
  }
  const role = composePromptSystemRole(template, lang)
  const body = template.content.trim()
  return body ? `${role}\n\n${body}`.trim() : role.trim()
}

export function buildCharacterChatSystemMessages(options: {
  entry: WorldbookEntry
  sharedEntries: readonly WorldbookEntry[]
  writingLanguage?: WritingLanguage
}): Array<{ role: 'system'; content: string }> {
  const play = buildCharacterPlaySystemPrompt(options.writingLanguage)
  const persona = formatCharacterPersonaBlock(options.entry)
  const shared = formatCharacterSharedBlock(options.sharedEntries)
  return [
    { role: 'system', content: play },
    { role: 'system', content: persona },
    ...(shared ? [{ role: 'system' as const, content: shared }] : []),
  ]
}

/** 角色模式回执用的条目标题列表。 */
export function characterModeReceiptTitles(
  entry: WorldbookEntry,
  sharedEntries: readonly WorldbookEntry[],
): string[] {
  const titles = [entry.title.trim() || entry.id]
  if (entry.privateContent?.trim()) titles.push('私有认知')
  for (const shared of sharedEntries) {
    titles.push(shared.title.trim() || shared.id)
  }
  return titles
}
