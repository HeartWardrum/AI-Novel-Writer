import type Database from 'better-sqlite3'
import type { MigrationImplementation, SchemaReader } from './registry'

export const M09_AGENT_CHAT_SQL = `
CREATE TABLE agent_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  model_id TEXT,
  messages_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_agent_conversations_updated ON agent_conversations(updated_at DESC);

CREATE TABLE agent_chat_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_conversation_id TEXT
);
`

export function applyM09AgentChat(db: Database.Database): void {
  if (!db.inTransaction) throw new Error('AGENT_CHAT_MIGRATION_TRANSACTION_REQUIRED')
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_core'").get()) {
    throw new Error('AGENT_CHAT_MIGRATION_SCHEMA_UNRECOGNIZED')
  }
  db.exec(M09_AGENT_CHAT_SQL)
}

export function verifyM09AgentChat(db: Database.Database): boolean {
  try {
    if (db.pragma('foreign_keys', { simple: true }) !== 1 || (db.pragma('foreign_key_check') as unknown[]).length) return false
    return ['agent_conversations', 'agent_chat_meta']
      .every(name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
  } catch {
    return false
  }
}

export function createM09Migration(deps: {
  database(reader: SchemaReader): Database.Database
  verifyKnownSchema(reader: SchemaReader): boolean
}): MigrationImplementation {
  return {
    id: 'M09',
    from: 9,
    to: 10,
    owner: 'agent-chat',
    migrate: reader => applyM09AgentChat(deps.database(reader)),
    verify: reader => deps.verifyKnownSchema(reader) && verifyM09AgentChat(deps.database(reader)),
  }
}
