import type { ProjectSessionContext } from '../../shared/ipc-channels'
import {
  defaultWorldbookActivation,
  isWorldbookSystemEntry,
  type WorldbookEntry,
  type WorldbookSourceCandidate,
} from '../../shared/worldbook'
import {
  listWorldbookEntries,
  listWorldbookSources,
  saveWorldbookEntry,
} from '../worldbook-service'

/** 通用教材合计字数上限（只组装一次，不按角色复制）。 */
export const HOMEWORK_SHARED_CORPUS_BUDGET = 12_000

export type AssignHomeworkProgress = {
  active: boolean
  index: number
  total: number
  currentTitle: string
  cancelled: boolean
  /** preparing = 导入/识别人物；learning = 逐人写私有认知 */
  phase: 'idle' | 'preparing' | 'learning'
}

export type HomeworkGenerate = (
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
) => Promise<{ content: string }>

export function buildSharedHomeworkCorpus(
  entries: readonly WorldbookEntry[],
  budget = HOMEWORK_SHARED_CORPUS_BUDGET,
): string {
  const blocks: string[] = []
  let used = 0
  for (const entry of entries) {
    if (entry.kind === 'character') continue
    if (isWorldbookSystemEntry(entry)) continue
    if (!entry.activation.enabled) continue
    const title = entry.title.trim() || entry.id
    const body = entry.content.trim()
    if (!body) continue
    const block = `### ${title}\n${body}`
    const cost = block.length + (blocks.length > 0 ? 2 : 0)
    if (used + cost > budget && blocks.length > 0) break
    blocks.push(block)
    used += cost
  }
  return blocks.join('\n\n')
}

/** 世界书尚无通用条目时，用作品投影候选拼教材（默认跳过人物类）。 */
export function buildSharedCorpusFromSources(
  sources: readonly WorldbookSourceCandidate[],
  budget = HOMEWORK_SHARED_CORPUS_BUDGET,
  options: { includeCharacters?: boolean } = {},
): string {
  const blocks: string[] = []
  let used = 0
  for (const source of sources) {
    if (!options.includeCharacters && source.kind === 'character') continue
    const title = source.title.trim() || source.id
    const body = source.content.trim()
    if (!body) continue
    const block = `### ${title}\n${body}`
    const cost = block.length + (blocks.length > 0 ? 2 : 0)
    if (used + cost > budget && blocks.length > 0) break
    blocks.push(block)
    used += cost
  }
  return blocks.join('\n\n')
}

export function listHomeworkCharacters(entries: readonly WorldbookEntry[]): WorldbookEntry[] {
  return entries.filter(entry => (
    entry.kind === 'character'
    && entry.activation.enabled
    && !isWorldbookSystemEntry(entry)
    && entry.editable
  ))
}

export function listCharacterSources(
  sources: readonly WorldbookSourceCandidate[],
): WorldbookSourceCandidate[] {
  return sources.filter(source => source.kind === 'character' && source.title.trim().length > 0)
}

/** @deprecated 保留给测试；建档请用 seedHomeworkCharactersFromSources（不受 alreadyImported 卡住）。 */
export function listImportableCharacterSourceIds(
  sources: readonly WorldbookSourceCandidate[],
): string[] {
  return listCharacterSources(sources)
    .filter(source => !source.alreadyImported)
    .map(source => source.id)
}

export function buildHomeworkPrompt(options: {
  characterTitle: string
  publicPersona: string
  sharedCorpus: string
}): Array<{ role: 'system' | 'user'; content: string }> {
  const name = options.characterTitle.trim() || '未命名'
  return [
    {
      role: 'system',
      content: [
        '你在为小说角色整理「私有认知」作业。',
        '只输出此人此时应知道的内容：亲历、被告知、合理推断；可保留误解。',
        '不要复述整本通用设定；不要把别人不该让他知道的密谋写进去；若教材未标明知情归属则偏保守。',
        '不要输出 JSON、标题层级或「私有认知：」之类前缀；直接写中文要点正文。',
      ].join(''),
    },
    {
      role: 'user',
      content: [
        `角色：${name}`,
        '',
        '【公开人设】',
        options.publicPersona.trim() || '（暂无）',
        '',
        '【通用教材｜只读，勿整段抄入作业】',
        options.sharedCorpus.trim() || '（暂无通用设定）',
        '',
        `请为「${name}」写出私有认知作业正文。`,
      ].join('\n'),
    },
  ]
}

export function buildDiscoverCharactersPrompt(sharedCorpus: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        '你从小说设定材料中识别需要建档的人物。',
        '只返回 JSON：{"characters":[{"name":"姓名","persona":"一两句公开人设"}]}。',
        '材料里出现的具名角色都要尽量列出；可从「主角设定」等段落提炼姓名。',
        '不要编造材料里完全没有依据的人名；最多 20 人。',
      ].join(''),
    },
    {
      role: 'user',
      content: `材料：\n${sharedCorpus.trim() || '（空）'}`,
    },
  ]
}

export type DiscoveredHomeworkCharacter = {
  name: string
  persona: string
}

