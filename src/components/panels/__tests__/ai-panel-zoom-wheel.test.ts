import { describe, expect, it, vi } from 'vitest'

import {
  CHAT_FONT_SCALE_DEFAULT,
  CHAT_FONT_SCALE_KEY,
  CHAT_FONT_SCALE_MAX,
  CHAT_FONT_SCALE_MIN,
  applyChatZoomWheel,
  bumpChatFontScale,
  clampChatFontScale,
  readChatFontScale,
  writeChatFontScale,
} from '../ai-panel-zoom-wheel'

function memoryStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    map,
  }
}

function wheel(
  partial: Partial<Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'deltaY'>> & { deltaY: number },
) {
  return {
    ctrlKey: false,
    metaKey: false,
    ...partial,
    preventDefault: vi.fn(),
  }
}

describe('chat font scale', () => {
  it('clamps and persists scale', () => {
    const storage = memoryStorage()
    expect(writeChatFontScale(2, storage)).toBe(CHAT_FONT_SCALE_MAX)
    expect(storage.map.get(CHAT_FONT_SCALE_KEY)).toBe(String(CHAT_FONT_SCALE_MAX))
    expect(readChatFontScale(storage)).toBe(CHAT_FONT_SCALE_MAX)
    expect(clampChatFontScale(0.1)).toBe(CHAT_FONT_SCALE_MIN)
    expect(readChatFontScale(memoryStorage())).toBe(CHAT_FONT_SCALE_DEFAULT)
  })

  it('bumps by step', () => {
    const storage = memoryStorage()
    expect(bumpChatFontScale(1, 1, storage)).toBe(1.05)
    expect(bumpChatFontScale(1, -1, storage)).toBe(0.95)
  })
})

describe('applyChatZoomWheel', () => {
  it('scales up on Ctrl + scroll up and prevents default', () => {
    const storage = memoryStorage()
    const event = wheel({ ctrlKey: true, deltaY: -100 })

    expect(applyChatZoomWheel(event, 1, storage)).toBe(1.05)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(storage.map.get(CHAT_FONT_SCALE_KEY)).toBe('1.05')
  })

  it('scales down on Meta + scroll down', () => {
    const storage = memoryStorage()
    const event = wheel({ metaKey: true, deltaY: 80 })

    expect(applyChatZoomWheel(event, 1, storage)).toBe(0.95)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('ignores plain wheel without modifier', () => {
    const storage = memoryStorage()
    const event = wheel({ deltaY: -50 })

    expect(applyChatZoomWheel(event, 1, storage)).toBeNull()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(storage.map.size).toBe(0)
  })
})
