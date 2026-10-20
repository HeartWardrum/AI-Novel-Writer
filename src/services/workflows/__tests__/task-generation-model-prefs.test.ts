import { describe, expect, it, vi, beforeEach } from 'vitest'

const { invokeWithProjectSession } = vi.hoisted(() => ({
  invokeWithProjectSession: vi.fn(),
}))

vi.mock('../../../services/ipc-client', () => ({
  ipc: { invokeWithProjectSession },
}))

vi.mock('../../../components/project-session-gate', () => ({
  isProjectSessionCurrent: () => true,
}))

import {
  loadTaskGenerationModelId,
  saveTaskGenerationModelId,
} from '../task-generation-model-prefs'
import type { ModelProfile, ProjectSessionContext } from '../../../shared/ipc-channels'

const session = {
  projectId: 'p1',
  leaseId: 'l1',
  projectPath: 'D:/novels/demo',
} as ProjectSessionContext

function model(id: string): ModelProfile {
  return {
    id,
    name: id,
    provider: 'deepseek',
    protocol: 'openai',
    modelName: id,
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    temperature: 0.7,
    purposes: ['generation'],
  } as ModelProfile
}

describe('task generation model prefs', () => {
  beforeEach(() => {
    invokeWithProjectSession.mockReset()
  })

  it('loads a remembered model when it is still available', async () => {
    invokeWithProjectSession.mockResolvedValueOnce({
      success: true,
      data: { writing: 'aion-1', setup: 'glm-1' },
    })
    const models = [model('aion-1'), model('glm-1')]
    await expect(loadTaskGenerationModelId(session, 'writing', models, 'glm-1')).resolves.toBe('aion-1')
  })

  it('falls back when the remembered model is gone', async () => {
    invokeWithProjectSession.mockResolvedValueOnce({
      success: true,
      data: { writing: 'missing' },
    })
    const models = [model('aion-1')]
    await expect(loadTaskGenerationModelId(session, 'writing', models, 'aion-1')).resolves.toBe('aion-1')
  })

  it('merges on save', async () => {
    invokeWithProjectSession
      .mockResolvedValueOnce({ success: true, data: { setup: 'glm-1' } })
      .mockResolvedValueOnce({ success: true })
    await saveTaskGenerationModelId(session, 'writing', 'aion-1')
    expect(invokeWithProjectSession).toHaveBeenLastCalledWith(
      session,
      'fs:write-json',
      'D:/novels/demo/.ai-novel/generation-preferences.json',
      { setup: 'glm-1', writing: 'aion-1' },
      'D:/novels/demo',
    )
  })
})
