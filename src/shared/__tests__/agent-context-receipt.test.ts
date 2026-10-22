import { describe, expect, it } from 'vitest'
import {
  buildAgentContextReceipt,
  formatAgentContextReceiptHint,
} from '../agent-chat'

describe('buildAgentContextReceipt', () => {
  it('returns undefined when both sides are empty', () => {
    expect(buildAgentContextReceipt({})).toBeUndefined()
    expect(buildAgentContextReceipt({ worldbookTitles: ['  '], continuityChapters: [] })).toBeUndefined()
  })

  it('keeps trimmed titles and chapter meta', () => {
    expect(buildAgentContextReceipt({
      worldbookTitles: [' 林晚 ', '青云城'],
      continuityChapters: [{ chapterNumber: 10, chapterTitle: ' 潮汐 ' }],
    })).toEqual({
      worldbookTitles: ['林晚', '青云城'],
      continuityChapters: [{ chapterNumber: 10, chapterTitle: '潮汐' }],
    })
  })
})

describe('formatAgentContextReceiptHint', () => {
  const localize = (zh: string) => zh

  it('formats worldbook and continuity together', () => {
    expect(formatAgentContextReceiptHint({
      worldbookTitles: ['林晚', '青云城'],
      continuityChapters: [{ chapterNumber: 10 }, { chapterNumber: 11 }],
    }, localize)).toBe('本轮已带入：林晚、青云城；前文：第 10、11 章')
  })

  it('truncates long worldbook title lists', () => {
    const titles = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛']
    expect(formatAgentContextReceiptHint({
      worldbookTitles: titles,
      continuityChapters: [],
    }, localize)).toBe('本轮已带入：甲、乙、丙、丁、戊、己等 2 项')
  })

  it('returns null for empty receipt', () => {
    expect(formatAgentContextReceiptHint({
      worldbookTitles: [],
      continuityChapters: [],
    }, localize)).toBeNull()
  })
})
