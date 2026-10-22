import { useEffect } from 'react'
import { useLocaleStore } from '../../../stores/locale-store'
import { useAgentStore } from '../../../stores/agent-store'
import { useRecruitQuestionnaireStore } from '../../../stores/recruit-questionnaire-store'
import { RECRUIT_FIELD_LABELS } from '../../../shared/recruit-questionnaire'

/** 酒馆招新表单：本地答题，确定/推荐才调 AI。 */
export default function RecruitForm() {
  const text = useLocaleStore(s => s.text)
  const answers = useAgentStore(s => s.recruitAnswers)
  const recommendations = useAgentStore(s => s.recruitRecommendations)
  const recruitBusy = useAgentStore(s => s.recruitBusy)
  const setRecruitAnswer = useAgentStore(s => s.setRecruitAnswer)
  const recommendRecruit = useAgentStore(s => s.recommendRecruit)
  const applyRecruitRecommendation = useAgentStore(s => s.applyRecruitRecommendation)
  const hydrate = useRecruitQuestionnaireStore(s => s.hydrate)
  const questions = useRecruitQuestionnaireStore(s => s.saved.questions)
  useEffect(() => { hydrate() }, [hydrate])

  return (
    <div className="flex flex-col gap-3 px-1 pb-2">
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {text(
          '每题可选一项、自己写或跳过。未答留空。确定招募时才调用 AI 写入世界书。',
          '每题可选一项、自己写或跳过。未答留空。确定招募时才调用 AI 写入世界书。',
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={recruitBusy}
          onClick={() => { void recommendRecruit() }}
          className="rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50"
          style={{
            color: 'var(--color-accent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
            background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
          }}
        >
          {recruitBusy ? text('推荐中…', '推荐中…') : text('推荐三人', '推荐三人')}
        </button>
      </div>

      {recommendations.length > 0 && (
        <div className="flex flex-col gap-2">
          {recommendations.map((item, index) => (
            <button
              key={`${item.name}-${index}`}
              type="button"
              disabled={recruitBusy}
              onClick={() => applyRecruitRecommendation(index)}
              className="rounded-md px-3 py-2 text-left text-xs transition-colors disabled:opacity-50"
              style={{
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            >
              <div className="font-medium">{item.name}</div>
              <div style={{ color: 'var(--color-text-muted)' }}>
                {[item.gender, item.age, item.personality].filter(Boolean).join(' · ')}
              </div>
              {item.reason ? (
                <div className="mt-1" style={{ color: 'var(--color-text-secondary)' }}>{item.reason}</div>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {questions.map((question, index) => {
        const answer = answers[question.id]
        const customText = answer?.kind === 'custom' ? answer.text : ''
        const selectedIndex = answer?.kind === 'option' ? answer.index : null
        const skipped = answer?.kind === 'skipped'
        return (
          <div
            key={question.id}
            className="rounded-md px-3 py-2"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div className="mb-1.5 text-xs font-medium" style={{ color: 'var(--color-text)' }}>
              {index + 1}. {question.stem}
              <span className="ml-1 font-normal" style={{ color: 'var(--color-text-muted)' }}>
                ({text(RECRUIT_FIELD_LABELS[question.field][0], RECRUIT_FIELD_LABELS[question.field][1])})
              </span>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {question.options.map((option, optIndex) => (
                <button
                  key={optIndex}
                  type="button"
                  disabled={!option.trim() || recruitBusy}
                  onClick={() => setRecruitAnswer(question.id, {
                    kind: 'option',
                    index: optIndex as 0 | 1 | 2,
                  })}
                  className="rounded px-2 py-0.5 text-[0.7rem] disabled:opacity-40"
                  style={{
                    border: '1px solid var(--color-border)',
                    background: selectedIndex === optIndex
                      ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)'
                      : 'transparent',
                    color: 'var(--color-text)',
                  }}
                >
                  {option || text('（空选项）', '（空选项）')}
                </button>
              ))}
              <button
                type="button"
                disabled={recruitBusy}
                onClick={() => setRecruitAnswer(question.id, { kind: 'skipped' })}
                className="rounded px-2 py-0.5 text-[0.7rem] disabled:opacity-50"
                style={{
                  border: '1px solid var(--color-border)',
                  background: skipped ? 'var(--color-hover)' : 'transparent',
                  color: 'var(--color-text-muted)',
                }}
              >
                {text('跳过', '跳过')}
              </button>
            </div>
            <input
              className="w-full rounded px-2 py-1 text-xs outline-none"
              style={{
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
              placeholder={text('或自己填写…', '或自己填写…')}
              value={customText}
              disabled={recruitBusy}
              onChange={e => {
                const value = e.target.value
                if (!value.trim()) setRecruitAnswer(question.id, null)
                else setRecruitAnswer(question.id, { kind: 'custom', text: value })
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
