import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../shared/ipc-channels'
import { useAgentStore } from '../agent-store'
import { useEditorStore } from '../editor-store'
import { useLLMStore } from '../llm-store'
import { useLocaleStore } from '../locale-store'
import { useProjectStore } from '../project-store'
import { useRecruitQuestionnaireStore } from '../recruit-questionnaire-store'

const { invokeWithProjectSession, resolveWorldbook, saveWorldbookEntry } = vi.hoisted(() => ({
  invokeWithProjectSession: vi.fn(async () => []),
  resolveWorldbook: vi.fn(async () => ({
    selections: [],
    omitted: [],
    tokenEstimate: 0,
    budgetTokens: 4000,
    requiredOverflow: false,
  })),
  saveWorldbookEntry: vi.fn(async () => ({
    id: 'wb-1',
    kind: 'character' as const,
    title: '林晚',
    content: '姓名：林晚',
    promptContent: '',
    activation: {
      primaryKeys: ['林晚'],
      secondaryKeys: [],
      matchMode: 'any' as const,
      alwaysOn: false,
      enabled: true,
      stages: ['planning', 'drafting', 'review'] as const,
      priority: 60,
      insertionOrder: 0,
      group: 'character',
      promptPolicy: 'full' as const,
    },
    source: { kind: 'author' as const, id: 'a', revision: 'r' },
    editable: true,
    needsReview: false,
    revision: 1,
    updatedAt: '',
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
    saveWorldbookEntry,
  }
})

vi.mock('../../components/ui/Toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
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

describe('酒馆招新表单', () => {
  beforeEach(() => {
    useRecruitQuestionnaireStore.getState().hydrate()
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
      showHistory: false,
    })
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    useLLMStore.setState({
      defaultModelId: 'model-a',
      cancelGeneration: vi.fn(async () => undefined),
      generateStream: vi.fn(async (_messages, callbacks) => {
        callbacks.onDone?.(JSON.stringify({
          name: '林晚',
          gender: '女',
          age: '青壮',
          relationships: '旧友',
          appearance: '青衫',
          personality: '沉稳',
          keywords: ['林晚'],
        }))
        return 'stream-recruit'
      }),
    })
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useProjectStore.setState({ currentProject: demoProject() })
    saveWorldbookEntry.mockClear()
  })

  afterEach(() => {
    useEditorStore.setState(originalEditor, true)
    useProjectStore.setState(originalProject, true)
  })

  it('opens form without calling the model', () => {
    const generateStream = vi.fn()
    useLLMStore.setState({ generateStream })
    useAgentStore.getState().startRecruit()
    expect(useAgentStore.getState().recruitActive).toBe(true)
    expect(generateStream).not.toHaveBeenCalled()
    expect(useAgentStore.getState().getActiveConversation()).toBeTruthy()
  })

  it('does not grow main conversation while recruiting', async () => {
    useAgentStore.getState().createConversation()
    const before = useAgentStore.getState().getActiveConversation()!.messages.length
    useAgentStore.getState().startRecruit()
    await useAgentStore.getState().sendMessage('不应发出')
    expect(useAgentStore.getState().getActiveConversation()!.messages).toHaveLength(before)
  })

  it('cancel and restart clear answers', () => {
    useAgentStore.getState().startRecruit()
    const nameId = useRecruitQuestionnaireStore.getState().saved.questions.find(q => q.field === 'name')!.id
    useAgentStore.getState().setRecruitAnswer(nameId, { kind: 'custom', text: '林晚' })
    useAgentStore.getState().restartRecruit()
    expect(useAgentStore.getState().recruitActive).toBe(true)
    expect(useAgentStore.getState().recruitAnswers).toEqual({})
    useAgentStore.getState().setRecruitAnswer(nameId, { kind: 'custom', text: '林晚' })
    useAgentStore.getState().cancelRecruit()
    expect(useAgentStore.getState().recruitActive).toBe(false)
    expect(useAgentStore.getState().recruitAnswers).toEqual({})
  })

  it('finishRecruit saves worldbook character', async () => {
    useAgentStore.getState().startRecruit()
    const nameId = useRecruitQuestionnaireStore.getState().saved.questions.find(q => q.field === 'name')!.id
    useAgentStore.getState().setRecruitAnswer(nameId, { kind: 'custom', text: '林晚' })
    await useAgentStore.getState().finishRecruit()
    expect(saveWorldbookEntry).toHaveBeenCalledOnce()
    expect(saveWorldbookEntry.mock.calls[0]![1].kind).toBe('character')
    expect(useAgentStore.getState().recruitActive).toBe(false)
  })

  it('recommendRecruit fills three candidates and can prefill', async () => {
    useLLMStore.setState({
      defaultModelId: 'model-a',
      cancelGeneration: vi.fn(async () => undefined),
      generateStream: vi.fn(async (_messages, callbacks) => {
        callbacks.onDone?.(JSON.stringify([
          {
            name: '阿禾',
            gender: '女',
            age: '少年',
            relationships: '路人',
            appearance: '麻衣',
            personality: '胆大',
            keywords: ['阿禾'],
            reason: '适合带路',
          },
          {
            name: '老槐',
            gender: '男',
            age: '中老',
            relationships: '中立',
            appearance: '须发花白',
            personality: '沉稳',
            keywords: ['老槐'],
            reason: '知情者',
          },
          {
            name: '铁算',
            gender: '男',
            age: '青壮',
            relationships: '对手',
            appearance: '瘦高',
            personality: '算计',
            keywords: ['铁算'],
            reason: '制造冲突',
          },
        ]))
        return 'stream-rec'
      }),
    })
    useAgentStore.getState().startRecruit()
    await useAgentStore.getState().recommendRecruit()
    expect(useAgentStore.getState().recruitRecommendations).toHaveLength(3)
    useAgentStore.getState().applyRecruitRecommendation(0)
    const nameId = useRecruitQuestionnaireStore.getState().saved.questions.find(q => q.field === 'name')!.id
    expect(useAgentStore.getState().recruitAnswers[nameId]).toEqual({ kind: 'custom', text: '阿禾' })
  })
})