export function parseDiscoveredCharacters(raw: string): DiscoveredHomeworkCharacter[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*\n?/iu, '').replace(/\n?```\s*$/u, '')
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const list = parsed && typeof parsed === 'object' && Array.isArray((parsed as { characters?: unknown }).characters)
      ? (parsed as { characters: unknown[] }).characters
      : Array.isArray(parsed) ? parsed : []
    const seen = new Set<string>()
    const result: DiscoveredHomeworkCharacter[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      if (!name || name.length > 80 || seen.has(name)) continue
      seen.add(name)
      const persona = typeof row.persona === 'string' ? row.persona.trim() : ''
      result.push({ name, persona: persona || `姓名：${name}` })
      if (result.length >= 20) break
    }
    return result
  } catch {
    return []
  }
}

export function mergeExtraHintsIntoCorpus(corpus: string, extraHints: string | undefined): string {
  const hint = extraHints?.trim()
  if (!hint) return corpus
  const block = `### 作品补充设定\n${hint}`
  if (!corpus.trim()) return block
  const joined = `${corpus}\n\n${block}`
  return joined.length > HOMEWORK_SHARED_CORPUS_BUDGET
    ? joined.slice(0, HOMEWORK_SHARED_CORPUS_BUDGET)
    : joined
}

export async function createHomeworkCharacterStubs(
  session: ProjectSessionContext,
  discovered: readonly DiscoveredHomeworkCharacter[],
): Promise<WorldbookEntry[]> {
  const saved: WorldbookEntry[] = []
  for (const item of discovered) {
    const activation = defaultWorldbookActivation('character')
    activation.primaryKeys = [item.name]
    activation.group = '人物'
    activation.enabled = true
    saved.push(await saveWorldbookEntry(session, {
      kind: 'character',
      title: item.name,
      content: item.persona,
      privateContent: '',
      activation,
      sourceKind: 'author',
      needsReview: true,
    }))
  }
  return saved
}

/**
 * 把作品侧人物投影直接写成世界书人物条目。
 * 不依赖 alreadyImported（避免删条目后无法再导入）。
 */
export async function seedHomeworkCharactersFromSources(
  session: ProjectSessionContext,
  sources: readonly WorldbookSourceCandidate[],
  existingTitles: ReadonlySet<string>,
): Promise<WorldbookEntry[]> {
  const saved: WorldbookEntry[] = []
  const seen = new Set(existingTitles)
  for (const source of listCharacterSources(sources)) {
    const title = source.title.trim()
    if (!title || seen.has(title)) continue
    const activation = {
      ...defaultWorldbookActivation('character'),
      ...source.activation,
      primaryKeys: source.activation.primaryKeys.length > 0
        ? source.activation.primaryKeys
        : [title],
      group: source.activation.group || '人物',
      enabled: true,
    }
    const entry = await saveWorldbookEntry(session, {
      kind: 'character',
      title,
      content: source.content.trim() || `姓名：${title}`,
      privateContent: '',
      activation,
      sourceKind: 'author',
      needsReview: true,
    })
    saved.push(entry)
    seen.add(title)
  }
  return saved
}

export async function loadHomeworkInputs(session: ProjectSessionContext): Promise<{
  characters: WorldbookEntry[]
  sharedCorpus: string
  sources: WorldbookSourceCandidate[]
}> {
  const [entries, sources] = await Promise.all([
    listWorldbookEntries(session),
    listWorldbookSources(session),
  ])
  const characters = listHomeworkCharacters(entries)
  let sharedCorpus = buildSharedHomeworkCorpus(entries)
  if (!sharedCorpus.trim()) {
    sharedCorpus = buildSharedCorpusFromSources(sources)
  }
  return { characters, sharedCorpus, sources }
}

/**
 * 若世界书尚无人物条目：
 * 1) 从作品人物/主角设定投影直接建档
 * 2) 仍没有则 LLM 从教材（含人物段落与补充设定）识别并建档
 */
export async function ensureHomeworkCharacters(options: {
  session: ProjectSessionContext
  sharedCorpus: string
  sources: readonly WorldbookSourceCandidate[]
  extraHints?: string
  generate?: HomeworkGenerate
}): Promise<{ characters: WorldbookEntry[]; createdCount: number; importedCount: number }> {
  const { session, sharedCorpus, sources, extraHints, generate } = options
  let entries = await listWorldbookEntries(session)
  let characters = listHomeworkCharacters(entries)
  let importedCount = 0
  let createdCount = 0

  if (characters.length === 0) {
    const seeded = await seedHomeworkCharactersFromSources(
      session,
      sources,
      new Set(characters.map(item => item.title.trim())),
    )
    importedCount = seeded.length
    if (seeded.length > 0) {
      entries = await listWorldbookEntries(session)
      characters = listHomeworkCharacters(entries)
    }
  }

  if (characters.length === 0 && generate) {
    const discoverCorpus = mergeExtraHintsIntoCorpus(
      sharedCorpus.trim()
        || buildSharedCorpusFromSources(sources, HOMEWORK_SHARED_CORPUS_BUDGET, { includeCharacters: true }),
      extraHints,
    )
    if (discoverCorpus.trim()) {
      const response = await generate(buildDiscoverCharactersPrompt(discoverCorpus))
      const discovered = parseDiscoveredCharacters(response.content)
      if (discovered.length > 0) {
        const created = await createHomeworkCharacterStubs(session, discovered)
        createdCount = created.length
        entries = await listWorldbookEntries(session)
        characters = listHomeworkCharacters(entries)
      }
    }
  }

  return { characters, createdCount, importedCount }
}

export async function saveCharacterPrivateHomework(
  session: ProjectSessionContext,
  entry: WorldbookEntry,
  privateContent: string,
): Promise<WorldbookEntry> {
  return saveWorldbookEntry(session, {
    id: entry.id,
    expectedRevision: entry.revision,
    kind: 'character',
    title: entry.title,
    content: entry.content,
    privateContent,
    activation: entry.activation,
    sourceKind: entry.source.kind === 'import' ? 'import' : 'author',
    needsReview: true,
  })
}
