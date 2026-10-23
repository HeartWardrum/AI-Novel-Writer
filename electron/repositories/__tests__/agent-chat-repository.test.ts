import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openCanonicalProjectFixture } from '../../../test/helpers/canonical-project-fixture'
import { closeProjectDatabase } from '../../database'
import { AgentChatRepository } from '../agent-chat-repository'
import type { PersistedAgentConversation } from '../../../src/shared/agent-chat'

let projectPath = ''

function conversation(partial?: Partial<PersistedAgentConversation>): PersistedAgentConversation {
  const now = Date.now()
  return {
    id: partial?.id ?? 'conv-1',
    title: partial?.title ?? '灯塔夜谈',
    modelId: partial?.modelId ?? 'model-a',
    createdAt: partial?.createdAt ?? now,
    updatedAt: partial?.updatedAt ?? now,
    messages: partial?.messages ?? [
      { id: 'm1', role: 'user', content: '说说灯塔', createdAt: now },
      { id: 'm2', role: 'assistant', content: '雾钟提前一刻响起。', createdAt: now + 1 },
    ],
    ...(partial?.chatMode !== undefined ? { chatMode: partial.chatMode } : {}),
    ...(partial?.characterEntryId !== undefined ? { characterEntryId: partial.characterEntryId } : {}),
    ...(partial?.focusChapterNumber !== undefined ? { focusChapterNumber: partial.focusChapterNumber } : {}),
    ...(partial?.proseTone !== undefined ? { proseTone: partial.proseTone } : {}),
  }
}

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-repository-'))
  openCanonicalProjectFixture(projectPath)
})

afterEach(() => {
  closeProjectDatabase()
  fs.rmSync(projectPath, { recursive: true, force: true })
})

describe('agent chat repository', () => {
  it('upserts, loads, and restores active conversation', () => {
    const first = conversation()
    AgentChatRepository.upsert(first)
    AgentChatRepository.setActive(first.id)
    const second = conversation({
      id: 'conv-2',
      title: '第二段',
      updatedAt: first.updatedAt + 10,
      messages: [{ id: 'n1', role: 'user', content: '继续', createdAt: first.updatedAt + 5 }],
    })
    AgentChatRepository.upsert(second)

    const loaded = AgentChatRepository.load()
    expect(loaded.conversations.map(item => item.id)).toEqual(['conv-2', 'conv-1'])
    expect(loaded.conversations[1]).toMatchObject({
      id: 'conv-1',
      title: '灯塔夜谈',
      messages: [
        { id: 'm1', role: 'user', content: '说说灯塔' },
        { id: 'm2', role: 'assistant', content: '雾钟提前一刻响起。' },
      ],
    })
    expect(loaded.activeConversationId).toBe('conv-1')
  })

  it('deletes a conversation and advances active meta', () => {
    AgentChatRepository.upsert(conversation({ id: 'a', updatedAt: 2 }))
    AgentChatRepository.upsert(conversation({ id: 'b', updatedAt: 1 }))
    AgentChatRepository.setActive('a')
    AgentChatRepository.delete('a')
    const loaded = AgentChatRepository.load()
    expect(loaded.conversations.map(item => item.id)).toEqual(['b'])
    expect(loaded.activeConversationId).toBe('b')
  })

  it('clears all conversations and meta', () => {
    AgentChatRepository.upsert(conversation())
    AgentChatRepository.setActive('conv-1')
    AgentChatRepository.clearAll()
    expect(AgentChatRepository.load()).toEqual({ conversations: [], activeConversationId: null })
  })

  it('persists chatMode, characterEntryId, focusChapterNumber, and proseTone on conversations', () => {
    const now = Date.now()
    AgentChatRepository.upsert(conversation({
      chatMode: 'character',
      characterEntryId: 'wb:char:lin',
      focusChapterNumber: 7,
      proseTone: 'web-novel',
      messages: [{ id: 'u1', role: 'user', content: '你好', createdAt: now }],
    }))
    const loaded = AgentChatRepository.load().conversations[0]
    expect(loaded.chatMode).toBe('character')
    expect(loaded.characterEntryId).toBe('wb:char:lin')
    expect(loaded.focusChapterNumber).toBe(7)
    expect(loaded.proseTone).toBe('web-novel')
  })

  it('defaults missing chatMode to author when loading legacy message arrays', () => {
    const first = AgentChatRepository.upsert(conversation())
    expect(first.chatMode).toBe('author')
    expect(first.characterEntryId).toBeNull()
    expect(first.focusChapterNumber).toBe(1)
    expect(first.proseTone).toBe('default')
    const loaded = AgentChatRepository.load().conversations[0]
    expect(loaded.chatMode).toBe('author')
    expect(loaded.characterEntryId).toBeNull()
    expect(loaded.focusChapterNumber).toBe(1)
    expect(loaded.proseTone).toBe('default')
  })

  it('persists lightweight contextReceipt on assistant messages', () => {
    const now = Date.now()
    AgentChatRepository.upsert(conversation({
      messages: [
        { id: 'u1', role: 'user', content: '说说林晚', createdAt: now },
        {
          id: 'a1',
          role: 'assistant',
          content: '她站在青云城门外。',
          createdAt: now + 1,
          contextReceipt: {
            worldbookTitles: ['林晚', '青云城'],
            continuityChapters: [{ chapterNumber: 10, chapterTitle: '潮汐' }],
          },
        },
      ],
    }))

    const loaded = AgentChatRepository.load().conversations[0]
    expect(loaded.messages[1]).toMatchObject({
      id: 'a1',
      contextReceipt: {
        worldbookTitles: ['林晚', '青云城'],
        continuityChapters: [{ chapterNumber: 10, chapterTitle: '潮汐' }],
      },
    })
  })
})
