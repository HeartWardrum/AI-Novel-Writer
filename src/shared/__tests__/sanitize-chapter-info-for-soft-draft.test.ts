import { describe, expect, it } from 'vitest'

import {
  buildNsfwScaleNotes,
  sanitizeChapterInfoForSoftDraft,
} from '../sanitize-chapter-info-for-soft-draft'

describe('sanitizeChapterInfoForSoftDraft', () => {
  const base = {
    chapterNumber: 3,
    title: '雨夜',
    role: '发展',
    purpose: '两人关系推进',
    characters: ['林晚', '沈舟'],
    keyEvents: '两人做爱并达成和解',
    suspenseHook: '门外有人听到情色动静',
    userGuidance: '可以写得露骨一些，上床细节要足',
  }

  it('softens explicit wording but keeps cast and title', () => {
    const soft = sanitizeChapterInfoForSoftDraft(base)
    expect(soft.title).toBe('雨夜')
    expect(soft.characters).toEqual(['林晚', '沈舟'])
    expect(soft.keyEvents).not.toContain('做爱')
    expect(soft.keyEvents).toContain('亲密接触')
    expect(soft.userGuidance).not.toContain('上床')
  })

  it('keeps original wording in scale notes for unlock', () => {
    const notes = buildNsfwScaleNotes(base)
    expect(notes).toContain('做爱')
    expect(notes).toContain('林晚')
  })
})
