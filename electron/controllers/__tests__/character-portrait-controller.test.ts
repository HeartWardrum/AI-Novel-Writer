import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CharacterPortraitService } from '../../services/character-portrait-service'

type Handler = (...args: unknown[]) => Promise<unknown> | unknown
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), showOpenDialog: vi.fn() }))
vi.mock('electron', () => ({
  app: { getLocale: () => 'zh-CN' },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  ipcMain: { handle: vi.fn((channel: string, handler: Handler) => mocks.handlers.set(channel, handler)) },
}))
vi.mock('../../i18n', () => ({ mainText: (_locale: string, zh: string) => zh }))

import { registerCharacterPortraitController } from '../character-portrait-controller'

const event = { sender: { id: 9, isDestroyed: () => false } }
const context = { projectId: 'project-a', leaseId: 'lease-a', projectPath: 'C:\\Novel' }
const portrait = {
  portraitId: '11111111-1111-1111-1111-111111111111',
  characterId: 'stable-a',
  sortIndex: 0,
  mime: 'image/png' as const,
  base64: 'image',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function fakeService() {
  return {
    hasCharacter: vi.fn(() => true),
    list: vi.fn(() => [portrait]),
    addFromFiles: vi.fn(async () => [portrait]),
    remove: vi.fn(),
    reorder: vi.fn(() => [portrait]),
  }
}

beforeEach(() => { mocks.handlers.clear(); mocks.showOpenDialog.mockReset() })

describe('character portrait controller', () => {
  it('registers list/add/remove/reorder and treats picker cancellation as no mutation', async () => {
    const service = fakeService()
    registerCharacterPortraitController({ resolveService: () => service as unknown as CharacterPortraitService })
    expect([...mocks.handlers.keys()].sort()).toEqual([
      'character-portrait:choose-add',
      'character-portrait:list',
      'character-portrait:remove',
      'character-portrait:reorder',
    ])
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await mocks.handlers.get('character-portrait:choose-add')!(event, 'stable-a', context)).toEqual({
      success: true, cancelled: true,
    })
    expect(service.addFromFiles).not.toHaveBeenCalled()
  })

  it('lists portraits for a valid session', async () => {
    const service = fakeService()
    registerCharacterPortraitController({ resolveService: () => service as unknown as CharacterPortraitService })
    expect(await mocks.handlers.get('character-portrait:list')!(event, 'stable-a', context)).toEqual({
      success: true, portraits: [portrait],
    })
  })

  it('requires a valid frozen project session', async () => {
    const resolveService = vi.fn(() => fakeService() as unknown as CharacterPortraitService)
    registerCharacterPortraitController({ resolveService })
    expect(await mocks.handlers.get('character-portrait:list')!(event, 'stable-a', { projectId: 'project-a' })).toMatchObject({
      success: false, error: { code: 'PROJECT_NOT_OPEN' },
    })
    expect(resolveService).not.toHaveBeenCalled()
  })
})
