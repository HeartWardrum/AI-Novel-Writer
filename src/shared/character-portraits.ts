/** Cross-process contract for per-character portrait galleries (parallel to avatars). */

export const MAX_CHARACTER_PORTRAIT_INPUT_BYTES = 4 * 1024 * 1024
export const MAX_CHARACTER_PORTRAITS_PER_CHARACTER = 64

export type CharacterPortraitErrorCode =
  | 'INVALID_SENDER'
  | 'INVALID_CHARACTER_ID'
  | 'INVALID_PORTRAIT_ID'
  | 'PROJECT_NOT_OPEN'
  | 'CHARACTER_NOT_FOUND'
  | 'PORTRAIT_NOT_FOUND'
  | 'IMAGE_READ_FAILED'
  | 'IMAGE_FORMAT_INVALID'
  | 'IMAGE_TOO_LARGE'
  | 'PORTRAIT_LIMIT_REACHED'
  | 'PORTRAIT_SAVE_FAILED'
  | 'PORTRAIT_REORDER_INVALID'

export interface CharacterPortraitError {
  code: CharacterPortraitErrorCode
  message: string
}

export interface CharacterPortraitView {
  portraitId: string
  characterId: string
  sortIndex: number
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  base64: string
  createdAt: string
}

export type CharacterPortraitListResponse =
  | { success: true; portraits: CharacterPortraitView[] }
  | { success: false; error: CharacterPortraitError }

export type CharacterPortraitChooseAddResponse =
  | { success: true; cancelled: true }
  | { success: true; cancelled: false; portraits: CharacterPortraitView[] }
  | { success: false; error: CharacterPortraitError }

export type CharacterPortraitRemoveResponse =
  | { success: true }
  | { success: false; error: CharacterPortraitError }

export type CharacterPortraitReorderResponse =
  | { success: true; portraits: CharacterPortraitView[] }
  | { success: false; error: CharacterPortraitError }

export interface CharacterPortraitChannels {
  'character-portrait:list': {
    args: [characterId: string]
    return: CharacterPortraitListResponse
  }
  'character-portrait:choose-add': {
    args: [characterId: string]
    return: CharacterPortraitChooseAddResponse
  }
  'character-portrait:remove': {
    args: [portraitId: string]
    return: CharacterPortraitRemoveResponse
  }
  'character-portrait:reorder': {
    args: [characterId: string, portraitIds: string[]]
    return: CharacterPortraitReorderResponse
  }
}

export type PortableCharacterPortraitRow = {
  kind: 'bound'
  portraitId: string
  characterId: string
  sortIndex: number
  relativePath: string
  contentHash: string
  mime: CharacterPortraitView['mime'] | 'application/octet-stream'
  byteSize: number
  createdAt: string
}
