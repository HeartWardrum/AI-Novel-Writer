import {
  readJsonFile,
  GLOBAL_CONFIG_PATH,
  DEFAULT_GLOBAL_CONFIG,
  MODELS_CONFIG_PATH,
  CREDENTIALS_CONFIG_PATH,
} from '../utils/config-utils'
import type { GlobalConfig, ModelProfile, ProviderCredential } from '../../src/shared/ipc-channels'
import type { EmbeddingOptions } from '../../src/shared/embedding-options'
import { resolveModelProfile } from '../../src/shared/provider-credential'

export interface EmbeddingRuntimeConfig {
  protocol: 'openai' | 'gemini'
  model: {
    baseUrl: string
    apiKey: string
    modelName: string
    embeddingOptions?: EmbeddingOptions
  }
}

/** Project-independent retrieval configuration. Credentials stay in the main process. */
export function getEmbeddingConfig(): EmbeddingRuntimeConfig | null {
  const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
  const targetModelId = config.defaultEmbeddingModelId || config.defaultModelId
  if (!targetModelId) return null
  const models = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])
  const profile = models.find(model => model.id === targetModelId)
  if (!profile) return null
  const credentials = readJsonFile<ProviderCredential[]>(CREDENTIALS_CONFIG_PATH, [])
  const model = resolveModelProfile(profile, credentials)
  return {
    protocol: model.protocol as 'openai' | 'gemini',
    model: {
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      modelName: model.modelName,
      embeddingOptions: model.embeddingOptions,
    },
  }
}

