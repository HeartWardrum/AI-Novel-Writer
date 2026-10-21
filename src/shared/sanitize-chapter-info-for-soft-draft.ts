/**
 * Rule-based softening of chapter blueprint fields before they reach a
 * moderated draft model. Full original text is kept separately for NSFW unlock.
 */

export interface SoftDraftChapterInfo {
  chapterNumber: number
  title: string
  role: string
  purpose: string
  characters: string[]
  keyEvents: string
  suspenseHook?: string
  userGuidance?: string
}

/** Phrases that often trip moderated providers when left in planning text. */
const EXPLICIT_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  { pattern: /做爱|性交|上床|插入|高潮|射精|阴茎|阴道|乳房|乳头|裸[体身]|脱光|口交|性爱|情色|色情|肉棒|小穴|抽插/gu, replacement: '亲密接触' },
  { pattern: /\b(fuck|sex|nude|naked|orgasm|penis|vagina|breast|nipple|erotic|porn)\b/giu, replacement: 'intimate moment' },
]

function softenText(value: string): string {
  let next = value
  for (const { pattern, replacement } of EXPLICIT_PATTERNS) {
    next = next.replace(pattern, replacement)
  }
  return next
    .replace(/亲密接触{2,}/gu, '亲密接触')
    .replace(/(intimate moment)(\s+\1)+/giu, '$1')
    .trim()
}

/**
 * Returns a copy safe for moderated draft prompts. Skeleton fields stay;
 * event/guidance/hook strings are softened.
 */
export function sanitizeChapterInfoForSoftDraft<T extends SoftDraftChapterInfo>(
  chapterInfo: T,
): T {
  const result = { ...chapterInfo, keyEvents: softenText(chapterInfo.keyEvents) }
  if (chapterInfo.suspenseHook !== undefined) result.suspenseHook = softenText(chapterInfo.suspenseHook)
  if (chapterInfo.userGuidance !== undefined) result.userGuidance = softenText(chapterInfo.userGuidance)
  return result
}

/** Compact scale notes for the unlock model (original wording). */
export function buildNsfwScaleNotes(chapterInfo: SoftDraftChapterInfo): string {
  const lines = [
    `第${chapterInfo.chapterNumber}章 ${chapterInfo.title}`.trim(),
    chapterInfo.purpose?.trim() ? `目标：${chapterInfo.purpose.trim()}` : '',
    chapterInfo.keyEvents?.trim() ? `事件：${chapterInfo.keyEvents.trim()}` : '',
    chapterInfo.suspenseHook?.trim() ? `钩子：${chapterInfo.suspenseHook.trim()}` : '',
    chapterInfo.userGuidance?.trim() ? `作者指导：${chapterInfo.userGuidance.trim()}` : '',
    chapterInfo.characters.length > 0 ? `人物：${chapterInfo.characters.join('、')}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}
