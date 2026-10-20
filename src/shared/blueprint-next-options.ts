import type { MainGenerationRunHandle, MainGenerationRunView, MainGenerationExecuteReceipt } from '../services/generation/generation-runtime'
import type { DatabaseChannels } from './ipc-channels'
import type { WritingLanguage } from './writing-language'
import type {
  BlueprintNextArchitectureBrief,
  BlueprintNextMode,
  BlueprintNextNeighborSummary,
  BlueprintNextOption,
} from './blueprint-next-options-pure'

export type {
  BlueprintNextArchitectureBrief,
  BlueprintNextMode,
  BlueprintNextNeighborSummary,
  BlueprintNextOption,
} from './blueprint-next-options-pure'

type BlueprintData = DatabaseChannels['db:blueprint-get-all']['return'][number]

export interface BlueprintNextInput {
  chapterNumber: number
  mode: BlueprintNextMode
}

export interface BlueprintNextContext {
  projectId: string
  originEpoch: string
  key: string
  createdAt: string
  input: BlueprintNextInput
  writingLanguage: WritingLanguage
  totalChapters: number
  blueprint: BlueprintData
  neighbors: BlueprintNextNeighborSummary[]
  architecture: BlueprintNextArchitectureBrief
}

export interface BlueprintNextRecovery {
  view: MainGenerationRunView
  modelId: string
  context: BlueprintNextContext
  attemptCount: number
  sourceStatus: 'current' | 'conflict'
  options?: BlueprintNextOption[]
}

export interface BlueprintNextOptionsChannels {
  'blueprint-next:begin': {
    args: [{ input: BlueprintNextInput; modelId: string; uiActionNonce: string }]
    return: BlueprintNextRecovery
  }
  'blueprint-next:read-recovery': {
    args: [{ handle: MainGenerationRunHandle }]
    return: BlueprintNextRecovery
  }
  'blueprint-next:execute': {
    args: [{ handle: MainGenerationRunHandle }]
    return: MainGenerationExecuteReceipt
  }
  'blueprint-next:cancel': {
    args: [{ handle: MainGenerationRunHandle }]
    return: MainGenerationRunView
  }
}
