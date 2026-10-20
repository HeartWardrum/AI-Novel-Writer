import type Database from 'better-sqlite3'
import type {
  CharacterPortraitView,
  PortableCharacterPortraitRow,
} from '../../src/shared/character-portraits'
import { MAX_CHARACTER_PORTRAITS_PER_CHARACTER } from '../../src/shared/character-portraits'

export interface CharacterPortraitRecord {
  portraitId: string
  characterId: string
  sortIndex: number
  relativePath: string
  contentHash: string
  mime: CharacterPortraitView['mime']
  byteSize: number
  createdAt: string
}

type PortraitRow = {
  portrait_id: string
  character_id: string
  sort_index: number
  relative_path: string
  content_hash: string
  mime: CharacterPortraitView['mime']
  byte_size: number
  created_at: string
}

const fromRow = (row: PortraitRow): CharacterPortraitRecord => ({
  portraitId: row.portrait_id,
  characterId: row.character_id,
  sortIndex: row.sort_index,
  relativePath: row.relative_path,
  contentHash: row.content_hash,
  mime: row.mime,
  byteSize: row.byte_size,
  createdAt: row.created_at,
})

export class CharacterPortraitRepository {
  constructor(private readonly db: Database.Database) {}

  characterExists(characterId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM characters WHERE character_id=? AND retired=0').get(characterId))
  }

  countForCharacter(characterId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS count FROM character_portrait_assets WHERE character_id=?',
    ).get(characterId) as { count: number }
    return row.count
  }

  list(characterId: string): CharacterPortraitRecord[] {
    return (this.db.prepare(
      'SELECT * FROM character_portrait_assets WHERE character_id=? ORDER BY sort_index ASC',
    ).all(characterId) as PortraitRow[]).map(fromRow)
  }

  read(portraitId: string): CharacterPortraitRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM character_portrait_assets WHERE portrait_id=?',
    ).get(portraitId) as PortraitRow | undefined
    return row ? fromRow(row) : null
  }

  nextSortIndex(characterId: string): number {
    const row = this.db.prepare(
      'SELECT MAX(sort_index) AS max_index FROM character_portrait_assets WHERE character_id=?',
    ).get(characterId) as { max_index: number | null }
    return (row.max_index ?? -1) + 1
  }

  insert(record: CharacterPortraitRecord): void {
    this.db.transaction(() => {
      if (!this.characterExists(record.characterId)) throw new Error('CHARACTER_NOT_FOUND')
      if (this.countForCharacter(record.characterId) >= MAX_CHARACTER_PORTRAITS_PER_CHARACTER) {
        throw new Error('PORTRAIT_LIMIT_REACHED')
      }
      this.db.prepare(`INSERT INTO character_portrait_assets(
        portrait_id,character_id,sort_index,relative_path,content_hash,mime,byte_size,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        record.portraitId,
        record.characterId,
        record.sortIndex,
        record.relativePath,
        record.contentHash,
        record.mime,
        record.byteSize,
        record.createdAt,
      )
    })()
  }

  remove(portraitId: string): CharacterPortraitRecord | null {
    return this.db.transaction(() => {
      const previous = this.read(portraitId)
      if (!previous) return null
      this.db.prepare('DELETE FROM character_portrait_assets WHERE portrait_id=?').run(portraitId)
      this.compactSortIndexes(previous.characterId)
      return previous
    })()
  }

  reorder(characterId: string, portraitIds: readonly string[]): CharacterPortraitRecord[] {
    return this.db.transaction(() => {
      if (!this.characterExists(characterId)) throw new Error('CHARACTER_NOT_FOUND')
      const current = this.list(characterId)
      if (current.length !== portraitIds.length) throw new Error('PORTRAIT_REORDER_INVALID')
      const currentIds = new Set(current.map(row => row.portraitId))
      if (portraitIds.some(id => !currentIds.has(id)) || new Set(portraitIds).size !== portraitIds.length) {
        throw new Error('PORTRAIT_REORDER_INVALID')
      }
      // Avoid UNIQUE(character_id, sort_index) collisions while rewriting.
      this.db.prepare(
        'UPDATE character_portrait_assets SET sort_index = -1 - sort_index WHERE character_id=?',
      ).run(characterId)
      const update = this.db.prepare(
        'UPDATE character_portrait_assets SET sort_index=? WHERE portrait_id=? AND character_id=?',
      )
      portraitIds.forEach((portraitId, index) => update.run(index, portraitId, characterId))
      return this.list(characterId)
    })()
  }

  private compactSortIndexes(characterId: string): void {
    const rows = this.list(characterId)
    this.db.prepare(
      'UPDATE character_portrait_assets SET sort_index = -1 - sort_index WHERE character_id=?',
    ).run(characterId)
    const update = this.db.prepare(
      'UPDATE character_portrait_assets SET sort_index=? WHERE portrait_id=?',
    )
    rows.forEach((row, index) => update.run(index, row.portraitId))
  }

  referencedPaths(): Set<string> {
    const assets = this.db.prepare('SELECT relative_path FROM character_portrait_assets').all() as {
      relative_path: string
    }[]
    const unresolved = this.db.prepare(
      'SELECT preserved_relative_path AS relative_path FROM character_portrait_unresolved WHERE preserved_relative_path IS NOT NULL',
    ).all() as { relative_path: string }[]
    return new Set([...assets, ...unresolved].map(row => row.relative_path))
  }
}

export function readPortableCharacterPortraitRows(db: Database.Database): PortableCharacterPortraitRow[] {
  return (db.prepare(
    'SELECT * FROM character_portrait_assets ORDER BY character_id, sort_index',
  ).all() as PortraitRow[]).map(row => ({
    kind: 'bound' as const,
    portraitId: row.portrait_id,
    characterId: row.character_id,
    sortIndex: row.sort_index,
    relativePath: row.relative_path,
    contentHash: row.content_hash,
    mime: row.mime,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  }))
}
