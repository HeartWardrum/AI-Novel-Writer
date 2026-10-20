import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CharacterPresetStore } from '../character-preset-store'

/** Minimal valid 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('CharacterPresetStore', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  function tempStore(): CharacterPresetStore {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'char-preset-'))
    roots.push(root)
    return new CharacterPresetStore(root)
  }

  it('creates, lists, updates fields, and deletes', () => {
    const store = tempStore()
    const created = store.create({ name: '林晚', age: '27', appearance: '黑发' })
    expect(created.fields.name).toBe('林晚')
    expect(store.list()).toHaveLength(1)
    const saved = store.saveFields(created.presetId, {
      ...created.fields,
      personality: '冷静',
    })
    expect(saved.fields.personality).toBe('冷静')
    expect(store.load(created.presetId).fields.appearance).toBe('黑发')
    store.delete(created.presetId)
    expect(store.list()).toHaveLength(0)
  })

  it('stores avatar and portrait bytes for later project copy', () => {
    const store = tempStore()
    const created = store.create({ name: '沈舟' })
    store.setAvatarFromBytes(created.presetId, PNG)
    store.addPortraitFromBytes(created.presetId, PNG)
    const loaded = store.load(created.presetId)
    expect(loaded.avatar?.base64).toBeTruthy()
    expect(loaded.portraits).toHaveLength(1)
    const assets = store.assetFilePaths(created.presetId)
    expect(assets.avatarPath && fs.existsSync(assets.avatarPath)).toBe(true)
    expect(assets.portraitPaths).toHaveLength(1)
  })
})
