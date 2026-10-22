/**
 * 酒馆招新：表单答卷 → 世界书人物；推荐三人解析。
 */

import {
  flattenRecruitAnswers,
  type RecruitAnswers,
  type RecruitField,
  type RecruitQuestion,
} from '../../shared/recruit-questionnaire'
import {
  defaultWorldbookActivation,
  type WorldbookEntrySaveRequest,
} from '../../shared/worldbook'

export interface RecruitCharacterCard {
  name: string
  gender: string
  age: string
  relationships: string
  appearance: string
  personality: string
  keywords: string[]
}

export interface RecruitRecommendation extends RecruitCharacterCard {
  reason: string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => asString(item)).filter(Boolean)
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim()
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractJsonArray(raw: string): unknown[] | null {
  const text = raw.trim()
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function cardFromRecord(parsed: Record<string, unknown>, fallbackName = ''): RecruitCharacterCard | null {
  const name = asString(parsed.name) || fallbackName
  if (!name) return null
  const keywords = asStringArray(parsed.keywords)
  return {
    name,
    gender: asString(parsed.gender),
    age: asString(parsed.age),
    relationships: asString(parsed.relationships),
    appearance: asString(parsed.appearance),
    personality: asString(parsed.personality),
    keywords: keywords.length > 0 ? keywords : [name],
  }
}

export function parseRecruitCharacterCard(raw: string, fallbackName = ''): RecruitCharacterCard | null {
  const parsed = extractJsonObject(raw)
  if (!parsed) return null
  return cardFromRecord(parsed, fallbackName)
}

export function parseRecruitRecommendations(raw: string): RecruitRecommendation[] {
  const arr = extractJsonArray(raw)
  if (!arr) return []
  const out: RecruitRecommendation[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const card = cardFromRecord(record)
    if (!card) continue
    out.push({ ...card, reason: asString(record.reason) })
    if (out.length >= 3) break
  }
  return out
}

export function cardFromFlattenedAnswers(
  flat: Partial<Record<RecruitField, string>>,
): RecruitCharacterCard {
  const name = flat.name?.trim() || '未名新人'
  return {
    name,
    gender: flat.gender?.trim() ?? '',
    age: flat.age?.trim() ?? '',
    relationships: flat.relationships?.trim() ?? '',
    appearance: flat.appearance?.trim() ?? '',
    personality: flat.personality?.trim() ?? '',
    keywords: [name],
  }
}

export function formatRecruitCharacterContent(card: RecruitCharacterCard): string {
  return [
    `姓名：${card.name}`,
    card.gender ? `性别：${card.gender}` : '',
    card.age ? `年龄：${card.age}` : '',
    card.relationships ? `人际关系：${card.relationships}` : '',
    card.appearance ? `外貌：${card.appearance}` : '',
    card.personality ? `性格：${card.personality}` : '',
  ].filter(Boolean).join('\n')
}

export function buildRecruitWorldbookSaveRequest(card: RecruitCharacterCard): WorldbookEntrySaveRequest {
  const activation = defaultWorldbookActivation('character')
  const keys = [...new Set([card.name, ...card.keywords].map(k => k.trim()).filter(Boolean))]
  return {
    kind: 'character',
    title: card.name,
    content: formatRecruitCharacterContent(card),
    activation: {
      ...activation,
      primaryKeys: keys,
      secondaryKeys: [],
      alwaysOn: false,
      enabled: true,
    },
  }
}

export function buildCardFromAnswers(
  questions: readonly RecruitQuestion[],
  answers: RecruitAnswers,
): RecruitCharacterCard {
  return cardFromFlattenedAnswers(flattenRecruitAnswers(questions, answers))
}

/** 推荐结果预填：按字段写入「自定义」答案（同字段第一题）。 */
export function answersFromRecommendation(
  questions: readonly RecruitQuestion[],
  recommendation: RecruitRecommendation,
): RecruitAnswers {
  const byField: Record<RecruitField, string> = {
    name: recommendation.name,
    gender: recommendation.gender,
    age: recommendation.age,
    relationships: recommendation.relationships,
    appearance: recommendation.appearance,
    personality: recommendation.personality,
  }
  const answers: RecruitAnswers = {}
  const filled = new Set<RecruitField>()
  for (const question of questions) {
    if (filled.has(question.field)) continue
    const text = byField[question.field]?.trim()
    if (!text) continue
    answers[question.id] = { kind: 'custom', text }
    filled.add(question.field)
  }
  return answers
}
