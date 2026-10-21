import type { ProjectSessionContext } from '../../shared/ipc-channels'
import type { FinalizedContinuityProjection } from '../../shared/finalized-continuity'
import { ipc } from '../ipc-client'

/** 直连对话注入已定稿前文时的合计字数上限（约 6k～8k）。 */
export const DIRECT_CHAT_CONTINUITY_BUDGET = 7000

function chapterBlock(row: FinalizedContinuityProjection): string {
  const title = row.chapterTitle?.trim()
  const head = title
    ? `第${row.chapterNumber}章「${title}」`
    : `第${row.chapterNumber}章`
  const notes = row.chapterNotes?.trim() ?? ''
  const facts = (row.facts ?? [])
    .map(fact => fact.statement?.trim())
    .filter(Boolean)
    .slice(0, 8)
  const lines = [head]
  if (notes) lines.push(notes)
  if (facts.length > 0) lines.push(...facts.map(statement => `· ${statement}`))
  return lines.join('\n')
}

/**
 * 将「当前章之前」的定稿 continuity 格式化为中文上下文块。
 * 超预算时从最早章截断，优先保留近章。
 */
export function formatDirectChatContinuity(
  rows: readonly FinalizedContinuityProjection[],
  budget = DIRECT_CHAT_CONTINUITY_BUDGET,
): string | null {
  if (rows.length === 0) return null
  const ordered = [...rows].sort((a, b) => a.chapterNumber - b.chapterNumber)
  const blocks = ordered.map(chapterBlock).filter(block => block.trim().length > 0)
  if (blocks.length === 0) return null

  const kept: string[] = []
  let used = '【已定稿前文】'.length
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    const cost = block.length + (kept.length > 0 ? 2 : 0)
    if (used + cost > budget && kept.length > 0) break
    kept.unshift(block)
    used += cost
  }
  return `【已定稿前文】\n${kept.join('\n\n')}`
}

/**
 * 读取当前章之前的定稿剧情要点，供直连 sendMessage 注入。
 * 无章号、无会话或列表为空时返回 null。
 */
export async function loadDirectChatContinuity(options: {
  projectSession?: ProjectSessionContext
  chapterNumber?: number
}): Promise<string | null> {
  const { projectSession, chapterNumber } = options
  if (!projectSession || chapterNumber === undefined || !Number.isFinite(chapterNumber) || chapterNumber < 1) {
    return null
  }
  try {
    const rows = await ipc.invokeWithProjectSession(
      projectSession,
      'db:continuity-list-before',
      chapterNumber,
      projectSession.projectPath,
    )
    return formatDirectChatContinuity(rows)
  } catch {
    return null
  }
}
