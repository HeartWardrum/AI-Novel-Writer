import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDirectChatSystemPrompt } from '../../services/agent/direct-chat-prompt'
import { formatDirectChatContinuity } from '../../services/agent/direct-chat-continuity'
import { formatDirectChatWorldbook } from '../../services/agent/direct-chat-worldbook'
import type { ProjectData } from '../../shared/ipc-channels'
import type { WorldbookResolveResult } from '../../shared/worldbook'
import { useAgentStore } from '../agent-store'
import { useEditorStore } from '../editor-store'
import { useLLMStore } from '../llm-store'
import { useLocaleStore } from '../locale-store'
import { useProjectStore } from '../project-store'

const { invokeWithProjectSession, resolveWorldbook } = vi.hoisted(() => ({
  invokeWithProjectSession: vi.fn(async () => []),
  resolveWorldbook: vi.fn(async () => ({
    selections: [] as WorldbookResolveResult['selections'],
    omitted: [] as WorldbookResolveResult['omitted'],
    tokenEstimate: 0,
    budgetTokens: 4000,
    requiredOverflow: false,
  })),
}))

vi.mock('../../services/ipc-client', () => ({
  ipc: {
    invoke: vi.fn(),
    invokeWithProjectSession,
  },
}))

vi.mock('../../services/worldbook-service', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/worldbook-service')>()
  return {
    ...actual,
    resolveWorldbook,
  }
})

const originalEditor = useEditorStore.getState()
const originalProject = useProjectStore.getState()

function demoProject(): ProjectData {
  return {
    id: 'p1',
    path: 'C:\\novels\\demo',
    sessionLease: 'lease-1',
    name: 'demo',
    novelConfig: {
      genre: '玄幻',
      subGenre: '',
      targetAudience: '全龄',
      totalChapters: 10,
      wordsPerChapter: 3000,
      plotStructure: 'three_act',
      narrativePOV: 'third_limited',
      coreOutline: '',
      worldSetting: '',
      goldenFinger: '',
      protagonistProfile: '',
      globalGuidance: '',
      writingLanguage: 'zh-CN',
    },
    characterStates: '',
    createdAt: '',
    updatedAt: '',
  }
}

