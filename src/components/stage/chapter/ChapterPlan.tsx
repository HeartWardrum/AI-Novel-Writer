import { useEffect, useState } from 'react'
import { blueprintWritePrefill, emptyChapterWritePrefill } from '../../../services/workflows/chapter-write-launch'
import type { EditorTab } from '../../../stores/editor-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { navigate } from '../../../stores/navigation/navigation-intents'
import { useStageStore } from '../../../stores/navigation/stage-store'
import { useProjectStore } from '../../../stores/project-store'
import { captureProjectSession, isProjectSessionCurrent } from '../../project-session-gate'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { useStageView } from '../use-stage-work'
import WriteChapterPopover from '../write/WriteChapterPopover'
import { openWritingReferences } from '../reference/open-writing-references'
import { openDraftInChapterView, swapChapterTab } from './chapter-tab-routing'
import ChapterHead from './ChapterHead'
import DeletionCleanupNotices from './DeletionCleanupNotices'
import { useChapterBlueprint } from './use-chapter-blueprint'
import { pluralEn } from '../../../shared/plural-en'

/**
 * 待写章的单章视图：有蓝图则只读展示；无蓝图也可「写作此章」。
 * 这一章有了稿（写完了，或在别处写好）就在这个标签的位置换成那一稿。
 */
export default function ChapterPlan({ tab, chapterNumber, projectKey }: { tab: EditorTab; chapterNumber: number; projectKey: string }) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const focus = useStageStore(s => s.focus)
  const wordsPerChapter = useProjectStore(s => s.currentProject?.novelConfig.wordsPerChapter)
  const { blueprint, failed: blueprintFailed, reload: reloadBlueprint } = useChapterBlueprint(chapterNumber, projectKey)
  const { chapters } = useStageView()
  const row = chapters.find(candidate => candidate.number === chapterNumber)
  const draft = row?.draft ?? null
  const writePrefill = blueprint
    ? blueprintWritePrefill(blueprint)
    : emptyChapterWritePrefill(chapterNumber, row?.title)

  useEffect(() => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!draft || !session) return
    void swapChapterTab(tab.id, () => openDraftInChapterView(draft, row?.title ?? '', session))
  }, [draft, row?.title, tab.id])

  const target = wordsPerChapter && wordsPerChapter > 0 ? wordsPerChapter.toLocaleString(locale) : null
  const [refsBusy, setRefsBusy] = useState(false)

  const openReferences = async () => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session || !isProjectSessionCurrent(session)) return
    setRefsBusy(true)
    try {
      await openWritingReferences({
        session,
        chapterNumber,
        characterNames: blueprint?.characters ?? [],
      })
    } finally {
      setRefsBusy(false)
    }
  }

  return (
    <div className="stage-ch" data-focus={focus || undefined}>
      <div className="stage-ch-scroll">
        <article className="stage-ch-page">
          <ChapterHead
            chapterNumber={chapterNumber}
            role={blueprint?.role}
            title={blueprint?.title ?? row?.title ?? ''}
            titleReadOnly
            focus={focus}
            meta={(
              <span className="stage-ch-version stage-ch-version-chip">
                {target ? text(`尚无草稿 · 目标 ${target} 字`, `No draft yet · target ${target} ${pluralEn(wordsPerChapter ?? 0, 'word')}`) : text('尚无草稿', 'No draft yet')}
              </span>
            )}
          />
          <div className="stage-ch-actions">
            <WriteChapterPopover chapterNumber={chapterNumber} blueprint={writePrefill} label={text('写作此章', 'Write this chapter')} align="start" />
            <Button variant="secondary" size="sm" disabled={refsBusy} onClick={() => void openReferences()}>
              {text('打开参考图', 'Open references')}
            </Button>
            <span className="stage-ch-hint">
              {row?.running
                ? text('这一章正在写，完成后会在这里换成草稿', 'This chapter is being written; the draft replaces this page when it is done')
                : blueprint
                  ? text('按本章蓝图写作，也可以在弹层里加一句指导', 'Writes from this chapter’s blueprint; add optional guidance in the popover')
                  : text('没有蓝图也可以写；在弹层里可加作者指导', 'You can write without a blueprint; add optional guidance in the popover')}
            </span>
          </div>
          <div className="stage-ch-notices">
            <DeletionCleanupNotices projectKey={projectKey} chapterNumber={chapterNumber} />
            {row?.running && (
              <Notice
                tone="info"
                title={text('正在写这一章', 'Writing this chapter')}
                actions={<Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'run', facet: 'output' })}>{text('查看运行', 'Open run')}</Button>}
              />
            )}
            {blueprintFailed && (
              <Notice
                tone="warn"
                title={text('读取本章蓝图失败', 'Could not read this chapter’s blueprint')}
                actions={<Button variant="secondary" size="sm" onClick={reloadBlueprint}>{text('重新读取', 'Read again')}</Button>}
              >
                {text('仍可直接写作；有蓝图时会用来增强标题与事件。', 'You can still write; a blueprint will enrich title and events when available.')}
              </Notice>
            )}
          </div>
          {blueprint && (
            <section className="stage-ch-plan" aria-label={text('本章参考', 'Chapter notes')}>
              <div className="stage-ch-plan-head">
                <h2 className="stage-ch-plan-title">{text('本章参考', 'Chapter notes')}<small>{text('只读 · 可选', 'Read-only · optional')}</small></h2>
              </div>
              <dl className="stage-ch-plan-grid">
                <dt>{text('定位', 'Role')}</dt><dd>{blueprint.role || '—'}</dd>
                <dt>{text('出场角色', 'Characters')}</dt>
                <dd>{blueprint.characters.length > 0
                  ? <span className="stage-ch-chips">{blueprint.characters.map(name => <span key={name} className="stage-ch-chip">{name}</span>)}</span>
                  : '—'}</dd>
                <dt>{text('本章目的', 'Purpose')}</dt><dd>{blueprint.purpose || '—'}</dd>
                <dt>{text('关键事件', 'Key events')}</dt><dd>{blueprint.keyEvents || '—'}</dd>
                {blueprint.userGuidance && <><dt>{text('作者指导', 'Author guidance')}</dt><dd>{blueprint.userGuidance}</dd></>}
              </dl>
            </section>
          )}
          {!row?.running && (
            <div className="stage-ch-blank">
              <b>{text('这一章还是空白', 'This chapter is still blank')}</b>
              {text('点「写作此章」，AI 会写出草稿。', 'Choose “Write this chapter” and AI drafts it.')}
            </div>
          )}
        </article>
      </div>
    </div>
  )
}
