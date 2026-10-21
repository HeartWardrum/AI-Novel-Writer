import { createHash, randomUUID } from 'node:crypto'
import { getProjectDb } from '../database'
import type {
  WorldbookActivation,
  WorldbookEntry,
  WorldbookEntryKind,
  WorldbookEntrySaveRequest,
  WorldbookResolveRequest,
  WorldbookResolveResult,
  WorldbookSourceCandidate,
  WorldbookSourceKind,
  WorldbookStage,
} from '../../src/shared/worldbook'
import {
  WORLD_BOOK_ENTRY_KINDS,
  WORLD_BOOK_STAGES,
  WORLD_BOOK_SYSTEM_DIRECT_CHAT_ID,
  WORLD_BOOK_SYSTEM_DIRECT_CHAT_SOURCE_KEY,
  defaultWorldbookActivation,
  isWorldbookSystemEntry,
  resolveWorldbookEntries,
} from '../../src/shared/worldbook'
import {
  composePromptSystemRole,
  getBuiltinPromptTemplate,
} from '../../src/services/builtin-prompt-templates'
import { ProjectCoreRepository } from './project-core-repository'
import { BlueprintRepository } from './blueprint-repository'
import { NarrativeThreadRepository } from './narrative-thread-repository'
import { FinalizationRepository } from './finalization-repository'

interface SettingsRow {
  entry_id: string
  primary_keys_json: string
  secondary_keys_json: string
  match_mode: 'any' | 'all'
  always_on: number
  enabled: number
  stages_json: string
  priority: number
  insertion_order: number
  group_name: string
  prompt_policy: 'full' | 'excerpt' | 'browse-only'
}

interface GenericEntryRow {
  id: string
  kind: WorldbookEntryKind
  title: string
  content: string
  source_kind: WorldbookSourceKind
  source_key: string
  source_revision: string
  needs_review: number
  revision: number
  updated_at: string
}

function defaultSystemDirectChatSeed(): string {
  const template = getBuiltinPromptTemplate('direct_chat_system', 'zh-CN')
  if (!template) return '你是写作助手，用对话帮用户构思、讨论与润色。'
  const role = composePromptSystemRole(template, 'zh-CN')
  const body = template.content.trim()
  return body ? `${role}\n\n${body}`.trim() : role.trim()
}

function systemDirectChatActivation(): WorldbookActivation {
  return {
    primaryKeys: [],
    secondaryKeys: [],
    matchMode: 'any',
    alwaysOn: true,
    enabled: true,
    stages: ['setup', 'planning', 'drafting', 'review', 'finalization'],
    priority: 10_000,
    insertionOrder: -1,
    group: 'system',
    promptPolicy: 'full',
  }
}

function lockSystemActivation(activation: WorldbookActivation): WorldbookActivation {
  return {
    ...validateActivation(activation),
    alwaysOn: true,
    enabled: true,
    priority: Math.max(coerceActivationInt(activation.priority), 10_000),
    insertionOrder: -1,
    group: activation.group || 'system',
  }
}

const KINDS = new Set<string>(WORLD_BOOK_ENTRY_KINDS)
const STAGES = new Set<string>(WORLD_BOOK_STAGES)
function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function settingsFor(row: SettingsRow | undefined, fallback: WorldbookActivation): WorldbookActivation {
  if (!row) return fallback
  const stages = parseStringArray(row.stages_json).filter((stage): stage is WorldbookStage => STAGES.has(stage))
  return {
    primaryKeys: parseStringArray(row.primary_keys_json),
    secondaryKeys: parseStringArray(row.secondary_keys_json),
    matchMode: row.match_mode,
    alwaysOn: row.always_on === 1,
    enabled: row.enabled === 1,
    stages: stages.length ? stages : fallback.stages,
    priority: Number.isSafeInteger(row.priority) ? row.priority : fallback.priority,
    insertionOrder: Number.isSafeInteger(row.insertion_order) ? row.insertion_order : fallback.insertionOrder,
    group: row.group_name || fallback.group,
    promptPolicy: row.prompt_policy,
  }
}

function projectionId(kind: string, sourceId: string | number): string {
  return `${kind}:${sourceId}`
}

