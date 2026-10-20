import { CANONICAL_PROJECT_DIRECTORY } from '../../shared/project-format'
import type { ModelProfile, ProjectSessionContext } from '../../shared/ipc-channels'
import { isProjectSessionCurrent } from '../../components/project-session-gate'
import { ipc } from '../ipc-client'
import {
  availableGenerationModelId,
  isGenerationModel,
  preferredGenerationModelId,
} from './chapter-write-launch'

/** Prefer an Aion generation model when no per-task preference is stored. */
export function preferredNsfwUnlockModelId(
  models: ModelProfile[],
  defaultModelId: string | null,
): string | null {
  const aion = models.find(model => isGenerationModel(model) && model.provider === 'aion')
  return availableGenerationModelId(models, aion?.id)
    ?? preferredGenerationModelId(models, defaultModelId)
}

/** 按作品记住各创作任务上次选用的生成模型。 */
export const GENERATION_PREFS_REL = `${CANONICAL_PROJECT_DIRECTORY}/generation-preferences.json`

export type TaskGenerationModelKey =
  | 'setup'
  | 'architecture'
  | 'blueprint'
  | 'writing'
  | 'rewrite'
  | 'revise'
  | 'nsfwUnlock'

export type TaskGenerationModelPrefs = Partial<Record<TaskGenerationModelKey, string>>

/** 作品级 generation-preferences.json 内容（模型偏好 + 软写打标开关）。 */
export type GenerationPreferencesFile = TaskGenerationModelPrefs & {
  softNsfwDraftMarkers?: boolean
}

function asPrefs(value: unknown): GenerationPreferencesFile {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>
  const keys: TaskGenerationModelKey[] = [
    'setup', 'architecture', 'blueprint', 'writing', 'rewrite', 'revise', 'nsfwUnlock',
  ]
  const prefs: GenerationPreferencesFile = {}
  for (const key of keys) {
    const id = source[key]
    if (typeof id === 'string' && id.trim()) prefs[key] = id.trim()
  }
  if (typeof source.softNsfwDraftMarkers === 'boolean') {
    prefs.softNsfwDraftMarkers = source.softNsfwDraftMarkers
  }
  return prefs
}

async function readPrefs(session: ProjectSessionContext): Promise<GenerationPreferencesFile> {
  const projectPath = session.projectPath
  try {
    const existing = await ipc.invokeWithProjectSession(
      session,
      'fs:read-json',
      `${projectPath}/${GENERATION_PREFS_REL}`,
      projectPath,
    )
    if (!isProjectSessionCurrent(session)) return {}
    if (existing.success && existing.data) return asPrefs(existing.data)
  } catch (error) {
    console.warn('[GenerationPrefs] 读取失败:', error)
  }
  return {}
}

/** Aion 默认关软写打标；其它生成模型默认开。 */
export function defaultSoftNsfwDraftMarkers(model: ModelProfile | null | undefined): boolean {
  return model?.provider !== 'aion'
}

/**
 * 解析本次是否软写打标：作品已记住 boolean 则用之，否则按模型智能默认。
 */
export async function loadSoftNsfwDraftMarkers(
  session: ProjectSessionContext | null | undefined,
  models: ModelProfile[],
  modelId: string | null | undefined,
): Promise<boolean> {
  const model = typeof modelId === 'string' && modelId
    ? models.find(item => item.id === modelId)
    : undefined
  const fallback = defaultSoftNsfwDraftMarkers(model)
  if (!session) return fallback
  const prefs = await readPrefs(session)
  if (!isProjectSessionCurrent(session)) return fallback
  if (typeof prefs.softNsfwDraftMarkers === 'boolean') return prefs.softNsfwDraftMarkers
  return fallback
}

/** 写作启动后写回软写打标偏好（失败不挡主流程）。 */
export async function saveSoftNsfwDraftMarkers(
  session: ProjectSessionContext | null | undefined,
  enabled: boolean,
): Promise<void> {
  if (!session) return
  const projectPath = session.projectPath
  try {
    const prefs = await readPrefs(session)
    if (!isProjectSessionCurrent(session)) return
    const next: GenerationPreferencesFile = { ...prefs, softNsfwDraftMarkers: enabled }
    await ipc.invokeWithProjectSession(
      session,
      'fs:write-json',
      `${projectPath}/${GENERATION_PREFS_REL}`,
      next,
      projectPath,
    )
  } catch (error) {
    console.warn('[GenerationPrefs] 保存软写打标失败:', error)
  }
}

/** 打开弹层时解析该任务应预填的模型 id。 */
export async function loadTaskGenerationModelId(
  session: ProjectSessionContext | null | undefined,
  task: TaskGenerationModelKey,
  models: ModelProfile[],
  defaultModelId: string | null,
): Promise<string | null> {
  const fallback = task === 'nsfwUnlock'
    ? preferredNsfwUnlockModelId(models, defaultModelId)
    : preferredGenerationModelId(models, defaultModelId)
  if (!session) return fallback
  const prefs = await readPrefs(session)
  if (!isProjectSessionCurrent(session)) return fallback
  return availableGenerationModelId(models, prefs[task]) ?? fallback
}

/** 任务成功选用模型后写回作品偏好（失败不挡主流程）。 */
export async function saveTaskGenerationModelId(
  session: ProjectSessionContext | null | undefined,
  task: TaskGenerationModelKey,
  modelId: string | null | undefined,
): Promise<void> {
  if (!session || !modelId?.trim()) return
  const projectPath = session.projectPath
  try {
    const prefs = await readPrefs(session)
    if (!isProjectSessionCurrent(session)) return
    const next: GenerationPreferencesFile = { ...prefs, [task]: modelId.trim() }
    await ipc.invokeWithProjectSession(
      session,
      'fs:write-json',
      `${projectPath}/${GENERATION_PREFS_REL}`,
      next,
      projectPath,
    )
  } catch (error) {
    console.warn('[GenerationPrefs] 保存失败:', error)
  }
}
