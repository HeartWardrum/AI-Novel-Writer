export const WORLD_BOOK_ENTRY_KINDS = [
  'project',
  'premise',
  'world',
  'rule',
  'character',
  'organization',
  'location',
  'item',
  'relationship',
  'plot-thread',
  'blueprint',
  'chapter',
  'reference',
  'custom',
] as const

export type WorldbookEntryKind = typeof WORLD_BOOK_ENTRY_KINDS[number]
export type WorldbookPromptPolicy = 'full' | 'excerpt' | 'browse-only'
export type WorldbookMatchMode = 'any' | 'all'
export type WorldbookStage = 'setup' | 'planning' | 'drafting' | 'review' | 'finalization'

export const WORLD_BOOK_STAGES: readonly WorldbookStage[] = Object.freeze([
  'setup',
  'planning',
  'drafting',
  'review',
  'finalization',
])

export interface WorldbookActivation {
  primaryKeys: string[]
  secondaryKeys: string[]
  matchMode: WorldbookMatchMode
  alwaysOn: boolean
  enabled: boolean
  stages: WorldbookStage[]
  priority: number
  insertionOrder: number
  group: string
  promptPolicy: WorldbookPromptPolicy
}

export type WorldbookSourceKind =
  | 'author'
  | 'project'
  | 'character'
  | 'blueprint'
  | 'chapter'
  | 'plot-thread'
  | 'reference'
  | 'import'

export interface WorldbookSource {
  kind: WorldbookSourceKind
  id: string
  revision: string
}

export interface WorldbookEntry {
  id: string
  kind: WorldbookEntryKind
  title: string
  content: string
  promptContent: string
  activation: WorldbookActivation
  source: WorldbookSource
  editable: boolean
  needsReview: boolean
  revision: number
  updatedAt: string
}

/** 作品设定/定稿等可拷进世界书的候选；拷贝后成为可随时改的独立条目。 */
export interface WorldbookSourceCandidate {
  id: string
  kind: WorldbookEntryKind
  title: string
  content: string
  activation: WorldbookActivation
  origin: WorldbookSource
  alreadyImported: boolean
}

export interface WorldbookEntrySaveRequest {
  id?: string
  kind: WorldbookEntryKind
  title: string
  content: string
  activation: WorldbookActivation
  sourceKind?: 'author' | 'import'
  sourceId?: string
  expectedRevision?: number
  needsReview?: boolean
}

export interface WorldbookActivationSaveRequest {
  entryId: string
  activation: WorldbookActivation
}

export interface WorldbookResolveRequest {
  stage: WorldbookStage
  chapterNumber?: number
  chapterTitle?: string
  blueprintText?: string
  characters?: string[]
  authorGuidance?: string
  previousEnding?: string
  draftText?: string
  budgetTokens?: number
  forceIncludeIds?: string[]
  forceExcludeIds?: string[]
  semanticMatches?: Array<{ entryId: string; score: number }>
}

export interface WorldbookSelection {
  entryId: string
  title: string
  kind: WorldbookEntryKind
  content: string
  source: WorldbookSource
  revision: number
  reason: 'always-on' | 'primary-key' | 'secondary-key' | 'semantic' | 'manual'
  matchedKeys: string[]
  score: number
  estimatedTokens: number
}

export interface WorldbookResolveResult {
  selections: WorldbookSelection[]
  omitted: Array<{ entryId: string; title: string; reason: 'budget' | 'disabled' | 'stage' | 'duplicate' | 'excluded' }>
  tokenEstimate: number
  budgetTokens: number
  requiredOverflow: boolean
  resolvedQuery: string
}

export function defaultWorldbookActivation(kind: WorldbookEntryKind = 'custom'): WorldbookActivation {
  const projectBase = kind === 'project' || kind === 'rule'
  const chapterSummary = kind === 'chapter'
  const blueprint = kind === 'blueprint'
  return {
    primaryKeys: [],
    secondaryKeys: [],
    matchMode: 'any',
    alwaysOn: projectBase || blueprint,
    enabled: true,
    stages: projectBase
      ? ['setup', 'planning', 'drafting', 'review', 'finalization']
      : blueprint
        ? ['planning', 'drafting', 'review', 'finalization']
        : ['planning', 'drafting', 'review'],
    priority: projectBase ? 100 : blueprint ? 80 : kind === 'character' ? 60 : 0,
    insertionOrder: 0,
    group: kind,
    promptPolicy: chapterSummary ? 'excerpt' : 'full',
  }
}

/** Deterministic estimate used for UI preflight; provider usage receipts remain authoritative. */
export function estimateWorldbookTokens(value: string): number {
  if (!value) return 0
  const cjk = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length
  const other = Math.max(0, value.length - cjk)
  return Math.ceil(cjk + other / 4)
}

function normalizedText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function keyMatches(key: string, haystack: string): boolean {
  const normalized = normalizedText(key.trim())
  return normalized.length > 0 && haystack.includes(normalized)
}

function stageAllowed(activation: WorldbookActivation, stage: WorldbookStage): boolean {
  return activation.stages.length === 0 || activation.stages.includes(stage)
}

