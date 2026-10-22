import { getProjectDb } from '../database'
import type {
  AgentChatLoadResult,
  AgentContextReceipt,
  PersistedAgentConversation,
  PersistedAgentMessage,
} from '../../src/shared/agent-chat'

interface ConversationRow {
  id: string
  title: string
  model_id: string | null
  messages_json: string
  created_at: number
  updated_at: number
}

function parseContextReceipt(raw: unknown): AgentContextReceipt | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  if (!Array.isArray(row.worldbookTitles) || !Array.isArray(row.continuityChapters)) return undefined
  const worldbookTitles = row.worldbookTitles.filter((title): title is string => typeof title === 'string')
  const continuityChapters = row.continuityChapters.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const chapter = item as Record<string, unknown>
    if (typeof chapter.chapterNumber !== 'number' || !Number.isFinite(chapter.chapterNumber)) return []
    const title = typeof chapter.chapterTitle === 'string' ? chapter.chapterTitle : undefined
    return title
      ? [{ chapterNumber: chapter.chapterNumber, chapterTitle: title }]
      : [{ chapterNumber: chapter.chapterNumber }]
  })
  return { worldbookTitles, continuityChapters }
}

function parseMessages(raw: string): PersistedAgentMessage[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      if (typeof row.id !== 'string' || typeof row.content !== 'string' || typeof row.createdAt !== 'number') return []
      if (row.role !== 'user' && row.role !== 'assistant' && row.role !== 'system') return []
      const message: PersistedAgentMessage = {
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
      }
      if ('toolCalls' in row) message.toolCalls = row.toolCalls
      if ('artifacts' in row) message.artifacts = row.artifacts
      const contextReceipt = parseContextReceipt(row.contextReceipt)
      if (contextReceipt) message.contextReceipt = contextReceipt
      return [message]
    })
  } catch {
    return []
  }
}

function rowToConversation(row: ConversationRow): PersistedAgentConversation {
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    messages: parseMessages(row.messages_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeMessages(messages: readonly PersistedAgentMessage[]): string {
  return JSON.stringify(messages.map(message => {
    const next: PersistedAgentMessage = {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    }
    if (message.toolCalls !== undefined) next.toolCalls = message.toolCalls
    if (message.artifacts !== undefined) next.artifacts = message.artifacts
    if (message.contextReceipt !== undefined) next.contextReceipt = message.contextReceipt
    return next
  }))
}

export class AgentChatRepository {
  static load(): AgentChatLoadResult {
    const db = getProjectDb()
    if (!db) throw new Error('DATABASE_NOT_OPEN')
    const rows = db.prepare(
      'SELECT id, title, model_id, messages_json, created_at, updated_at FROM agent_conversations ORDER BY updated_at DESC, id',
    ).all() as ConversationRow[]
    const conversations = rows.map(rowToConversation)
    const meta = db.prepare('SELECT active_conversation_id FROM agent_chat_meta WHERE id = 1').get() as
      | { active_conversation_id: string | null }
      | undefined
    const activeConversationId = meta?.active_conversation_id
      && conversations.some(item => item.id === meta.active_conversation_id)
      ? meta.active_conversation_id
      : (conversations[0]?.id ?? null)
    return { conversations, activeConversationId }
  }

  static upsert(conversation: PersistedAgentConversation): PersistedAgentConversation {
    const db = getProjectDb()
    if (!db) throw new Error('DATABASE_NOT_OPEN')
    const payload = {
      id: conversation.id,
      title: conversation.title.trim() || '对话',
      modelId: conversation.modelId,
      messagesJson: serializeMessages(conversation.messages),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    }
    db.prepare(`
      INSERT INTO agent_conversations(id, title, model_id, messages_json, created_at, updated_at)
      VALUES(@id, @title, @modelId, @messagesJson, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        model_id = excluded.model_id,
        messages_json = excluded.messages_json,
        updated_at = excluded.updated_at
    `).run(payload)
    return {
      id: payload.id,
      title: payload.title,
      modelId: payload.modelId,
      messages: conversation.messages,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    }
  }

  static delete(id: string): void {
    const db = getProjectDb()
    if (!db) throw new Error('DATABASE_NOT_OPEN')
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM agent_conversations WHERE id = ?').run(id)
      const meta = db.prepare('SELECT active_conversation_id FROM agent_chat_meta WHERE id = 1').get() as
        | { active_conversation_id: string | null }
        | undefined
      if (meta?.active_conversation_id === id) {
        const next = db.prepare(
          'SELECT id FROM agent_conversations ORDER BY updated_at DESC, id LIMIT 1',
        ).get() as { id: string } | undefined
        db.prepare(`
          INSERT INTO agent_chat_meta(id, active_conversation_id) VALUES(1, @active)
          ON CONFLICT(id) DO UPDATE SET active_conversation_id = excluded.active_conversation_id
        `).run({ active: next?.id ?? null })
      }
    })
    tx()
  }

  static setActive(activeConversationId: string | null): void {
    const db = getProjectDb()
    if (!db) throw new Error('DATABASE_NOT_OPEN')
    if (activeConversationId) {
      const exists = db.prepare('SELECT 1 FROM agent_conversations WHERE id = ?').get(activeConversationId)
      if (!exists) throw new Error('AGENT_CHAT_CONVERSATION_NOT_FOUND')
    }
    db.prepare(`
      INSERT INTO agent_chat_meta(id, active_conversation_id) VALUES(1, @active)
      ON CONFLICT(id) DO UPDATE SET active_conversation_id = excluded.active_conversation_id
    `).run({ active: activeConversationId })
  }

  static clearAll(): void {
    const db = getProjectDb()
    if (!db) throw new Error('DATABASE_NOT_OPEN')
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM agent_conversations').run()
      db.prepare('DELETE FROM agent_chat_meta').run()
    })
    tx()
  }
}