function projectEntry(
  id: string,
  kind: WorldbookEntryKind,
  title: string,
  content: string,
  revision: string,
  activation: WorldbookActivation = defaultWorldbookActivation(kind),
): WorldbookEntry {
  return {
    id,
    kind,
    title,
    content,
    promptContent: content,
    activation,
    source: { kind: 'project', id, revision },
    editable: false,
    needsReview: false,
    revision: 1,
    updatedAt: '',
  }
}

function currentCoreEntries(): WorldbookEntry[] {
  const core = ProjectCoreRepository.get()
  if (!core) return []
  const revision = sha256(JSON.stringify(core))
  const result: WorldbookEntry[] = []
  const base = [
    core.genre && `类型：${core.genre}`,
    core.subGenre && `细分类型：${core.subGenre}`,
    core.targetAudience && `目标读者：${core.targetAudience}`,
    core.totalChapters && `总章数：${core.totalChapters}`,
    core.wordsPerChapter && `每章目标：${core.wordsPerChapter} 字`,
    core.plotStructure && `故事结构：${core.plotStructure}`,
    core.narrativePov && `叙事视角：${core.narrativePov}`,
    core.writingLanguage && `写作语言：${core.writingLanguage}`,
  ].filter(Boolean).join('\n')
  if (base) result.push(projectEntry('project:base', 'project', '作品基座', base, revision))
  const fields: Array<[string, WorldbookEntryKind, string, string]> = [
    ['core-outline', 'premise', '核心大纲', core.coreOutline],
    ['premise', 'premise', '故事前提', core.premise],
    ['world-setting', 'world', '世界观设定', core.worldSetting],
    ['worldbuilding', 'world', '世界观架构', core.worldbuilding],
    ['golden-finger', 'rule', '金手指与核心能力', core.goldenFinger],
    ['global-guidance', 'rule', '全局写作规则', core.globalGuidance],
    ['writing-style', 'rule', '文风', core.writingStyle],
    ['reference-works', 'reference', '参考作品', core.referenceWorks],
    ['protagonist', 'character', '主角设定', core.protagonistProfile],
    ['synopsis', 'plot-thread', '情节总大纲', core.synopsis],
  ]
  for (const [key, kind, title, content] of fields) {
    if (!content?.trim()) continue
    const activation = defaultWorldbookActivation(kind)
    if (key === 'core-outline' || key === 'world-setting' || key === 'global-guidance') activation.alwaysOn = true
    result.push(projectEntry(`project:${key}`, kind, title, content, revision, activation))
  }
  return result
}

function characterEntries(db: NonNullable<ReturnType<typeof getProjectDb>>): WorldbookEntry[] {
  const rows = db.prepare(`
    SELECT character_id,name,role,gender,age,appearance,personality,background,abilities,motivation,arc,notes,
           cs_location,cs_power_level,cs_physical_state,cs_mental_state,cs_key_items,cs_recent_events,
           cs_updated_at_chapter,updated_at
    FROM characters WHERE retired=0 ORDER BY name
  `).all() as Array<Record<string, unknown>>
  return rows.map(row => {
    const id = String(row.character_id)
    const name = String(row.name ?? '')
    const state = [
      row.cs_location && `当前位置：${row.cs_location}`,
      row.cs_power_level && `能力/境界：${row.cs_power_level}`,
      row.cs_physical_state && `身体状态：${row.cs_physical_state}`,
      row.cs_mental_state && `心理状态：${row.cs_mental_state}`,
      row.cs_key_items && `关键物品：${row.cs_key_items}`,
      row.cs_recent_events && `最近事件：${row.cs_recent_events}`,
    ].filter(Boolean).join('\n')
    const content = [
      name,
      row.role && `定位：${row.role}`,
      row.gender && `性别：${row.gender}`,
      row.age && `年龄：${row.age}`,
      row.appearance && `外貌：${row.appearance}`,
      row.personality && `性格：${row.personality}`,
      row.background && `背景：${row.background}`,
      row.abilities && `能力：${row.abilities}`,
      row.motivation && `动机：${row.motivation}`,
      row.arc && `成长线：${row.arc}`,
      row.notes && `备注：${row.notes}`,
      state,
    ].filter(Boolean).join('\n')
    const aliases = (db.prepare('SELECT DISTINCT name FROM character_aliases WHERE character_id=?')
      .all(id) as Array<{ name: string }>).map(item => item.name)
    const activation = defaultWorldbookActivation('character')
    activation.primaryKeys = [...new Set([name, ...aliases].filter(Boolean))]
    activation.group = '人物'
    return {
      id: projectionId('character', id),
      kind: 'character' as const,
      title: name,
      content,
      promptContent: content,
      activation,
      source: { kind: 'character' as const, id, revision: sha256(content) },
      editable: false,
      needsReview: false,
      revision: Math.max(1, Number(row.cs_updated_at_chapter) || 1),
      updatedAt: String(row.updated_at ?? ''),
    }
  })
}

