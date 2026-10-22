import { describe, expect, it } from 'vitest'
import {
  defaultWorldbookActivation,
  resolveWorldbookEntries,
  type WorldbookEntry,
} from '../worldbook'

function entry(
  id: string,
  title: string,
  content: string,
  activation = defaultWorldbookActivation('custom'),
): WorldbookEntry {
  return {
    id,
    kind: 'custom',
    title,
    content,
    privateContent: '',
    promptContent: content,
    activation,
    source: { kind: 'author', id, revision: '1' },
    editable: true,
    needsReview: false,
    revision: 1,
    updatedAt: '',
  }
}

describe('worldbook resolver', () => {
  it('prioritizes always-on and exact keyword entries over semantic entries', () => {
    const always = defaultWorldbookActivation('rule')
    const keyword = defaultWorldbookActivation('location')
    keyword.primaryKeys = ['灯塔']
    keyword.priority = 20
    const semantic = defaultWorldbookActivation('reference')
    semantic.priority = 100
    const result = resolveWorldbookEntries([
      entry('always', '全局规则', '规则正文', always),
      entry('keyword', '灯塔', '灯塔正文', keyword),
      entry('semantic', '语义资料', '资料正文', semantic),
    ], {
      stage: 'drafting',
      chapterTitle: '灯塔的夜',
      semanticMatches: [{ entryId: 'semantic', score: 0.9 }],
    })
    expect(result.selections.map(item => item.entryId)).toEqual(['always', 'keyword', 'semantic'])
    expect(result.selections[1]).toMatchObject({ reason: 'primary-key', matchedKeys: ['灯塔'] })
  })

  it('supports all-key matching and stage filters', () => {
    const activation = defaultWorldbookActivation('custom')
    activation.primaryKeys = ['灯塔']
    activation.secondaryKeys = ['暴雨']
    activation.matchMode = 'all'
    activation.stages = ['review']
    const value = entry('all', '暴雨灯塔', '正文', activation)
    expect(resolveWorldbookEntries([value], { stage: 'drafting', chapterTitle: '灯塔' }).selections).toEqual([])
    expect(resolveWorldbookEntries([value], { stage: 'drafting', chapterTitle: '灯塔暴雨' }).selections).toEqual([])
    expect(resolveWorldbookEntries([value], { stage: 'review', chapterTitle: '灯塔暴雨' }).selections)
      .toHaveLength(1)
  })

  it('all-mode with only primary keys requires every primary key', () => {
    const activation = defaultWorldbookActivation('custom')
    activation.primaryKeys = ['灯塔', '暴雨']
    activation.secondaryKeys = []
    activation.matchMode = 'all'
    const value = entry('all-primary', '暴雨灯塔', '正文', activation)
    expect(resolveWorldbookEntries([value], { stage: 'drafting', chapterTitle: '灯塔' }).selections).toEqual([])
    expect(resolveWorldbookEntries([value], { stage: 'drafting', chapterTitle: '灯塔与暴雨' }).selections)
      .toHaveLength(1)
  })

  it('reports required overflow instead of silently dropping an always-on entry', () => {
    const activation = defaultWorldbookActivation('rule')
    const result = resolveWorldbookEntries([
      entry('required', '必现规则', '规'.repeat(100), activation),
    ], { stage: 'drafting', budgetTokens: 10 })
    expect(result.selections).toEqual([])
    expect(result.requiredOverflow).toBe(true)
    expect(result.omitted).toContainEqual({ entryId: 'required', title: '必现规则', reason: 'budget' })
  })

  it('honors manual exclusions and browse-only entries', () => {
    const excluded = defaultWorldbookActivation('location')
    excluded.primaryKeys = ['灯塔']
    const browse = defaultWorldbookActivation('chapter')
    browse.alwaysOn = true
    browse.promptPolicy = 'browse-only'
    const result = resolveWorldbookEntries([
      entry('excluded', '灯塔', '正文', excluded),
      entry('browse', '章节全文', '正文', browse),
    ], { stage: 'drafting', chapterTitle: '灯塔', forceExcludeIds: ['excluded'] })
    expect(result.selections).toEqual([])
    expect(result.omitted).toContainEqual({ entryId: 'excluded', title: '灯塔', reason: 'excluded' })
  })
})

