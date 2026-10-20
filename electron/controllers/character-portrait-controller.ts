import { app, dialog, ipcMain } from 'electron'
import type { ProjectSessionContext } from '../../src/shared/ipc-channels'
import { isProjectSessionContext } from '../../src/shared/project-session-context'
import type {
  CharacterPortraitChooseAddResponse,
  CharacterPortraitError,
  CharacterPortraitErrorCode,
  CharacterPortraitListResponse,
  CharacterPortraitRemoveResponse,
  CharacterPortraitReorderResponse,
} from '../../src/shared/character-portraits'
import { mainText } from '../i18n'
import type { CharacterPortraitService } from '../services/character-portrait-service'

interface PortraitEvent {
  sender?: { id?: number; isDestroyed?: () => boolean }
}

export interface CharacterPortraitControllerDependencies {
  resolveService(event: PortraitEvent, context: ProjectSessionContext): CharacterPortraitService | null
}

function text(zh: string, en: string): string { return mainText(app.getLocale(), zh, en) }

function failure(code: CharacterPortraitErrorCode): CharacterPortraitError {
  const messages: Record<CharacterPortraitErrorCode, [string, string]> = {
    INVALID_SENDER: ['当前窗口无权访问角色人设图。', 'This window cannot access character portraits.'],
    INVALID_CHARACTER_ID: ['角色身份无效，人设图未修改。', 'The character identity is invalid.'],
    INVALID_PORTRAIT_ID: ['人设图身份无效。', 'The portrait identity is invalid.'],
    PROJECT_NOT_OPEN: ['尚未打开项目，无法访问人设图。', 'No project is open.'],
    CHARACTER_NOT_FOUND: ['该角色已不存在，人设图未修改。', 'That character no longer exists.'],
    PORTRAIT_NOT_FOUND: ['该人设图已不存在。', 'That portrait no longer exists.'],
    IMAGE_READ_FAILED: ['无法读取所选图片，请重新选择。', 'The selected image could not be read.'],
    IMAGE_FORMAT_INVALID: ['请选择有效的 PNG、JPEG 或 WebP 图片。', 'Choose a valid PNG, JPEG, or WebP image.'],
    IMAGE_TOO_LARGE: ['图片超过 4 MB，请换一张更小的。', 'The image is larger than 4 MB.'],
    PORTRAIT_LIMIT_REACHED: ['每人最多 64 张人设图。', 'Each character can have at most 64 portraits.'],
    PORTRAIT_SAVE_FAILED: ['人设图保存失败。', 'The portrait could not be saved.'],
    PORTRAIT_REORDER_INVALID: ['人设图排序无效，请重试。', 'The portrait order is invalid. Try again.'],
  }
  const [zh, en] = messages[code]
  return { code, message: text(zh, en) }
}

function validSender(event: PortraitEvent): boolean {
  return Boolean(event.sender && Number.isSafeInteger(event.sender.id) && (event.sender.id ?? 0) > 0
    && typeof event.sender.isDestroyed === 'function' && !event.sender.isDestroyed())
}

function errorCode(error: unknown): CharacterPortraitErrorCode {
  if (error instanceof Error && [
    'INVALID_CHARACTER_ID', 'INVALID_PORTRAIT_ID', 'CHARACTER_NOT_FOUND', 'PORTRAIT_NOT_FOUND',
    'IMAGE_READ_FAILED', 'IMAGE_FORMAT_INVALID', 'IMAGE_TOO_LARGE', 'PORTRAIT_LIMIT_REACHED',
    'PORTRAIT_REORDER_INVALID',
  ].includes(error.message)) return error.message as CharacterPortraitErrorCode
  return 'PORTRAIT_SAVE_FAILED'
}

const CHARACTER_ID = /^[a-zA-Z0-9_-]{1,128}$/u

function serviceFor(
  deps: CharacterPortraitControllerDependencies,
  event: PortraitEvent,
  context: ProjectSessionContext,
): CharacterPortraitService | null {
  if (!validSender(event) || !isProjectSessionContext(context)) return null
  return deps.resolveService(event, context)
}

export function registerCharacterPortraitController(deps: CharacterPortraitControllerDependencies): void {
  let mutationTail: Promise<void> = Promise.resolve()
  const serialize = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const scheduled = mutationTail.then(operation, operation)
    mutationTail = scheduled.then(() => undefined, () => undefined)
    return scheduled
  }

  ipcMain.handle('character-portrait:list', (event: PortraitEvent, characterId: string, context: ProjectSessionContext): CharacterPortraitListResponse => {
    if (!validSender(event)) return { success: false, error: failure('INVALID_SENDER') }
    const service = serviceFor(deps, event, context)
    if (!service) return { success: false, error: failure('PROJECT_NOT_OPEN') }
    if (!CHARACTER_ID.test(characterId)) return { success: false, error: failure('INVALID_CHARACTER_ID') }
    try {
      return { success: true, portraits: service.list(characterId) }
    } catch (error) {
      return { success: false, error: failure(errorCode(error)) }
    }
  })

  ipcMain.handle('character-portrait:choose-add', (event: PortraitEvent, characterId: string, context: ProjectSessionContext): Promise<CharacterPortraitChooseAddResponse> => serialize(async () => {
    if (!validSender(event)) return { success: false, error: failure('INVALID_SENDER') }
    const service = serviceFor(deps, event, context)
    if (!service) return { success: false, error: failure('PROJECT_NOT_OPEN') }
    if (!service.hasCharacter(characterId)) return { success: false, error: failure('CHARACTER_NOT_FOUND') }
    let selection: Awaited<ReturnType<typeof dialog.showOpenDialog>>
    try {
      selection = await dialog.showOpenDialog({
        title: text('选择人设图', 'Choose character portraits'),
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PNG / JPEG / WebP', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      })
    } catch { return { success: false, error: failure('IMAGE_READ_FAILED') } }
    if (selection.canceled || selection.filePaths.length === 0) return { success: true, cancelled: true }
    try {
      const portraits = await service.addFromFiles(characterId, selection.filePaths)
      return { success: true, cancelled: false, portraits }
    } catch (error) {
      return { success: false, error: failure(errorCode(error)) }
    }
  }))

  ipcMain.handle('character-portrait:remove', (event: PortraitEvent, portraitId: string, context: ProjectSessionContext): Promise<CharacterPortraitRemoveResponse> => serialize(async () => {
    if (!validSender(event)) return { success: false, error: failure('INVALID_SENDER') }
    const service = serviceFor(deps, event, context)
    if (!service) return { success: false, error: failure('PROJECT_NOT_OPEN') }
    try {
      service.remove(portraitId)
      return { success: true }
    } catch (error) {
      return { success: false, error: failure(errorCode(error)) }
    }
  }))

  ipcMain.handle('character-portrait:reorder', (event: PortraitEvent, characterId: string, portraitIds: string[], context: ProjectSessionContext): Promise<CharacterPortraitReorderResponse> => serialize(async () => {
    if (!validSender(event)) return { success: false, error: failure('INVALID_SENDER') }
    const service = serviceFor(deps, event, context)
    if (!service) return { success: false, error: failure('PROJECT_NOT_OPEN') }
    if (!CHARACTER_ID.test(characterId) || !Array.isArray(portraitIds)) {
      return { success: false, error: failure('PORTRAIT_REORDER_INVALID') }
    }
    try {
      return { success: true, portraits: service.reorder(characterId, portraitIds) }
    } catch (error) {
      return { success: false, error: failure(errorCode(error)) }
    }
  }))
}
