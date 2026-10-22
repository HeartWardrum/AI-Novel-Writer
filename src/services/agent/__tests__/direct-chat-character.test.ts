import { describe, expect, it } from 'vitest'
import {
  defaultWorldbookActivation,
  type WorldbookEntry,
} from '../../../shared/worldbook'
import {
  buildCharacterChatSystemMessages,
  characterModeReceiptTitles,
  formatCharacterPersonaBlock,
  listCharacterModeSharedEntries,
} from '../direct-chat-character'

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

describe('direct-chat-character', () => {
  it('lists only always-on public shared kinds, excluding character/plot/system', () => {
    const shared = listCharacterModeSharedEntries([
      entry({
        id: 'wb:system:direct-chat',
        kind: 'rule',
        title: '系统提示',
        content: '助手身份',
        source: { kind: 'system', id: 'direct-chat', revision: '1' },
        activation: { ...defaultWorldbookActivation('rule'), alwaysOn: true, enabled: true },
      }),
      entry({
        id: 'wb:world',
        kind: 'world',
        title: '世界观',
        content: '旧港以潮汐计时。',
        activation: { ...defaultWorldbookActivation('world'), alwaysOn: true, enabled: true },
      }),
      entry({
        id: 'wb:rule',
        kind: 'rule',
        title: '铁律',
        content: '不可召唤旧神。',
        activation: { ...defaultWorldbookActivation('rule'), alwaysOn: true, enabled: true },
      }),
      entry({
        id: 'wb:plot',
        kind: 'plot-thread',
        title: '主线',
        content: '不该进角色模式',
        activation: { ...defaultWorldbookActivation('plot-thread'), alwaysOn: true, enabled: true },
      }),
      entry({
        id: 'wb:char',
        kind: 'character',
        title: '林晚',
        content: '公开人设',
        activation: { ...defaultWorldbookActivation('character'), alwaysOn: true, enabled: true },
      }),
      entry({
        id: 'wb:kw',
        kind: 'location',
        title: '关键词地点',
        content: '仅关键词触发',
        activation: { ...defaultWorldbookActivation('location'), alwaysOn: false, enabled: true },
      }),
    ])
    expect(shared.map(item => item.id)).toEqual(['wb:world', 'wb:rule'])
  })

  it('persona block includes privateContent once when present', () => {
    const character = entry({
      id: 'wb:char',
      kind: 'character',
      title: '林晚',
      content: '青云弟子，外冷内热。',
      privateContent: '其实怕打雷。',
    })
    const block = formatCharacterPersonaBlock(character)
    expect(block).toContain('【扮演角色】林晚')
    expect(block).toContain('青云弟子，外冷内热。')
    expect(block).toContain('【私有认知｜只有此人知道】')
    expect(block).toContain('其实怕打雷。')
    expect(block.indexOf('青云弟子')).toBe(block.lastIndexOf('青云弟子'))
  })

  it('buildCharacterChatSystemMessages wires play + persona + shared', () => {
    const character = entry({
      id: 'wb:char',
      kind: 'character',
      title: '林晚',
      content: '公开人设',
      privateContent: '私有秘密',
    })
    const shared = [
      entry({
        id: 'wb:world',
        kind: 'world',
        title: '世界观',
        content: '旧港',
        activation: { ...defaultWorldbookActivation('world'), alwaysOn: true, enabled: true },
      }),
    ]
    const messages = buildCharacterChatSystemMessages({
      entry: character,
      sharedEntries: shared,
      writingLanguage: 'zh-CN',
    })
    expect(messages).toHaveLength(3)
    expect(messages[0].content).toContain('扮演')
    expect(messages[1].content).toContain('私有秘密')
    expect(messages[2].content).toContain('公开常驻设定')
    expect(messages[2].content).toContain('旧港')
    expect(characterModeReceiptTitles(character, shared)).toEqual(['林晚', '私有认知', '世界观'])
  })
})
