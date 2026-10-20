import { describe, expect, it } from 'vitest'

import {
  assertUnmarkedRegionsUnchanged,
  findNsfwSpans,
  hasNsfwMarkers,
  NSFW_CLOSE,
  NSFW_OPEN,
  replaceNsfwSpans,
  stripNsfwMarkers,
} from '../nsfw-soft-markers'

describe('nsfw soft markers', () => {
  it('parses paired spans with context windows', () => {
    const text = `前文一二三${NSFW_OPEN}软写${NSFW_CLOSE}后文四五六`
    const spans = findNsfwSpans(text)
    expect(spans).toHaveLength(1)
    expect(spans[0].inner).toBe('软写')
    expect(spans[0].before).toContain('前文')
    expect(spans[0].after).toContain('后文')
  })

  it('rejects nested or unpaired markers', () => {
    expect(() => findNsfwSpans(`${NSFW_OPEN}a${NSFW_OPEN}b${NSFW_CLOSE}`)).toThrow(/Nested/)
    expect(() => findNsfwSpans(`${NSFW_OPEN}only`)).toThrow(/Unpaired/)
    expect(() => findNsfwSpans(`only${NSFW_CLOSE}`)).toThrow(/Unpaired/)
  })

  it('replaces spans and keeps unmarked text', () => {
    const text = `A${NSFW_OPEN}软1${NSFW_CLOSE}B${NSFW_OPEN}软2${NSFW_CLOSE}C`
    const unlocked = replaceNsfwSpans(text, ['硬1', '硬2'])
    expect(unlocked).toBe('A硬1B硬2C')
    assertUnmarkedRegionsUnchanged(text, unlocked)
  })

  it('strips markers keeping soft inner text', () => {
    expect(stripNsfwMarkers(`X${NSFW_OPEN}内${NSFW_CLOSE}Y`)).toBe('X内Y')
  })

  it('detects marker presence', () => {
    expect(hasNsfwMarkers(`no`)).toBe(false)
    expect(hasNsfwMarkers(`${NSFW_OPEN}x${NSFW_CLOSE}`)).toBe(true)
  })

  it('fails when unmarked regions drift', () => {
    const text = `A${NSFW_OPEN}软${NSFW_CLOSE}B`
    expect(() => assertUnmarkedRegionsUnchanged(text, 'A硬Z')).toThrow(/outside/)
    expect(() => assertUnmarkedRegionsUnchanged(text, `A硬${NSFW_OPEN}x${NSFW_CLOSE}B`)).toThrow(/still contains/)
  })
})
