import { create } from 'zustand'
import {
  type ConfigImpactBlueprintProposal,
  type ToolCallInfo,
  type ToolConfirmationDecision,
} from '../services/agent/agent-engine'
import { registerBuiltinTools } from '../services/agent/tools'
import { skillRegistry, type LoadedSkill } from '../services/agent/skill-registry'
import {
  getAllSlashCommands,
  parseSlashCommand,
} from '../services/agent/intent-router'
import type { ToolArtifact } from '../services/agent/tool-registry'
import {
  buildHomeworkPrompt,
  ensureHomeworkCharacters,
  loadHomeworkInputs,
  saveCharacterPrivateHomework,
  type AssignHomeworkProgress,
} from '../services/agent/assign-worldbook-homework'
import { loadDirectChatWorldbook } from '../services/agent/direct-chat-worldbook'
import { buildDirectChatSystemPrompt } from '../services/agent/direct-chat-prompt'
import {
  buildContinueChapterUserMessage,
  formatChapterFocusBlock,
  normalizeFocusChapterNumber,
} from '../services/agent/continue-chapter'
import { takeAgentComposerHint } from '../services/agent/agent-composer-bridge'
import {
  buildCharacterChatSystemMessages,
  characterModeReceiptTitles,
  listCharacterModeSharedEntries,
} from '../services/agent/direct-chat-character'
import { listWorldbookEntries } from '../services/worldbook-service'
import {
  answersFromRecommendation,
  buildCardFromAnswers,
  buildRecruitWorldbookSaveRequest,
  parseRecruitCharacterCard,
  parseRecruitRecommendations,
  type RecruitRecommendation,
} from '../services/agent/recruit-character'
import { getBuiltinPromptTemplate } from '../services/builtin-prompt-templates'
import { renderPrompt, resolvePromptTemplate } from '../services/prompt-templates'
import { saveWorldbookEntry } from '../services/worldbook-service'
import { toast } from '../components/ui/Toast'
import {
  formatRecruitAnswersForPrompt,
  type RecruitAnswer,
  type RecruitAnswers,
} from '../shared/recruit-questionnaire'
import { getSavedRecruitQuestionnaire } from './recruit-questionnaire-store'
import {
  clearAgentChat,
  deleteAgentConversation,
  loadAgentChat,
  setActiveAgentConversation,
  upsertAgentConversation,
} from '../services/agent-chat-service'
import type { MainGenerationRunHandle } from '../services/generation/generation-runtime'
import {
  buildAgentContextReceipt,
  type AgentChatMode,
  type AgentContextReceipt,
  type PersistedAgentConversation,
  type PersistedAgentMessage,
} from '../shared/agent-chat'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import { projectSessionContextFromProject } from '../shared/project-session-context'
import { resolveWritingLanguage, writingLanguageText } from '../shared/writing-language'
import { useLocaleStore } from './locale-store'
import { useLLMStore } from './llm-store'
import { useProjectStore } from './project-store'
import type { Locale } from '../i18n/types'

export const AGENT_GENERATION_BUDGET = Object.freeze({
  maxAttempts: 8,
  maxRequestedOutputTokens: 65_536,
  maxRequestedOutputTokensPerAttempt: 8192,
  deadlineMs: 20 * 60_000,
})

// ===== 类型定义 =====

/** 直连对话调试：本轮实际发给模型的载荷（仅展示，不改语义） */
export interface AgentRequestDebug {
  at: number
  modelId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  meta: {
    purpose: string
    reasoningStage: string
    creativeStrategy?: string
    historyCount: number
    worldbookCount?: number
    chatMode?: AgentChatMode
  }
}

/** 单条消息 */
export interface AgentMessage {
  /** Exact durable Agent navigation; no renderer-owned candidate mirror. */
  mainGenerationHandle?: MainGenerationRunHandle
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  /** 是否正在流式生成中 */
  streaming?: boolean
  /** Tool 调用信息（Agent 回复时） */
  toolCalls?: ToolCallInfo[]
  /** 产物列表（Agent 创建/修改的文件、触发的工作流等） */
  artifacts?: ToolArtifact[]
  /** 本轮请求上下文（调试用） */
  requestDebug?: AgentRequestDebug
  /** 本轮实际注入的世界书/前文回执（轻量，可落盘） */
  contextReceipt?: AgentContextReceipt
}

/** 单个会话 */
export interface AgentConversation {
  id: string
  /** 会话标题（取自第一条用户消息前 20 个字符） */
  title: string
  messages: AgentMessage[]
  createdAt: number
  updatedAt: number
  /** 当前会话使用的模型 ID（null 表示使用默认） */
  modelId: string | null
  /** 作者助手 / 扮演人物；缺省 author */
  chatMode: AgentChatMode
  /** 角色模式下选中的世界书人物条目 id */
  characterEntryId: string | null
  /** 续写/对话焦点章号 */
  focusChapterNumber: number
}

// ===== Store 状态接口 =====

interface AgentState {
  /** 所有会话列表（最新的排在前面） */
  conversations: AgentConversation[]
  /** 当前活跃会话 ID */
  activeConversationId: string | null
  /** 是否显示历史面板 */
  showHistory: boolean
  /** 当前是否正在生成（用于 UI 状态） */
  generating: boolean
  /** 当前流式请求 ID（用于取消） */
  activeRequestId: string | null
  /** Tool 系统是否已初始化 */
  toolsInitialized: boolean
  /** 酒馆招新：表单进行中（答卷不进主会话） */
  recruitActive: boolean
  /** 酒馆招新答卷 */
  recruitAnswers: RecruitAnswers
  /** 推荐三人结果 */
  recruitRecommendations: RecruitRecommendation[]
  /** 招新 AI 进行中（确定/推荐） */
  recruitBusy: boolean
  /** 分配作业进度（串行给人物写私有认知） */
  assignHomework: AssignHomeworkProgress

