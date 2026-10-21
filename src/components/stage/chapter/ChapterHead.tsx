import type { ReactNode } from 'react'
import { chapterLabel } from '../../../shared/chapter-label'
import { getChapterRoleLabels } from '../../../shared/chapter-role'
import { useLocaleStore } from '../../../stores/locale-store'

/** 章节头：大号章号、可选定位、可编辑标题与右侧字数。沉浸写作时只留标题与字数。 */
export default function ChapterHead({
  chapterNumber, role, title, onTitleChange, titleReadOnly, meta, focus,
}: {
  chapterNumber: number
  role?: string
  title: string
  onTitleChange?: (title: string) => void
  titleReadOnly?: boolean
  meta?: ReactNode
  focus: boolean
}) {
  const text = useLocaleStore(s => s.text)
  const roleLabels = getChapterRoleLabels(role)
  const roleText = roleLabels ? text(roleLabels.zhCN, roleLabels.enUS) : role
  const placeholder = chapterLabel(chapterNumber, text)
  const readOnly = titleReadOnly || !onTitleChange
  return (
    <header className="stage-ch-head">
      {!focus && (
        <div className="stage-ch-kicker">
          <span className="stage-ch-numeral" aria-hidden="true">{chapterNumber}</span>
          <span className="stage-ch-eyebrow">{roleText ? `${placeholder} · ${roleText}` : placeholder}</span>
        </div>
      )}
      <div className="stage-ch-titlerow">
        {readOnly ? (
          <h1 className="stage-ch-title">{title || placeholder}</h1>
        ) : (
          <input
            className="stage-ch-title stage-ch-title-input"
            value={title}
            placeholder={placeholder}
            aria-label={text('本章标题', 'Chapter title')}
            onChange={event => onTitleChange(event.target.value)}
          />
        )}
        {meta}
      </div>
    </header>
  )
}