function relationshipEntries(db: NonNullable<ReturnType<typeof getProjectDb>>): WorldbookEntry[] {
  const rows = db.prepare(`
    SELECT r.relationship_id,r.relation,r.source_character_id,r.target_character_id,
           source.name AS source_name,target.name AS target_name
    FROM character_relationships r
    JOIN characters source ON source.character_id=r.source_character_id
    JOIN characters target ON target.character_id=r.target_character_id
    WHERE source.retired=0 AND target.retired=0
    ORDER BY source.name,target.name,r.relationship_id
  `).all() as Array<Record<string, unknown>>
  return rows.map(row => {
    const content = `${row.source_name} 与 ${row.target_name}：${row.relation}`
    const activation = defaultWorldbookActivation('relationship')
    activation.primaryKeys = [String(row.source_name), String(row.target_name)]
    activation.secondaryKeys = [String(row.relation)]
    activation.group = '人物关系'
    return {
      id: projectionId('relationship', String(row.relationship_id)),
      kind: 'relationship' as const,
      title: `${row.source_name} ↔ ${row.target_name}`,
      content,
      promptContent: content,
      activation,
      source: { kind: 'character' as const, id: String(row.relationship_id), revision: sha256(content) },
      editable: false,
      needsReview: false,
      revision: 1,
      updatedAt: '',
    }
  })
}

function blueprintEntries(db: NonNullable<ReturnType<typeof getProjectDb>>, currentChapter?: number): WorldbookEntry[] {
  return BlueprintRepository.getAll(db).map(blueprint => {
    const content = [
      `第 ${blueprint.chapterNumber} 章${blueprint.title ? ` · ${blueprint.title}` : ''}`,
      blueprint.role && `定位：${blueprint.role}`,
      blueprint.purpose && `目的：${blueprint.purpose}`,
      blueprint.keyEvents && `关键事件：${blueprint.keyEvents}`,
      blueprint.characters?.length && `出场角色：${blueprint.characters.join('、')}`,
      blueprint.suspenseHook && `章末钩子：${blueprint.suspenseHook}`,
      blueprint.userGuidance && `作者指导：${blueprint.userGuidance}`,
      blueprint.notes && `定稿后摘要：${blueprint.notes}`,
    ].filter(Boolean).join('\n')
    const activation = defaultWorldbookActivation('blueprint')
    activation.alwaysOn = blueprint.chapterNumber === currentChapter
    activation.primaryKeys = [blueprint.title, ...blueprint.characters].filter(Boolean)
    activation.group = `第 ${blueprint.chapterNumber} 章蓝图`
    activation.insertionOrder = blueprint.chapterNumber
    return {
      id: projectionId('blueprint', blueprint.chapterNumber),
      kind: 'blueprint' as const,
      title: blueprint.title || `第 ${blueprint.chapterNumber} 章蓝图`,
      content,
      promptContent: content,
      activation,
      source: { kind: 'blueprint' as const, id: String(blueprint.chapterNumber), revision: sha256(content) },
      editable: false,
      needsReview: false,
      revision: 1,
      updatedAt: '',
    }
  })
}

