import { describe, expect, it } from 'vitest'

import { NSFW_OPEN } from '../../../../shared/nsfw-soft-markers'
import {
  chapterExecutionContractText,
  softNsfwDraftMarkersEnabled,
} from '../generate-draft.command'
import {
  buildNsfwScaleNotes,
  sanitizeChapterInfoForSoftDraft,
} from '../../../../shared/sanitize-chapter-info-for-soft-draft'

const chapter = {
  chapterNumber: 2,
  title: '雨夜',
  role: '发展',
  purpose: '关系推进',
  characters: ['林晚'],
  keyEvents: '两人做爱并和解',
  suspenseHook: '',
  userGuidance: '可以写得露骨一些',
}

describe('soft NSFW draft marker gate', () => {
  it('treats missing flag as soft-on (legacy default)', () => {
    expect(softNsfwDraftMarkersEnabled(undefined)).toBe(true)
    expect(softNsfwDraftMarkersEnabled({})).toBe(true)
    expect(softNsfwDraftMarkersEnabled({ softNsfwDraftMarkers: true })).toBe(true)
    expect(softNsfwDraftMarkersEnabled({ softNsfwDraftMarkers: false })).toBe(false)
  })

  it('includes soft-marker contract when soft is on', () => {
    const { rules } = chapterExecutionContractText('zh-CN', chapter, true)
    expect(rules).toContain('【软写标记】')
    expect(rules).toContain(NSFW_OPEN)
  })

  it('omits soft-marker contract when soft is off', () => {
    const { rules } = chapterExecutionContractText('zh-CN', chapter, false)
    expect(rules).not.toContain('【软写标记】')
    expect(rules).not.toContain(NSFW_OPEN)
    expect(rules).toContain('【操作边界】')
  })

  it('keeps full blueprint wording when soft is off', () => {
    const soft = softNsfwDraftMarkersEnabled({ softNsfwDraftMarkers: false })
    const writer = soft ? sanitizeChapterInfoForSoftDraft(chapter) : chapter
    expect(writer.keyEvents).toContain('做爱')
    expect(soft ? buildNsfwScaleNotes(chapter) : undefined).toBeUndefined()
  })

  it('sanitizes and builds scale notes when soft is on', () => {
    const soft = softNsfwDraftMarkersEnabled({ softNsfwDraftMarkers: true })
    const writer = soft ? sanitizeChapterInfoForSoftDraft(chapter) : chapter
    expect(writer.keyEvents).not.toContain('做爱')
    expect(buildNsfwScaleNotes(chapter)).toContain('做爱')
  })
})
