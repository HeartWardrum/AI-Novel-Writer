import { ipc } from './ipc-client'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import type {
  WorldbookActivation,
  WorldbookEntry,
  WorldbookEntrySaveRequest,
  WorldbookResolveRequest,
  WorldbookResolveResult,
  WorldbookSourceCandidate,
} from '../shared/worldbook'

export async function listWorldbookEntries(
  session: ProjectSessionContext,
  options: {
    includeReferenceContent?: boolean
    currentChapter?: number
    systemPromptSeed?: string
  } = {},
): Promise<WorldbookEntry[]> {
  return ipc.invokeWithProjectSession(session, 'worldbook:list', options, session.projectPath)
}

export async function listWorldbookSources(
  session: ProjectSessionContext,
  options: { currentChapter?: number } = {},
): Promise<WorldbookSourceCandidate[]> {
  return ipc.invokeWithProjectSession(session, 'worldbook:list-sources', options, session.projectPath)
}

export async function importWorldbookSources(
  session: ProjectSessionContext,
  sourceIds: readonly string[],
  options: { currentChapter?: number } = {},
): Promise<WorldbookEntry[]> {
  const result = await ipc.invokeWithProjectSession(
    session,
    'worldbook:import-sources',
    { sourceIds: [...sourceIds], currentChapter: options.currentChapter },
    session.projectPath,
  )
  if (!result.success || !result.entries) throw new Error(result.error || 'WORLDBOOK_IMPORT_FAILED')
  return result.entries
}

export async function saveWorldbookEntry(
  session: ProjectSessionContext,
  request: WorldbookEntrySaveRequest,
): Promise<WorldbookEntry> {
  const result = await ipc.invokeWithProjectSession(session, 'worldbook:save', request, session.projectPath)
  if (!result.success || !result.entry) throw new Error(result.error || 'WORLDBOOK_SAVE_FAILED')
  return result.entry
}

export async function saveWorldbookActivation(
  session: ProjectSessionContext,
  entryId: string,
  activation: WorldbookActivation,
): Promise<WorldbookActivation> {
  const result = await ipc.invokeWithProjectSession(
    session,
    'worldbook:save-activation',
    { entryId, activation },
    session.projectPath,
  )
  if (!result.success || !result.activation) throw new Error(result.error || 'WORLDBOOK_ACTIVATION_SAVE_FAILED')
  return result.activation
}

export async function deleteWorldbookEntry(
  session: ProjectSessionContext,
  entryId: string,
  expectedRevision: number,
): Promise<void> {
  const result = await ipc.invokeWithProjectSession(
    session,
    'worldbook:delete',
    entryId,
    expectedRevision,
    session.projectPath,
  )
  if (!result.success) throw new Error(result.error || 'WORLDBOOK_DELETE_FAILED')
}

export async function resolveWorldbook(
  session: ProjectSessionContext,
  request: WorldbookResolveRequest,
): Promise<WorldbookResolveResult> {
  return ipc.invokeWithProjectSession(session, 'worldbook:resolve', request, session.projectPath)
}
