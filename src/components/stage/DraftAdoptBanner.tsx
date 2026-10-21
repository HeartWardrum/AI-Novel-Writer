import { useEffect } from 'react'
import { chapterLabel } from '../../shared/chapter-label'
import { globalEventBus } from '../../shared/event-bus'
import { projectSessionContextFromProject, sameProjectSessionContext } from '../../shared/project-session-context'
import { useDraftStore } from '../../stores/draft-store'
import { useLocaleStore } from '../../stores/locale-store'
import { navigate } from '../../stores/navigation/navigation-intents'
import { useStageStore } from '../../stores/navigation/stage-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { deleteDraftVersion } from '../panels/sidebar/draft-deletion'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'

function chapterFromRun(runId: string): number | null {
  const run = useWorkflowStore.getState().history.find(item => item.id === runId)
    ?? useWorkflowStore.getState().activeRuns.find(item => item.id === runId)
  if (!run) return null
  // 只把「写稿 / 正文」类完成当成候选采用；修稿走合并视图，不算整章采用。
  if (!/写稿|正文|Draft|draft/i.test(run.title)) return null
  for (const key of run.resourceKeys ?? []) {
    const match = /^chapter:(\d+)$/.exec(key)
    if (match) return Number(match[1])
  }
  return null
}

/** 监听写章工作流完成，把该章最新草稿标为待采用候选。 */
export function usePendingDraftAdoptFromWorkflow(): void {
  useEffect(() => globalEventBus.on('WORKFLOW_COMPLETE', ({ type, projectSession, runId }) => {
    if (type !== 'chapter_creation') return
    const chapterNumber = chapterFromRun(runId)
    if (chapterNumber === null) return
    const project = useProjectStore.getState().currentProject
    const session = projectSessionContextFromProject(project)
    if (!session || !sameProjectSessionContext(session, projectSession)) return
    void (async () => {
      await useDraftStore.getState().loadAllDrafts(session.projectPath, session)
      const drafts = useDraftStore.getState().draftsByChapter[chapterNumber] ?? []
      const working = [...drafts]
        .filter(draft => draft.status === 'draft' || draft.status === 'revised' || draft.status === 'reviewed')
        .sort((a, b) => b.version - a.version)[0]
      if (!working) return
      useStageStore.setState({
        pendingDraftAdopt: {
          session,
          chapterNumber,
          draftId: working.id,
          version: working.version,
          runId,
        },
        rightRail: 'chat',
      })
      navigate({ kind: 'chapter', chapterNumber })
    })()
  }), [])
}

/** 候选稿采用条：采用打开该稿；丢弃则删除候选并留在本章。 */
export default function DraftAdoptBanner() {
  const text = useLocaleStore(s => s.text)
  const pending = useStageStore(s => s.pendingDraftAdopt)
  const project = useProjectStore(s => s.currentProject)

  if (!pending || !project) return null
  if (!sameProjectSessionContext(pending.session, projectSessionContextFromProject(project))) return null

  const clear = () => useStageStore.setState({ pendingDraftAdopt: null })

  const adopt = () => {
    navigate({ kind: 'chapter', chapterNumber: pending.chapterNumber })
    clear()
    toast.success(text(
      `已采用第 ${pending.chapterNumber} 章候选稿 v${pending.version}`,
      `Adopted chapter ${pending.chapterNumber} draft v${pending.version}`,
    ))
  }

  const discard = async () => {
    const drafts = useDraftStore.getState().draftsByChapter[pending.chapterNumber] ?? []
    const draft = drafts.find(item => item.id === pending.draftId)
    if (!draft) {
      clear()
      return
    }
    const ok = await deleteDraftVersion({
      draft,
      displayName: text(
        `${chapterLabel(pending.chapterNumber, text)} 候选 v${pending.version}`,
        `${chapterLabel(pending.chapterNumber, text)} candidate v${pending.version}`,
      ),
      projectKey: project.path,
      project,
    })
    if (ok) {
      clear()
      toast.success(text('已丢弃候选稿', 'Candidate draft discarded'))
      navigate({ kind: 'chapter', chapterNumber: pending.chapterNumber })
    }
  }

  return (
    <div className="draft-adopt-banner" role="status">
      <p className="draft-adopt-banner-text">
        {text(
          `${chapterLabel(pending.chapterNumber, text)} 有新的候选稿 v${pending.version}，采用后成为当前正文。`,
          `${chapterLabel(pending.chapterNumber, text)} has candidate draft v${pending.version}. Adopt to make it the current prose.`,
        )}
      </p>
      <div className="draft-adopt-banner-actions">
        <Button variant="primary" size="sm" onClick={adopt}>{text('采用', 'Adopt')}</Button>
        <Button variant="secondary" size="sm" onClick={() => void discard()}>{text('丢弃', 'Discard')}</Button>
      </div>
    </div>
  )
}
