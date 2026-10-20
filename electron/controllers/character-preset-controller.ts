import fs from 'node:fs'
import { app, dialog, ipcMain } from 'electron'
import type { ProjectSessionContext } from '../../src/shared/ipc-channels'
import { isProjectSessionContext } from '../../src/shared/project-session-context'
import type { CharacterPresetFields } from '../../src/shared/character-preset'
import { mainText } from '../i18n'
import { VELA_HOME } from '../utils/config-utils'
import { assertGlobalDataReady } from '../services/app-data-locator'
import { CharacterPresetStore } from '../services/character-preset-store'
import type { CharacterAssetService } from '../services/character-asset-service'
import type { CharacterPortraitService } from '../services/character-portrait-service'

function text(zh: string, en: string): string {
  return mainText(app.getLocale(), zh, en)
}

function fail(error: unknown): { success: false; error: string } {
  const message = error instanceof Error ? error.message : String(error)
  const mapped: Record<string, [string, string]> = {
    INVALID_PRESET_ID: ['预制人物标识无效', 'The character preset id is invalid'],
    PRESET_NOT_FOUND: ['找不到该预制人物', 'That character preset was not found'],
    PRESET_CORRUPT: ['预制人物数据已损坏', 'The character preset is corrupt'],
    PRESET_NAME_REQUIRED: ['请填写姓名', 'Name is required'],
    IMAGE_FORMAT_INVALID: ['请选择有效的 PNG、JPEG 或 WebP 图片', 'Choose a valid PNG, JPEG, or WebP image'],
    IMAGE_TOO_LARGE: ['图片超过 4 MB', 'The image is larger than 4 MB'],
    PORTRAIT_LIMIT_REACHED: ['人设图数量已达上限', 'Portrait limit reached'],
    PORTRAIT_NOT_FOUND: ['找不到该人设图', 'That portrait was not found'],
    CHARACTER_NOT_FOUND: ['目标角色不存在', 'The target character was not found'],
  }
  const pair = mapped[message]
  return { success: false, error: pair ? text(pair[0], pair[1]) : message }
}

export interface CharacterPresetControllerDependencies {
  resolveAvatarService(context: ProjectSessionContext): CharacterAssetService | null
  resolvePortraitService(context: ProjectSessionContext): CharacterPortraitService | null
}

function store(): CharacterPresetStore {
  assertGlobalDataReady()
  return new CharacterPresetStore(VELA_HOME)
}

async function chooseImageFiles(multi: boolean): Promise<string[] | null> {
  const selection = await dialog.showOpenDialog({
    title: text(multi ? '选择人设图' : '选择头像', multi ? 'Choose portraits' : 'Choose an avatar'),
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: 'PNG / JPEG / WebP', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  if (selection.canceled || selection.filePaths.length === 0) return null
  return selection.filePaths
}

export function registerCharacterPresetController(deps: CharacterPresetControllerDependencies): void {
  ipcMain.handle('character-preset:list', async () => {
    try {
      return { success: true as const, presets: store().list() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('character-preset:load', async (_event, presetId: string) => {
    try {
      return { success: true as const, preset: store().load(String(presetId ?? '')) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('character-preset:create', async (_event, fields?: Partial<CharacterPresetFields>) => {
    try {
      return { success: true as const, preset: store().create(fields) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('character-preset:save-fields', async (_event, presetId: string, fields: CharacterPresetFields) => {
    try {
      return { success: true as const, preset: store().saveFields(String(presetId ?? ''), fields) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('character-preset:delete', async (_event, presetId: string) => {
    try {
      store().delete(String(presetId ?? ''))
      return { success: true as const }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('character-preset:choose-avatar', async (_event, presetId: string) => {
    try {
      const paths = await chooseImageFiles(false)
      if (!paths) return { success: true as const, cancelled: true as const }
      const bytes = fs.readFileSync(paths[0]!)
      return { success: true as const, cancelled: false as const, preset: store().setAvatarFromBytes(String(presetId ?? ''), bytes) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('character-preset:clear-avatar', async (_event, presetId: string) => {
    try {
      return { success: true as const, preset: store().clearAvatar(String(presetId ?? '')) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('character-preset:choose-portraits-add', async (_event, presetId: string) => {
    try {
      const paths = await chooseImageFiles(true)
      if (!paths) return { success: true as const, cancelled: true as const }
      let preset = store().load(String(presetId ?? ''))
      for (const filePath of paths) {
        preset = store().addPortraitFromBytes(String(presetId ?? ''), fs.readFileSync(filePath))
      }
      return { success: true as const, cancelled: false as const, preset }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('character-preset:remove-portrait', async (_event, presetId: string, portraitId: string) => {
    try {
      return {
        success: true as const,
        preset: store().removePortrait(String(presetId ?? ''), String(portraitId ?? '')),
      }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'character-preset:apply-assets',
    async (_event, presetId: string, characterId: string, context: ProjectSessionContext) => {
      try {
        if (!isProjectSessionContext(context)) throw new Error('PROJECT_NOT_OPEN')
        const avatarService = deps.resolveAvatarService(context)
        const portraitService = deps.resolvePortraitService(context)
        if (!avatarService || !portraitService) throw new Error('PROJECT_NOT_OPEN')
        if (!avatarService.hasCharacter(characterId)) throw new Error('CHARACTER_NOT_FOUND')
        const assets = store().assetFilePaths(String(presetId ?? ''))
        if (assets.avatarPath) {
          const preview = await avatarService.previewFile(characterId, assets.avatarPath)
          avatarService.commit(characterId, preview.base64)
        }
        if (assets.portraitPaths.length) {
          await portraitService.addFromFiles(characterId, assets.portraitPaths)
        }
        return { success: true as const }
      } catch (error) {
        return fail(error)
      }
    },
  )
}