function chapterEntries(db: NonNullable<ReturnType<typeof getProjectDb>>, currentChapter?: number): WorldbookEntry[] {
  const rows = db.prepare(`
    SELECT d.id,d.chapter_number,d.version,d.updated_at,o.chapter_title,o.content_snapshot,
           s.chapter_notes,s.continuity_facts,s.id AS summary_id
    FROM drafts d
    JOIN finalization_outbox o ON o.draft_id=d.id
    LEFT JOIN summary_snapshots s ON s.draft_id=d.id
    WHERE d.status='finalized'
      AND (s.id IS NULL OR s.id=(
        SELECT MAX(latest.id) FROM summary_snapshots latest WHERE latest.draft_id=d.id
      ))
    ORDER BY d.chapter_number,d.version
  `).all() as Array<Record<string, unknown>>
  return rows.map(row => {
    let facts: string[] = []
    try {
      const parsed = JSON.parse(String(row.continuity_facts ?? '[]')) as Array<{ statement?: unknown; evidence?: unknown }>
      facts = parsed.flatMap(item => typeof item.statement === 'string' ? [item.statement] : [])
    } catch { /* A malformed derived summary remains browse-only until repaired. */ }
    const notes = typeof row.chapter_notes === 'string' ? row.chapter_notes.trim() : ''
    const promptContent = [notes, facts.length ? `连续性事实：\n${facts.map(fact => `- ${fact}`).join('\n')}` : '']
      .filter(Boolean).join('\n\n')
    const chapterNumber = Number(row.chapter_number)
    const activation = defaultWorldbookActivation('chapter')
    activation.stages = ['planning', 'drafting', 'review', 'finalization']
    activation.alwaysOn = currentChapter !== undefined && chapterNumber === currentChapter - 1
    activation.primaryKeys = [String(row.chapter_title ?? '')].filter(Boolean)
    activation.group = `第 ${chapterNumber} 章`
    activation.insertionOrder = chapterNumber
    activation.promptPolicy = 'excerpt'
    const content = String(row.content_snapshot ?? '')
    return {
      id: projectionId('chapter', Number(row.id)),
      kind: 'chapter' as const,
      title: row.chapter_title ? `第 ${chapterNumber} 章 · ${row.chapter_title}` : `第 ${chapterNumber} 章`,
      content,
      promptContent: promptContent || content.slice(-2_000),
      activation,
      source: { kind: 'chapter' as const, id: String(row.id), revision: sha256(content) },
      editable: false,
      needsReview: !notes,
      revision: Math.max(1, Number(row.version) || 1),
      updatedAt: String(row.updated_at ?? ''),
    }
  })
}

function plotEntries(): WorldbookEntry[] {
  return NarrativeThreadRepository.list().map(thread => {
    const content = [
      thread.title,
      `类型：${thread.type}`,
      `目标章节：${thread.targetStartChapter}-${thread.targetEndChapter}`,
      `作者意图：${thread.authorIntent}`,
      ...thread.events.map(event => `第 ${event.chapterNumber} 章 ${event.type}：${event.evidence}（${event.reason}）`),
    ].join('\n')
    const activation = defaultWorldbookActivation('plot-thread')
    activation.primaryKeys = [thread.title, ...thread.events.map(event => event.chapterTitle)].filter(Boolean)
    activation.group = '剧情与伏笔'
    return {
      id: projectionId('plot-thread', thread.id),
      kind: 'plot-thread' as const,
      title: thread.title,
      content,
      promptContent: content,
      activation,
      source: { kind: 'plot-thread' as const, id: String(thread.id), revision: sha256(content) },
      editable: false,
      needsReview: false,
      revision: 1,
      updatedAt: thread.updatedAt,
    }
  })
}

