import type { BlueprintData } from '../../../../electron/repositories/blueprint-repository'
import { ipc } from '../../../services/ipc-client'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import { isProjectSessionCurrent } from '../../project-session-gate'
import { refreshStageWork } from '../use-stage-work'

function blankBlueprint(chapterNumber: number, title: string): BlueprintData {
  return {
    chapterNumber,
    title,
    role: '',
    purpose: '',
    keyEvents: '',
    characters: [],
    suspenseHook: '',
    userGuidance: '',
    notes: '',
    notesUpdatedAt: '',
  }
}

/** 把本章标题写进蓝图（无则新建空蓝图），并刷新左栏章名。 */
export async function saveChapterTitle(
  session: ProjectSessionContext,
  chapterNumber: number,
  title: string,
  text: (zh: string, en: string) => string,
): Promise<void> {
  const existing = await ipc.invokeWithProjectSession(session, 'db:blueprint-get', chapterNumber, session.projectPath)
  if (!isProjectSessionCurrent(session)) return
  const next = existing ? { ...existing, title } : blankBlueprint(chapterNumber, title)
  const result = await ipc.invokeWithProjectSession(session, 'db:blueprint-upsert', next, session.projectPath)
  if (!result.success) throw new Error(result.error || text('保存标题失败', 'Could not save the title'))
  if (!isProjectSessionCurrent(session)) return
  await refreshStageWork(text)
}
