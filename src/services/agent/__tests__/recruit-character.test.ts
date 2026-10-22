import { describe, expect, it } from 'vitest'

import {
  answersFromRecommendation,
  buildCardFromAnswers,
  buildRecruitWorldbookSaveRequest,
  parseRecruitCharacterCard,
  parseRecruitRecommendations,
} from '../recruit-character'
import { defaultRecruitQuestionnaire } from '../../../shared/recruit-questionnaire'

describe('recruit-character form helpers', () => {
  it('parses finalize card and recommend list', () => {
    const card = parseRecruitCharacterCard(JSON.stringify({
      name: '林晚',
      gender: '女',
      age: '青壮',
      relationships: '旧友',
      appearance: '青衫',
      personality: '沉稳',
      keywords: ['林晚'],
    }))
    expect(card?.name).toBe('林晚')
    expect(buildRecruitWorldbookSaveRequest(card!).kind).toBe('character')

    const list = parseRecruitRecommendations(JSON.stringify([
      { name: '阿禾', gender: '女', age: '', relationships: '', appearance: '', personality: '', keywords: [], reason: '带路' },
      { name: '老槐', gender: '男', age: '', relationships: '', appearance: '', personality: '', keywords: [], reason: '知情' },
      { name: '铁算', gender: '男', age: '', relationships: '', appearance: '', personality: '', keywords: [], reason: '冲突' },
    ]))
    expect(list).toHaveLength(3)
  })

  it('builds card from answers and prefills from recommendation', () => {
    const questions = defaultRecruitQuestionnaire().questions
    const nameQ = questions.find(q => q.field === 'name')!
    const card = buildCardFromAnswers(questions, {
      [nameQ.id]: { kind: 'custom', text: '林晚' },
    })
    expect(card.name).toBe('林晚')

    const answers = answersFromRecommendation(questions, {
      name: '阿禾',
      gender: '女',
      age: '少年',
      relationships: '路人',
      appearance: '麻衣',
      personality: '胆大',
      keywords: ['阿禾'],
      reason: '带路',
    })
    expect(answers[nameQ.id]).toEqual({ kind: 'custom', text: '阿禾' })
  })
})
