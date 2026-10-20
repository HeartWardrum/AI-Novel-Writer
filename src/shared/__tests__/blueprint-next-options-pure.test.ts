import { describe, expect, it } from 'vitest'
import {
  parseBlueprintNextOptions,
  writableFieldsFromOption,
} from '../blueprint-next-options-pure'

describe('parseBlueprintNextOptions', () => {
  it('accepts a valid function track with ordered roles', () => {
    const options = parseBlueprintNextOptions(JSON.stringify({
      options: [
        { kind: 'writable', label: 'A', rationale: 'r', functionRole: 'info', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: ['甲'] },
        { kind: 'writable', label: 'B', rationale: 'r', functionRole: 'relationship', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: ['甲'] },
        { kind: 'writable', label: 'C', rationale: 'r', functionRole: 'pressure', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: ['甲'] },
        { kind: 'writable', label: 'D', rationale: 'r', functionRole: 'twist', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: ['甲'] },
      ],
    }), 'function')
    expect(options).toHaveLength(4)
    expect(writableFieldsFromOption(options[0]!)).toEqual({
      purpose: 'p',
      keyEvents: 'k',
      suspenseHook: 's',
      characters: ['甲'],
    })
  })

  it('rejects cost options without a cost', () => {
    expect(() => parseBlueprintNextOptions(JSON.stringify({
      options: [
        { kind: 'writable', label: 'A', rationale: 'r', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: [] },
        { kind: 'writable', label: 'B', rationale: 'r', cost: '失去盟友', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: [] },
        { kind: 'writable', label: 'C', rationale: 'r', cost: '暴露身份', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: [] },
      ],
    }), 'cost')).toThrow('BLUEPRINT_NEXT_OPTIONS_INVALID')
  })

  it('rejects bad track items that look writable', () => {
    expect(() => parseBlueprintNextOptions(JSON.stringify({
      options: [
        { kind: 'writable', label: 'A', rationale: 'r', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: [] },
        { kind: 'bad', label: 'B', whyBad: '伤节奏' },
        { kind: 'bad', label: 'C', whyBad: '伤人物' },
      ],
    }), 'bad')).toThrow('BLUEPRINT_NEXT_OPTIONS_INVALID')
  })

  it('accepts ordered pov options and reverse length bounds', () => {
    expect(parseBlueprintNextOptions(JSON.stringify({
      options: [
        { kind: 'writable', label: 'A', rationale: 'r', pov: 'protagonist', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: [] },
        { kind: 'writable', label: 'B', rationale: 'r', pov: 'antagonist', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: [] },
        { kind: 'writable', label: 'C', rationale: 'r', pov: 'bystander', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: [] },
      ],
    }), 'pov')).toHaveLength(3)

    expect(parseBlueprintNextOptions(JSON.stringify({
      options: [
        { kind: 'writable', label: 'A', rationale: 'r', purpose: 'p', keyEvents: 'k', suspenseHook: 's', characters: [] },
      ],
    }), 'reverse')).toHaveLength(1)
  })

  it('does not expose writable fields from bad options', () => {
    const options = parseBlueprintNextOptions(JSON.stringify({
      options: [
        { kind: 'bad', label: 'A', whyBad: '伤主题' },
        { kind: 'bad', label: 'B', whyBad: '伤节奏' },
        { kind: 'bad', label: 'C', whyBad: '伤人物' },
      ],
    }), 'bad')
    expect(writableFieldsFromOption(options[0]!)).toBeNull()
  })
})
