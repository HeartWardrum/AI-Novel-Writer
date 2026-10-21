import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { countDraftUnits } from '../../../shared/draft-units'
import type { EditorTab } from '../../../stores/editor-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useCharacterStore } from '../../../stores/character-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { chapterPhase } from '../../../stores/navigation/stage-progress'
import { useStageStore } from '../../../stores/navigation/stage-store'
import { useProjectStore } from '../../../stores/project-store'
import { chapterTabName } from '../../../shared/chapter-label'
import CodeMirrorEditor from '../../editor/CodeMirrorEditor'
import { useDraftActions } from '../../editor/use-draft-actions'
import { sameProjectSessionContext } from '../../../shared/project-session-context'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../../project-session-gate'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { toast } from '../../ui/Toast'
import { InkDialog } from '../InkDialog'
import ChapterHead from './ChapterHead'
import DeletionCleanupNotices from './DeletionCleanupNotices'
import { useChapterBlueprint } from './use-chapter-blueprint'
import ChapterPlan from './ChapterPlan'
import MergeView from './MergeView'
import PostProcessSteps from './PostProcessSteps'
import { saveChapterTitle } from './save-chapter-title'
import { pluralEn } from '../../../shared/plural-en'

const AUTOSAVE_MS = 1500

/**
 * 正文单章视图：可编辑标题、字数与纸面正文；自动保存。
 * 定稿在中栏确认后走 createFinalizeWorkflow；AI 对话在右栏。
 * 待写章（写作请求或章在跑）仍用 ChapterPlan。有待合并修稿时直接摆 MergeView。
 */
export default function ChapterView({ tab }: { tab: EditorTab }) {
  const project = useProjectStore(s => s.currentProject)
  const session = captureProjectSession(project)
  const sessionKey = session && tab.projectKey && isProjectSessionPath(session, tab.projectKey)
    ? `${session.projectId}:${session.leaseId}`
    : `inactive:${tab.projectKey}`
  if (!tab.projectKey || tab.chapterNumber === undefined && !tab.filePath) return null
  if (!tab.filePath) return <ChapterPlan key={sessionKey} tab={tab} chapterNumber={tab.chapterNumber!} projectKey={tab.projectKey} />
  return <DraftChapter key={sessionKey} tab={tab} filePath={tab.filePath} projectKey={tab.projectKey} />
}

