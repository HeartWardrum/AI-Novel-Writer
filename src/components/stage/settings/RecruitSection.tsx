import { useEffect } from 'react'
import {
  RECRUIT_FIELDS,
  RECRUIT_FIELD_LABELS,
  type RecruitField,
} from '../../../shared/recruit-questionnaire'
import { useLocaleStore } from '../../../stores/locale-store'
import { useRecruitQuestionnaireStore } from '../../../stores/recruit-questionnaire-store'
import { useUnsavedSettings } from '../../settings/unsaved-settings'
import { Button } from '../../ui/Button'

/** 酒馆招新题库：题干、选项、题数可改；保存到本机。 */
export default function RecruitSection() {
  const text = useLocaleStore(s => s.text)
  const hydrate = useRecruitQuestionnaireStore(s => s.hydrate)
  const draft = useRecruitQuestionnaireStore(s => s.draft)
  const dirty = useRecruitQuestionnaireStore(s => s.dirty)
  const savedFlash = useRecruitQuestionnaireStore(s => s.savedFlash)
  const updateQuestion = useRecruitQuestionnaireStore(s => s.updateQuestion)
  const addQuestion = useRecruitQuestionnaireStore(s => s.addQuestion)
  const removeQuestion = useRecruitQuestionnaireStore(s => s.removeQuestion)
  const moveQuestion = useRecruitQuestionnaireStore(s => s.moveQuestion)
  const resetDraftToDefault = useRecruitQuestionnaireStore(s => s.resetDraftToDefault)
  const save = useRecruitQuestionnaireStore(s => s.save)

  useEffect(() => { hydrate() }, [hydrate])
  useUnsavedSettings(dirty)

  return (
    <div className="stage-set-rows">
      <div className="stage-set-row">
        <div>
          <p className="stage-set-row-title">{text('招新题目', '招新题目')}</p>
          <p className="stage-set-row-desc">
            {text(
              '点「酒馆招新」时展示这些题。每题绑定一个字段，可增删改。确定入库 / 推荐三人的提示词在「提示词模板」中的「酒馆招新」条目修改。',
              '点「酒馆招新」时展示这些题。每题绑定一个字段，可增删改。确定入库 / 推荐三人的提示词在「提示词模板」中的「酒馆招新」条目修改。',
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {draft.questions.map((question, index) => (
          <div
            key={question.id}
            className="rounded-md p-3"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {text(`第 ${index + 1} 题`, `第 ${index + 1} 题`)}
              </span>
              <select
                className="stage-select text-xs"
                value={question.field}
                onChange={e => updateQuestion(question.id, { field: e.target.value as RecruitField })}
                aria-label={text('绑定字段', '绑定字段')}
              >
                {RECRUIT_FIELDS.map(field => (
                  <option key={field} value={field}>
                    {text(RECRUIT_FIELD_LABELS[field][0], RECRUIT_FIELD_LABELS[field][1])}
                  </option>
                ))}
              </select>
              <div className="ml-auto flex gap-1">
                <Button variant="secondary" size="sm" disabled={index === 0} onClick={() => moveQuestion(question.id, -1)}>
                  {text('上移', '上移')}
                </Button>
                <Button variant="secondary" size="sm" disabled={index >= draft.questions.length - 1} onClick={() => moveQuestion(question.id, 1)}>
                  {text('下移', '下移')}
                </Button>
                <Button variant="secondary" size="sm" disabled={draft.questions.length <= 1} onClick={() => removeQuestion(question.id)}>
                  {text('删除', '删除')}
                </Button>
              </div>
            </div>
            <label className="stage-set-field mb-2 block">
              <span className="text-xs">{text('题干', '题干')}</span>
              <input
                className="pi-input w-full"
                value={question.stem}
                onChange={e => updateQuestion(question.id, { stem: e.target.value })}
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              {([0, 1, 2] as const).map(optIndex => (
                <label key={optIndex} className="stage-set-field block">
                  <span className="text-xs">{text(`选项 ${optIndex + 1}`, `选项 ${optIndex + 1}`)}</span>
                  <input
                    className="pi-input w-full"
                    value={question.options[optIndex]}
                    onChange={e => {
                      const options: [string, string, string] = [...question.options]
                      options[optIndex] = e.target.value
                      updateQuestion(question.id, { options })
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="stage-set-actions flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => addQuestion()}>
          {text('添加题目', '添加题目')}
        </Button>
        <Button variant="secondary" onClick={() => resetDraftToDefault()}>
          {text('恢复默认', '恢复默认')}
        </Button>
        <span className="stage-set-saved" role="status">{savedFlash ? text('已保存', 'Saved') : ''}</span>
        <Button variant="primary" disabled={!dirty} onClick={() => save()}>
          {text('保存招新题库', '保存招新题库')}
        </Button>
      </div>
    </div>
  )
}
