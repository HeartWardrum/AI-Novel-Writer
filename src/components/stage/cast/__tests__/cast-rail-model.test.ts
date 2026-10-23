import { describe, expect, it } from 'vitest'
import { EMPTY_CARD, type CharacterCard } from '../../../../stores/character-store'
import {
  applyCastRailReorder,
  groupCharactersByRole,
  isCharacterMentionedInText,
  recentChatHaystack,
} from '../cast-rail-model'

function card(partial: Partial<CharacterCard> & { name: string; characterId: string }): CharacterCard {
  return { ...EMPTY_CARD, role: 'supporting', ...partial }
}

describe('cast-rail-model mentions', () => {
  it('matches names of at least two characters in recent haystack', () => {
    expect(isCharacterMentionedInText('林', '林岚走来')).toBe(false)
    expect(isCharacterMentionedInText('林岚', '雾里林岚抬头')).toBe(true)
    expect(isCharacterMentionedInText(' 陆云 ', '陆云沉默')).toBe(true)
    expect(isCharacterMentionedInText('林岚', '')).toBe(false)
  })

  it('builds haystack from the last non-system messages', () => {
    const haystack = recentChatHaystack([
      { role: 'system', content: '系统' },
      { role: 'user', content: '甲' },
      { role: 'assistant', content: '乙' },
      { role: 'user', content: '丙' },
    ], 2)
    expect(haystack).toBe('乙\n丙')
    expect(haystack).not.toContain('甲')
    expect(haystack).not.toContain('系统')
  })
})

describe('cast-rail-model groups and reorder', () => {
  it('groups by role and keeps relative order', () => {
    const characters = [
      card({ characterId: 's1', name: '配一', role: 'supporting' }),
      card({ characterId: 'p1', name: '主', role: 'protagonist' }),
      card({ characterId: 's2', name: '配二', role: 'supporting' }),
      card({ characterId: 'a1', name: '反', role: 'antagonist' }),
    ]
    const groups = groupCharactersByRole(characters)
    expect(groups.map(group => group.role)).toEqual(['protagonist', 'antagonist', 'supporting'])
    expect(groups[0].items.map(item => item.character.name)).toEqual(['主'])
    expect(groups[2].items.map(item => item.character.name)).toEqual(['配一', '配二'])
  })

  it('applies flat reorder and optional role overrides', () => {
    const characters = [
      card({ characterId: 'p1', name: '主', role: 'protagonist' }),
      card({ characterId: 's1', name: '配', role: 'supporting' }),
    ]
    const keys = ['s1', 'p1']
    const next = applyCastRailReorder(characters, keys, { s1: 'antagonist' })
    expect(next?.map(c => c.characterId)).toEqual(['s1', 'p1'])
    expect(next?.[0].role).toBe('antagonist')
    expect(next?.[1].role).toBe('protagonist')
    expect(applyCastRailReorder(characters, ['s1'])).toBeNull()
  })
})
