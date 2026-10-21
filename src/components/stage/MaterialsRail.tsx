import { useEffect, useRef, type ReactNode } from 'react'
import { BookOpen, BookMarked, GitBranch, Settings, type LucideIcon } from 'lucide-react'
import { chapterLabel } from '../../shared/chapter-label'
import { useLocaleStore } from '../../stores/locale-store'
import type { ResourcePage, WorkStage } from '../../stores/navigation/navigation-intents'
import type { ChapterRow, StageLocation, StageStatus } from '../../stores/navigation/stage-progress'
import { CHAPTER_PHASE_TEXT, CHAPTER_RUNNING_TEXT, RESOURCE_NAMES } from './stage-text'
import { StageMark } from './StageSpine'

type Text = (zh: string, en: string) => string

const RESOURCE_ICONS: Record<ResourcePage, LucideIcon> = {
  plot: GitBranch,
  worldbook: BookMarked,
  history: BookOpen,
}

interface MaterialsRailProps {
  stages: readonly StageStatus[]
  chapters: readonly ChapterRow[]
  location: StageLocation | null
  settingsOpen?: boolean
  onStage: (stage: WorkStage) => void
  onChapter: (chapterNumber: number) => void
  onResource: (page: ResourcePage) => void
  onSettings: () => void
}

function ChapterStatus({ row, text }: { row: ChapterRow; text: Text }) {
  if (row.running) return <span className="stage-chapter-status" data-tone="accent">{text(...CHAPTER_RUNNING_TEXT)}</span>
  if (row.phase === 'final') return <span className="stage-chapter-dot" role="img" aria-label={text(...CHAPTER_PHASE_TEXT.final)} />
  if (row.phase === 'todo') return null
  return <span className="stage-chapter-status">{text(...CHAPTER_PHASE_TEXT[row.phase])}</span>
}

/** 打开作品后的左栏：章节列表 + 人物/背景等设定入口，取代流程脊主导航。 */
export default function MaterialsRail({
  stages, chapters, location: activeLocation, settingsOpen, onStage, onChapter, onResource, onSettings,
}: MaterialsRailProps) {
  const location = settingsOpen ? null : activeLocation
  const text = useLocaleStore(s => s.text)
  const currentChapter = location?.kind === 'stage' ? location.chapter : undefined
  const currentRow = useRef<HTMLButtonElement>(null)
  const manuscript = stages.find(status => status.stage === 'manuscript')

  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'nearest' })
  }, [currentChapter, chapters.length])

  const row = (key: string, current: boolean, onClick: () => void, children: ReactNode, attributes: Record<string, string> = {}) => (
    <li key={key}>
      <button type="button" className="stage-row" aria-current={current ? 'page' : undefined} onClick={onClick} {...attributes}>
        {children}
      </button>
    </li>
  )

  return (
    <nav className="stage-spine materials-rail" aria-label={text('作品材料', 'Work materials')}>
      <div className="stage-spine-label">{text('正文', 'Manuscript')}</div>
      <ul className="stage-chapters">
        {chapters.length === 0 ? (
          <li>
            <button
              type="button"
              className="stage-row"
              aria-current={location?.kind === 'stage' && location.stage === 'manuscript' ? 'page' : undefined}
              onClick={() => onStage('manuscript')}
            >
              <span className="stage-row-label">{text('打开当前章', 'Open current chapter')}</span>
              {manuscript && <StageMark progress={manuscript.progress} />}
            </button>
          </li>
        ) : chapters.map(chapter => {
          const current = currentChapter === chapter.number
          return (
            <li key={chapter.number}>
              <button
                ref={current ? currentRow : undefined}
                type="button"
                className="stage-chapter"
                data-phase={chapter.phase}
                aria-current={current ? 'page' : undefined}
                onClick={() => onChapter(chapter.number)}
              >
                <span className="stage-chapter-no">{chapter.number}</span>
                <span className="stage-chapter-title">{chapter.title || chapterLabel(chapter.number, text)}</span>
                <ChapterStatus row={chapter} text={text} />
              </button>
            </li>
          )
        })}
      </ul>

      <div className="stage-spine-label stage-spine-label--resources">{text('设定', 'Settings & lore')}</div>
      <ul className="stage-stages">
        {row('worldbook', location?.kind === 'resource' && location.page === 'worldbook',
          () => onResource('worldbook'),
          <>
            <BookMarked size={15} strokeWidth={1.6} aria-hidden="true" />
            <span className="stage-row-label">{text('世界书', 'Worldbook')}</span>
          </>)}
      </ul>

      <div className="stage-spine-label stage-spine-label--resources">{text('资料', 'Reference')}</div>
      <ul className="stage-resources">
        {(['plot', 'history'] as ResourcePage[]).map(page => {
          const Icon = RESOURCE_ICONS[page]
          return row(`resource-${page}`, location?.kind === 'resource' && location.page === page,
            () => onResource(page),
            <>
              <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
              <span className="stage-row-label">{text(...RESOURCE_NAMES[page])}</span>
            </>)
        })}
        {row('app-settings', Boolean(settingsOpen), onSettings,
          <>
            <Settings size={15} strokeWidth={1.6} aria-hidden="true" />
            <span className="stage-row-label">{text('应用设置', 'App settings')}</span>
          </>)}
      </ul>
    </nav>
  )
}
