import { describe, expect, it } from 'vitest'
import {
  buildContinueChapterUserMessage,
  formatChapterFocusBlock,
  normalizeFocusChapterNumber,
} from '../continue-chapter'

describe('continue-chapter', () => {
  it('normalizes focus chapter to integer >= 1', () => {
    expect(normalizeFocusChapterNumber(3.9)).toBe(3)
    expect(normalizeFocusChapterNumber(0)).toBe(1)
    expect(normalizeFocusChapterNumber('x', 2)).toBe(2)
  })

  it('builds continue message with and without hint', () => {
    expect(buildContinueChapterUserMessage(12)).toContain('请续写第 12 章')
    expect(buildContinueChapterUserMessage(12)).toContain('直接写出下一段正文')
    expect(buildContinueChapterUserMessage(12, '  今晚别让反派出场  ')).toContain('作者补充：今晚别让反派出场')
  })

  it('formats chapter focus system block', () => {
    expect(formatChapterFocusBlock(5)).toBe('【本章焦点】第 5 章')
  })
})
