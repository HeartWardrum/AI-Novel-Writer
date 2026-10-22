import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { applyM08Worldbook } from '../m08-worldbook'
import { applyM10WorldbookPrivateContent, verifyM10WorldbookPrivateContent } from '../m10-worldbook-private-content'
import { getDesktopMigrationRegistry } from '../desktop-registry'
import { initializeLegacyBaselineSchema } from '../baseline-schema'
import { migrateSchema } from '../runner'
import { SqliteSchemaAdapter } from '../sqlite-schema-adapter'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

describe('m10 worldbook private content', () => {
  it('adds private_content without wiping existing worldbook rows', () => {
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
    db.transaction(() => applyM08Worldbook(db))()
    db.prepare(`
      INSERT INTO worldbook_entries(id,kind,title,content,source_kind,source_key,source_revision,needs_review,revision)
      VALUES('wb:1','character','林晚','公开人设','author','','rev',0,1)
    `).run()
    db.transaction(() => applyM10WorldbookPrivateContent(db))()
    expect(verifyM10WorldbookPrivateContent(db)).toBe(true)
    expect(db.prepare('SELECT title,content,private_content FROM worldbook_entries WHERE id=?').get('wb:1'))
      .toEqual({ title: '林晚', content: '公开人设', private_content: '' })
    db.close()
  })

  it('upgrades a populated v10 project to v11 without changing author content', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeLegacyBaselineSchema(db)
    migrateSchema(new SqliteSchemaAdapter(db), getDesktopMigrationRegistry(), 10)
    db.prepare("INSERT INTO project_core(id,project_name,world_setting) VALUES('main','灯塔','不可改写的世界观')").run()
    db.prepare("INSERT INTO contents(id,body) VALUES(1,'不可改写的正文')").run()
    db.prepare("INSERT INTO drafts(id,chapter_number,version,status,content_id,word_count) VALUES(1,1,1,'finalized',1,7)").run()
    migrateSchema(new SqliteSchemaAdapter(db), getDesktopMigrationRegistry(), 11)
    expect(db.pragma('user_version', { simple: true })).toBe(11)
    expect(db.prepare("SELECT world_setting FROM project_core WHERE id='main'").pluck().get()).toBe('不可改写的世界观')
    expect(db.prepare('SELECT body FROM contents WHERE id=1').pluck().get()).toBe('不可改写的正文')
    expect(verifyM10WorldbookPrivateContent(db)).toBe(true)
    db.close()
  })
})
