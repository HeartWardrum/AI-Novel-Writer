import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_CARD, useCharacterStore } from '../character-store'
import { useProjectStore } from '../project-store'

const { invokeWithProjectSession } = vi.hoisted(() => ({
  invokeWithProjectSession: vi.fn(),
}))

vi.mock('../../services/ipc-client', () => ({
  ipc: { invokeWithProjectSession },
}))

const path = 'C:/novels/harbor'
const session = {
  projectId: 'p1',
  leaseId: 'lease-1',
  projectPath: path,
}

describe('character-store loadCurrentDerivedFields', () => {
  beforeEach(() => {
    invokeWithProjectSession.mockReset()
    useProjectStore.setState({
      currentProject: {
        id: 'p1',
        path,
        sessionLease: 'lease-1',
        novelConfig: {},
      } as never,
    })
    useCharacterStore.setState({
      characters: [{ ...EMPTY_CARD, characterId: 'c1', name: '主' }],
      dataProjectKey: path,
      dataProjectSession: session,
      loadingProjectKey: null,
      loadingProjectSession: null,
      lastError: null,
      loaded: true,
      currentDerivedFields: {},
    })
  })

  afterEach(() => {
    useProjectStore.setState({ currentProject: null })
    useCharacterStore.getState().reset()
  })

  it('fetches derived fields via the lazy IPC channel', async () => {
    invokeWithProjectSession.mockResolvedValueOnce({ c1: ['recentEvents'] })
    await useCharacterStore.getState().loadCurrentDerivedFields()
    expect(invokeWithProjectSession).toHaveBeenCalledWith(
      session,
      'db:character-derived-fields-read',
      path,
    )
    expect(useCharacterStore.getState().currentDerivedFields).toEqual({ c1: ['recentEvents'] })
  })

  it('clears fields when the lazy IPC fails', async () => {
    useCharacterStore.setState({ currentDerivedFields: { c1: ['mood'] } })
    invokeWithProjectSession.mockRejectedValueOnce(new Error('boom'))
    await useCharacterStore.getState().loadCurrentDerivedFields()
    expect(useCharacterStore.getState().currentDerivedFields).toEqual({})
  })
})
