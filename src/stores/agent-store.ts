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
import { loadDirectChatContinuity } from '../services/agent/direct-chat-continuity'
import { buildDirectChatSystemPrompt } from '../services/agent/direct-chat-prompt'
import { loadDirectChatWorldbook } from '../services/agent/direct-chat-worldbook'
import {
  clearAgentChat,
  deleteAgentConversation,
  loadAgentChat,
  setActiveAgentConversation,
  upsertAgentConversation,
} from '../services/agent-chat-service'
import type { MainGenerationRunHandle } from '../services/generation/generation-runtime'
import type { PersistedAgentConversation, PersistedAgentMessage } from '../shared/agent-chat'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import { projectSessionContextFromProject } from '../shared/project-session-context'
import { resolveWritingLanguage, writingLanguageText } from '../shared/writing-language'
import { useEditorStore } from './editor-store'
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
  /** 发送消息（工作台直连流式对话） */
  sendMessage: (content: string, recoveryHandle?: MainGenerationRunHandle) => Promise<void>
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
    text('### 写进作品', '### Writing into the manuscript'),
    text(
      '对话只用于构思与讨论。要把助手正文写进作品，请用右栏的「写本章」。',
      '对话只用于构思与讨论。要把助手正文写进作品，请用右栏的「写本章」。',
    ),
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
    messages: conversation.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(message.toolCalls ? { toolCalls: message.toolCalls as AgentMessage['toolCalls'] } : {}),
      ...(message.artifacts ? { artifacts: message.artifacts as AgentMessage['artifacts'] } : {}),
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
      modelId: null,
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
    set({ conversations: [], activeConversationId: null, showHistory: false, generating: false, activeRequestId: null })
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
    const conv = get().getActiveConversation()
    if (!conv) return
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === conv.id ? { ...c, modelId, updatedAt: Date.now() } : c
      ),
    }))
    void persistConversationById(conv.id)
  },

  sendMessage: async (content, recoveryHandle) => {
    // 直连对话不再恢复 Agent Generation 托管轮次
    if (recoveryHandle) return
    if (!content.trim() || get().generating) return

    let requestLocale = useLocaleStore.getState().locale
    const text = (zhCNText: string, enUSText: string) => requestLocale === 'en-US' ? enUSText : zhCNText
    let skillInvocation: { skill: LoadedSkill; input: string } | null = null
    let messageContent = content

    // ===== / 命令拦截 =====
    const trimmedContent = content.trim()
    if (trimmedContent.startsWith('/')) {
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

    const userMsg: AgentMessage = {
      id: genId(),
      role: 'user',
      content: messageContent.trim(),
      createdAt: Date.now(),
    }

    const assistantMsg: AgentMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streaming: true,
    }

    const isFirstMsg = conv.messages.length === 0
    const newTitle = isFirstMsg ? generateTitle(content) : conv.title

    set(state => ({
      generating: true,
      conversations: state.conversations.map(c =>
        c.id === convId
          ? {
              ...c,
              title: newTitle,
              messages: [...c.messages, userMsg, assistantMsg],
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
      const systemPrompt = await buildDirectChatSystemPrompt({
        writingLanguage,
        projectSession,
      })
      const editor = useEditorStore.getState()
      const activeChapterNumber = editor.tabs.find(tab => tab.id === editor.activeTabId)?.chapterNumber
      const continuityBlock = await loadDirectChatContinuity({
        projectSession,
        chapterNumber: activeChapterNumber,
      })
      const worldbook = await loadDirectChatWorldbook({
        projectSession,
        userText: userMsg.content,
      })
      const llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...(continuityBlock ? [{ role: 'system' as const, content: continuityBlock }] : []),
        ...(worldbook ? [{ role: 'system' as const, content: worldbook.block }] : []),
        ...historyMessages,
        { role: 'user', content: userMsg.content },
      ]

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
          ...(worldbook ? { worldbookCount: worldbook.result.selections.length } : {}),
        },
      }
      updateAssistantMsg(m => ({ ...m, requestDebug }))

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
