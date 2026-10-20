import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { applyM07CharacterPortraits, verifyM07CharacterPortraits } from '../m07-character-portraits'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

describe('m07 character portraits', () => {
  it('creates portrait tables and verifies them', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE characters (character_id TEXT PRIMARY KEY, retired INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE character_avatar_assets (character_id TEXT PRIMARY KEY);
    `)
    db.transaction(() => applyM07CharacterPortraits(db))()
    expect(verifyM07CharacterPortraits(db)).toBe(true)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'character_portrait%' ORDER BY name")
      .all()).toEqual([
      { name: 'character_portrait_assets' },
      { name: 'character_portrait_unresolved' },
    ])
    db.close()
  })
})