  // ===== 计算属性（Getters） =====
  /** 获取当前活跃会话 */
  getActiveConversation: () => AgentConversation | null

  // ===== Actions =====
  /** 初始化 Tool 系统 */
  initializeTools: () => void
  /** 新建会话并激活 */
  createConversation: () => AgentConversation
  /** 激活指定会话 */
  selectConversation: (id: string) => void
  /** 删除指定会话 */
  deleteConversation: (id: string) => void
  /** 清空所有会话（可选同步清库） */
  clearAll: (options?: { persist?: boolean }) => void
  /** 从当前作品库加载对话 */
  hydrateFromProject: (session: ProjectSessionContext) => Promise<void>
  /** 切换历史面板 */
  toggleHistory: () => void
  /** 设置历史面板可见性 */
  setShowHistory: (show: boolean) => void
  /** 设置当前会话使用的模型 */
  setModelId: (modelId: string | null) => void
  /** 切换作者 / 角色模式（招新或作业进行中不可切） */
  setChatMode: (mode: AgentChatMode) => void
  /** 角色模式下选中的人物条目 */
  setCharacterEntryId: (entryId: string | null) => void
  /** 设置会话焦点章号（续写本章） */
  setFocusChapterNumber: (chapterNumber: number) => void
  /** 一键续写本章（取输入框半句指导后发送） */
  continueCurrentChapter: () => Promise<void>
  /** 删除单条消息（不连带其它消息） */
  deleteMessage: (messageId: string) => void
  /** 仅更新消息正文（不触发重新生成） */
  updateMessageContent: (messageId: string, content: string) => void
  /** 编辑用户消息并从此处重发：丢弃该条之后的消息，再生成新回复 */
  resendUserMessage: (messageId: string, content: string) => Promise<void>
  /** 发送消息（工作台直连流式对话）；editUserMessageId 时从此用户消息截断并重发 */
  sendMessage: (
    content: string,
    recoveryHandle?: MainGenerationRunHandle,
    options?: { editUserMessageId?: string },
  ) => Promise<void>
  /** 酒馆招新：打开表单（不调 AI） */
  startRecruit: () => void
  /** 酒馆招新：取消（你被炒了） */
  cancelRecruit: () => void
  /** 酒馆招新：清空答卷重来 */
  restartRecruit: () => void
  /** 更新某一题答案 */
  setRecruitAnswer: (questionId: string, answer: RecruitAnswer | null) => void
  /** 按本书推荐三人 */
  recommendRecruit: () => Promise<void>
  /** 选用推荐并预填表单 */
  applyRecruitRecommendation: (index: number) => void
  /** 酒馆招新：整理人物并写入世界书（确定招募） */
  finishRecruit: () => Promise<void>
  /** 分配作业：逐人把通用设定提炼进私有认知 */
  startAssignHomework: () => Promise<void>
  /** 取消后续人物的作业分配（已写入的保留） */
  cancelAssignHomework: () => void
  /** Explicitly recover the original Agent turn, including its durable tool calls. */
  resumeGeneration: (handle: MainGenerationRunHandle) => Promise<void>
  /** 取消当前生成 */
  cancelGeneration: () => Promise<void>
  /** 响应 Tool 确认（用于 ConfirmCard；直连路径下不会触发） */
  resolveToolConfirmation: (
    toolCallId: string,
    confirmed: boolean,
    options?: { blueprintProposals?: readonly ConfigImpactBlueprintProposal[] },
  ) => void
}

// ===== 工具函数 =====

/** 生成唯一 ID */
const genId = () => crypto.randomUUID()

/** 与输入框模型下拉一致：当前会话 modelId → 全局默认 */
function resolveChatModelId(get: () => AgentState): string | undefined {
  return get().getActiveConversation()?.modelId
    ?? useLLMStore.getState().defaultModelId
    ?? undefined
}

/** 招新确定/推荐：单次非展示流式生成，收集全文。 */
async function generateRecruitTextOnce(
  llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  modelId: string,
): Promise<string> {
  const requestId = genId()
  const abortController = new AbortController()
  activeAbortController = abortController
  activeStreamRequestId = null
  activeRequestUiLocale = useLocaleStore.getState().locale
  useAgentStore.setState({ generating: true, activeRequestId: requestId, recruitBusy: true })

  try {
    return await new Promise<string>((resolve, reject) => {
      void useLLMStore.getState().generateStream(
        llmMessages,
        {
          onChunk: () => undefined,
          onDone: (fullText) => resolve(fullText ?? ''),
          onError: () => reject(new Error('RECRUIT_GENERATE_FAILED')),
        },
        modelId,
        { purpose: 'generation', reasoningStage: 'planning' },
      ).then(streamId => {
        if (useAgentStore.getState().activeRequestId === requestId) {
          activeStreamRequestId = streamId
        }
      }).catch(reject)
    })
  } finally {
    if (activeAbortController === abortController) activeAbortController = null
    activeStreamRequestId = null
    activeRequestUiLocale = null
    useAgentStore.setState({ generating: false, activeRequestId: null, recruitBusy: false })
  }
}

/** 从消息内容生成会话标题 */
const generateTitle = (content: string): string => {
  const cleaned = content.replace(/\s+/g, ' ').trim()
  return cleaned.length > 24 ? cleaned.slice(0, 24) + '…' : cleaned
}

/** 生成 /help 命令的帮助文本 */
const generateHelpText = (locale: Locale): string => {
  const text = (zhCN: string, enUS: string) => locale === 'en-US' ? enUS : zhCN
  const commands = getAllSlashCommands(locale)
  const lines: string[] = [
    text('## 写作助手 — 帮助', '## Writing Assistant — Help'),
    '',
    text('### 可用命令', '### Available commands'),
    ...commands
      .filter(command => command.source === 'builtin_command')
      .map(command => `- \`/${command.name}\` — ${command.description}`),
    '',
    text('有任何创作问题，直接问我即可！', 'Ask me whenever you need help with your story.'),
  ]
  return lines.join('\n')
}

