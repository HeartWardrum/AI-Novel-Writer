import type { WritingLanguage } from './writing-language'
import { writingLanguageText as promptLanguageText } from './writing-language'

export interface BlueprintNextNeighborSummary {
  chapterNumber: number
  title: string
  role: string
  purpose: string
  keyEvents: string
  suspenseHook: string
  characters: string[]
}

export interface BlueprintNextArchitectureBrief {
  premise: string
  synopsis: string
  globalGuidance: string
}

export interface BlueprintNextBlueprintSnapshot {
  chapterNumber: number
  title: string
  role: string
  purpose: string
  keyEvents: string
  suspenseHook: string
  characters: string[]
}

export type BlueprintNextMode = 'function' | 'cost' | 'pov' | 'reverse' | 'bad'
export type BlueprintNextFunctionRole = 'info' | 'relationship' | 'pressure' | 'twist'
export type BlueprintNextPov = 'protagonist' | 'antagonist' | 'bystander'

export interface BlueprintNextWritableFields {
  purpose: string
  keyEvents: string
  suspenseHook: string
  characters: string[]
}

export type BlueprintNextOption =
  | ({
    kind: 'writable'
    label: string
    rationale: string
    cost?: string
    functionRole?: BlueprintNextFunctionRole
    pov?: BlueprintNextPov
  } & BlueprintNextWritableFields)
  | {
    kind: 'bad'
    label: string
    whyBad: string
  }

export const BLUEPRINT_NEXT_BUDGET = Object.freeze({
  maxAttempts: 1,
  maxRequestedOutputTokens: 4096,
  maxRequestedOutputTokensPerAttempt: 4096,
  deadlineMs: 120_000,
})

const MODES = new Set<BlueprintNextMode>(['function', 'cost', 'pov', 'reverse', 'bad'])
const FUNCTION_ROLES: BlueprintNextFunctionRole[] = ['info', 'relationship', 'pressure', 'twist']
const POVS: BlueprintNextPov[] = ['protagonist', 'antagonist', 'bystander']

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= maxLength ? text : null
}

function parseCharacters(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > 24) return null
  const names: string[] = []
  for (const item of value) {
    const name = boundedText(item, 40)
    if (!name) return null
    names.push(name)
  }
  return names
}

function parseWritable(value: Record<string, unknown>, mode: BlueprintNextMode): BlueprintNextOption | null {
  if (value.kind !== 'writable') return null
  const label = boundedText(value.label, 80)
  const rationale = boundedText(value.rationale, 400)
  const purpose = boundedText(value.purpose, 400)
  const keyEvents = boundedText(value.keyEvents, 800)
  const suspenseHook = boundedText(value.suspenseHook, 400)
  const characters = parseCharacters(value.characters)
  if (!label || !rationale || !purpose || !keyEvents || !suspenseHook || !characters) return null

  if (mode === 'cost') {
    const cost = boundedText(value.cost, 200)
    if (!cost) return null
    return { kind: 'writable', label, rationale, cost, purpose, keyEvents, suspenseHook, characters }
  }
  if (mode === 'function') {
    const functionRole = boundedText(value.functionRole, 32)
    if (!functionRole || !FUNCTION_ROLES.includes(functionRole as BlueprintNextFunctionRole)) return null
    return {
      kind: 'writable',
      label,
      rationale,
      functionRole: functionRole as BlueprintNextFunctionRole,
      purpose,
      keyEvents,
      suspenseHook,
      characters,
    }
  }
  if (mode === 'pov') {
    const pov = boundedText(value.pov, 32)
    if (!pov || !POVS.includes(pov as BlueprintNextPov)) return null
    return {
      kind: 'writable',
      label,
      rationale,
      pov: pov as BlueprintNextPov,
      purpose,
      keyEvents,
      suspenseHook,
      characters,
    }
  }
  if (mode === 'reverse') {
    return { kind: 'writable', label, rationale, purpose, keyEvents, suspenseHook, characters }
  }
  return null
}

function parseBad(value: Record<string, unknown>): BlueprintNextOption | null {
  if (value.kind !== 'bad') return null
  const label = boundedText(value.label, 80)
  const whyBad = boundedText(value.whyBad, 400)
  if (!label || !whyBad) return null
  return { kind: 'bad', label, whyBad }
}

export function isBlueprintNextMode(value: unknown): value is BlueprintNextMode {
  return typeof value === 'string' && MODES.has(value as BlueprintNextMode)
}

/** Parse model JSON into mode-validated options. Throws on invalid shape. */
export function parseBlueprintNextOptions(content: string, mode: BlueprintNextMode): BlueprintNextOption[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content.trim())
  } catch {
    throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
  }
  const root = record(parsed)
  if (!root || !Array.isArray(root.options)) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
  const options = root.options.map((item): BlueprintNextOption => {
    const value = record(item)
    if (!value) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
    if (mode === 'bad') {
      const bad = parseBad(value)
      if (!bad) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
      return bad
    }
    const writable = parseWritable(value, mode)
    if (!writable) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
    return writable
  })

  if (mode === 'function') {
    if (options.length !== 4) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
    const roles = options.map(option => option.kind === 'writable' ? option.functionRole : undefined)
    if (FUNCTION_ROLES.some((role, index) => roles[index] !== role)) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
  } else if (mode === 'cost') {
    if (options.length < 3 || options.length > 4) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
  } else if (mode === 'pov') {
    if (options.length !== 3) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
    const povs = options.map(option => option.kind === 'writable' ? option.pov : undefined)
    if (POVS.some((pov, index) => povs[index] !== pov)) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
  } else if (mode === 'reverse') {
    if (options.length < 1 || options.length > 2) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
  } else if (mode === 'bad') {
    if (options.length < 3 || options.length > 4) throw new Error('BLUEPRINT_NEXT_OPTIONS_INVALID')
  }

  return options
}

