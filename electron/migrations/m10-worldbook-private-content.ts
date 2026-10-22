import type Database from 'better-sqlite3'
import type { MigrationImplementation, SchemaReader } from './registry'

export const M10_WORLDBOOK_PRIVATE_CONTENT_SQL = `
ALTER TABLE worldbook_entries ADD COLUMN private_content TEXT NOT NULL DEFAULT '';
`

export function applyM10WorldbookPrivateContent(db: Database.Database): void {
  if (!db.inTransaction) throw new Error('WORLDBOOK_PRIVATE_MIGRATION_TRANSACTION_REQUIRED')
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worldbook_entries'").get()) {
    throw new Error('WORLDBOOK_PRIVATE_MIGRATION_SCHEMA_UNRECOGNIZED')
  }
  const columns = db.prepare('PRAGMA table_info(worldbook_entries)').all() as Array<{ name: string }>
  if (columns.some(column => column.name === 'private_content')) return
  db.exec(M10_WORLDBOOK_PRIVATE_CONTENT_SQL)
}

export function verifyM10WorldbookPrivateContent(db: Database.Database): boolean {
  try {
    if (db.pragma('foreign_keys', { simple: true }) !== 1 || (db.pragma('foreign_key_check') as unknown[]).length) return false
    const columns = db.prepare('PRAGMA table_info(worldbook_entries)').all() as Array<{ name: string }>
    return columns.some(column => column.name === 'private_content')
  } catch {
    return false
  }
}

export function createM10Migration(deps: {
  database(reader: SchemaReader): Database.Database
  verifyKnownSchema(reader: SchemaReader): boolean
}): MigrationImplementation {
  return {
    id: 'M10',
    from: 10,
    to: 11,
    owner: 'worldbook-private',
    migrate: reader => applyM10WorldbookPrivateContent(deps.database(reader)),
    verify: reader => deps.verifyKnownSchema(reader) && verifyM10WorldbookPrivateContent(deps.database(reader)),
  }
}