async function referenceEntries(
  projectPath: string,
  includeContent: boolean,
): Promise<WorldbookEntry[]> {
  try {
    const { listDocuments, readDocumentCopy } = await import('../knowledge-base')
    const documents = await listDocuments(projectPath)
    const finalizedKnowledgeDocuments = FinalizationRepository.knowledgeDocumentChapters()
    const result: WorldbookEntry[] = []
    for (const document of documents) {
      if (finalizedKnowledgeDocuments.has(document.id)) continue
      let content = ''
      if (includeContent) {
        const copy = await readDocumentCopy(document.id, projectPath)
        content = copy.available && copy.content ? copy.content : ''
      }
      const title = document.fileName.replace(/\.[^.]+$/u, '')
      const activation = defaultWorldbookActivation('reference')
      activation.primaryKeys = title ? [title] : []
      activation.group = document.finalizedChapter ? `第 ${document.finalizedChapter} 章资料` : '导入资料'
      activation.promptPolicy = 'excerpt'
      result.push({
        id: projectionId('reference', document.id),
        kind: 'reference',
        title,
        content,
        promptContent: content,
        activation,
        source: { kind: 'reference', id: document.id, revision: document.importedAt },
        editable: false,
        needsReview: document.finalizedChapter === undefined && !content,
        revision: 1,
        updatedAt: document.importedAt,
      })
    }
    return result
  } catch {
    return []
  }
}

function genericEntries(
  db: NonNullable<ReturnType<typeof getProjectDb>>,
  settings: Map<string, SettingsRow>,
): WorldbookEntry[] {
  const rows = db.prepare('SELECT * FROM worldbook_entries ORDER BY updated_at DESC,id').all() as GenericEntryRow[]
  return rows.map(row => {
    const system = isWorldbookSystemEntry(row.id) || row.source_kind === 'system'
    const fallback = system ? systemDirectChatActivation() : defaultWorldbookActivation(row.kind)
    const activation = system
      ? lockSystemActivation(settingsFor(settings.get(row.id), fallback))
      : settingsFor(settings.get(row.id), fallback)
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      content: row.content,
      promptContent: row.content,
      activation,
      source: {
        kind: system ? 'system' : row.source_kind,
        id: row.source_key || row.id,
        revision: row.source_revision,
      },
      editable: true,
      deletable: !system,
      needsReview: row.needs_review === 1,
      revision: row.revision,
      updatedAt: row.updated_at,
    }
  })
}

function coerceActivationInt(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const truncated = Math.trunc(parsed)
  return Number.isSafeInteger(truncated) ? truncated : fallback
}

function validateActivation(value: WorldbookActivation): WorldbookActivation {
  if (!value || typeof value !== 'object' || !['any', 'all'].includes(value.matchMode)
    || !['full', 'excerpt', 'browse-only'].includes(value.promptPolicy)
    || !Array.isArray(value.primaryKeys) || value.primaryKeys.some(key => typeof key !== 'string')
    || !Array.isArray(value.secondaryKeys) || value.secondaryKeys.some(key => typeof key !== 'string')
    || !Array.isArray(value.stages) || value.stages.some(stage => !STAGES.has(stage))) {
    throw new Error('WORLDBOOK_ACTIVATION_INVALID')
  }
  return {
    ...structuredClone(value),
    primaryKeys: [...new Set(value.primaryKeys.map(key => key.trim()).filter(Boolean))].slice(0, 200),
    secondaryKeys: [...new Set(value.secondaryKeys.map(key => key.trim()).filter(Boolean))].slice(0, 200),
    stages: [...new Set(value.stages)],
    enabled: value.enabled === true,
    alwaysOn: value.alwaysOn === true,
    priority: coerceActivationInt(value.priority),
    insertionOrder: coerceActivationInt(value.insertionOrder),
  }
}

function saveSettings(db: NonNullable<ReturnType<typeof getProjectDb>>, entryId: string, activation: WorldbookActivation): void {
  const value = validateActivation(activation)
  db.prepare(`
    INSERT INTO worldbook_entry_settings(
      entry_id,primary_keys_json,secondary_keys_json,match_mode,always_on,enabled,stages_json,
      priority,insertion_order,group_name,prompt_policy,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(entry_id) DO UPDATE SET
      primary_keys_json=excluded.primary_keys_json,secondary_keys_json=excluded.secondary_keys_json,
      match_mode=excluded.match_mode,always_on=excluded.always_on,enabled=excluded.enabled,
      stages_json=excluded.stages_json,priority=excluded.priority,insertion_order=excluded.insertion_order,
      group_name=excluded.group_name,prompt_policy=excluded.prompt_policy,updated_at=datetime('now')
  `).run(entryId, JSON.stringify(value.primaryKeys), JSON.stringify(value.secondaryKeys), value.matchMode,
    value.alwaysOn ? 1 : 0, value.enabled ? 1 : 0, JSON.stringify(value.stages), value.priority,
    value.insertionOrder, value.group, value.promptPolicy)
}