// ===== Tool 确认回调管理（保留 API；直连路径不再使用） =====
const pendingConfirmations = new Map<string, {
  resolve: (decision: boolean | ToolConfirmationDecision) => void
}>()

/** 当前活跃的 AbortController（用于取消直连流） */
let activeAbortController: AbortController | null = null
/** llm-store 流式 requestId，供 cancelGeneration 调用 */
let activeStreamRequestId: string | null = null
let activeRequestUiLocale: Locale | null = null
/** 已 hydrate 的项目会话键；未匹配时禁止落盘，避免写错库。 */
let hydratedSessionKey: string | null = null

function sessionKey(session: ProjectSessionContext): string {
  return `${session.projectId}\n${session.leaseId}\n${session.projectPath}`
}

function currentPersistSession(): ProjectSessionContext | null {
  const session = projectSessionContextFromProject(useProjectStore.getState().currentProject)
  if (!session || hydratedSessionKey !== sessionKey(session)) return null
  return session
}

function toPersistedConversation(conversation: AgentConversation): PersistedAgentConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    modelId: conversation.modelId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    chatMode: conversation.chatMode === 'character' ? 'character' : 'author',
    characterEntryId: conversation.characterEntryId ?? null,
    focusChapterNumber: normalizeFocusChapterNumber(conversation.focusChapterNumber),
    messages: conversation.messages
      .filter(message => !message.streaming)
      .map((message): PersistedAgentMessage => {
        const next: PersistedAgentMessage = {
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        }
        if (message.toolCalls) next.toolCalls = message.toolCalls
        if (message.artifacts) next.artifacts = message.artifacts
        if (message.contextReceipt) next.contextReceipt = message.contextReceipt
        return next
      }),
  }
}

function fromPersistedConversation(conversation: PersistedAgentConversation): AgentConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    modelId: conversation.modelId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    chatMode: conversation.chatMode === 'character' ? 'character' : 'author',
    characterEntryId: conversation.characterEntryId ?? null,
    focusChapterNumber: normalizeFocusChapterNumber(conversation.focusChapterNumber),
    messages: conversation.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(message.toolCalls ? { toolCalls: message.toolCalls as AgentMessage['toolCalls'] } : {}),
      ...(message.artifacts ? { artifacts: message.artifacts as AgentMessage['artifacts'] } : {}),
      ...(message.contextReceipt ? { contextReceipt: message.contextReceipt } : {}),
    })),
  }
}

async function persistConversationById(id: string): Promise<void> {
  const session = currentPersistSession()
  if (!session) return
  const conversation = useAgentStore.getState().conversations.find(item => item.id === id)
  if (!conversation) return
  try {
    await upsertAgentConversation(session, toPersistedConversation(conversation))
  } catch (error) {
    console.warn('[Agent] 对话落盘失败:', error)
  }
}

async function persistActiveMeta(): Promise<void> {
  const session = currentPersistSession()
  if (!session) return
  try {
    await setActiveAgentConversation(session, useAgentStore.getState().activeConversationId)
  } catch (error) {
    console.warn('[Agent] 活跃对话落盘失败:', error)
  }
}

// ===== Zustand Store =====

