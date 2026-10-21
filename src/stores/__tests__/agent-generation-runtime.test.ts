import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../agent-store'
import { useLLMStore } from '../llm-store'
import { useLocaleStore } from '../locale-store'

/**
 * 工作台 sendMessage 已改为 generateStream 直连。
 * Agent Generation 托管边界请见 services/agent/__tests__/agent-hosted-runtime.test.ts。
 */
describe('Agent GenerationRuntime boundary (workbench chat bypass)', () => {
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sendMessage uses generateStream and never attaches toolCalls', async () => {
    const generateStream = vi.fn(async (_messages, callbacks) => {
      callbacks.onDone?.('直连回复')
      return 'stream-bypass-1'
    })
    useLLMStore.setState({ generateStream })

    await useAgentStore.getState().sendMessage('检查项目')

    expect(generateStream).toHaveBeenCalledOnce()
    const last = useAgentStore.getState().getActiveConversation()?.messages.at(-1)
    expect(last?.content).toBe('直连回复')
    expect(last?.toolCalls).toBeUndefined()
    expect(last?.mainGenerationHandle).toBeUndefined()
  })

  it('resumeGeneration is a no-op after direct-chat migration', async () => {
    const generateStream = vi.fn()
    useLLMStore.setState({ generateStream })
    await useAgentStore.getState().resumeGeneration({
      rootActionId: 'agent-root',
      projectId: 'project-a',
      leaseId: 'lease-a',
    } as never)
    expect(generateStream).not.toHaveBeenCalled()
  })
})
