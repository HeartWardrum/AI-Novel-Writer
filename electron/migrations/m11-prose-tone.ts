import type Database from 'better-sqlite3'
import type { MigrationImplementation, SchemaReader } from './registry'

export const M11_PROSE_TONE_SQL = `
ALTER TABLE project_core ADD COLUMN prose_tone TEXT NOT NULL DEFAULT 'default';
`

export function applyM11ProseTone(db: Database.Database): void {
  if (!db.inTransaction) throw new Error('PROSE_TONE_MIGRATION_TRANSACTION_REQUIRED')
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_core'").get()) {
    throw new Error('PROSE_TONE_MIGRATION_SCHEMA_UNRECOGNIZED')
  }
  const columns = db.prepare('PRAGMA table_info(project_core)').all() as Array<{ name: string }>
  if (columns.some(column => column.name === 'prose_tone')) return
  db.exec(M11_PROSE_TONE_SQL)
}

export function verifyM11ProseTone(db: Database.Database): boolean {
  try {
    if (db.pragma('foreign_keys', { simple: true }) !== 1 || (db.pragma('foreign_key_check') as unknown[]).length) return false
    const columns = db.prepare('PRAGMA table_info(project_core)').all() as Array<{ name: string }>
    return columns.some(column => column.name === 'prose_tone')
  } catch {
    return false
  }
}

export function createM11Migration(deps: {
  database(reader: SchemaReader): Database.Database
  verifyKnownSchema(reader: SchemaReader): boolean
}): MigrationImplementation {
  return {
    id: 'M11',
    from: 11,
    to: 12,
    owner: 'prose-tone',
    migrate: reader => applyM11ProseTone(deps.database(reader)),
    verify: reader => deps.verifyKnownSchema(reader) && verifyM11ProseTone(deps.database(reader)),
  }
}
