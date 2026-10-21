import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDirectChatSystemPrompt } from '../../services/agent/direct-chat-prompt'
import { formatDirectChatContinuity } from '../../services/agent/direct-chat-continuity'
import * as promptTemplates from '../../services/prompt-templates'
import { getBuiltinPromptTemplate } from '../../services/prompt-templates'
import type { ProjectData } from '../../shared/ipc-channels'
import { useAgentStore } from '../agent-store'
import { useEditorStore } from '../editor-store'
import { useLLMStore } from '../llm-store'
import { useLocaleStore } from '../locale-store'
import { useProjectStore } from '../project-store'

const { invokeWithProjectSession } = vi.hoisted(() => ({
  invokeWithProjectSession: vi.fn(async () => []),
}))

vi.mock('../../services/ipc-client', () => ({
  ipc: {
    invoke: vi.fn(),
    invokeWithProjectSession,
  },
}))

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

  it('uses a custom direct_chat_system override in requestDebug', async () => {
    const builtin = getBuiltinPromptTemplate('direct_chat_system', 'zh-CN')!
    const resolveSpy = vi.spyOn(promptTemplates, 'resolvePromptTemplate').mockResolvedValue({
      ...builtin,
      systemRole: '自定义直连身份，请提醒用户使用写本章。',
    })
    const generateStream = vi.fn(async (_messages, callbacks) => {
      callbacks.onDone?.('ok')
      return 'stream-req-6'
    })
    useLLMStore.setState({ generateStream })

    useAgentStore.getState().createConversation()
    await useAgentStore.getState().sendMessage('覆盖测试')

    const system = useAgentStore.getState().getActiveConversation()?.messages.at(-1)?.requestDebug?.messages[0]?.content
    expect(system).toContain('自定义直连身份')
    expect(system).toContain('写本章')
    expect(system).not.toContain('简短梳理')
    expect(system).not.toContain('直接简洁作答')
    resolveSpy.mockRestore()
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
    const messages = useAgentStore.getState().getActiveConversation()?.messages.at(-1)?.requestDebug?.messages
    expect(messages?.[1]?.role).toBe('system')
    expect(messages?.[1]?.content).toContain('【已定稿前文】')
    expect(messages?.[1]?.content).toContain('雨夜里他错过了末班车。')
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
    const messages = useAgentStore.getState().getActiveConversation()?.messages.at(-1)?.requestDebug?.messages ?? []
    expect(messages.filter(m => m.role === 'system')).toHaveLength(1)
    expect(messages.some(m => m.content.includes('已定稿前文'))).toBe(false)
  })
})

describe('formatDirectChatContinuity', () => {
  it('formats chapter notes and keeps nearer chapters under budget', () => {
    const block = formatDirectChatContinuity([
      { draftId: 1, chapterNumber: 1, chapterTitle: '开端', chapterNotes: '他错过了末班车。' },
      { draftId: 2, chapterNumber: 2, chapterTitle: '追寻', chapterNotes: '他找到了线索。', facts: [{ category: 'plot', entities: [], statement: '线索在旧站台。', sourceChapter: 2, evidence: '' }] },
    ])
    expect(block).toContain('【已定稿前文】')
    expect(block).toContain('第1章「开端」')
    expect(block).toContain('他错过了末班车。')
    expect(block).toContain('第2章「追寻」')
    expect(block).toContain('· 线索在旧站台。')
  })
})

describe('buildDirectChatSystemPrompt', () => {
  it('keeps builtin identity semantics without tool_call XML or mode tones', async () => {
    const prompt = await buildDirectChatSystemPrompt({ writingLanguage: 'zh-CN' })
    expect(prompt).not.toMatch(/<\/?tool_call>/i)
    expect(prompt).toContain('写本章')
    expect(prompt).toContain('写作助手')
    expect(prompt).not.toContain('简短梳理')
    expect(prompt).not.toContain('直接简洁作答')
  })
})