describe('direct chat sendMessage', () => {
  beforeEach(() => {
    useAgentStore.setState({
      conversations: [],
      activeConversationId: null,
      generating: false,
      activeRequestId: null,
      toolsInitialized: false,
      recruitActive: false,
      recruitAnswers: {},
      recruitRecommendations: [],
      recruitBusy: false,
    })
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    useLLMStore.setState({
      defaultModelId: 'model-a',
      cancelGeneration: vi.fn(async () => undefined),
    })
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useProjectStore.setState({ currentProject: null })
    invokeWithProjectSession.mockReset()
    invokeWithProjectSession.mockResolvedValue([])
    resolveWorldbook.mockReset()
    resolveWorldbook.mockResolvedValue({
      selections: [],
      omitted: [],
      tokenEstimate: 0,
      budgetTokens: 4000,
      requiredOverflow: false,
    })
  })

  afterEach(() => {
    useEditorStore.setState(originalEditor, true)
    useProjectStore.setState(originalProject, true)
  })

  it('streams via generateStream with a system prompt that excludes tool protocol', async () => {
    const chunks = ['捉', '鬼', '大纲']
    const generateStream = vi.fn(async (messages, callbacks) => {
      expect(messages[0]).toMatchObject({ role: 'system' })
      expect(messages[0].content).not.toMatch(/<\/?tool_call>/i)
      expect(messages[0].content).not.toContain('invoke name=')
      expect(messages[0].content).toContain('写作助手')
      expect(messages.at(-1)).toMatchObject({ role: 'user', content: '写一篇捉鬼小说' })
      for (const chunk of chunks) callbacks.onChunk?.(chunk)
      callbacks.onDone?.(chunks.join(''))
      return 'stream-req-1'
    })
    useLLMStore.setState({ generateStream })

    useAgentStore.getState().createConversation()
    await useAgentStore.getState().sendMessage('写一篇捉鬼小说')

    expect(generateStream).toHaveBeenCalledOnce()
    const last = useAgentStore.getState().getActiveConversation()?.messages.at(-1)
    expect(last).toMatchObject({
      role: 'assistant',
      content: '捉鬼大纲',
      streaming: false,
    })
    expect(useAgentStore.getState().generating).toBe(false)
    expect(useAgentStore.getState().activeRequestId).toBeNull()
  })

  it('appends chunks while streaming and finishes on onDone', async () => {
    let onChunk!: (chunk: string) => void
    let onDone!: (full: string) => void
    const generateStream = vi.fn(async (_messages, callbacks) => {
      onChunk = callbacks.onChunk!
      onDone = callbacks.onDone!
      return 'stream-req-3'
    })
    useLLMStore.setState({ generateStream })

    useAgentStore.getState().createConversation()
    const send = useAgentStore.getState().sendMessage('流式测试')
    await vi.waitFor(() => expect(generateStream).toHaveBeenCalledOnce())

    onChunk('第一')
    expect(useAgentStore.getState().getActiveConversation()?.messages.at(-1)?.content).toBe('第一')
    expect(useAgentStore.getState().getActiveConversation()?.messages.at(-1)?.streaming).toBe(true)

    onChunk('段')
    onDone('第一段')
    await send

    expect(useAgentStore.getState().getActiveConversation()?.messages.at(-1)).toMatchObject({
      content: '第一段',
      streaming: false,
    })
  })

  it('does not go through agent-generation begin', async () => {
    const generateStream = vi.fn(async (messages, callbacks) => {
      expect(messages.some((m: { role: string }) => m.role === 'system')).toBe(true)
      callbacks.onDone?.('纯文本')
      return 'stream-req-4'
    })
    useLLMStore.setState({ generateStream })

    await useAgentStore.getState().sendMessage('随便聊聊')
    expect(generateStream).toHaveBeenCalledOnce()
    expect(useAgentStore.getState().getActiveConversation()?.messages.at(-1)?.content).toBe('纯文本')
    expect(useAgentStore.getState().getActiveConversation()?.messages.at(-1)?.toolCalls).toBeUndefined()
  })

  it('attaches requestDebug with the exact llmMessages sent', async () => {
    const generateStream = vi.fn(async (_messages, callbacks) => {
      callbacks.onDone?.('回复')
      return 'stream-req-5'
    })
    useLLMStore.setState({ generateStream })

    useAgentStore.getState().createConversation()
    await useAgentStore.getState().sendMessage('调试上下文')

    const last = useAgentStore.getState().getActiveConversation()?.messages.at(-1)
    const expectedSystem = await buildDirectChatSystemPrompt({ writingLanguage: 'zh-CN' })
    expect(last?.requestDebug).toMatchObject({
      modelId: 'model-a',
      meta: { purpose: 'generation', reasoningStage: 'drafting', historyCount: 0 },
    })
    expect(last?.requestDebug?.messages[0]).toEqual({ role: 'system', content: expectedSystem })
    expect(last?.requestDebug?.messages.at(-1)).toEqual({ role: 'user', content: '调试上下文' })
    expect(generateStream.mock.calls[0][0]).toEqual(last?.requestDebug?.messages)
  })

  it('uses the worldbook system prompt entry in requestDebug', async () => {
    const project = demoProject()
    useProjectStore.setState({ currentProject: project })
    invokeWithProjectSession.mockImplementation((async (_session: unknown, channel: string) => {
      if (channel === 'worldbook:list') {
        return [{
          id: 'wb:system:direct-chat',
          kind: 'rule',
          title: '系统提示',
          content: '自定义直连身份，专注对话构思与润色。',
          promptContent: '自定义直连身份，专注对话构思与润色。',
          activation: {
            primaryKeys: [],
            secondaryKeys: [],
            matchMode: 'any',
            alwaysOn: true,
            enabled: true,
            stages: ['drafting'],
            priority: 10_000,
            insertionOrder: -1,
            group: 'system',
            promptPolicy: 'full',
          },
          source: { kind: 'system', id: 'direct-chat', revision: '1' },
          editable: true,
          deletable: false,
          needsReview: false,
          revision: 1,
          updatedAt: '',
        }]
      }
      return []
    }) as never)
    const generateStream = vi.fn(async (_messages, callbacks) => {
      callbacks.onDone?.('ok')
      return 'stream-req-6'
    })
    useLLMStore.setState({ generateStream })

    useAgentStore.getState().createConversation()
    await useAgentStore.getState().sendMessage('覆盖测试')

    const system = useAgentStore.getState().getActiveConversation()?.messages.at(-1)?.requestDebug?.messages[0]?.content
    expect(system).toBe('自定义直连身份，专注对话构思与润色。')
    expect(system).toContain('专注对话')
    expect(system).not.toContain('简短梳理')
    expect(system).not.toContain('直接简洁作答')
  })

  it('injects finalized continuity notes into llmMessages and requestDebug', async () => {
    const project = demoProject()
    useProjectStore.setState({ currentProject: project })
    useEditorStore.setState({
      tabs: [{ id: 'tab-ch2', name: '第 2 章', type: 'chapter', projectKey: project.path, chapterNumber: 2, content: '' }],
      activeTabId: 'tab-ch2',
    })
    invokeWithProjectSession.mockImplementation((async (_session: unknown, channel: string) => {
      if (channel === 'db:continuity-list-before') {
        return [{
          draftId: 1,
          chapterNumber: 1,
          chapterTitle: '开端',
          chapterNotes: '雨夜里他错过了末班车。',
        }]
      }
      return []
    }) as never)
    const generateStream = vi.fn(async (_messages, callbacks) => {
      callbacks.onDone?.('接上')
      return 'stream-req-7'
    })
    useLLMStore.setState({ generateStream })

    useAgentStore.getState().createConversation()
    await useAgentStore.getState().sendMessage('写第二章')

    expect(invokeWithProjectSession).toHaveBeenCalledWith(
      { projectId: 'p1', leaseId: 'lease-1', projectPath: 'C:\\novels\\demo' },
      'db:continuity-list-before',
      2,
      'C:\\novels\\demo',
    )
    const last = useAgentStore.getState().getActiveConversation()?.messages.at(-1)
    const messages = last?.requestDebug?.messages
    expect(messages?.[1]?.role).toBe('system')
    expect(messages?.[1]?.content).toContain('【已定稿前文】')
    expect(messages?.[1]?.content).toContain('雨夜里他错过了末班车。')
    expect(last?.contextReceipt).toEqual({
      worldbookTitles: [],
      continuityChapters: [{ chapterNumber: 1, chapterTitle: '开端' }],
    })
    expect(generateStream.mock.calls[0][0]).toEqual(messages)
  })

  it('skips continuity injection when there is no active chapter tab', async () => {
    const generateStream = vi.fn(async (_messages, callbacks) => {
      callbacks.onDone?.('ok')
      return 'stream-req-8'
    })
    useLLMStore.setState({ generateStream })

    useAgentStore.getState().createConversation()
    await useAgentStore.getState().sendMessage('闲聊')

    expect(invokeWithProjectSession).not.toHaveBeenCalled()
    const last = useAgentStore.getState().getActiveConversation()?.messages.at(-1)
    const messages = last?.requestDebug?.messages ?? []
    expect(messages.filter(m => m.role === 'system')).toHaveLength(1)
    expect(messages.some(m => m.content.includes('已定稿前文'))).toBe(false)
    expect(last?.contextReceipt).toBeUndefined()
  })

  it('injects matched worldbook entries into llmMessages and requestDebug', async () => {
    const project = demoProject()
    useProjectStore.setState({ currentProject: project })
    resolveWorldbook.mockResolvedValue({
      selections: [{
        entryId: 'wb-1',
        title: '灯塔守则',
        kind: 'rule',
        content: '雾钟提前一刻响起。',
        source: { kind: 'author', id: 'wb-1', revision: '1' },
        revision: 1,
        reason: 'primary-key',
        matchedKeys: ['灯塔'],
        score: 20,
        estimatedTokens: 12,
      }],
      omitted: [],
      tokenEstimate: 12,
      budgetTokens: 4000,
      requiredOverflow: false,
    })
    const generateStream = vi.fn(async (_messages, callbacks) => {
      callbacks.onDone?.('记下了')
      return 'stream-req-9'
    })
    useLLMStore.setState({ generateStream })

    useAgentStore.getState().createConversation()
    await useAgentStore.getState().sendMessage('说说灯塔')

    expect(resolveWorldbook).toHaveBeenCalledWith(
      { projectId: 'p1', leaseId: 'lease-1', projectPath: 'C:\\novels\\demo' },
      expect.objectContaining({
        stage: 'drafting',
        draftText: '说说灯塔',
        authorGuidance: '说说灯塔',
        budgetTokens: 4000,
      }),
    )
    const last = useAgentStore.getState().getActiveConversation()?.messages.at(-1)
    const messages = last?.requestDebug?.messages ?? []
    expect(last?.requestDebug?.meta.worldbookCount).toBe(1)
    expect(last?.contextReceipt).toEqual({
      worldbookTitles: ['灯塔守则'],
      continuityChapters: [],
    })
    expect(messages.some(m => m.role === 'system' && m.content.includes('【世界书】'))).toBe(true)
    expect(messages.some(m => m.content.includes('雾钟提前一刻响起。'))).toBe(true)
    expect(generateStream.mock.calls[0][0]).toEqual(messages)
  })

  it('continues chat when worldbook resolve fails', async () => {
    useProjectStore.setState({ currentProject: demoProject() })
    resolveWorldbook.mockRejectedValue(new Error('offline'))
    const generateStream = vi.fn(async (_messages, callbacks) => {
      callbacks.onDone?.('仍可聊')
      return 'stream-req-10'
    })
    useLLMStore.setState({ generateStream })

    useAgentStore.getState().createConversation()
    await useAgentStore.getState().sendMessage('灯塔')

    const messages = useAgentStore.getState().getActiveConversation()?.messages.at(-1)?.requestDebug?.messages ?? []
    expect(messages.some(m => m.content.includes('【世界书】'))).toBe(false)
    expect(useAgentStore.getState().getActiveConversation()?.messages.at(-1)?.content).toBe('仍可聊')
  })

  it('upserts the conversation after send without requestDebug', async () => {
    const project = demoProject()
    useProjectStore.setState({ currentProject: project })
    const upserted: unknown[] = []
    invokeWithProjectSession.mockImplementation((async (_session: unknown, channel: string, ...args: unknown[]) => {
      if (channel === 'agent-chat:load') {
        return { conversations: [], activeConversationId: null }
      }
      if (channel === 'agent-chat:upsert') {
        upserted.push(args[0])
        return { success: true, conversation: args[0] }
      }
      if (channel === 'agent-chat:set-active') {
        return { success: true }
      }
      return []
    }) as never)

    await useAgentStore.getState().hydrateFromProject({
      projectId: project.id,
      leaseId: project.sessionLease!,
      projectPath: project.path,
    })
    useAgentStore.getState().createConversation()
    await vi.waitFor(() => expect(upserted.length).toBeGreaterThan(0))
    upserted.length = 0

    const generateStream = vi.fn(async (_messages, callbacks) => {
      callbacks.onDone?.('雾钟响了')
      return 'stream-req-persist'
    })
    useLLMStore.setState({ generateStream })
    await useAgentStore.getState().sendMessage('说说灯塔')

    await vi.waitFor(() => expect(upserted.length).toBeGreaterThan(0))
    const payload = upserted.at(-1) as {
      messages: Array<{ content: string; requestDebug?: unknown }>
    }
    expect(payload.messages.map(m => m.content)).toEqual(['说说灯塔', '雾钟响了'])
    expect(payload.messages.every(m => !('requestDebug' in m) || m.requestDebug === undefined)).toBe(true)
  })

  it('deletes an assistant message without removing the user prompt', () => {
    const now = Date.now()
    useAgentStore.setState({
      conversations: [{
        id: 'c1',
        title: '测',
        modelId: null,
        createdAt: now,
        updatedAt: now,
        messages: [
          { id: 'u1', role: 'user', content: '写开头', createdAt: now },
          { id: 'a1', role: 'assistant', content: '不满意的开头', createdAt: now + 1 },
        ],
      }],
      activeConversationId: 'c1',
      generating: false,
      activeRequestId: null,
    })
    useAgentStore.getState().deleteMessage('a1')
    expect(useAgentStore.getState().getActiveConversation()?.messages.map(m => m.id)).toEqual(['u1'])
  })

  it('updates message content locally without regenerating', () => {
    const now = Date.now()
    useAgentStore.setState({
      conversations: [{
        id: 'c1',
        title: '测',
        modelId: null,
        createdAt: now,
        updatedAt: now,
        messages: [
          { id: 'u1', role: 'user', content: '旧提示', createdAt: now },
          { id: 'a1', role: 'assistant', content: '旧回复', createdAt: now + 1, requestDebug: {
            at: now, modelId: 'model-a', messages: [], meta: { purpose: 'generation', reasoningStage: 'drafting', historyCount: 0 },
          } },
        ],
      }],
      activeConversationId: 'c1',
      generating: false,
      activeRequestId: null,
    })
    useAgentStore.getState().updateMessageContent('u1', '新提示')
    useAgentStore.getState().updateMessageContent('a1', '手改回复')
    const messages = useAgentStore.getState().getActiveConversation()?.messages ?? []
    expect(messages.map(m => m.content)).toEqual(['新提示', '手改回复'])
    expect(messages[1]?.requestDebug).toBeUndefined()
  })

  it('resends an edited user message and drops later turns', async () => {
    const now = Date.now()
    useAgentStore.setState({
      conversations: [{
        id: 'c1',
        title: '测',
        modelId: null,
        createdAt: now,
        updatedAt: now,
        messages: [
          { id: 'u1', role: 'user', content: '第一问', createdAt: now },
          { id: 'a1', role: 'assistant', content: '第一答', createdAt: now + 1 },
          { id: 'u2', role: 'user', content: '第二问', createdAt: now + 2 },
          { id: 'a2', role: 'assistant', content: '第二答', createdAt: now + 3 },
        ],
      }],
      activeConversationId: 'c1',
      generating: false,
      activeRequestId: null,
    })
    const generateStream = vi.fn(async (messages, callbacks) => {
      expect(messages.at(-1)).toMatchObject({ role: 'user', content: '改过的第二问' })
      expect(messages.some((m: { content: string }) => m.content === '第二答')).toBe(false)
      callbacks.onDone?.('新的第二答')
      return 'stream-resend'
    })
    useLLMStore.setState({ generateStream })

    await useAgentStore.getState().resendUserMessage('u2', '改过的第二问')

    const messages = useAgentStore.getState().getActiveConversation()?.messages ?? []
    expect(messages.map(m => m.content)).toEqual(['第一问', '第一答', '改过的第二问', '新的第二答'])
    expect(messages.some(m => m.id === 'a2')).toBe(false)
    expect(generateStream).toHaveBeenCalledOnce()
  })
})

