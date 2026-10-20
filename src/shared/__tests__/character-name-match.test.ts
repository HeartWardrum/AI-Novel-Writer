import { describe, expect, it } from 'vitest'
import {
  buildCharacterNameIndex,
  findCharacterNameMatches,
} from '../character-name-match'

describe('character-name-match', () => {
  it('prefers the longest formal name at each position', () => {
    const index = buildCharacterNameIndex([
      { characterId: 'a', name: '林晚' },
      { characterId: 'b', name: '林晚舟' },
    ])
    expect(findCharacterNameMatches('林晚舟走进雨里。', index)).toEqual([
      { from: 0, to: 3, name: '林晚舟', characterIds: ['b'] },
    ])
  })

  it('ignores names that are not on the roster', () => {
    const index = buildCharacterNameIndex([{ characterId: 'a', name: '林晚' }])
    expect(findCharacterNameMatches('沈舟推开门。', index)).toEqual([])
  })

  it('keeps every characterId when formal names collide', () => {
    const index = buildCharacterNameIndex([
      { characterId: 'id-1', name: '阿明' },
      { characterId: 'id-2', name: '阿明' },
    ])
    expect(findCharacterNameMatches('阿明笑了。', index)).toEqual([
      { from: 0, to: 2, name: '阿明', characterIds: ['id-1', 'id-2'] },
    ])
  })

  it('requires word boundaries for ASCII names', () => {
    const index = buildCharacterNameIndex([{ characterId: 'a', name: 'Ann' }])
    expect(findCharacterNameMatches('Ann walked in.', index)).toEqual([
      { from: 0, to: 3, name: 'Ann', characterIds: ['a'] },
    ])
    expect(findCharacterNameMatches('Anniversary party.', index)).toEqual([])
    expect(findCharacterNameMatches('said Ann,', index)).toEqual([
      { from: 5, to: 8, name: 'Ann', characterIds: ['a'] },
    ])
  })

  it('applies fromOffset for document-absolute ranges', () => {
    const index = buildCharacterNameIndex([{ characterId: 'a', name: '林晚' }])
    expect(findCharacterNameMatches('林晚', index, 100)).toEqual([
      { from: 100, to: 102, name: '林晚', characterIds: ['a'] },
    ])
  })

  it('skips blank names and blank ids', () => {
    const index = buildCharacterNameIndex([
      { characterId: '', name: '废名' },
      { characterId: 'a', name: '  ' },
      { characterId: 'b', name: '林晚' },
    ])
    expect(index.names).toEqual(['林晚'])
  })
})