function sortEntries(entries: WorldbookEntry[]): WorldbookEntry[] {
  return [...entries].sort((left, right) => (
    Number(isWorldbookSystemEntry(right)) - Number(isWorldbookSystemEntry(left))
    || Number(right.activation.alwaysOn) - Number(left.activation.alwaysOn)
    || right.activation.priority - left.activation.priority
    || left.activation.insertionOrder - right.activation.insertionOrder
    || left.title.localeCompare(right.title)
  ))
}

function importedSourceKeys(db: NonNullable<ReturnType<typeof getProjectDb>>): Set<string> {
  const rows = db.prepare(
    "SELECT source_key FROM worldbook_entries WHERE source_kind='import' AND source_key<>''",
  ).all() as Array<{ source_key: string }>
  return new Set(rows.map(row => row.source_key))
}

function sourceAlreadyImported(keys: Set<string>, sourceId: string): boolean {
  if (keys.has(sourceId)) return true
  const prefix = `${sourceId}:`
  for (const key of keys) {
    if (key.startsWith(prefix)) return true
  }
  return false
}

/** 投影内容拷进世界书时：定稿优先用摘要/连续性事实，避免把整章正文当 lore。 */
function importableContent(entry: WorldbookEntry): string {
  const summary = entry.promptContent.trim()
  if (entry.kind === 'chapter' && summary) return summary
  return entry.content
}

async function collectProjections(
  projectPath: string,
  options: { currentChapter?: number } = {},
): Promise<WorldbookEntry[]> {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return [
    ...currentCoreEntries(),
    ...characterEntries(db),
    ...relationshipEntries(db),
    ...blueprintEntries(db, options.currentChapter),
    ...chapterEntries(db, options.currentChapter),
    ...plotEntries(),
    ...await referenceEntries(projectPath, true),
  ]
}

export class WorldbookRepository {
  /** 确保直连系统提示常驻条目存在；已有则不动正文。 */
  static ensureSystemDirectChatEntry(seedContent?: string): void {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未打开')
    if (db.prepare('SELECT 1 FROM worldbook_entries WHERE id=?').get(WORLD_BOOK_SYSTEM_DIRECT_CHAT_ID)) return
    const content = (seedContent?.trim() || defaultSystemDirectChatSeed()).trim()
    if (!content || content.length > 2_000_000) throw new Error('WORLDBOOK_ENTRY_INVALID')
    const title = '系统提示'
    const sourceRevision = sha256(JSON.stringify([title, content]))
    const activation = systemDirectChatActivation()
    db.transaction(() => {
      db.prepare(`
        INSERT INTO worldbook_entries(
          id,kind,title,content,source_kind,source_key,source_revision,needs_review,revision,updated_at
        ) VALUES(?,?,?,?,?,?,?,0,1,datetime('now'))
      `).run(
        WORLD_BOOK_SYSTEM_DIRECT_CHAT_ID,
        'rule',
        title,
        content,
        'system',
        WORLD_BOOK_SYSTEM_DIRECT_CHAT_SOURCE_KEY,
        sourceRevision,
      )
      saveSettings(db, WORLD_BOOK_SYSTEM_DIRECT_CHAT_ID, activation)
    }).immediate()
  }

  /** SillyTavern 式：只列作者/导入/系统常驻的可编辑条目，不含作品域投影。 */
  static async list(
    _projectPath?: string,
    options: { includeReferenceContent?: boolean; currentChapter?: number; systemPromptSeed?: string } = {},
  ): Promise<WorldbookEntry[]> {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未打开')
    this.ensureSystemDirectChatEntry(options.systemPromptSeed)
    const settings = new Map((db.prepare('SELECT * FROM worldbook_entry_settings').all() as SettingsRow[])
      .map(row => [row.entry_id, row]))
    return sortEntries(genericEntries(db, settings))
  }

