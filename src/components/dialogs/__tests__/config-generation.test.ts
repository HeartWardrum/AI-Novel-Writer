import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelProfile, ProjectSessionContext } from '../../../shared/ipc-channels'
import { useLLMStore } from '../../../stores/llm-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { startConfigGeneration } from '../config-generation'

vi.mock('../../ui/Toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const MODELS: ModelProfile[] = [
  {
    id: 'default-gen', name: 'Default', provider: 'custom', protocol: 'openai',
    modelName: 'default-gen', apiKey: 'k', baseUrl: 'https://models.example/v1',
    temperature: 0.7, maxTokens: 4096, purposes: ['generation'],
  },
  {
    id: 'picked-gen', name: 'Picked', provider: 'custom', protocol: 'openai',
    modelName: 'picked-gen', apiKey: 'k', baseUrl: 'https://models.example/v1',
    temperature: 0.7, maxTokens: 4096, purposes: ['generation'],
  },
]

const session: ProjectSessionContext = {
  projectId: 'cfg',
  leaseId: 'lease-cfg',
  projectPath: 'C:\\novels\\cfg',
}

const original = {
  llm: useLLMStore.getState(),
  project: useProjectStore.getState(),
  workflow: useWorkflowStore.getState(),
  locale: useLocaleStore.getState().locale,
}

afterEach(() => {
  useLLMStore.setState(original.llm, true)
  useProjectStore.setState(original.project, true)
  useWorkflowStore.setState(original.workflow, true)
  useLocaleStore.setState({ locale: original.locale })
  vi.restoreAllMocks()
})

describe('startConfigGeneration', () => {
  it('starts the config workflow with the selected generation model', () => {
    useLocaleStore.setState({ locale: 'zh-CN' })
    useLLMStore.setState({ models: MODELS, defaultModelId: 'default-gen', loaded: true })
    useProjectStore.setState({
      currentProject: {
        id: session.projectId,
        sessionLease: session.leaseId,
        path: session.projectPath,
        name: 'Cfg',
        novelConfig: {
          genre: '奇幻', totalChapters: 50, wordsPerChapter: 2000, coreOutline: '脑洞',
        },
      } as never,
    })
    const startWorkflow = vi.fn().mockResolvedValue(undefined)
    useWorkflowStore.setState({
      startWorkflow,
      getResourceConflict: () => null,
      addLog: vi.fn(),
      activeRuns: [],
    } as never)

    const started = startConfigGeneration({
      idea: '脑洞',
      projectSession: session,
      onGenerated: vi.fn(),
      generationModelId: 'picked-gen',
    })

    expect(started).toBe(true)
    expect(startWorkflow).toHaveBeenCalledOnce()
    expect(startWorkflow.mock.calls[0][0]).toMatchObject({
      type: 'config_generation',
      generationModelId: 'picked-gen',
    })
  })
})
