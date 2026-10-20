import { describe, expect, it, vi } from 'vitest'

import { NSFW_CLOSE, NSFW_OPEN } from '../nsfw-soft-markers'
import {
  buildNsfwUnlockFacts,
  buildNsfwUnlockSpanPrompt,
  unlockNsfwTextSequentially,
} from '../nsfw-unlock-apply'

describe('nsfw unlock apply', () => {
  it('builds facts from scale notes and soft prefix', () => {
    const facts = buildNsfwUnlockFacts('前文一段', '事件：亲密接触')
    expect(facts).toContain('尺度笔记')
    expect(facts).toContain('亲密接触')
    expect(facts).toContain('软版前文摘录')
    expect(facts).toContain('前文一段')
  })

  it('builds unlock prompt without markers in the contract', () => {
    const { system, user } = buildNsfwUnlockSpanPrompt({
      index: 0,
      total: 1,
      facts: '事实',
      scaleNotes: '尺度',
      preceding: '前',
      softSpan: '软',
      following: '后',
    })
    expect(system).toContain('只输出替换正文')
    expect(user).toContain('待解锁软写段')
    expect(user).toContain('软')
  })

  it('unlocks spans sequentially and keeps unmarked text', async () => {
    const soft = `开场。${NSFW_OPEN}软写一${NSFW_CLOSE}中间。${NSFW_OPEN}软写二${NSFW_CLOSE}收束。`
    const unlock = vi.fn(async (request: { softSpan: string; index: number }) => {
      if (request.index === 0) return '硬写一'
      return '硬写二'
    })
    const result = await unlockNsfwTextSequentially(soft, '尺度：升级亲密', unlock)
    expect(result).toBe('开场。硬写一中间。硬写二收束。')
    expect(unlock).toHaveBeenCalledTimes(2)
    expect(unlock.mock.calls[1][0].preceding).toContain('硬写一')
  })

  it('fails when there are no markers', async () => {
    await expect(unlockNsfwTextSequentially('普通正文', '', async () => 'x')).rejects.toThrow(/没有可解锁/)
  })

  it('strips accidental markers from model replacement', async () => {
    const soft = `A${NSFW_OPEN}软${NSFW_CLOSE}B`
    const result = await unlockNsfwTextSequentially(
      soft,
      '',
      async () => `${NSFW_OPEN}硬写${NSFW_CLOSE}`,
    )
    expect(result).toBe('A硬写B')
  })
})
