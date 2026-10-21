import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { applyM09AgentChat, verifyM09AgentChat } from '../m09-agent-chat'
import { getDesktopMigrationRegistry } from '../desktop-registry'
import { initializeLegacyBaselineSchema } from '../baseline-schema'
import { migrateSchema } from '../runner'
import { SqliteSchemaAdapter } from '../sqlite-schema-adapter'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

describe('m09 agent chat', () => {
  it('adds conversation tables without touching existing project content', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE project_core (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        world_setting TEXT NOT NULL
      );
      INSERT INTO project_core VALUES ('main', '灯塔', '作者世界观原文');
    `)
    db.transaction(() => applyM09AgentChat(db))()
    expect(verifyM09AgentChat(db)).toBe(true)
    expect(db.prepare('SELECT project_name,world_setting FROM project_core').get())
      .toEqual({ project_name: '灯塔', world_setting: '作者世界观原文' })
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_%' ORDER BY name").all())
      .toEqual([{ name: 'agent_chat_meta' }, { name: 'agent_conversations' }])
    db.close()
  })

  it('upgrades a populated v9 project to v10 without changing author content', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeLegacyBaselineSchema(db)
    migrateSchema(new SqliteSchemaAdapter(db), getDesktopMigrationRegistry(), 9)
    db.prepare("INSERT INTO project_core(id,project_name,world_setting) VALUES('main','灯塔','不可改写的世界观')").run()
    db.prepare("INSERT INTO contents(id,body) VALUES(1,'不可改写的正文')").run()
    db.prepare("INSERT INTO drafts(id,chapter_number,version,status,content_id,word_count) VALUES(1,1,1,'finalized',1,7)").run()
    migrateSchema(new SqliteSchemaAdapter(db), getDesktopMigrationRegistry(), 10)
    expect(db.pragma('user_version', { simple: true })).toBe(10)
    expect(db.prepare("SELECT world_setting FROM project_core WHERE id='main'").pluck().get()).toBe('不可改写的世界观')
    expect(db.prepare('SELECT body FROM contents WHERE id=1').pluck().get()).toBe('不可改写的正文')
    expect(verifyM09AgentChat(db)).toBe(true)
    db.close()
  })
})
