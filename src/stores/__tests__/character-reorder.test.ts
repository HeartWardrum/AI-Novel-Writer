import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_CARD, characterSelectionKey, useCharacterStore } from '../character-store'
import { useProjectStore } from '../project-store'

const path = 'C:/novels/harbor'
const session = {
  projectId: 'p1',
  leaseId: 'lease-1',
  projectPath: path,
}

describe('character-store reorderCharacters', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: {
        id: 'p1',
        path,
        sessionLease: 'lease-1',
        novelConfig: {},
      } as never,
    })
    useCharacterStore.setState({
      characters: [
        { ...EMPTY_CARD, characterId: 'p1', name: '主', role: 'protagonist' },
        { ...EMPTY_CARD, characterId: 's1', name: '配', role: 'supporting' },
      ],
      dataProjectKey: path,
      dataProjectSession: session,
      loadingProjectKey: null,
      loadingProjectSession: null,
      lastError: null,
      loaded: true,
      selectedId: 'p1',
      selectedName: '主',
    })
  })

  afterEach(() => {
    useProjectStore.setState({ currentProject: null })
    useCharacterStore.getState().reset()
  })

  it('reorders the roster and can change role for a moved card', () => {
    const ok = useCharacterStore.getState().reorderCharacters(
      ['s1', 'p1'],
      { s1: 'antagonist' },
    )
    expect(ok).toBe(true)
    const characters = useCharacterStore.getState().characters
    expect(characters.map(c => c.characterId)).toEqual(['s1', 'p1'])
    expect(characters[0].role).toBe('antagonist')
    expect(characterSelectionKey(characters[0], 0)).toBe('s1')
  })
})
