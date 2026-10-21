import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openCanonicalProjectFixture } from '../../../test/helpers/canonical-project-fixture'
import { closeProjectDatabase, getProjectDb } from '../../database'
import { WorldbookRepository } from '../worldbook-repository'
import { defaultWorldbookActivation } from '../../../src/shared/worldbook'

let projectPath = ''

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'worldbook-repository-'))
  openCanonicalProjectFixture(projectPath)
  const db = getProjectDb()!
  db.prepare(`INSERT INTO project_core(
    id,project_name,genre,target_audience,total_chapters,words_per_chapter,
    core_outline,world_setting,global_guidance
  ) VALUES('main','灯塔','悬疑','全龄',12,3000,'核心大纲原文','世界观原文','全局规则原文')`).run()
  db.prepare("INSERT INTO blueprints(chapter_number,title,characters,key_events) VALUES(2,'雾钟',?,?)")
    .run(JSON.stringify(['林岚']), '林岚抵达北塔')
  db.prepare(`INSERT INTO characters(character_id,name,role,cs_location,cs_recent_events)
    VALUES('character-lin','林岚','protagonist','北塔','找到了雾钟')`).run()
  const prose = '林岚在北塔找到了雾钟。'
  const hash = createHash('sha256').update(prose).digest('hex')
  db.prepare("INSERT INTO contents(id,body) VALUES(1,?)").run(prose)
  db.prepare("INSERT INTO drafts(id,chapter_number,version,status,content_id,word_count) VALUES(1,1,1,'finalized',1,10)").run()
  db.prepare(`INSERT INTO finalization_outbox(
    finalization_id,draft_id,chapter_number,chapter_title,content_hash,content_revision,
    content_snapshot,target_file_name,publication_status
  ) VALUES('final-1',1,1,'雾钟',?,1,?,'chapter-1.txt','published')`).run(hash, prose)
  db.prepare(`INSERT INTO summary_snapshots(
    draft_id,chapter_number,chapter_notes,continuity_facts,source_finalization_id,source_content_hash
  ) VALUES(1,1,'林岚找到雾钟。',?,'final-1',?)`).run(JSON.stringify([{
    category: 'character-state', entities: ['林岚'], statement: '林岚在北塔找到雾钟。',
    sourceChapter: 1, evidence: prose,
  }]), hash)
})

afterEach(() => {
  closeProjectDatabase()
  fs.rmSync(projectPath, { recursive: true, force: true })
})

describe('worldbook repository', () => {
  it('lists only editable authored entries, not live domain projections', async () => {
    const entries = await WorldbookRepository.list(projectPath, { currentChapter: 2 })
    expect(entries).toEqual([])
    expect(getProjectDb()!.prepare('SELECT COUNT(*) FROM worldbook_entries').pluck().get()).toBe(0)
  })

  it('exposes work materials as import candidates and copies them into editable entries', async () => {
    const sources = await WorldbookRepository.listSources(projectPath, { currentChapter: 2 })
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project:world-setting', title: '世界观设定', alreadyImported: false }),
      expect.objectContaining({ id: 'character:character-lin', alreadyImported: false }),
      expect.objectContaining({ id: 'blueprint:2', alreadyImported: false }),
      expect.objectContaining({
        id: 'chapter:1',
        content: expect.stringContaining('林岚找到雾钟'),
        alreadyImported: false,
      }),
    ]))
    const chapter = sources.find(item => item.id === 'chapter:1')
    expect(chapter?.content).not.toContain('林岚在北塔找到了雾钟。')

    const imported = await WorldbookRepository.importSources(projectPath, [
      'project:world-setting',
      'chapter:1',
    ], { currentChapter: 2 })
    expect(imported).toHaveLength(2)
    expect(imported.every(entry => entry.editable && entry.source.kind === 'import')).toBe(true)

    const listed = await WorldbookRepository.list(projectPath)
    expect(listed).toHaveLength(2)
    expect(listed.find(entry => entry.title === '世界观设定')?.content).toBe('世界观原文')
    expect(listed.find(entry => entry.id.startsWith('wb:'))).toBeTruthy()

    const again = await WorldbookRepository.listSources(projectPath, { currentChapter: 2 })
    expect(again.find(item => item.id === 'project:world-setting')?.alreadyImported).toBe(true)
    const secondPass = await WorldbookRepository.importSources(projectPath, ['project:world-setting'])
    expect(secondPass).toEqual([])
    expect(await WorldbookRepository.list(projectPath)).toHaveLength(2)
  })

  it('lets authors edit imported entries without writing back to the source projection', async () => {
    const [imported] = await WorldbookRepository.importSources(projectPath, ['project:world-setting'])
    const updated = WorldbookRepository.save({
      id: imported!.id,
      expectedRevision: imported!.revision,
      kind: 'world',
      title: '雾港世界观',
      content: '旧港以潮汐计时，作者手改。',
      activation: imported!.activation,
      sourceKind: 'import',
    })
    expect(updated.content).toBe('旧港以潮汐计时，作者手改。')
    expect(updated.editable).toBe(true)
    const sources = await WorldbookRepository.listSources(projectPath)
    expect(sources.find(item => item.id === 'project:world-setting')?.content).toBe('世界观原文')
  })

  it('saves authored entries and returns deterministic exact-key activation', async () => {
    const activation = defaultWorldbookActivation('location')
    activation.primaryKeys = ['北塔']
    activation.priority = 12.7 as unknown as number
    const saved = WorldbookRepository.save({
      kind: 'location',
      title: '北塔',
      content: '北塔只在退潮时开放。',
      activation,
    })
    expect(saved.activation.priority).toBe(12)
    const resolved = await WorldbookRepository.resolve({
      stage: 'drafting',
      chapterNumber: 2,
      chapterTitle: '北塔',
      budgetTokens: 1_000,
    }, projectPath)
    expect(resolved.selections).toContainEqual(expect.objectContaining({
      entryId: saved.id,
      title: '北塔',
      reason: 'primary-key',
      matchedKeys: ['北塔'],
    }))
  })

  it('allows several confirmed entries to share one imported source document', () => {
    const activation = defaultWorldbookActivation('world')
    const first = WorldbookRepository.save({
      kind: 'world', title: '北塔', content: '北塔只在退潮时开放。', activation,
      sourceKind: 'import', sourceId: 'document-1',
    })
    const second = WorldbookRepository.save({
      kind: 'rule', title: '退潮规则', content: '退潮后才会出现石阶。', activation,
      sourceKind: 'import', sourceId: 'document-1',
    })
    expect(first.id).not.toBe(second.id)
    expect(first.source.id).toContain('document-1:')
    expect(second.source.id).toContain('document-1:')
  })
})
