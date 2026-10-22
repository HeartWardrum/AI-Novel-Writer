/** 对话区独立字号（消息正文 + 输入框），与全局 zoomFactor 无关。 */

export const CHAT_FONT_SCALE_KEY = 'vela.chat-font-scale'
export const CHAT_FONT_SCALE_DEFAULT = 1
export const CHAT_FONT_SCALE_STEP = 0.05
export const CHAT_FONT_SCALE_MIN = 0.85
export const CHAT_FONT_SCALE_MAX = 1.5

type ScaleStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): ScaleStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function clampChatFontScale(value: number): number {
  return +Math.max(CHAT_FONT_SCALE_MIN, Math.min(CHAT_FONT_SCALE_MAX, value)).toFixed(2)
}

export function readChatFontScale(storage: ScaleStorage | null = defaultStorage()): number {
  if (!storage) return CHAT_FONT_SCALE_DEFAULT
  try {
    const raw = storage.getItem(CHAT_FONT_SCALE_KEY)
    if (raw == null) return CHAT_FONT_SCALE_DEFAULT
    const n = Number(raw)
    if (!Number.isFinite(n)) return CHAT_FONT_SCALE_DEFAULT
    return clampChatFontScale(n)
  } catch {
    return CHAT_FONT_SCALE_DEFAULT
  }
}

export function writeChatFontScale(
  scale: number,
  storage: ScaleStorage | null = defaultStorage(),
): number {
  const next = clampChatFontScale(scale)
  if (storage) {
    try {
      storage.setItem(CHAT_FONT_SCALE_KEY, String(next))
    } catch {
      /* ignore quota / private mode */
    }
  }
  return next
}

export function bumpChatFontScale(
  current: number,
  direction: 1 | -1,
  storage: ScaleStorage | null = defaultStorage(),
): number {
  return writeChatFontScale(current + direction * CHAT_FONT_SCALE_STEP, storage)
}

/**
 * Ctrl/Cmd + 滚轮调整对话字号。
 * 返回新比例；未处理（无修饰键）返回 null。
 */
export function applyChatZoomWheel(
  event: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'deltaY' | 'preventDefault'>,
  current: number,
  storage: ScaleStorage | null = defaultStorage(),
): number | null {
  if (!event.ctrlKey && !event.metaKey) return null
  event.preventDefault()
  if (event.deltaY < 0) return bumpChatFontScale(current, 1, storage)
  if (event.deltaY > 0) return bumpChatFontScale(current, -1, storage)
  return clampChatFontScale(current)
}
