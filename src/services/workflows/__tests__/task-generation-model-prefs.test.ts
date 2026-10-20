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
  defaultSoftNsfwDraftMarkers,
  loadSoftNsfwDraftMarkers,
  loadTaskGenerationModelId,
  saveSoftNsfwDraftMarkers,
  saveTaskGenerationModelId,
} from '../task-generation-model-prefs'
import type { ModelProfile, ProjectSessionContext } from '../../../shared/ipc-channels'

const session = {
  projectId: 'p1',
  leaseId: 'l1',
  projectPath: 'D:/novels/demo',
} as ProjectSessionContext

function model(id: string, provider: ModelProfile['provider'] = 'deepseek'): ModelProfile {
  return {
    id,
    name: id,
    provider,
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

  it('defaults soft NSFW markers off for aion and on for others', () => {
    expect(defaultSoftNsfwDraftMarkers(model('aion-1', 'aion'))).toBe(false)
    expect(defaultSoftNsfwDraftMarkers(model('glm-1', 'deepseek'))).toBe(true)
    expect(defaultSoftNsfwDraftMarkers(undefined)).toBe(true)
  })

  it('loads remembered soft markers when present', async () => {
    invokeWithProjectSession.mockResolvedValueOnce({
      success: true,
      data: { softNsfwDraftMarkers: false, writing: 'glm-1' },
    })
    await expect(loadSoftNsfwDraftMarkers(session, [model('glm-1')], 'glm-1')).resolves.toBe(false)
  })

  it('falls back to model default when soft markers are unset', async () => {
    invokeWithProjectSession.mockResolvedValueOnce({ success: true, data: { writing: 'aion-1' } })
    await expect(
      loadSoftNsfwDraftMarkers(session, [model('aion-1', 'aion')], 'aion-1'),
    ).resolves.toBe(false)
    invokeWithProjectSession.mockResolvedValueOnce({ success: true, data: {} })
    await expect(
      loadSoftNsfwDraftMarkers(session, [model('glm-1')], 'glm-1'),
    ).resolves.toBe(true)
  })

  it('preserves model prefs when saving soft markers', async () => {
    invokeWithProjectSession
      .mockResolvedValueOnce({ success: true, data: { writing: 'glm-1' } })
      .mockResolvedValueOnce({ success: true })
    await saveSoftNsfwDraftMarkers(session, false)
    expect(invokeWithProjectSession).toHaveBeenLastCalledWith(
      session,
      'fs:write-json',
      'D:/novels/demo/.ai-novel/generation-preferences.json',
      { writing: 'glm-1', softNsfwDraftMarkers: false },
      'D:/novels/demo',
    )
  })

  it('preserves soft markers when saving a model id', async () => {
    invokeWithProjectSession
      .mockResolvedValueOnce({ success: true, data: { softNsfwDraftMarkers: false } })
      .mockResolvedValueOnce({ success: true })
    await saveTaskGenerationModelId(session, 'writing', 'aion-1')
    expect(invokeWithProjectSession).toHaveBeenLastCalledWith(
      session,
      'fs:write-json',
      'D:/novels/demo/.ai-novel/generation-preferences.json',
      { softNsfwDraftMarkers: false, writing: 'aion-1' },
      'D:/novels/demo',
    )
  })
})
