import { describe, expect, it } from 'vitest'

import {
  defaultRecruitQuestionnaire,
  flattenRecruitAnswers,
  formatRecruitAnswersForPrompt,
  parseRecruitQuestionnaire,
  writeRecruitQuestionnaire,
} from '../recruit-questionnaire'

describe('recruit-questionnaire', () => {
  it('defaults to six field questions', () => {
    const q = defaultRecruitQuestionnaire()
    expect(q.questions).toHaveLength(6)
    expect(q.questions.map(item => item.field).sort()).toEqual([
      'age',
      'appearance',
      'gender',
      'name',
      'personality',
      'relationships',
    ])
  })

  it('round-trips storage and flattens answers', () => {
    const storage = {
      map: new Map<string, string>(),
      getItem(key: string) { return this.map.get(key) ?? null },
      setItem(key: string, value: string) { this.map.set(key, value) },
    }
    const saved = writeRecruitQuestionnaire(defaultRecruitQuestionnaire(), storage)
    expect(parseRecruitQuestionnaire(JSON.parse(storage.map.get('vela.recruit-questionnaire')!))).toEqual(saved)

    const nameQ = saved.questions.find(q => q.field === 'name')!
    const flat = flattenRecruitAnswers(saved.questions, {
      [nameQ.id]: { kind: 'custom', text: '林晚' },
    })
    expect(flat.name).toBe('林晚')
    expect(formatRecruitAnswersForPrompt(saved.questions, {
      [nameQ.id]: { kind: 'skipped' },
    })).toContain('（跳过）')
  })
})
