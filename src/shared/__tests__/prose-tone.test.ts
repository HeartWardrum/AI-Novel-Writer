import { describe, expect, it } from 'vitest'
import {
  formatProseToneBlock,
  normalizeProseToneId,
  PROSE_TONE_PRESETS,
} from '../prose-tone'

describe('prose-tone', () => {
  it('normalizes unknown ids to default', () => {
    expect(normalizeProseToneId('web-novel')).toBe('web-novel')
    expect(normalizeProseToneId('nope')).toBe('default')
    expect(normalizeProseToneId(undefined)).toBe('default')
  })

  it('formats non-default filters with boundary text and skips default', () => {
    expect(formatProseToneBlock('default')).toBeNull()
    const block = formatProseToneBlock('dialogue-dense')
    expect(block).toContain('【本轮文风滤镜】')
    expect(block).toContain('对话密')
    expect(block).toContain('【文风适用边界】')
    expect(PROSE_TONE_PRESETS.map(item => item.id)).toEqual([
      'default',
      'web-novel',
      'literary',
      'dialogue-dense',
      'oppressive',
    ])
  })
})
