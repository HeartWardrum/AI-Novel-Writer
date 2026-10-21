import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NSFW_CLOSE, NSFW_OPEN } from '../../../../shared/nsfw-soft-markers'
import { useProjectStore } from '../../../../stores/project-store'
import { useLLMStore } from '../../../../stores/llm-store'
import type { StepCallbacks, WorkflowContext } from '../../../../stores/workflow-store'
import { NsfwUnlockCommand as RuntimeNsfwUnlockCommand } from '../nsfw-unlock.command'
import { workflowRuntimeDependencies } from './workflow-generation-runtime.fixture'

class NsfwUnlockCommand extends RuntimeNsfwUnlockCommand {
  constructor(...args: ConstructorParameters<typeof RuntimeNsfwUnlockCommand>) {
    super(args[0], workflowRuntimeDependencies)
  }
}

const projectPath = 'C:\\novels\\nsfw-unlock'
const originalGenerateStream = useLLMStore.getState().generateStream
const originalDefaultModelId = useLLMStore.getState().defaultModelId
const callbacks: StepCallbacks = {
  log: vi.fn(),
  setProgress: vi.fn(),
  appendText: vi.fn(),
  replaceText: vi.fn(),
}

function makeContext(): WorkflowContext {
  return {
    runId: 'nsfw-run',
    projectPath,
    projectSession: { projectId: projectPath, leaseId: 'lease-nsfw', projectPath },
    generationModelId: 'model-b',
    writingLanguage: 'zh-CN',
    uiLocale: 'zh-CN',
    data: {},
    cancelled: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', {
    aiNovelAPI: {
      invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
        if (channel === 'db:draft-next-version') return 3
        if (channel === 'db:draft-create') {
          const params = args[0] as { content: string; version: number; source: string }
          expect(params.source).toBe('rewrite')
          expect(params.content).not.toContain(NSFW_OPEN)
          return { success: true, id: 99 }
        }
        if (channel === 'prompt:load-global') return { templates: [], diagnostics: [] }
        if (channel === 'fs:check-exists') return false
        return { success: true }
      }),
    },
  })
  useProjectStore.setState({
    currentProject: {
      id: projectPath,
      name: 'nsfw',
      path: projectPath,
      sessionLease: 'lease-nsfw',
      novelConfig: { genre: '都市' },
    } as never,
    refreshFileTree: vi.fn(async () => undefined),
  })
  useLLMStore.setState({
    defaultModelId: 'model-b',
    generateStream: vi.fn(async (_messages, streamCallbacks) => {
      streamCallbacks.onDone?.('硬写替换', undefined, 'stop')
      return 'nsfw-request'
    }),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useProjectStore.setState({ currentProject: null })
  useLLMStore.setState({
    generateStream: originalGenerateStream,
    defaultModelId: originalDefaultModelId,
  })
})

describe('NsfwUnlockCommand', () => {
  it('unlocks markers with fake LLM and saves rewrite draft', async () => {
    const soft = `前文。${NSFW_OPEN}软写亲密${NSFW_CLOSE}后文。`
    const cmd = new NsfwUnlockCommand({
      draftPath: 'ai-novel://draft/1',
      draftContent: soft,
      sourceDraft: {
        id: 1,
        chapterNumber: 2,
        version: 1,
        status: 'draft',
        contentRevision: 0,
      },
      chapterNumber: 2,
      chapterTitle: '雨夜',
      scaleNotes: '事件：两人做爱',
    })

    const result = await cmd.execute({ step: {}, context: makeContext(), callbacks })
    expect(result).toBe('前文。硬写替换后文。')
    expect(callbacks.replaceText).toHaveBeenCalledWith('前文。硬写替换后文。')
    const invoke = window.aiNovelAPI?.invoke as ReturnType<typeof vi.fn>
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:draft-create')).toBe(true)
  })

  it('fails friendly when draft has no markers', async () => {
    const cmd = new NsfwUnlockCommand({
      draftPath: 'ai-novel://draft/1',
      draftContent: '没有标记的正文',
      sourceDraft: {
        id: 1,
        chapterNumber: 2,
        version: 1,
        status: 'draft',
        contentRevision: 0,
      },
      chapterNumber: 2,
      chapterTitle: '雨夜',
    })
    await expect(cmd.execute({ step: {}, context: makeContext(), callbacks }))
      .rejects.toThrow(/没有可解锁|No NSFW markers/)
  })
})