  /** 作品设定、人物、蓝图、定稿等可拷贝进世界书的候选。 */
  static async listSources(
    projectPath: string,
    options: { currentChapter?: number } = {},
  ): Promise<WorldbookSourceCandidate[]> {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未打开')
    const imported = importedSourceKeys(db)
    const projections = await collectProjections(projectPath, options)
    return projections
      .filter(entry => importableContent(entry).trim().length > 0)
      .map(entry => ({
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        content: importableContent(entry),
        activation: entry.activation,
        origin: entry.source,
        alreadyImported: sourceAlreadyImported(imported, entry.id),
      }))
      .sort((left, right) => Number(left.alreadyImported) - Number(right.alreadyImported)
        || left.title.localeCompare(right.title))
  }

  /** 把选定投影拷成可编辑世界书条目；已导入过的跳过。 */
  static async importSources(
    projectPath: string,
    sourceIds: readonly string[],
    options: { currentChapter?: number } = {},
  ): Promise<WorldbookEntry[]> {
    const uniqueIds = [...new Set(sourceIds.map(id => id.trim()).filter(Boolean))]
    if (uniqueIds.length === 0) return []
    if (uniqueIds.length > 200) throw new Error('WORLDBOOK_IMPORT_TOO_MANY')
    const candidates = await this.listSources(projectPath, options)
    const byId = new Map(candidates.map(item => [item.id, item]))
    const saved: WorldbookEntry[] = []
    for (const id of uniqueIds) {
      const candidate = byId.get(id)
      if (!candidate) throw new Error(`WORLDBOOK_SOURCE_MISSING:${id}`)
      if (candidate.alreadyImported) continue
      saved.push(this.save({
        kind: candidate.kind,
        title: candidate.title,
        content: candidate.content,
        activation: candidate.activation,
        sourceKind: 'import',
        sourceId: candidate.id,
        needsReview: true,
      }))
    }
    return saved
  }