function DraftChapter({ tab, filePath, projectKey }: { tab: EditorTab; filePath: string; projectKey: string }) {
  const session = captureProjectSession(useProjectStore(s => s.currentProject))
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const focus = useStageStore(s => s.focus)
  const request = useStageStore(s => s.chapterRequest)
  const draft = useDraftActions({ tabId: tab.id, filePath, content: tab.content ?? '', projectKey })
  const chapterNumber = draft.meta?.chapterNumber ?? tab.chapterNumber
  const { blueprint, reload: reloadBlueprint } = useChapterBlueprint(chapterNumber, projectKey)
  const [charCount, setCharCount] = useState(() => countDraftUnits(tab.content ?? ''))
  const target = useProjectStore(s => s.currentProject?.novelConfig.wordsPerChapter) || 0

  const facts = useStageStore(s => draft.meta && s.chapterFacts && session && sameProjectSessionContext(s.chapterFacts.session, session)
    ? s.chapterFacts.byDraft[draft.meta.id]
    : undefined)
  const stage = draft.loaded && draft.meta ? draft.status === 'archived' ? 'archived' : chapterPhase(draft.status, facts) : null

  const { reload } = draft
  useEffect(() => {
    if (!request || request.filePath !== filePath || !sameProjectSessionContext(request.session, captureProjectSession(useProjectStore.getState().currentProject))) return
    useStageStore.setState({ chapterRequest: null, sheet: null })
    reload()
  }, [request, filePath, reload])

  const storedTitle = blueprint?.title || draft.meta?.chapterTitle || ''
  const [titleDraft, setTitleDraft] = useState(storedTitle)
  useEffect(() => { setTitleDraft(storedTitle) }, [storedTitle, chapterNumber])

  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (titleTimer.current) clearTimeout(titleTimer.current)
    if (bodyTimer.current) clearTimeout(bodyTimer.current)
  }, [])

  const persistTitle = async (next: string) => {
    if (chapterNumber === undefined) return
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    try {
      await saveChapterTitle(projectSession, chapterNumber, next.trim(), text)
      if (!isProjectSessionCurrent(projectSession)) return
      const name = chapterTabName(chapterNumber, next.trim(), text)
      useEditorStore.setState(state => ({
        tabs: state.tabs.map(candidate => candidate.id === tab.id ? { ...candidate, name } : candidate),
      }))
      reloadBlueprint()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text('保存标题失败', 'Could not save the title'))
    }
  }

  const onTitleChange = (next: string) => {
    setTitleDraft(next)
    if (titleTimer.current) clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => { void persistTitle(next) }, AUTOSAVE_MS)
  }

  const onBodyChange = (body: string) => {
    draft.onBodyChange(body)
    if (bodyTimer.current) clearTimeout(bodyTimer.current)
    bodyTimer.current = setTimeout(() => {
      void draft.save(draft.currentBodyRef.current)
    }, AUTOSAVE_MS)
  }

  const units = charCount.toLocaleString(locale)
  const wordMeta = target > 0
    ? text(`${units} / ${target.toLocaleString(locale)} 字`, `${units} / ${target.toLocaleString(locale)} ${pluralEn(target, 'word')}`)
    : text(`${units} 字`, `${units} ${pluralEn(charCount, 'word')}`)
  const editable = !draft.isReadonly && !draft.isChapterBusy
  const titleReadOnly = draft.isReadonly || draft.isChapterBusy
  const [askFinalize, setAskFinalize] = useState(false)
  const showFinalize = Boolean(
    stage
    && stage !== 'final'
    && stage !== 'archived'
    && draft.canFinalize
    && !draft.mergeData,
  )

  const characters = useCharacterStore(s => s.characters)
  const characterNameEntries = useMemo(
    () => characters
      .filter(card => Boolean(card.characterId?.trim() && card.name.trim()))
      .map(card => ({ characterId: card.characterId!.trim(), name: card.name.trim() })),
    [characters],
  )

  // 有待合并修稿时自动打开合并视图（右栏修稿完成后）。
  const pending = draft.pendingRevisions.find(revision => revision.id === facts?.mergeable.at(-1))
  const autoOpened = useRef<number | null>(null)
  useEffect(() => {
    if (stage !== 'merge' || !pending || draft.mergeData || autoOpened.current === pending.id) return
    autoOpened.current = pending.id
    void draft.openPendingRevision(pending)
  }, [stage, pending, draft.mergeData, draft.openPendingRevision])

  const mergeVersionLabel = draft.meta
    ? text(`草稿 v${draft.meta.version}`, `Draft v${draft.meta.version}`)
    : wordMeta

  const confirmFinalize = () => {
    setAskFinalize(false)
    useStageStore.setState({ rightRail: 'run' })
    void draft.finalize()
  }

  return (
    <div className="stage-ch" data-focus={focus || undefined}>
      <div className="stage-ch-scroll">
        <article className="stage-ch-page" aria-busy={!draft.loaded}>
          {chapterNumber !== undefined && (
            <ChapterHead
              chapterNumber={chapterNumber}
              role={blueprint?.role}
              title={titleDraft}
              onTitleChange={titleReadOnly ? undefined : onTitleChange}
              titleReadOnly={titleReadOnly}
              focus={focus}
              meta={(
                <div className="stage-ch-head-meta">
                  <span className="stage-ch-version stage-ch-version-chip" role="status">
                    {tab.dirty ? text(`${wordMeta} · 未保存`, `${wordMeta} · unsaved`) : wordMeta}
                  </span>
                  {showFinalize && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!draft.canFinalize || draft.isChapterBusy}
                      onClick={() => setAskFinalize(true)}
                    >
                      <BadgeCheck size={14} aria-hidden />{text('定稿', 'Finalize')}
                    </Button>
                  )}
                </div>
              )}
            />
          )}
          {chapterNumber !== undefined && (
            <div className="stage-ch-notices"><DeletionCleanupNotices projectKey={projectKey} chapterNumber={chapterNumber} /></div>
          )}
          {draft.mergeData ? (
            <MergeView
              data={draft.mergeData}
              versionLabel={mergeVersionLabel}
              recheck={false}
              onComplete={draft.completeMerge}
              onLater={() => draft.closeMerge()}
            />
          ) : (
            <div className="stage-ch-prose" data-readonly={!editable || undefined}>
              <CodeMirrorEditor
                mode="prose"
                fitContent
                paragraphIndent
                content={tab.content ?? ''}
                filePath={filePath}
                chapterNumber={chapterNumber}
                editable={editable}
                hideStatusBar
                characterNameEntries={characterNameEntries}
                onCharCountChange={setCharCount}
                onChange={onBodyChange}
                onSave={body => draft.save(body)}
              />
            </div>
          )}
          {stage === 'final' && chapterNumber !== undefined && (
            <PostProcessSteps
              chapterNumber={chapterNumber}
              publication={tab.finalizationPublication}
              busy={draft.isChapterBusy}
              onRetryStep={stepKey => void draft.repairFinalize(stepKey)}
              onRetryFailed={() => void draft.repairFinalize()}
              onRetryPublication={() => void draft.retryManuscriptPublication()}
            />
          )}
        </article>
      </div>
      {focus && (
        <footer className="stage-ch-focusbar" aria-label={text('写作状态', 'Writing status')}>
          {target ? (
            <>
              <span>{text(`${units} / ${target.toLocaleString(locale)} 字`, `${units} / ${target.toLocaleString(locale)} ${pluralEn(target, 'word')}`)}</span>
              <span className="stage-ch-focus-progress" role="progressbar" aria-label={text('本章目标字数进度', 'Progress toward the chapter target')}
                aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(charCount, target)}>
                <span style={{ width: `${Math.min(100, charCount / target * 100)}%` }} />
              </span>
            </>
          ) : <span>{text(`${units} 字`, `${units} ${pluralEn(charCount, 'word')}`)}</span>}
          <span>{tab.dirty ? text('有未保存的修改', 'Unsaved changes') : text('已保存', 'Saved')}</span>
        </footer>
      )}
      {chapterNumber !== undefined && (
        <InkDialog
          open={askFinalize}
          onOpenChange={open => { if (!open) setAskFinalize(false) }}
          title={text(`定稿第 ${chapterNumber} 章？`, `Finalize chapter ${chapterNumber}?`)}
          description={text('定稿是这部作品里的一次提交。提交后本章只读，后面的章节都以它为准。', 'Finalizing commits this chapter to the book. It becomes read-only and later chapters build on it.')}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setAskFinalize(false)}>{text('再看看', 'Not yet')}</Button>
              <Button variant="primary" disabled={!draft.canFinalize} onClick={confirmFinalize}>{text('确认定稿', 'Finalize')}</Button>
            </>
          )}
        >
          <ul className="stage-ch-commit">
            <li><b>{text('写入正文。', 'Writes the manuscript.')}</b>{text(`这 ${units} 字成为第 ${chapterNumber} 章正文，同时保存为正文文件。`, `This ${units}-word text becomes chapter ${chapterNumber} and is saved as the manuscript file.`)}</li>
            <li><b>{text('自动做定稿后处理。', 'Runs post-finalization steps.')}</b>{text('完成后在本章页面显示每一步的结果，失败的步骤可以单独重试。', 'Each step’s result appears on this chapter; a failed step can be retried on its own.')}</li>
            <li><b>{text('之后不能直接修改。', 'No direct edits afterwards.')}</b>{text('要再改，从版本历史回退为新草稿。', 'To change it again, roll back to a new draft from version history.')}</li>
          </ul>
          {tab.dirty && (
            <Notice tone="info" title={text('还没保存的修改会一并定稿', 'Unsaved edits are included')}>
              {text('定稿以你现在看到的正文为准。', 'Finalization uses the text exactly as you see it now.')}
            </Notice>
          )}
        </InkDialog>
      )}
    </div>
  )
}
