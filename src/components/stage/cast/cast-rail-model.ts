import { CHARACTER_ROLES, type CharacterRole } from '../../../shared/character-role'
import { characterSelectionKey, type CharacterCard } from '../../../stores/character-store'

const RECENT_MESSAGE_LIMIT = 12

/** 最近对话正文里是否提到该姓名（至少 2 字，避免误亮）。 */
export function isCharacterMentionedInText(name: string, haystack: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length < 2 || !haystack) return false
  return haystack.includes(trimmed)
}

export function recentChatHaystack(
  messages: readonly { role: string; content: string }[],
  limit = RECENT_MESSAGE_LIMIT,
): string {
  return messages
    .filter(message => message.role !== 'system')
    .slice(-limit)
    .map(message => message.content)
    .join('\n')
}

export interface CastRailGroup {
  role: CharacterRole
  items: Array<{ character: CharacterCard; key: string; sourceIndex: number }>
}

/** 按身份分桶，桶内保留名单数组相对次序；空桶省略。 */
export function groupCharactersByRole(
  characters: readonly CharacterCard[],
): CastRailGroup[] {
  const buckets = new Map<CharacterRole, CastRailGroup['items']>()
  for (const role of CHARACTER_ROLES) buckets.set(role, [])

  characters.forEach((character, sourceIndex) => {
    const role = (CHARACTER_ROLES.includes(character.role as CharacterRole)
      ? character.role
      : 'supporting') as CharacterRole
    buckets.get(role)!.push({
      character,
      key: characterSelectionKey(character, sourceIndex),
      sourceIndex,
    })
  })

  return CHARACTER_ROLES
    .map(role => ({ role, items: buckets.get(role)! }))
    .filter(group => group.items.length > 0)
}

/**
 * 将拖拽结果写回完整名单顺序。
 * `orderedKeys`：各组按显示顺序展平后的 selectionKey。
 * `roleByKey`：跨组拖放时覆盖身份。
 */
export function applyCastRailReorder(
  characters: readonly CharacterCard[],
  orderedKeys: readonly string[],
  roleByKey: Readonly<Record<string, CharacterRole>> = {},
): CharacterCard[] | null {
  if (orderedKeys.length !== characters.length) return null
  const keyed = characters.map((character, index) => ({
    key: characterSelectionKey(character, index),
    character,
  }))
  if (new Set(orderedKeys).size !== orderedKeys.length) return null
  const byKey = new Map(keyed.map(entry => [entry.key, entry.character]))
  if (orderedKeys.some(key => !byKey.has(key))) return null

  return orderedKeys.map(key => {
    const card = byKey.get(key)!
    const nextRole = roleByKey[key]
    return nextRole && nextRole !== card.role ? { ...card, role: nextRole } : card
  })
}