  static save(request: WorldbookEntrySaveRequest): WorldbookEntry {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未打开')
    if (!KINDS.has(request.kind)) throw new Error('WORLDBOOK_KIND_INVALID')
    const title = request.title.trim()
    const content = request.content
    if (!title || title.length > 300 || typeof content !== 'string' || content.length > 2_000_000) {
      throw new Error('WORLDBOOK_ENTRY_INVALID')
    }
    const system = Boolean(request.id && isWorldbookSystemEntry(request.id))
    const activation = system
      ? lockSystemActivation(request.activation)
      : validateActivation(request.activation)
    const sourceKind: WorldbookSourceKind = system
      ? 'system'
      : request.sourceKind === 'import' ? 'import' : 'author'
    const sourceId = request.sourceId?.trim() ?? ''
    const sourceRevision = sha256(JSON.stringify([title, content]))
    return db.transaction(() => {
      const existing = request.id ? db.prepare('SELECT * FROM worldbook_entries WHERE id=?').get(request.id) as GenericEntryRow | undefined : undefined
      if (request.id && !existing) throw new Error('WORLDBOOK_ENTRY_READ_ONLY')
      if (existing && request.expectedRevision !== undefined && existing.revision !== request.expectedRevision) {
        throw new Error('WORLDBOOK_ENTRY_CONFLICT')
      }
      if (existing && (isWorldbookSystemEntry(existing.id) || existing.source_kind === 'system') && !system) {
        throw new Error('WORLDBOOK_ENTRY_PROTECTED')
      }
      const id = existing?.id ?? `wb:${randomUUID()}`
      const sourceKey = system
        ? WORLD_BOOK_SYSTEM_DIRECT_CHAT_SOURCE_KEY
        : existing?.source_key
          || (sourceId ? `${sourceId}:${sha256(JSON.stringify([title, content])).slice(0, 20)}` : '')
      const kind = system ? 'rule' : request.kind
      db.prepare(`
        INSERT INTO worldbook_entries(
          id,kind,title,content,source_kind,source_key,source_revision,needs_review,revision,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,1,datetime('now'))
        ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,content=excluded.content,
          source_kind=excluded.source_kind,source_key=excluded.source_key,source_revision=excluded.source_revision,
          needs_review=excluded.needs_review,revision=worldbook_entries.revision+1,updated_at=datetime('now')
      `).run(id, kind, title, content, sourceKind, sourceKey, sourceRevision,
        system ? 0 : (request.needsReview ? 1 : 0))
      saveSettings(db, id, activation)
      const row = db.prepare('SELECT * FROM worldbook_entries WHERE id=?').get(id) as GenericEntryRow
      return {
        id,
        kind: row.kind,
        title: row.title,
        content: row.content,
        promptContent: row.content,
        activation,
        source: { kind: row.source_kind, id: row.source_key || row.id, revision: row.source_revision },
        editable: true,
        deletable: !system,
        needsReview: row.needs_review === 1,
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    }).immediate()
  }

  static saveActivation(request: { entryId: string; activation: WorldbookActivation }): WorldbookActivation {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未打开')
    if (!request.entryId.trim()) throw new Error('WORLDBOOK_ENTRY_INVALID')
    if (!db.prepare('SELECT 1 FROM worldbook_entries WHERE id=?').get(request.entryId)) {
      throw new Error('WORLDBOOK_ENTRY_MISSING')
    }
    const activation = isWorldbookSystemEntry(request.entryId)
      ? lockSystemActivation(request.activation)
      : validateActivation(request.activation)
    saveSettings(db, request.entryId, activation)
    return activation
  }

  static delete(entryId: string, expectedRevision: number): void {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未打开')
    if (isWorldbookSystemEntry(entryId)) throw new Error('WORLDBOOK_ENTRY_PROTECTED')
    const row = db.prepare('SELECT id,revision,source_kind FROM worldbook_entries WHERE id=?').get(entryId) as
      | { id: string; revision: number; source_kind: string }
      | undefined
    if (!row) throw new Error('WORLDBOOK_ENTRY_MISSING')
    if (row.source_kind === 'system') throw new Error('WORLDBOOK_ENTRY_PROTECTED')
    if (row.revision !== expectedRevision) throw new Error('WORLDBOOK_ENTRY_CONFLICT')
    db.transaction(() => {
      db.prepare('DELETE FROM worldbook_entry_settings WHERE entry_id=?').run(entryId)
      db.prepare('DELETE FROM worldbook_entries WHERE id=?').run(entryId)
    }).immediate()
  }

  static async resolve(request: WorldbookResolveRequest, projectPath: string): Promise<WorldbookResolveResult> {
    const entries = (await this.list(projectPath)).filter(entry => !isWorldbookSystemEntry(entry))
    const query = [
      request.chapterTitle,
      request.blueprintText,
      ...(request.characters ?? []),
      request.authorGuidance,
      request.previousEnding,
      request.draftText,
    ].filter(Boolean).join('\n').trim()
    let semanticMatches = request.semanticMatches ?? []
    if (query) {
      try {
        const { captureWritingKnowledgeSnapshot } = await import('../knowledge-base')
        const { getEmbeddingConfig } = await import('../services/embedding-config')
        const snapshot = await captureWritingKnowledgeSnapshot(query, projectPath, getEmbeddingConfig())
        const matched = snapshot.items.flatMap(item => {
          const prefixes = [`reference:${item.documentId}:`, `${item.documentId}:`]
          return entries
            .filter(entry => entry.source.kind === 'import' && prefixes.some(prefix => entry.source.id.startsWith(prefix)))
            .map(entry => ({ entryId: entry.id, score: item.score }))
        })
        semanticMatches = [...semanticMatches, ...matched]
      } catch { /* Exact worldbook keys and always-on entries remain available when search is offline. */ }
    }
    return resolveWorldbookEntries(entries, { ...request, semanticMatches })
  }

  static importText(input: {
    title: string
    content: string
    sourceId: string
  }): WorldbookEntry {
    const activation = defaultWorldbookActivation('reference')
    activation.primaryKeys = [input.title]
    return this.save({
      kind: 'reference',
      title: input.title,
      content: input.content,
      activation,
      sourceKind: 'import',
      sourceId: input.sourceId,
      needsReview: true,
    })
  }
}

