/** 聊天栏「续写本章」用户消息模板（不定稿、不写回章节草稿）。 */

export function normalizeFocusChapterNumber(raw: unknown, fallback = 1): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.floor(n))
}

export function formatChapterFocusBlock(chapterNumber: number): string {
  const n = normalizeFocusChapterNumber(chapterNumber)
  return `【本章焦点】第 ${n} 章`
}

/**
 * 拼装续写本章的用户消息。
 * @param hint 输入框里可选的半句指导；空则只发续写指令。
 */
export function buildContinueChapterUserMessage(
  chapterNumber: number,
  hint?: string | null,
): string {
  const n = normalizeFocusChapterNumber(chapterNumber)
  const base = `请续写第 ${n} 章。承接对话里已有情节与世界书设定，直接写出下一段正文，不要解释写作计划。`
  const extra = hint?.trim()
  if (!extra) return base
  return `${base}\n作者补充：${extra}`
}
