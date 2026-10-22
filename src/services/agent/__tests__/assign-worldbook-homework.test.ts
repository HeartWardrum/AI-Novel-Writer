import { describe, expect, it } from 'vitest'
import {
  defaultWorldbookActivation,
  type WorldbookEntry,
  type WorldbookSourceCandidate,
} from '../../../shared/worldbook'
import {
  buildHomeworkPrompt,
  buildSharedCorpusFromSources,
  buildSharedHomeworkCorpus,
  listCharacterSources,
  listHomeworkCharacters,
  listImportableCharacterSourceIds,
  mergeExtraHintsIntoCorpus,
  parseDiscoveredCharacters,
} from '../assign-worldbook-homework'

function entry(partial: Partial<WorldbookEntry> & Pick<WorldbookEntry, 'id' | 'kind' | 'title' | 'content'>): WorldbookEntry {
  return {
    promptContent: partial.content,
    privateContent: '',
    activation: defaultWorldbookActivation(partial.kind),
    source: { kind: 'author', id: partial.id, revision: '1' },
    editable: true,
    needsReview: false,
    revision: 1,
    updatedAt: '',
    ...partial,
  }
}

describe('assign-worldbook-homework', () => {
  it('builds shared corpus once from non-character enabled entries only', () => {
    const corpus = buildSharedHomeworkCorpus([
      entry({
        id: 'wb:system:direct-chat',
        kind: 'rule',
        title: '系统提示',
        content: '助手身份',
        source: { kind: 'system', id: 'direct-chat', revision: '1' },
      }),
      entry({ id: 'wb:world', kind: 'world', title: '世界观', content: '旧港以潮汐计时。' }),
      entry({
        id: 'wb:char',
        kind: 'character',
        title: '林晚',
        content: '公开人设',
        privateContent: '不该进教材',
      }),
      entry({
        id: 'wb:off',
        kind: 'rule',
        title: '停用规则',
        content: '不该出现',
        activation: { ...defaultWorldbookActivation('rule'), enabled: false },
      }),
    ])
    expect(corpus).toContain('旧港以潮汐计时。')
    expect(corpus).not.toContain('助手身份')
    expect(corpus).not.toContain('公开人设')
    expect(corpus).not.toContain('不该进教材')
    expect(corpus).not.toContain('不该出现')
  })

  it('lists only editable enabled character entries', () => {
    const characters = listHomeworkCharacters([
      entry({ id: 'a', kind: 'character', title: '林晚', content: '甲' }),
      entry({ id: 'b', kind: 'world', title: '世界', content: '乙' }),
      entry({
        id: 'c',
        kind: 'character',
        title: '投影',
        content: '丙',
        editable: false,
      }),
    ])
    expect(characters.map(item => item.title)).toEqual(['林晚'])
  })

  it('builds a homework prompt that names the character and marks corpus read-only', () => {
    const messages = buildHomeworkPrompt({
      characterTitle: '林晚',
      publicPersona: '短发，守灯人。',
      sharedCorpus: '### 世界观\n旧港以潮汐计时。',
    })
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.content).toContain('角色：林晚')
    expect(messages[1]?.content).toContain('短发，守灯人。')
    expect(messages[1]?.content).toContain('只读，勿整段抄入作业')
    expect(messages[1]?.content).toContain('旧港以潮汐计时。')
  })

  it('lists character sources even when alreadyImported', () => {
    const sources: WorldbookSourceCandidate[] = [
      {
        id: 'character:a',
        kind: 'character',
        title: '林晚',
        content: '守灯人',
        activation: defaultWorldbookActivation('character'),
        origin: { kind: 'character', id: 'a', revision: '1' },
        alreadyImported: false,
      },
      {
        id: 'character:b',
        kind: 'character',
        title: '已导入',
        content: '旧人',
        activation: defaultWorldbookActivation('character'),
        origin: { kind: 'character', id: 'b', revision: '1' },
        alreadyImported: true,
      },
      {
        id: 'project:world',
        kind: 'world',
        title: '世界观',
        content: '潮汐',
        activation: defaultWorldbookActivation('world'),
        origin: { kind: 'project', id: 'world', revision: '1' },
        alreadyImported: false,
      },
    ]
    expect(listImportableCharacterSourceIds(sources)).toEqual(['character:a'])
    expect(listCharacterSources(sources).map(item => item.title)).toEqual(['林晚', '已导入'])
    expect(buildSharedCorpusFromSources(sources)).toContain('潮汐')
    expect(buildSharedCorpusFromSources(sources)).not.toContain('守灯人')
    expect(buildSharedCorpusFromSources(sources, undefined, { includeCharacters: true })).toContain('守灯人')
    expect(mergeExtraHintsIntoCorpus('### 世界观\n潮汐', '主角设定：林晚')).toContain('林晚')
  })

  it('parses discovered character JSON', () => {
    expect(parseDiscoveredCharacters('{"characters":[{"name":"林晚","persona":"守灯人"},{"name":"林晚"},{"name":""}]}'))
      .toEqual([{ name: '林晚', persona: '守灯人' }])
    expect(parseDiscoveredCharacters('not-json')).toEqual([])
  })
})
