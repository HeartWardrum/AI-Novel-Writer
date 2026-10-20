import { CANONICAL_PROJECT_DIRECTORY } from '../../shared/project-format'
import type { ModelProfile, ProjectSessionContext } from '../../shared/ipc-channels'
import { isProjectSessionCurrent } from '../../components/project-session-gate'
import { ipc } from '../ipc-client'
import { availableGenerationModelId, preferredGenerationModelId } from './chapter-write-launch'

/** 按作品记住各创作任务上次选用的生成模型。 */
export const GENERATION_PREFS_REL = `${CANONICAL_PROJECT_DIRECTORY}/generation-preferences.json`

export type TaskGenerationModelKey =
  | 'setup'
  | 'architecture'
  | 'blueprint'
  | 'writing'
  | 'rewrite'
  | 'revise'

export type TaskGenerationModelPrefs = Partial<Record<TaskGenerationModelKey, string>>

function asPrefs(value: unknown): TaskGenerationModelPrefs {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>
  const keys: TaskGenerationModelKey[] = [
    'setup', 'architecture', 'blueprint', 'writing', 'rewrite', 'revise',
  ]
  const prefs: TaskGenerationModelPrefs = {}
  for (const key of keys) {
    const id = source[key]
    if (typeof id === 'string' && id.trim()) prefs[key] = id.trim()
  }
  return prefs
}

async function readPrefs(session: ProjectSessionContext): Promise<TaskGenerationModelPrefs> {
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

/** 打开弹层时解析该任务应预填的模型 id。 */
export async function loadTaskGenerationModelId(
  session: ProjectSessionContext | null | undefined,
  task: TaskGenerationModelKey,
  models: ModelProfile[],
  defaultModelId: string | null,
): Promise<string | null> {
  const fallback = preferredGenerationModelId(models, defaultModelId)
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
    const next: TaskGenerationModelPrefs = { ...prefs, [task]: modelId.trim() }
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
