import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyM07CharacterPortraits } from '../../migrations/m07-character-portraits'
import { CharacterPortraitRepository } from '../character-portrait-repository'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

let db: import('better-sqlite3').Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE characters (
      character_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      retired INTEGER NOT NULL DEFAULT 0
    );
  `)
  db.transaction(() => {
    // Minimal predecessor so m07 apply accepts the DB.
    db.exec(`CREATE TABLE character_avatar_assets (character_id TEXT PRIMARY KEY);`)
    applyM07CharacterPortraits(db)
  })()
  db.prepare(`INSERT INTO characters(character_id,name) VALUES('stable-a','A')`).run()
})

afterEach(() => { db.close() })

describe('CharacterPortraitRepository', () => {
  it('inserts multiple portraits and reorders without colliding sort indexes', () => {
    const repo = new CharacterPortraitRepository(db)
    const mk = (id: string, sort: number) => ({
      portraitId: id,
      characterId: 'stable-a',
      sortIndex: sort,
      relativePath: `portraits/${id}.png`,
      contentHash: 'a'.repeat(64),
      mime: 'image/png' as const,
      byteSize: 12,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    repo.insert(mk('11111111-1111-1111-1111-111111111111', 0))
    repo.insert(mk('22222222-2222-2222-2222-222222222222', 1))
    repo.insert(mk('33333333-3333-3333-3333-333333333333', 2))
    const reordered = repo.reorder('stable-a', [
      '33333333-3333-3333-3333-333333333333',
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ])
    expect(reordered.map(row => row.portraitId)).toEqual([
      '33333333-3333-3333-3333-333333333333',
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ])
    expect(reordered.map(row => row.sortIndex)).toEqual([0, 1, 2])
  })

  it('compacts sort indexes after remove', () => {
    const repo = new CharacterPortraitRepository(db)
    for (const [id, sort] of [
      ['11111111-1111-1111-1111-111111111111', 0],
      ['22222222-2222-2222-2222-222222222222', 1],
      ['33333333-3333-3333-3333-333333333333', 2],
    ] as const) {
      repo.insert({
        portraitId: id,
        characterId: 'stable-a',
        sortIndex: sort,
        relativePath: `portraits/${id}.png`,
        contentHash: 'b'.repeat(64),
        mime: 'image/png',
        byteSize: 8,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    }
    repo.remove('22222222-2222-2222-2222-222222222222')
    expect(repo.list('stable-a').map(row => ({ id: row.portraitId, sort: row.sortIndex }))).toEqual([
      { id: '11111111-1111-1111-1111-111111111111', sort: 0 },
      { id: '33333333-3333-3333-3333-333333333333', sort: 1 },
    ])
  })

  it('enforces soft limit of 64 portraits', () => {
    const repo = new CharacterPortraitRepository(db)
    for (let index = 0; index < 64; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      repo.insert({
        portraitId: id,
        characterId: 'stable-a',
        sortIndex: index,
        relativePath: `portraits/${id}.png`,
        contentHash: 'c'.repeat(64),
        mime: 'image/png',
        byteSize: 4,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    }
    expect(() => repo.insert({
      portraitId: '00000000-0000-4000-8000-000000000064',
      characterId: 'stable-a',
      sortIndex: 64,
      relativePath: 'portraits/overflow.png',
      contentHash: 'd'.repeat(64),
      mime: 'image/png',
      byteSize: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
    })).toThrow('PORTRAIT_LIMIT_REACHED')
  })
})