export function writableFieldsFromOption(option: BlueprintNextOption): BlueprintNextWritableFields | null {
  if (option.kind !== 'writable') return null
  return {
    purpose: option.purpose,
    keyEvents: option.keyEvents,
    suspenseHook: option.suspenseHook,
    characters: [...option.characters],
  }
}

function modeInstructions(mode: BlueprintNextMode, language: WritingLanguage): string {
  return promptLanguageText(
    language,
    ({
      function: '给出恰好 4 条可写入选项，functionRole 依次必须是 info、relationship、pressure、twist（信息推进 / 人物关系变化 / 蓄势加压 / 意外转折）。选项彼此不能雷同。每条含 label、rationale、functionRole、purpose、keyEvents、suspenseHook、characters。kind 一律为 writable。只输出 JSON：{"options":[...]}。',
      cost: '给出 3～4 条可写入选项。每条必须有非空 cost，说明主角要付出的具体代价；无代价的选项禁止出现。每条含 label、rationale、cost、purpose、keyEvents、suspenseHook、characters。kind 一律为 writable。只输出 JSON：{"options":[...]}。',
      pov: '给出恰好 3 条可写入选项，pov 依次必须是 protagonist、antagonist、bystander（同一局面分别从主角、对手、旁观者推进）。每条含 label、rationale、pov、purpose、keyEvents、suspenseHook、characters。kind 一律为 writable。只输出 JSON：{"options":[...]}。',
      reverse: '给出 1～2 条可写入选项，回答：如果这一章主角什么都不做，局面会怎么恶化，并据此形成被动推进。每条含 label、rationale、purpose、keyEvents、suspenseHook、characters。kind 一律为 writable。只输出 JSON：{"options":[...]}。',
      bad: '给出 3～4 条坏选项：看似合理但会伤害故事。每条 kind 必须是 bad，只含 label 与 whyBad，禁止附带 purpose/keyEvents 等蓝图字段。只输出 JSON：{"options":[...]}。',
    } as const)[mode],
    ({
      function: 'Return exactly 4 writable options whose functionRole values are info, relationship, pressure, twist in that order. Options must not be redundant. Each item needs label, rationale, functionRole, purpose, keyEvents, suspenseHook, characters. kind must be writable. JSON only: {"options":[...]}.',
      cost: 'Return 3–4 writable options. Each must include a non-empty cost stating what the protagonist pays; options without cost are forbidden. Each needs label, rationale, cost, purpose, keyEvents, suspenseHook, characters. kind must be writable. JSON only: {"options":[...]}.',
      pov: 'Return exactly 3 writable options whose pov values are protagonist, antagonist, bystander in that order for the same situation. Each needs label, rationale, pov, purpose, keyEvents, suspenseHook, characters. kind must be writable. JSON only: {"options":[...]}.',
      reverse: 'Return 1–2 writable options answering how the situation worsens if the protagonist does nothing this chapter, forming passive advancement. Each needs label, rationale, purpose, keyEvents, suspenseHook, characters. kind must be writable. JSON only: {"options":[...]}.',
      bad: 'Return 3–4 bad options that look reasonable but would harm the story. Each kind must be bad with only label and whyBad; never include blueprint fields. JSON only: {"options":[...]}.',
    } as const)[mode],
  )
}

export function buildBlueprintNextTask(input: {
  writingLanguage: WritingLanguage
  mode: BlueprintNextMode
  totalChapters: number
  blueprint: BlueprintNextBlueprintSnapshot
  neighbors: BlueprintNextNeighborSummary[]
  architecture: BlueprintNextArchitectureBrief
}) {
  return {
    purpose: 'blueprint-next-options',
    reasoningStage: 'planning' as const,
    output: 'structured-data' as const,
    messages: [
      {
        role: 'system' as const,
        content: promptLanguageText(
          input.writingLanguage,
          `你是小说结构参谋。针对当前章节给出互不雷同的下一步方向，帮助作者摆脱「不知道接下来写什么」。不要声称正文已发生。不要生成整本目录。${modeInstructions(input.mode, input.writingLanguage)}`,
          `You are a fiction structure advisor. Propose non-redundant next-chapter directions for the current chapter so the author is not stuck. Never claim manuscript events already happened. Do not generate a full outline. ${modeInstructions(input.mode, input.writingLanguage)}`,
        ),
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          mode: input.mode,
          totalChapters: input.totalChapters,
          chapterNumber: input.blueprint.chapterNumber,
          blueprint: {
            title: input.blueprint.title,
            role: input.blueprint.role,
            purpose: input.blueprint.purpose,
            keyEvents: input.blueprint.keyEvents,
            suspenseHook: input.blueprint.suspenseHook,
            characters: input.blueprint.characters,
          },
          neighbors: input.neighbors,
          architecture: input.architecture,
        }),
      },
    ],
  }
}
