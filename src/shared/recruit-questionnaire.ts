/** 酒馆招新：可配置题库（全局 localStorage）。 */

export const RECRUIT_QUESTIONNAIRE_KEY = 'vela.recruit-questionnaire'

export const RECRUIT_FIELDS = [
  'name',
  'gender',
  'age',
  'relationships',
  'appearance',
  'personality',
] as const

export type RecruitField = (typeof RECRUIT_FIELDS)[number]

export const RECRUIT_FIELD_LABELS: Record<RecruitField, [string, string]> = {
  name: ['姓名', 'Name'],
  gender: ['性别', 'Gender'],
  age: ['年龄', 'Age'],
  relationships: ['人际关系', 'Relationships'],
  appearance: ['外貌', 'Appearance'],
  personality: ['性格', 'Personality'],
}

export interface RecruitQuestion {
  id: string
  field: RecruitField
  stem: string
  options: [string, string, string]
}

export interface RecruitQuestionnaire {
  version: 1
  questions: RecruitQuestion[]
}

export type RecruitAnswer =
  | { kind: 'option'; index: 0 | 1 | 2 }
  | { kind: 'custom'; text: string }
  | { kind: 'skipped' }

export type RecruitAnswers = Record<string, RecruitAnswer>

function isField(value: unknown): value is RecruitField {
  return typeof value === 'string' && (RECRUIT_FIELDS as readonly string[]).includes(value)
}

function normalizeOptions(value: unknown): [string, string, string] {
  if (!Array.isArray(value) || value.length < 3) return ['', '', '']
  return [
    String(value[0] ?? '').trim(),
    String(value[1] ?? '').trim(),
    String(value[2] ?? '').trim(),
  ]
}

export function createRecruitQuestionId(): string {
  return crypto.randomUUID()
}

export function defaultRecruitQuestionnaire(): RecruitQuestionnaire {
  return {
    version: 1,
    questions: [
      {
        id: 'q-name',
        field: 'name',
        stem: '怎么称呼这个人？',
        options: ['先用代号', '尚未起名', '用外号'],
      },
      {
        id: 'q-gender',
        field: 'gender',
        stem: '性别观感？',
        options: ['男', '女', '不明或不重要'],
      },
      {
        id: 'q-age',
        field: 'age',
        stem: '年龄段？',
        options: ['少年', '青壮', '中老'],
      },
      {
        id: 'q-relationships',
        field: 'relationships',
        stem: '和主角或核心人物的关系？',
        options: ['盟友/同伴', '对手/阻碍', '中立或旁观'],
      },
      {
        id: 'q-appearance',
        field: 'appearance',
        stem: '外貌印象？',
        options: ['不起眼好认', '有明显特征', '扎眼或好看'],
      },
      {
        id: 'q-personality',
        field: 'personality',
        stem: '性格一句话？',
        options: ['沉稳靠谱', '跳脱话多', '阴着有算计'],
      },
    ],
  }
}

export function parseRecruitQuestionnaire(raw: unknown): RecruitQuestionnaire | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.questions)) return null
  const questions: RecruitQuestion[] = []
  for (const item of record.questions) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    if (typeof q.id !== 'string' || !q.id.trim()) continue
    if (!isField(q.field)) continue
    if (typeof q.stem !== 'string') continue
    questions.push({
      id: q.id.trim(),
      field: q.field,
      stem: q.stem.trim(),
      options: normalizeOptions(q.options),
    })
  }
  if (questions.length === 0) return null
  return { version: 1, questions }
}

export function readRecruitQuestionnaire(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): RecruitQuestionnaire {
  if (!storage) return defaultRecruitQuestionnaire()
  try {
    const raw = storage.getItem(RECRUIT_QUESTIONNAIRE_KEY)
    if (!raw) return defaultRecruitQuestionnaire()
    return parseRecruitQuestionnaire(JSON.parse(raw)) ?? defaultRecruitQuestionnaire()
  } catch {
    return defaultRecruitQuestionnaire()
  }
}

export function writeRecruitQuestionnaire(
  value: RecruitQuestionnaire,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): RecruitQuestionnaire {
  const parsed = parseRecruitQuestionnaire(value) ?? defaultRecruitQuestionnaire()
  if (storage) {
    try {
      storage.setItem(RECRUIT_QUESTIONNAIRE_KEY, JSON.stringify(parsed))
    } catch {
      /* ignore */
    }
  }
  return parsed
}

/** 把答卷摊成「字段 → 文本」；同字段多题时后答覆盖先答。 */
export function flattenRecruitAnswers(
  questions: readonly RecruitQuestion[],
  answers: RecruitAnswers,
): Partial<Record<RecruitField, string>> {
  const out: Partial<Record<RecruitField, string>> = {}
  for (const question of questions) {
    const answer = answers[question.id]
    if (!answer || answer.kind === 'skipped') continue
    if (answer.kind === 'custom') {
      const text = answer.text.trim()
      if (text) out[question.field] = text
      continue
    }
    const picked = question.options[answer.index]?.trim()
    if (picked) out[question.field] = picked
  }
  return out
}

export function formatRecruitAnswersForPrompt(
  questions: readonly RecruitQuestion[],
  answers: RecruitAnswers,
): string {
  const lines: string[] = []
  for (const question of questions) {
    const label = RECRUIT_FIELD_LABELS[question.field][0]
    const answer = answers[question.id]
    let value = '（未答）'
    if (answer?.kind === 'skipped') value = '（跳过）'
    else if (answer?.kind === 'custom' && answer.text.trim()) value = answer.text.trim()
    else if (answer?.kind === 'option') {
      const picked = question.options[answer.index]?.trim()
      if (picked) value = picked
    }
    lines.push(`- ${label}（${question.stem}）：${value}`)
  }
  return lines.join('\n')
}