function resolvedContent(entry: WorldbookEntry): string {
  if (entry.activation.promptPolicy === 'browse-only') return ''
  if (entry.activation.promptPolicy === 'excerpt') return entry.promptContent || entry.content
  return entry.content
}

/**
 * Resolve a reproducible worldbook context. Exact matches and always-on entries
 * are mandatory; semantic matches fill remaining budget in priority/order.
 */
export function resolveWorldbookEntries(
  entries: readonly WorldbookEntry[],
  request: WorldbookResolveRequest,
): WorldbookResolveResult {
  const haystack = normalizedText([
    request.chapterTitle,
    request.blueprintText,
    ...(request.characters ?? []),
    request.authorGuidance,
    request.previousEnding,
    request.draftText,
  ].filter(Boolean).join('\n'))
  const semantic = new Map((request.semanticMatches ?? []).map(item => [item.entryId, item.score]))
  const excluded = new Set(request.forceExcludeIds ?? [])
  const forced = new Set(request.forceIncludeIds ?? [])
  const omitted: WorldbookResolveResult['omitted'] = []
  const candidates: Array<WorldbookSelection & { mandatory: boolean }> = []

  for (const entry of entries) {
    if (excluded.has(entry.id)) {
      omitted.push({ entryId: entry.id, title: entry.title, reason: 'excluded' })
      continue
    }
    if (!entry.activation.enabled) {
      omitted.push({ entryId: entry.id, title: entry.title, reason: 'disabled' })
      continue
    }
    if (!stageAllowed(entry.activation, request.stage)) {
      omitted.push({ entryId: entry.id, title: entry.title, reason: 'stage' })
      continue
    }
    const content = resolvedContent(entry)
    if (!content.trim()) {
      omitted.push({ entryId: entry.id, title: entry.title, reason: 'stage' })
      continue
    }
    const primaryMatched = entry.activation.primaryKeys.filter(key => keyMatches(key, haystack))
    const secondaryMatched = entry.activation.secondaryKeys.filter(key => keyMatches(key, haystack))
    const keywordMatch = entry.activation.matchMode === 'all'
      ? primaryMatched.length > 0 && secondaryMatched.length > 0
      : primaryMatched.length > 0 || secondaryMatched.length > 0
    const manual = forced.has(entry.id)
    const semanticScore = semantic.get(entry.id) ?? 0
    if (!entry.activation.alwaysOn && !keywordMatch && !manual && semanticScore <= 0) continue
    const reason: WorldbookSelection['reason'] = manual
      ? 'manual'
      : entry.activation.alwaysOn
        ? 'always-on'
        : primaryMatched.length > 0
          ? 'primary-key'
          : secondaryMatched.length > 0
            ? 'secondary-key'
            : 'semantic'
    candidates.push({
      entryId: entry.id,
      title: entry.title,
      kind: entry.kind,
      content,
      source: entry.source,
      revision: entry.revision,
      reason,
      matchedKeys: [...primaryMatched, ...secondaryMatched],
      score: (manual ? 1_000 : 0) + (entry.activation.alwaysOn ? 500 : 0)
        + primaryMatched.length * 20 + secondaryMatched.length * 8 + semanticScore,
      estimatedTokens: estimateWorldbookTokens(content),
      mandatory: manual || entry.activation.alwaysOn || keywordMatch,
    })
  }

  candidates.sort((left, right) => (
    Number(right.mandatory) - Number(left.mandatory)
    || right.score - left.score
    || entries.find(entry => entry.id === right.entryId)!.activation.priority
      - entries.find(entry => entry.id === left.entryId)!.activation.priority
    || entries.find(entry => entry.id === left.entryId)!.activation.insertionOrder
      - entries.find(entry => entry.id === right.entryId)!.activation.insertionOrder
    || left.entryId.localeCompare(right.entryId)
  ))

  const budgetTokens = Math.max(1, Math.floor(request.budgetTokens ?? 4_000))
  const selections: WorldbookSelection[] = []
  const seen = new Set<string>()
  let tokenEstimate = 0
  let requiredOverflow = false
  for (const candidate of candidates) {
    if (seen.has(candidate.entryId)) {
      omitted.push({ entryId: candidate.entryId, title: candidate.title, reason: 'duplicate' })
      continue
    }
    seen.add(candidate.entryId)
    if (tokenEstimate + candidate.estimatedTokens > budgetTokens) {
      omitted.push({ entryId: candidate.entryId, title: candidate.title, reason: 'budget' })
      if (candidate.mandatory) requiredOverflow = true
      continue
    }
    tokenEstimate += candidate.estimatedTokens
    const { mandatory: _mandatory, ...selection } = candidate
    void _mandatory
    selections.push(selection)
  }
  return {
    selections,
    omitted,
    tokenEstimate,
    budgetTokens,
    requiredOverflow,
    resolvedQuery: [
      request.chapterTitle,
      request.blueprintText,
      ...(request.characters ?? []),
      request.authorGuidance,
      request.previousEnding,
      request.draftText,
    ].filter(Boolean).join('\n').slice(0, 8_000),
  }
}

