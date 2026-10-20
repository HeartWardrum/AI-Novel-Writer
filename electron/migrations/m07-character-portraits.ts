import type Database from 'better-sqlite3'
import type { MigrationImplementation, SchemaReader } from './registry'

export const M07_CHARACTER_PORTRAIT_SQL = `
CREATE TABLE character_portrait_assets (
 portrait_id TEXT PRIMARY KEY,
 character_id TEXT NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
 sort_index INTEGER NOT NULL,
 relative_path TEXT NOT NULL UNIQUE,
 content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
 byte_size INTEGER NOT NULL CHECK(byte_size > 0),
 created_at TEXT NOT NULL,
 UNIQUE(character_id, sort_index)
);
CREATE INDEX idx_character_portraits_character ON character_portrait_assets(character_id, sort_index);
CREATE TABLE character_portrait_unresolved (
 record_id TEXT PRIMARY KEY,
 disposition TEXT NOT NULL CHECK(disposition IN ('orphan','ambiguous','unknown-fork','reference-only')),
 source_reference TEXT NOT NULL,
 source_relative_path TEXT NOT NULL,
 preserved_relative_path TEXT UNIQUE CHECK(CASE WHEN disposition = 'reference-only' THEN preserved_relative_path IS NULL ELSE preserved_relative_path IS NOT NULL END),
 content_hash TEXT CHECK(CASE WHEN disposition = 'reference-only' THEN content_hash IS NULL ELSE content_hash IS NOT NULL AND length(content_hash) = 64 END),
 mime TEXT CHECK(CASE WHEN disposition = 'reference-only' THEN mime IS NULL ELSE mime IS NOT NULL AND mime IN ('image/png','image/jpeg','image/webp','application/octet-stream') END),
 byte_size INTEGER CHECK(CASE WHEN disposition = 'reference-only' THEN byte_size IS NULL ELSE byte_size IS NOT NULL AND byte_size > 0 END),
 candidate_character_ids_json TEXT NOT NULL
);
CREATE TRIGGER retain_character_portrait_on_delete BEFORE DELETE ON characters
WHEN EXISTS(SELECT 1 FROM character_portrait_assets WHERE character_id=OLD.character_id)
BEGIN
 INSERT OR IGNORE INTO character_portrait_unresolved(
  record_id,disposition,source_reference,source_relative_path,preserved_relative_path,
  content_hash,mime,byte_size,candidate_character_ids_json
 ) SELECT 'portrait-delete:' || portrait_id,
  'orphan','character-delete:' || OLD.character_id,relative_path,relative_path,
  content_hash,mime,byte_size,json_array(OLD.character_id)
 FROM character_portrait_assets WHERE character_id=OLD.character_id;
END;
`

/** The central schema runner owns this transaction and PRAGMA user_version. */
export function applyM07CharacterPortraits(db: Database.Database): void {
  if (!db.inTransaction) throw new Error('CHARACTER_PORTRAIT_MIGRATION_TRANSACTION_REQUIRED')
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='character_avatar_assets'").get()) {
    throw new Error('CHARACTER_PORTRAIT_MIGRATION_SCHEMA_UNRECOGNIZED')
  }
  db.exec(M07_CHARACTER_PORTRAIT_SQL)
}

export function verifyM07CharacterPortraits(db: Database.Database): boolean {
  try {
    if (db.pragma('foreign_keys', { simple: true }) !== 1 || (db.pragma('foreign_key_check') as unknown[]).length) return false
    const tables = ['character_portrait_assets', 'character_portrait_unresolved']
    if (tables.some(name => !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))) return false
    return true
  } catch { return false }
}

export function createM07Migration(deps: {
  database(reader: SchemaReader): Database.Database
  verifyKnownSchema(reader: SchemaReader): boolean
}): MigrationImplementation {
  return {
    id: 'M07',
    from: 7,
    to: 8,
    owner: 'portrait-gallery',
    migrate: reader => applyM07CharacterPortraits(deps.database(reader)),
    verify: reader => deps.verifyKnownSchema(reader) && verifyM07CharacterPortraits(deps.database(reader)),
  }
}