describe('agent chat hydrateFromProject', () => {
  beforeEach(() => {
    useAgentStore.setState({
      conversations: [],
      activeConversationId: null,
      generating: false,
      activeRequestId: null,
      toolsInitialized: false,
      recruitActive: false,
      recruitAnswers: {},
      recruitRecommendations: [],
      recruitBusy: false,
    })
    useProjectStore.setState({ currentProject: null })
    invokeWithProjectSession.mockReset()
  })

  afterEach(() => {
    useProjectStore.setState(originalProject, true)
  })

  it('loads conversations from the project database into the store', async () => {
    const project = demoProject()
    useProjectStore.setState({ currentProject: project })
    const now = Date.now()
    invokeWithProjectSession.mockImplementation((async (_session: unknown, channel: string) => {
      if (channel === 'agent-chat:load') {
        return {
          conversations: [
            {
              id: 'c1',
              title: '灯塔夜谈',
              modelId: 'model-a',
              createdAt: now,
              updatedAt: now + 2,
              messages: [
                { id: 'm1', role: 'user', content: '说说灯塔', createdAt: now },
                { id: 'm2', role: 'assistant', content: '雾钟提前一刻响起。', createdAt: now + 1 },
              ],
            },
            {
              id: 'c2',
              title: '第二段',
              modelId: null,
              createdAt: now - 10,
              updatedAt: now - 5,
              messages: [{ id: 'n1', role: 'user', content: '继续', createdAt: now - 8 }],
            },
          ],
          activeConversationId: 'c1',
        }
      }
      return []
    }) as never)

    await useAgentStore.getState().hydrateFromProject({
      projectId: project.id,
      leaseId: project.sessionLease!,
      projectPath: project.path,
    })

    expect(useAgentStore.getState().conversations.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(useAgentStore.getState().activeConversationId).toBe('c1')
    expect(useAgentStore.getState().getActiveConversation()?.messages.map(m => m.content))
      .toEqual(['说说灯塔', '雾钟提前一刻响起。'])
  })
})

describe('formatDirectChatWorldbook', () => {
  it('formats selected entries under a worldbook heading', () => {
    const block = formatDirectChatWorldbook([{
      entryId: 'wb-1',
      title: '灯塔',
      kind: 'location',
      content: '守塔人擦亮了灯罩。',
      source: { kind: 'author', id: 'wb-1', revision: '1' },
      revision: 1,
      reason: 'primary-key',
      matchedKeys: ['灯塔'],
      score: 20,
      estimatedTokens: 10,
    }])
    expect(block).toContain('【世界书】')
    expect(block).toContain('### 灯塔')
    expect(block).toContain('守塔人擦亮了灯罩。')
  })
})

describe('formatDirectChatContinuity', () => {
  it('formats chapter notes and keeps nearer chapters under budget', () => {
    const result = formatDirectChatContinuity([
      { draftId: 1, chapterNumber: 1, chapterTitle: '开端', chapterNotes: '他错过了末班车。' },
      { draftId: 2, chapterNumber: 2, chapterTitle: '追寻', chapterNotes: '他找到了线索。', facts: [{ category: 'plot', entities: [], statement: '线索在旧站台。', sourceChapter: 2, evidence: '' }] },
    ])
    expect(result?.block).toContain('【已定稿前文】')
    expect(result?.block).toContain('第1章「开端」')
    expect(result?.block).toContain('他错过了末班车。')
    expect(result?.block).toContain('第2章「追寻」')
    expect(result?.block).toContain('· 线索在旧站台。')
    expect(result?.chapters).toEqual([
      { chapterNumber: 1, chapterTitle: '开端' },
      { chapterNumber: 2, chapterTitle: '追寻' },
    ])
  })

  it('drops earliest chapters from receipt when over budget', () => {
    const longNotes = '剧情要点。'.repeat(400)
    const result = formatDirectChatContinuity(
      [
        { draftId: 1, chapterNumber: 1, chapterTitle: '远章', chapterNotes: longNotes },
        { draftId: 2, chapterNumber: 2, chapterTitle: '近章', chapterNotes: longNotes },
      ],
      900,
    )
    expect(result?.chapters).toEqual([{ chapterNumber: 2, chapterTitle: '近章' }])
    expect(result?.block).toContain('第2章「近章」')
    expect(result?.block).not.toContain('第1章「远章」')
  })
})

describe('buildDirectChatSystemPrompt', () => {
  it('keeps builtin identity semantics without tool_call XML or mode tones', async () => {
    const prompt = await buildDirectChatSystemPrompt({ writingLanguage: 'zh-CN' })
    expect(prompt).not.toMatch(/<\/?tool_call>/i)
    expect(prompt).toContain('写作助手')
    expect(prompt).toContain('构思')
    expect(prompt).not.toContain('写本章')
    expect(prompt).not.toContain('简短梳理')
    expect(prompt).not.toContain('直接简洁作答')
  })
})
