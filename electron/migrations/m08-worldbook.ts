import type Database from 'better-sqlite3'
import type { MigrationImplementation, SchemaReader } from './registry'

export const M08_WORLDBOOK_SQL = `
CREATE TABLE worldbook_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL DEFAULT 'author',
  source_key TEXT NOT NULL DEFAULT '',
  source_revision TEXT NOT NULL DEFAULT '',
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_review IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_worldbook_source
  ON worldbook_entries(source_kind, source_key) WHERE source_key <> '';
CREATE INDEX idx_worldbook_kind ON worldbook_entries(kind, updated_at);

CREATE TABLE worldbook_entry_settings (
  entry_id TEXT PRIMARY KEY,
  primary_keys_json TEXT NOT NULL DEFAULT '[]',
  secondary_keys_json TEXT NOT NULL DEFAULT '[]',
  match_mode TEXT NOT NULL DEFAULT 'any' CHECK(match_mode IN ('any','all')),
  always_on INTEGER NOT NULL DEFAULT 0 CHECK(always_on IN (0,1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  stages_json TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 0,
  insertion_order INTEGER NOT NULL DEFAULT 0,
  group_name TEXT NOT NULL DEFAULT '',
  prompt_policy TEXT NOT NULL DEFAULT 'excerpt'
    CHECK(prompt_policy IN ('full','excerpt','browse-only')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_worldbook_settings_enabled
  ON worldbook_entry_settings(enabled, priority, insertion_order);
`

export function applyM08Worldbook(db: Database.Database): void {
  if (!db.inTransaction) throw new Error('WORLDBOOK_MIGRATION_TRANSACTION_REQUIRED')
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_core'").get()) {
    throw new Error('WORLDBOOK_MIGRATION_SCHEMA_UNRECOGNIZED')
  }
  db.exec(M08_WORLDBOOK_SQL)
}

export function verifyM08Worldbook(db: Database.Database): boolean {
  try {
    if (db.pragma('foreign_keys', { simple: true }) !== 1 || (db.pragma('foreign_key_check') as unknown[]).length) return false
    return ['worldbook_entries', 'worldbook_entry_settings']
      .every(name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
  } catch {
    return false
  }
}

export function createM08Migration(deps: {
  database(reader: SchemaReader): Database.Database
  verifyKnownSchema(reader: SchemaReader): boolean
}): MigrationImplementation {
  return {
    id: 'M08',
    from: 8,
    to: 9,
    owner: 'worldbook',
    migrate: reader => applyM08Worldbook(deps.database(reader)),
    verify: reader => deps.verifyKnownSchema(reader) && verifyM08Worldbook(deps.database(reader)),
  }
}