export const useAgentStore = create<AgentState>()((set, get) => ({
  conversations: [],
  activeConversationId: null,
  showHistory: false,
  generating: false,
  activeRequestId: null,
  toolsInitialized: false,
  recruitActive: false,
  recruitAnswers: {},
  recruitRecommendations: [],
  recruitBusy: false,
  assignHomework: {
    active: false,
    index: 0,
    total: 0,
    currentTitle: '',
    cancelled: false,
    phase: 'idle',
  },

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get()
    return conversations.find(c => c.id === activeConversationId) ?? null
  },

  initializeTools: () => {
    if (get().toolsInitialized) return
    registerBuiltinTools()
    skillRegistry.loadAll().catch(e => console.warn('[Agent] Skill 加载失败:', e))
    set({ toolsInitialized: true })
  },

  createConversation: () => {
    const newConv: AgentConversation = {
      id: genId(),
      title: useLocaleStore.getState().locale === 'en-US' ? 'New conversation' : '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelId: useLLMStore.getState().defaultModelId,
      chatMode: 'author',
      characterEntryId: null,
      focusChapterNumber: 1,
    }
    set(state => ({
      conversations: [newConv, ...state.conversations],
      activeConversationId: newConv.id,
      showHistory: false,
    }))
    void persistConversationById(newConv.id).then(() => persistActiveMeta())
    return newConv
  },

  selectConversation: (id) => {
    set({ activeConversationId: id, showHistory: false })
    void persistActiveMeta()
  },

  setChatMode: (mode) => {
    const state = get()
    if (state.recruitActive || state.assignHomework.active || state.recruitBusy) return
    let conv = state.getActiveConversation()
    if (!conv) conv = get().createConversation()
    const chatMode = mode === 'character' ? 'character' : 'author'
    const convId = conv.id
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id === convId
          ? { ...c, chatMode, updatedAt: Date.now() }
          : c
      ),
    }))
    void persistConversationById(convId)
  },

  setCharacterEntryId: (entryId) => {
    let conv = get().getActiveConversation()
    if (!conv) conv = get().createConversation()
    const convId = conv.id
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id === convId
          ? { ...c, characterEntryId: entryId, updatedAt: Date.now() }
          : c
      ),
    }))
    void persistConversationById(convId)
  },

  setFocusChapterNumber: (chapterNumber) => {
    let conv = get().getActiveConversation()
    if (!conv) conv = get().createConversation()
    const convId = conv.id
    const focusChapterNumber = normalizeFocusChapterNumber(chapterNumber)
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id === convId
          ? { ...c, focusChapterNumber, updatedAt: Date.now() }
          : c
      ),
    }))
    void persistConversationById(convId)
  },

  continueCurrentChapter: async () => {
    const state = get()
    if (state.generating || state.recruitActive || state.recruitBusy || state.assignHomework.active) return
    let conv = state.getActiveConversation()
    if (!conv) conv = get().createConversation()
    if (conv.chatMode === 'character') return
    const n = normalizeFocusChapterNumber(conv.focusChapterNumber)
    const hint = takeAgentComposerHint()
    await get().sendMessage(buildContinueChapterUserMessage(n, hint))
  },

  deleteConversation: (id) => {
    set(state => {
      const filtered = state.conversations.filter(c => c.id !== id)
      const nextId = state.activeConversationId === id
        ? (filtered[0]?.id ?? null)
        : state.activeConversationId
      return { conversations: filtered, activeConversationId: nextId }
    })
    const session = currentPersistSession()
    if (session) {
      void deleteAgentConversation(session, id)
        .then(() => persistActiveMeta())
        .catch(error => console.warn('[Agent] 删除对话落盘失败:', error))
    }
  },

  clearAll: (options) => {
    set({
      conversations: [],
      activeConversationId: null,
      showHistory: false,
      generating: false,
      activeRequestId: null,
      recruitActive: false,
      recruitAnswers: {},
      recruitRecommendations: [],
      recruitBusy: false,
      assignHomework: {
        active: false,
        index: 0,
        total: 0,
        currentTitle: '',
        cancelled: false,
        phase: 'idle',
      },
    })
    if (options?.persist === false) {
      hydratedSessionKey = null
      return
    }
    const session = currentPersistSession()
    if (session) {
      void clearAgentChat(session).catch(error => console.warn('[Agent] 清空对话落盘失败:', error))
    }
  },

  hydrateFromProject: async (session) => {
    const key = sessionKey(session)
    hydratedSessionKey = null
    set({
      conversations: [],
      activeConversationId: null,
      showHistory: false,
      generating: false,
      activeRequestId: null,
      recruitActive: false,
      recruitAnswers: {},
      recruitRecommendations: [],
      recruitBusy: false,
      assignHomework: {
        active: false,
        index: 0,
        total: 0,
        currentTitle: '',
        cancelled: false,
        phase: 'idle',
      },
    })
    try {
      const loaded = await loadAgentChat(session)
      const project = useProjectStore.getState().currentProject
      const current = projectSessionContextFromProject(project)
      if (!current || sessionKey(current) !== key) return
      hydratedSessionKey = key
      set({
        conversations: loaded.conversations.map(fromPersistedConversation),
        activeConversationId: loaded.activeConversationId,
      })
    } catch (error) {
      console.warn('[Agent] 对话加载失败:', error)
      const project = useProjectStore.getState().currentProject
      const current = projectSessionContextFromProject(project)
      if (current && sessionKey(current) === key) hydratedSessionKey = key
    }
  },

  toggleHistory: () => {
    set(state => ({ showHistory: !state.showHistory }))
  },

  setShowHistory: (show) => {
    set({ showHistory: show })
  },

  setModelId: (modelId) => {
    let conv = get().getActiveConversation()
    if (!conv) conv = get().createConversation()
    const convId = conv.id
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === convId ? { ...c, modelId, updatedAt: Date.now() } : c
      ),
    }))
    void persistConversationById(convId)
  },

  deleteMessage: (messageId) => {
    const conv = get().getActiveConversation()
    if (!conv || get().generating) return
    const nextMessages = conv.messages.filter(message => message.id !== messageId)
    if (nextMessages.length === conv.messages.length) return
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === conv.id
          ? { ...c, messages: nextMessages, updatedAt: Date.now() }
          : c
      ),
    }))
    void persistConversationById(conv.id)
  },

  updateMessageContent: (messageId, content) => {
    const conv = get().getActiveConversation()
    if (!conv || get().generating) return
    const next = content.trim()
    if (!next) return
    const target = conv.messages.find(message => message.id === messageId)
    if (!target || target.streaming) return
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === conv.id
          ? {
              ...c,
              title: c.messages[0]?.id === messageId ? generateTitle(next) : c.title,
              messages: c.messages.map(message =>
                message.id === messageId
                  ? { ...message, content: next, requestDebug: undefined }
                  : message
              ),
              updatedAt: Date.now(),
            }
          : c
      ),
    }))
    void persistConversationById(conv.id)
  },

  resendUserMessage: async (messageId, content) => {
    await get().sendMessage(content, undefined, { editUserMessageId: messageId })
  },

  startRecruit: () => {
    if (get().generating || get().recruitBusy || get().assignHomework.active) return
    if (get().recruitActive) return
    if (!get().getActiveConversation()) get().createConversation()
    set({
      recruitActive: true,
      recruitAnswers: {},
      recruitRecommendations: [],
      showHistory: false,
    })
  },

  cancelAssignHomework: () => {
    set(state => ({
      assignHomework: state.assignHomework.active
        ? { ...state.assignHomework, cancelled: true }
        : state.assignHomework,
    }))
  },

  startAssignHomework: async () => {
    const text = useLocaleStore.getState().text
    if (get().recruitActive || get().generating || get().recruitBusy || get().assignHomework.active) return
    const project = useProjectStore.getState().currentProject
    const session = projectSessionContextFromProject(project)
    if (!session) {
      toast.error(text('请先打开作品', '请先打开作品'))
      return
    }
    const modelId = useLLMStore.getState().defaultModelId
      ?? get().getActiveConversation()?.modelId
      ?? null
    if (!modelId) {
      toast.error(text('先在设置里配置生成模型', '先在设置里配置生成模型'))
      return
    }

    set({
      assignHomework: {
        active: true,
        index: 0,
        total: 1,
        currentTitle: text('正在准备人物…', '正在准备人物…'),
        cancelled: false,
        phase: 'preparing',
      },
    })

    let characters
    let sharedCorpus: string
    try {
      const loaded = await loadHomeworkInputs(session)
      sharedCorpus = loaded.sharedCorpus
      characters = loaded.characters
      if (characters.length === 0) {
        if (get().assignHomework.cancelled) {
          set({
            assignHomework: {
              active: false, index: 0, total: 0, currentTitle: '', cancelled: false, phase: 'idle',
            },
          })
          return
        }
        set(state => ({
          assignHomework: {
            ...state.assignHomework,
            currentTitle: text('正在识别并创建人物…', '正在识别并创建人物…'),
            phase: 'preparing',
          },
        }))
        const config = project?.novelConfig
        const extraHints = [
          config?.protagonistProfile && `主角设定：\n${config.protagonistProfile}`,
          config?.coreOutline && `核心大纲：\n${config.coreOutline}`,
          config?.worldSetting && `世界观：\n${config.worldSetting}`,
          config?.synopsis && `情节大纲：\n${config.synopsis}`,
          config?.premise && `故事前提：\n${config.premise}`,
        ].filter(Boolean).join('\n\n')
        const ensured = await ensureHomeworkCharacters({
          session,
          sharedCorpus,
          sources: loaded.sources,
          extraHints,
          generate: async messages => useLLMStore.getState().generate(messages, modelId, {
            purpose: 'worldbook-homework-discover',
            projectSession: session,
            reasoningStage: 'planning',
            responseFormat: { type: 'json_object' },
          }),
        })
        characters = ensured.characters
        if (ensured.importedCount > 0 || ensured.createdCount > 0) {
          toast.info(text(
            `已准备 ${ensured.importedCount + ensured.createdCount} 名人物（导入 ${ensured.importedCount} / 新建 ${ensured.createdCount}）`,
            `已准备 ${ensured.importedCount + ensured.createdCount} 名人物（导入 ${ensured.importedCount} / 新建 ${ensured.createdCount}）`,
          ))
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      set({
        assignHomework: {
          active: false, index: 0, total: 0, currentTitle: '', cancelled: false, phase: 'idle',
        },
      })
      return
    }

    if (characters.length === 0) {
      toast.error(text(
        '没找到可分配的人物。请先在设定页填写主角/人物，或去酒馆招新后再试。',
        '没找到可分配的人物。请先在设定页填写主角/人物，或去酒馆招新后再试。',
      ))
      set({
        assignHomework: {
          active: false, index: 0, total: 0, currentTitle: '', cancelled: false, phase: 'idle',
        },
      })
      return
    }

    if (get().assignHomework.cancelled) {
      set({
        assignHomework: {
          active: false, index: 0, total: 0, currentTitle: '', cancelled: false, phase: 'idle',
        },
      })
      return
    }

    set({
      assignHomework: {
        active: true,
        index: 0,
        total: characters.length,
        currentTitle: characters[0]?.title ?? '',
        cancelled: false,
        phase: 'learning',
      },
    })

    let completed = 0
    try {
      for (let index = 0; index < characters.length; index += 1) {
        if (get().assignHomework.cancelled) break
        const character = characters[index]
        set({
          assignHomework: {
            active: true,
            index,
            total: characters.length,
            currentTitle: character.title,
            cancelled: false,
            phase: 'learning',
          },
        })
        const messages = buildHomeworkPrompt({
          characterTitle: character.title,
          publicPersona: character.content,
          sharedCorpus,
        })
        const response = await useLLMStore.getState().generate(messages, modelId, {
          purpose: 'worldbook-homework',
          projectSession: session,
          reasoningStage: 'planning',
        })
        if (get().assignHomework.cancelled) break
        const privateContent = response.content.trim()
        if (!privateContent) {
          toast.error(text(`「${character.title}」没有写出内容，已跳过`, `「${character.title}」没有写出内容，已跳过`))
          continue
        }
        await saveCharacterPrivateHomework(session, character, privateContent)
        completed += 1
      }
      if (get().assignHomework.cancelled) {
        toast.info(text(
          `已中止；完成 ${completed}/${characters.length} 人`,
          `已中止；完成 ${completed}/${characters.length} 人`,
        ))
      } else {
        toast.success(text('作业分配完成', '作业分配完成'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      set({
        assignHomework: {
          active: false,
          index: 0,
          total: 0,
          currentTitle: '',
          cancelled: false,
          phase: 'idle',
        },
      })
    }
  },

  cancelRecruit: () => {
    if (get().generating || get().recruitBusy) {
      void get().cancelGeneration()
    }
    set({
      recruitActive: false,
      recruitAnswers: {},
      recruitRecommendations: [],
      recruitBusy: false,
    })
  },

  restartRecruit: () => {
    if (get().generating || get().recruitBusy) return
    set({
      recruitActive: true,
      recruitAnswers: {},
      recruitRecommendations: [],
    })
  },

  setRecruitAnswer: (questionId, answer) => {
    if (!get().recruitActive) return
    set(state => {
      const next = { ...state.recruitAnswers }
      if (answer == null) delete next[questionId]
      else next[questionId] = answer
      return { recruitAnswers: next }
    })
  },

  applyRecruitRecommendation: (index) => {
    const recommendation = get().recruitRecommendations[index]
    if (!recommendation) return
    const questions = getSavedRecruitQuestionnaire().questions
    set({
      recruitAnswers: answersFromRecommendation(questions, recommendation),
    })
  },

  recommendRecruit: async () => {
    if (!get().recruitActive || get().generating || get().recruitBusy) return
    const locale = useLocaleStore.getState().locale
    const text = (zh: string, en: string) => (locale === 'en-US' ? en : zh)
    const modelId = resolveChatModelId(get)
    if (!modelId) {
      toast.error(text('请先在输入框上方选择模型。', '请先在输入框上方选择模型。'))
      return
    }
    const project = useProjectStore.getState().currentProject
    const projectSession = projectSessionContextFromProject(project)
    if (!projectSession) {
      toast.error(text('请先打开作品。', '请先打开作品。'))
      return
    }
    const writingLanguage = resolveWritingLanguage(project?.novelConfig.writingLanguage)
    try {
      const recommendTemplate = await resolvePromptTemplate('recruit_recommend', projectSession, writingLanguage)
        ?? getBuiltinPromptTemplate('recruit_recommend', writingLanguage)
      if (!recommendTemplate) throw new Error('RECRUIT_RECOMMEND_TEMPLATE_MISSING')
      const worldbook = await loadDirectChatWorldbook({
        projectSession,
        userText: '人物 角色 配角 关系',
      })
      const context = worldbook?.block
        ?? text('（暂无世界书命中，请根据一般网文配角需求推荐）', '（暂无世界书命中，请根据一般网文配角需求推荐）')
      const userContent = renderPrompt(recommendTemplate, { context }, writingLanguage)
      const llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        {
          role: 'system',
          content: recommendTemplate.systemRole
            ?? text('你是小说人物设定助手。', '你是小说人物设定助手。'),
        },
        { role: 'user', content: userContent },
      ]
      const raw = await generateRecruitTextOnce(llmMessages, modelId)
      const list = parseRecruitRecommendations(raw)
      if (list.length === 0) {
        toast.error(text('没能解析出推荐人选，请重试。', '没能解析出推荐人选，请重试。'))
        return
      }
      set({ recruitRecommendations: list })
      toast.success(text(`已推荐 ${list.length} 人，点选可预填表单`, `已推荐 ${list.length} 人，点选可预填表单`))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      toast.error(text(`推荐失败：${reason}`, `推荐失败：${reason}`))
      set({ recruitBusy: false, generating: false, activeRequestId: null })
    }
  },

  finishRecruit: async () => {
    if (!get().recruitActive || get().generating || get().recruitBusy) return
    const locale = useLocaleStore.getState().locale
    const text = (zh: string, en: string) => (locale === 'en-US' ? en : zh)
    const questions = getSavedRecruitQuestionnaire().questions
    const answers = get().recruitAnswers
    const fallback = buildCardFromAnswers(questions, answers)

    const modelId = resolveChatModelId(get)
    if (!modelId) {
      toast.error(text('请先在输入框上方选择模型。', '请先在输入框上方选择模型。'))
      return
    }
    const project = useProjectStore.getState().currentProject
    const projectSession = projectSessionContextFromProject(project)
    if (!projectSession) {
      toast.error(text('请先打开作品。', '请先打开作品。'))
      return
    }
    const writingLanguage = resolveWritingLanguage(project?.novelConfig.writingLanguage)

    try {
      const finalizeTemplate = await resolvePromptTemplate('recruit_finalize', projectSession, writingLanguage)
        ?? getBuiltinPromptTemplate('recruit_finalize', writingLanguage)
      if (!finalizeTemplate) throw new Error('RECRUIT_FINALIZE_TEMPLATE_MISSING')
      const answersText = formatRecruitAnswersForPrompt(questions, answers)
      const userContent = renderPrompt(finalizeTemplate, { answers: answersText }, writingLanguage)
      const llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        {
          role: 'system',
          content: finalizeTemplate.systemRole
            ?? text('你是小说人物设定助手。', '你是小说人物设定助手。'),
        },
        { role: 'user', content: userContent },
      ]
      const raw = await generateRecruitTextOnce(llmMessages, modelId)
      const card = parseRecruitCharacterCard(raw, fallback.name) ?? fallback
      await saveWorldbookEntry(projectSession, buildRecruitWorldbookSaveRequest(card))
      toast.success(text(`已招募「${card.name}」进世界书`, `已招募「${card.name}」进世界书`))
      set({
        recruitActive: false,
        recruitAnswers: {},
        recruitRecommendations: [],
        recruitBusy: false,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      toast.error(text(`写入世界书失败：${reason}`, `写入世界书失败：${reason}`))
      set({ recruitBusy: false, generating: false, activeRequestId: null })
    }
  },

  sendMessage: async (content, recoveryHandle, options) => {
    // 直连对话不再恢复 Agent Generation 托管轮次
    if (recoveryHandle) return
    if (!content.trim() || get().generating) return
    // 招新表单期间禁止往主会话/招新闲聊发消息
    if (get().recruitActive) return

    const editUserMessageId = options?.editUserMessageId
    let requestLocale = useLocaleStore.getState().locale
    const text = (zhCNText: string, enUSText: string) => requestLocale === 'en-US' ? enUSText : zhCNText

    let skillInvocation: { skill: LoadedSkill; input: string } | null = null
    let messageContent = content

    // ===== / 命令拦截（重发编辑中的用户消息时不当命令处理） =====
    const trimmedContent = content.trim()
    if (!editUserMessageId && trimmedContent.startsWith('/')) {
      // Skill 命令可能需要已加载的 Skill 列表
      if (!get().toolsInitialized) get().initializeTools()
      const { command, args } = parseSlashCommand(trimmedContent, requestLocale)
      if (command) {
        switch (command.name) {
          case 'clear': {
            const activeConv = get().getActiveConversation()
            if (activeConv) {
              set(state => ({
                conversations: state.conversations.map(c =>
                  c.id === activeConv.id ? { ...c, messages: [], updatedAt: Date.now() } : c
                ),
              }))
              void persistConversationById(activeConv.id)
            }
            return
          }
          case 'new':
            get().createConversation()
            return
          case 'help': {
            const helpConv = get().getActiveConversation() ?? get().createConversation()
            const helpMsg: AgentMessage = {
              id: genId(), role: 'assistant', content: generateHelpText(requestLocale), createdAt: Date.now(),
            }
            set(state => ({
              conversations: state.conversations.map(c =>
                c.id === helpConv.id
                  ? { ...c, messages: [...c.messages, helpMsg], updatedAt: Date.now() }
                  : c
              ),
            }))
            void persistConversationById(helpConv.id).then(() => persistActiveMeta())
            return
          }
          default:
            if (command.source === 'skill' && command.skill) {
              skillInvocation = { skill: command.skill, input: args }
            }
            break
        }
      }
    }

    let conv = get().getActiveConversation()
    if (!conv) {
      if (editUserMessageId) return
      conv = get().createConversation()
    }
    const convId = conv.id
    const modelId = conv.modelId ?? useLLMStore.getState().defaultModelId ?? undefined
    const writingLanguage = useProjectStore.getState().currentProject?.novelConfig.writingLanguage ?? 'zh-CN'
    const modelText = (zhCNText: string, enUSText: string) => writingLanguageText(
      writingLanguage,
      zhCNText,
      enUSText,
    )

    if (skillInvocation) {
      const skill = skillInvocation.skill
      const displayName = writingLanguage === 'en-US'
        ? (skill.writingSkill.metadata.displayName ?? skill.metadata.name)
        : (skill.metadata.displayName ?? skill.metadata.name)
      let skillContent = skill.localizedContent?.[writingLanguage] ?? skill.content
      if (skillInvocation.input) {
        skillContent = skillContent
          .replace(/\$\{args\}/g, skillInvocation.input)
          .replace(/\$1/g, skillInvocation.input)
      }
      messageContent = `${modelText('[用户使用了 Skill:', '[The user invoked Skill:')} ${displayName}]\n\n${modelText('用户输入:', 'User input:')} ${skillInvocation.input || modelText('(无额外参数)', '(no additional arguments)')}\n\n---\n\n${skillContent}`
    }

    const assistantMsg: AgentMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streaming: true,
    }

    let userMsg: AgentMessage
    let nextMessages: AgentMessage[]
    let newTitle = conv.title

    if (editUserMessageId) {
      const editIndex = conv.messages.findIndex(message => message.id === editUserMessageId)
      const existing = editIndex >= 0 ? conv.messages[editIndex] : undefined
      if (!existing || existing.role !== 'user' || existing.streaming) return
      userMsg = {
        ...existing,
        content: messageContent.trim(),
      }
      nextMessages = [...conv.messages.slice(0, editIndex), userMsg, assistantMsg]
      if (editIndex === 0) newTitle = generateTitle(content)
    } else {
      userMsg = {
        id: genId(),
        role: 'user',
        content: messageContent.trim(),
        createdAt: Date.now(),
      }
      const isFirstMsg = conv.messages.length === 0
      newTitle = isFirstMsg ? generateTitle(content) : conv.title
      nextMessages = [...conv.messages, userMsg, assistantMsg]
    }

    set(state => ({
      generating: true,
      conversations: state.conversations.map(c =>
        c.id === convId
          ? {
              ...c,
              title: newTitle,
              messages: nextMessages,
              updatedAt: Date.now(),
            }
          : c
      ),
    }))
    activeRequestUiLocale = requestLocale
    const abortController = new AbortController()
    activeAbortController = abortController
    activeStreamRequestId = null
    set({ activeRequestId: assistantMsg.id, activeConversationId: convId })

    const updateAssistantMsg = (updater: (msg: AgentMessage) => AgentMessage) => {
      if (get().activeRequestId !== assistantMsg.id) return
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === assistantMsg.id ? updater(m) : m
                ),
              }
            : c
        ),
      }))
    }

    const finishIdle = () => {
      if (get().activeRequestId !== assistantMsg.id) return
      activeAbortController = null
      activeStreamRequestId = null
      activeRequestUiLocale = null
      set({ generating: false, activeRequestId: null })
    }

    try {
      if (!modelId) {
        updateAssistantMsg(m => ({
          ...m,
          content: text('请先在设置中配置模型。', 'Configure a model in settings first.'),
          streaming: false,
        }))
        finishIdle()
        void persistConversationById(convId).then(() => persistActiveMeta())
        return
      }

      const currentConv = get().conversations.find(c => c.id === convId)!
      const historyMessages = currentConv.messages
        .filter(m => !m.streaming && m.role !== 'system' && m.id !== userMsg.id && m.id !== assistantMsg.id)
        .slice(-16)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      const project = useProjectStore.getState().currentProject
      const writingLanguage = resolveWritingLanguage(project?.novelConfig.writingLanguage)
      const projectSession = projectSessionContextFromProject(project) ?? undefined
      const chatMode = currentConv.chatMode === 'character' ? 'character' : 'author'

      let llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
      let contextReceipt: AgentContextReceipt | undefined
      let worldbookCount: number | undefined

      if (chatMode === 'character') {
        const entryId = currentConv.characterEntryId?.trim()
        if (!entryId) {
          updateAssistantMsg(m => ({
            ...m,
            content: text('先选要扮的角色。', '先选要扮的角色。'),
            streaming: false,
          }))
          finishIdle()
          void persistConversationById(convId).then(() => persistActiveMeta())
          return
        }
        if (!projectSession) {
          updateAssistantMsg(m => ({
            ...m,
            content: text('请先打开作品。', '请先打开作品。'),
            streaming: false,
          }))
          finishIdle()
          void persistConversationById(convId).then(() => persistActiveMeta())
          return
        }
        const entries = await listWorldbookEntries(projectSession)
        const entry = entries.find(item => item.id === entryId && item.kind === 'character')
        if (!entry) {
          updateAssistantMsg(m => ({
            ...m,
            content: text('所选角色已不存在，请重新选择。', '所选角色已不存在，请重新选择。'),
            streaming: false,
          }))
          finishIdle()
          void persistConversationById(convId).then(() => persistActiveMeta())
          return
        }
        const sharedEntries = listCharacterModeSharedEntries(entries)
        const systemParts = buildCharacterChatSystemMessages({
          entry,
          sharedEntries,
          writingLanguage,
        })
        llmMessages = [
          ...systemParts,
          ...historyMessages,
          { role: 'user', content: userMsg.content },
        ]
        worldbookCount = 1 + sharedEntries.length
        contextReceipt = buildAgentContextReceipt({
          worldbookTitles: characterModeReceiptTitles(entry, sharedEntries),
          continuityChapters: [],
        })
      } else {
        const systemPrompt = await buildDirectChatSystemPrompt({
          writingLanguage,
          projectSession,
        })
        const focusChapterNumber = normalizeFocusChapterNumber(currentConv.focusChapterNumber)
        const chapterFocus = formatChapterFocusBlock(focusChapterNumber)
        const worldbook = await loadDirectChatWorldbook({
          projectSession,
          userText: userMsg.content,
          chapterNumber: focusChapterNumber,
        })
        const worldbookTitles = [
          `第 ${focusChapterNumber} 章`,
          ...(worldbook?.result.selections.map(item => item.title.trim() || item.entryId) ?? []),
        ]
        llmMessages = [
          { role: 'system', content: systemPrompt },
          { role: 'system', content: chapterFocus },
          ...(worldbook ? [{ role: 'system' as const, content: worldbook.block }] : []),
          ...historyMessages,
          { role: 'user', content: userMsg.content },
        ]
        if (worldbook) worldbookCount = worldbook.result.selections.length
        contextReceipt = buildAgentContextReceipt({
          worldbookTitles,
          continuityChapters: [],
        })
      }

      const purpose = 'generation'
      const reasoningStage = 'drafting'
      const creativeStrategy = useProjectStore.getState().currentProject?.novelConfig.creativeStrategy
      const requestDebug: AgentRequestDebug = {
        at: Date.now(),
        modelId,
        messages: llmMessages.map(m => ({ ...m })),
        meta: {
          purpose,
          reasoningStage,
          ...(creativeStrategy ? { creativeStrategy } : {}),
          historyCount: historyMessages.length,
          ...(worldbookCount !== undefined ? { worldbookCount } : {}),
          chatMode,
        },
      }
      updateAssistantMsg(m => ({
        ...m,
        requestDebug,
        ...(contextReceipt ? { contextReceipt } : {}),
      }))

      if (abortController.signal.aborted) {
        finishIdle()
        return
      }

      const streamRequestId = await useLLMStore.getState().generateStream(
        llmMessages,
        {
          onChunk: (chunk) => {
            if (!chunk || abortController.signal.aborted) return
            updateAssistantMsg(m => ({
              ...m,
              content: m.content + chunk,
            }))
          },
          onDone: (fullText) => {
            if (get().activeRequestId !== assistantMsg.id) return
            updateAssistantMsg(m => ({
              ...m,
              content: fullText || m.content,
              streaming: false,
            }))
            set(state => ({
              generating: false,
              activeRequestId: null,
              conversations: state.conversations.map(c =>
                c.id === convId ? { ...c, updatedAt: Date.now() } : c
              ),
            }))
            activeAbortController = null
            activeStreamRequestId = null
            activeRequestUiLocale = null
            void persistConversationById(convId).then(() => persistActiveMeta())
          },
          onError: () => {
            if (get().activeRequestId !== assistantMsg.id) return
            updateAssistantMsg(m => ({
              ...m,
              content: m.content
                ? m.content + text('\n\n生成未完成。', '\n\nGeneration did not finish.')
                : text('生成失败，请重试。', 'Generation failed. Please try again.'),
              streaming: false,
            }))
            finishIdle()
            void persistConversationById(convId).then(() => persistActiveMeta())
          },
        },
        modelId,
        { purpose, reasoningStage },
      )

      if (get().activeRequestId === assistantMsg.id) {
        activeStreamRequestId = streamRequestId
      }

      if (abortController.signal.aborted && streamRequestId) {
        try {
          await useLLMStore.getState().cancelGeneration(streamRequestId)
        } catch {
          // ignore cancel races
        }
      }
    } catch {
      if (get().activeRequestId !== assistantMsg.id) return
      updateAssistantMsg(m => ({
        ...m,
        content: (m.content ? m.content + '\n\n' : '') + text('生成失败，请重试。', 'Generation failed. Please try again.'),
        streaming: false,
      }))
      finishIdle()
      void persistConversationById(convId).then(() => persistActiveMeta())
    } finally {
      if (activeAbortController === abortController) activeAbortController = null
    }
  },

  resumeGeneration: async () => {
    // 工作台已改为直连流式对话，不再恢复 Agent Generation 托管轮次
  },

  cancelGeneration: async () => {
    const cancelledUiLocale = activeRequestUiLocale ?? useLocaleStore.getState().locale
    const stoppedText = cancelledUiLocale === 'en-US'
      ? '\n\n_(Generation stopped)_'
      : '\n\n_（已停止生成）_'

    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
    }

    for (const [, pending] of pendingConfirmations) {
      pending.resolve(false)
    }
    pendingConfirmations.clear()

    const streamId = activeStreamRequestId
    activeStreamRequestId = null

    const activeId = get().activeConversationId
    set(state => ({
      generating: false,
      activeRequestId: null,
      conversations: state.conversations.map(c => ({
        ...c,
        updatedAt: Date.now(),
        messages: c.messages.map(m =>
          m.streaming ? { ...m, streaming: false, content: m.content + stoppedText } : m
        ),
      })),
      recruitBusy: false,
    }))
    activeRequestUiLocale = null
    if (activeId) void persistConversationById(activeId).then(() => persistActiveMeta())

    if (streamId) {
      try {
        await useLLMStore.getState().cancelGeneration(streamId)
      } catch {
        // ignore
      }
    }
  },

  resolveToolConfirmation: (toolCallId, confirmed, options) => {
    const pending = pendingConfirmations.get(toolCallId)
    if (pending) {
      pending.resolve(confirmed && options?.blueprintProposals?.length
        ? { confirmed: true, blueprintProposals: options.blueprintProposals }
        : confirmed)
      pendingConfirmations.delete(toolCallId)
    }
  },
}))
