/**
 * Sequential NSFW-span unlock: B rewrites one marked block at a time;
 * unmarked regions must stay bit-identical after all replacements.
 */

import {
  assertUnmarkedRegionsUnchanged,
  findNsfwSpans,
  hasNsfwMarkers,
  NSFW_CLOSE,
  NSFW_OPEN,
  type NsfwSpan,
  NsfwMarkerError,
  stripNsfwMarkers,
} from './nsfw-soft-markers'

export interface NsfwUnlockSpanRequest {
  index: number
  total: number
  facts: string
  scaleNotes: string
  preceding: string
  softSpan: string
  following: string
}

export type NsfwSpanUnlocker = (request: NsfwUnlockSpanRequest) => Promise<string>

/** Short fact sticky-note from scale notes + soft-draft prefix. */
export function buildNsfwUnlockFacts(softPrefix: string, scaleNotes: string): string {
  const notes = scaleNotes.trim()
  const head = softPrefix.trim().slice(0, 800)
  return [
    notes ? `尺度笔记：\n${notes}` : '',
    head ? `软版前文摘录：\n${head}` : '',
  ].filter(Boolean).join('\n\n')
}

/** Fixed prompt template `nsfw_unlock_span` (experiment branch; not a builtin editable key). */
export function buildNsfwUnlockSpanPrompt(request: NsfwUnlockSpanRequest): {
  system: string
  user: string
} {
  const system = [
    '你是小说正文改写助手。任务：把软写段落改写成完整、连贯的正文替换段。',
    '只输出替换正文本身：不要标记、不要解释、不要前后缀、不要用代码块包裹。',
    '必须承接前后文语气与人称；不得改动标记外已有叙事。',
    '按尺度笔记落实亲密/成人尺度事实，但不得新增与前后文冲突的情节。',
  ].join('\n')

  const user = [
    `【块 ${request.index + 1}/${request.total}】`,
    '',
    '【事实便签】',
    request.facts || '（无）',
    '',
    '【尺度笔记】',
    request.scaleNotes.trim() || '（无）',
    '',
    '【前文】',
    request.preceding || '（章首）',
    '',
    '【待解锁软写段】',
    request.softSpan,
    '',
    '【后文】',
    request.following || '（章末）',
    '',
    '请只输出该软写段的替换正文。',
  ].join('\n')

  return { system, user }
}

function cleanReplacement(raw: string): string {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim()
  }
  if (hasNsfwMarkers(text)) {
    text = stripNsfwMarkers(text)
  }
  if (text.includes(NSFW_OPEN) || text.includes(NSFW_CLOSE)) {
    throw new NsfwMarkerError('Unlock replacement still contains NSFW markers')
  }
  return text
}

/**
 * Unlock every NSFW span in order. Re-parses after each replacement so later
 * before/after windows see already-unlocked prose.
 */
export async function unlockNsfwTextSequentially(
  softText: string,
  scaleNotes: string,
  unlockSpan: NsfwSpanUnlocker,
): Promise<string> {
  const initialSpans = findNsfwSpans(softText)
  if (initialSpans.length === 0) {
    throw new NsfwMarkerError('没有可解锁的标记')
  }

  let working = softText
  const total = initialSpans.length
  for (let index = 0; index < total; index += 1) {
    const spans = findNsfwSpans(working)
    if (spans.length === 0) break
    const span: NsfwSpan = spans[0]
    const preceding = working.slice(0, span.start)
    const facts = buildNsfwUnlockFacts(preceding, scaleNotes)
    const replacement = cleanReplacement(await unlockSpan({
      index,
      total,
      facts,
      scaleNotes,
      preceding: span.before,
      softSpan: span.inner,
      following: span.after,
    }))
    working = working.slice(0, span.start) + replacement + working.slice(span.end)
  }

  if (hasNsfwMarkers(working)) {
    working = stripNsfwMarkers(working)
  }
  assertUnmarkedRegionsUnchanged(softText, working)
  return working
}
