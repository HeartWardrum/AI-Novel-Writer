import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  FileText,
  Filter,
  FolderInput,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  deleteWorldbookEntry,
  importWorldbookSources,
  listWorldbookEntries,
  listWorldbookSources,
  resolveWorldbook,
  saveWorldbookEntry,
} from '../../../services/worldbook-service'
import { useLLMStore } from '../../../stores/llm-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import {
  WORLD_BOOK_ENTRY_KINDS,
  WORLD_BOOK_STAGES,
  defaultWorldbookActivation,
  type WorldbookActivation,
  type WorldbookEntry,
  type WorldbookEntryKind,
  type WorldbookResolveResult,
  type WorldbookSourceCandidate,
  type WorldbookStage,
} from '../../../shared/worldbook'
import { captureProjectSession, isProjectSessionCurrent } from '../../project-session-gate'
import { sameProjectPathKey } from '../../../shared/project-session-context'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { toast } from '../../ui/Toast'
import './worldbook.css'

type Text = (zh: string, en: string) => string

interface SplitProposal {
  title: string
  kind: WorldbookEntryKind
  content: string
  primaryKeys: string[]
  secondaryKeys: string[]
  selected: boolean
}

const KIND_NAMES: Record<WorldbookEntryKind, [string, string]> = {
  project: ['作品基座', 'Project'],
  premise: ['前提与大纲', 'Premise'],
  world: ['世界观', 'World'],
  rule: ['规则', 'Rule'],
  character: ['人物', 'Character'],
  organization: ['组织', 'Organization'],
  location: ['地点', 'Location'],
  item: ['物品', 'Item'],
  relationship: ['关系', 'Relationship'],
  'plot-thread': ['剧情线', 'Plot thread'],
  blueprint: ['章节蓝图', 'Blueprint'],
  chapter: ['章节', 'Chapter'],
  reference: ['参考资料', 'Reference'],
  custom: ['自定义', 'Custom'],
}

const STAGE_NAMES: Record<WorldbookStage, [string, string]> = {
  setup: ['设定', 'Setup'],
  planning: ['规划', 'Planning'],
  drafting: ['写稿', 'Drafting'],
  review: ['审稿', 'Review'],
  finalization: ['定稿', 'Finalization'],
}

function textValue(value: string): string {
  return value.trim()
}

function cloneActivation(value: WorldbookActivation): WorldbookActivation {
  return {
    ...value,
    primaryKeys: [...value.primaryKeys],
    secondaryKeys: [...value.secondaryKeys],
    stages: [...value.stages],
    priority: Math.trunc(Number(value.priority)) || 0,
    insertionOrder: Math.trunc(Number(value.insertionOrder)) || 0,
  }
}

function parseKeys(value: string): string[] {
  return value.split(/[,，\n]/u).map(item => item.trim()).filter(Boolean)
}

function sourceLabel(entry: WorldbookEntry, text: Text): string {
  if (entry.source.kind === 'import') return text('从作品导入', 'Imported from work')
  return text('作者新建', 'Author-created')
}

function dedupeById(entries: WorldbookEntry[]): WorldbookEntry[] {
  return [...new Map(entries.map(entry => [entry.id, entry])).values()]
}

function parseSplitProposals(content: string): SplitProposal[] {
  const text = content.trim().replace(/^```(?:json)?\s*\n?/iu, '').replace(/\n?```\s*$/u, '')
  const parsed = JSON.parse(text) as { entries?: unknown }
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0 || parsed.entries.length > 50) {
    throw new Error('WORLDBOOK_SPLIT_INVALID')
  }
  return parsed.entries.map(value => {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const body = typeof item.content === 'string' ? item.content.trim() : ''
    if (!title || !body) throw new Error('WORLDBOOK_SPLIT_INVALID')
    const kind = WORLD_BOOK_ENTRY_KINDS.includes(item.kind as WorldbookEntryKind)
      ? item.kind as WorldbookEntryKind : 'custom'
    const keys = (field: unknown) => Array.isArray(field)
      ? field.filter((key): key is string => typeof key === 'string').map(key => key.trim()).filter(Boolean).slice(0, 40)
      : []
    return {
      title,
      kind,
      content: body,
      primaryKeys: keys(item.primaryKeys),
      secondaryKeys: keys(item.secondaryKeys),
      selected: true,
    }
  })
}

export default function StageWorldbook({ projectKey }: { projectKey: string }) {
  const text = useLocaleStore(state => state.text)
  const project = useProjectStore(state => state.currentProject)
  const models = useLLMStore(state => state.models)
  const defaultModelId = useLLMStore(state => state.defaultModelId)
  const [entries, setEntries] = useState<WorldbookEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | WorldbookEntryKind>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'author' | 'import'>('all')
  const [onlyEnabled, setOnlyEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftActivation, setDraftActivation] = useState<WorldbookActivation>(defaultWorldbookActivation())
  const [previewStage, setPreviewStage] = useState<WorldbookStage>('drafting')
  const [previewChapter, setPreviewChapter] = useState('1')
  const [previewContext, setPreviewContext] = useState('')
  const [preview, setPreview] = useState<WorldbookResolveResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [splitProposals, setSplitProposals] = useState<SplitProposal[] | null>(null)
  const [splitting, setSplitting] = useState(false)
  const [importCandidates, setImportCandidates] = useState<Array<WorldbookSourceCandidate & { selected: boolean }> | null>(null)
  const [importing, setImporting] = useState(false)

  // 订阅 currentProject；按会话身份键记忆，避免每帧新对象把 load 效果反复触发。
  const session = useMemo(() => (
    sameProjectPathKey(project?.path, projectKey) ? captureProjectSession(project) : null
  ), [project?.id, project?.path, project?.sessionLease, projectKey])
  const selectedIdRef = useRef<string | null>(null)
  const newDraftRef = useRef<WorldbookEntry | null>(null)

  const selected = entries.find(entry => entry.id === selectedId) ?? null
  const dirty = Boolean(selected && (
    draftTitle !== selected.title
    || draftContent !== selected.content
    || JSON.stringify(draftActivation) !== JSON.stringify(selected.activation)
  ))

  const applyEntry = (entry: WorldbookEntry | null) => {
    selectedIdRef.current = entry?.id ?? null
    if (entry?.id !== '__new__') newDraftRef.current = null
    setSelectedId(entry?.id ?? null)
    setDraftTitle(entry?.title ?? '')
    setDraftContent(entry?.content ?? '')
    setDraftActivation(cloneActivation(entry?.activation ?? defaultWorldbookActivation()))
    setPreview(null)
  }

  const load = useCallback(async (preferredEntryId?: string) => {
    if (!session) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const loaded = await listWorldbookEntries(session)
      if (!isProjectSessionCurrent(session)) return
      const next = dedupeById(loaded)
      const drafting = newDraftRef.current
      const keepNewDraft = Boolean(drafting && (!preferredEntryId || preferredEntryId === '__new__'))
      const merged = keepNewDraft && drafting
        ? [drafting, ...next.filter(entry => entry.id !== '__new__')]
        : next
      setEntries(merged)

      const currentId = selectedIdRef.current
      if (preferredEntryId === '__new__' || (!preferredEntryId && currentId === '__new__' && keepNewDraft)) {
        selectedIdRef.current = '__new__'
        setSelectedId('__new__')
        return
      }
      const targetId = preferredEntryId
        ?? (currentId && next.some(entry => entry.id === currentId) ? currentId : null)
        ?? next[0]?.id
        ?? null
      applyEntry(targetId ? next.find(entry => entry.id === targetId) ?? null : null)
    } catch (cause) {
      if (isProjectSessionCurrent(session)) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(session)) setLoading(false)
    }
  }, [session])

  useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return entries.filter(entry => {
      if (kindFilter !== 'all' && entry.kind !== kindFilter) return false
      if (onlyEnabled && !entry.activation.enabled) return false
      if (sourceFilter !== 'all' && entry.source.kind !== sourceFilter) return false
      if (!normalizedQuery) return true
      return [entry.title, entry.content, entry.activation.primaryKeys.join(' '), entry.activation.secondaryKeys.join(' ')]
        .join('\n').toLocaleLowerCase().includes(normalizedQuery)
    })
  }, [entries, kindFilter, onlyEnabled, query, sourceFilter])

  const guardedSelect = (entry: WorldbookEntry) => {
    if (entry.id === selectedId) return
    if (dirty && !window.confirm(text('当前条目有未保存的修改，切换后这些修改会丢失。继续？', 'This entry has unsaved changes. Discard them and switch?'))) return
    if (entry.id !== '__new__') newDraftRef.current = null
    applyEntry(entry)
  }

  const startNew = (kind: WorldbookEntryKind = 'custom') => {
    if (dirty && !window.confirm(text('当前条目有未保存的修改，继续会丢失。', 'Discard the unsaved changes to this entry?'))) return
    const activation = defaultWorldbookActivation(kind)
    const newEntry: WorldbookEntry = {
      id: '__new__',
      kind,
      title: '',
      content: '',
      promptContent: '',
      activation,
      source: { kind: 'author', id: '', revision: '' },
      editable: true,
      needsReview: false,
      revision: 0,
      updatedAt: '',
    }
    newDraftRef.current = newEntry
    selectedIdRef.current = '__new__'
    setEntries(current => [newEntry, ...current.filter(entry => entry.id !== '__new__')])
    setSelectedId('__new__')
    setDraftTitle('')
    setDraftContent('')
    setDraftActivation(activation)
    setPreview(null)
  }

  const save = async () => {
    if (!selected) return
    if (!session) {
      toast.error(text('当前作品会话未就绪，请重新打开作品后再保存', 'Project session is not ready. Reopen the project and try again.'))
      return
    }
    if (!textValue(draftTitle)) {
      toast.error(text('条目要有标题', 'Give the entry a title'))
      return
    }
    setSaving(true)
    try {
      const saved = await saveWorldbookEntry(session, {
        ...(selected.id === '__new__' ? {} : { id: selected.id, expectedRevision: selected.revision }),
        kind: selected.kind,
        title: draftTitle,
        content: draftContent,
        activation: cloneActivation(draftActivation),
        sourceKind: selected.source.kind === 'import' ? 'import' : 'author',
      })
      if (!isProjectSessionCurrent(session)) return
      await load(saved.id)
      toast.success(text('世界书已保存', 'Worldbook entry saved'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!session || selected?.id === '__new__' || !selected) return
    if (!window.confirm(text(`删除「${selected.title}」？`, `Delete “${selected.title}”?`))) return
    try {
      await deleteWorldbookEntry(session, selected.id, selected.revision)
      if (isProjectSessionCurrent(session)) {
        setSelectedId(null)
        await load()
        toast.success(text('条目已删除', 'Entry deleted'))
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const openImportDialog = async () => {
    if (!session) return
    if (dirty && !window.confirm(text('当前条目有未保存的修改，打开导入前会先丢弃。继续？', 'Discard unsaved changes before importing?'))) return
    setImporting(true)
    try {
      const candidates = await listWorldbookSources(session)
      if (!isProjectSessionCurrent(session)) return
      setImportCandidates(candidates.map(item => ({
        ...item,
        selected: !item.alreadyImported,
      })))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(session)) setImporting(false)
    }
  }

  const confirmImport = async () => {
    if (!session || !importCandidates) return
    const sourceIds = importCandidates.filter(item => item.selected && !item.alreadyImported).map(item => item.id)
    if (sourceIds.length === 0) {
      setImportCandidates(null)
      return
    }
    setImporting(true)
    try {
      const saved = await importWorldbookSources(session, sourceIds)
      if (!isProjectSessionCurrent(session)) return
      setImportCandidates(null)
      await load(saved[0]?.id)
      toast.success(text(`已导入 ${saved.length} 条，可随时修改`, `Imported ${saved.length} editable entries`))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(session)) setImporting(false)
    }
  }

  const runPreview = async () => {
    if (!session || !selected) return
    setPreviewing(true)
    try {
      const chapterNumber = Math.max(1, Number(previewChapter) || 1)
      const result = await resolveWorldbook(session, {
        stage: previewStage,
        chapterNumber,
        chapterTitle: previewContext.split('\n')[0] ?? '',
        blueprintText: previewContext,
        authorGuidance: previewContext,
        budgetTokens: 4_000,
        forceIncludeIds: [selected.id],
      })
      if (isProjectSessionCurrent(session)) setPreview(result)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(session)) setPreviewing(false)
    }
  }

  const proposeSplit = async () => {
    if (!session || !selected || !selected.content) return
    if (selected.kind !== 'reference' && selected.source.kind !== 'import') return
    const model = models.find(item => item.id === defaultModelId) ?? models[0]
    if (!model) {
      toast.error(text('先在设置里配置生成模型', 'Configure a generation model in Settings first'))
      return
    }
    setSplitting(true)
    try {
      const language = project?.novelConfig.writingLanguage === 'en-US' ? 'English' : '简体中文'
      const response = await useLLMStore.getState().generate([
        {
          role: 'system',
          content: `You split novel reference material into atomic worldbook entries. Return JSON only. Use ${language}. Do not invent facts. Each entry must be independently useful and copy facts from the source without adding outside canon.`,
        },
        {
          role: 'user',
          content: `Split the following source into 1-30 atomic entries. Allowed kind values: ${WORLD_BOOK_ENTRY_KINDS.join(', ')}. Return one object: {"entries":[{"title":"...","kind":"world","content":"...","primaryKeys":["..."],"secondaryKeys":["..."]}]}. primaryKeys should be concrete names, aliases, places, objects, terms, or events likely to appear in a chapter.\n\nSOURCE\n${selected.content}`,
        },
      ], model.id, {
        responseFormat: { type: 'json_object' },
        purpose: 'worldbook-split',
        projectSession: session,
        reasoningStage: 'planning',
      })
      if (!isProjectSessionCurrent(session)) return
      const proposals = parseSplitProposals(response.content)
      setSplitProposals(proposals)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(session)) setSplitting(false)
    }
  }

  const confirmSplit = async () => {
    if (!session || !selected || !splitProposals) return
    const accepted = splitProposals.filter(item => item.selected)
    if (accepted.length === 0) return
    setSplitting(true)
    try {
      for (const item of accepted) {
        const activation = defaultWorldbookActivation(item.kind)
        activation.primaryKeys = item.primaryKeys
        activation.secondaryKeys = item.secondaryKeys
        await saveWorldbookEntry(session, {
          kind: item.kind,
          title: item.title,
          content: item.content,
          activation,
          sourceKind: 'import',
          sourceId: selected.source.id,
        })
      }
      if (!isProjectSessionCurrent(session)) return
      setSplitProposals(null)
      await load()
      toast.success(text(`已加入 ${accepted.length} 个世界书条目`, `${accepted.length} worldbook entries added`))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(session)) setSplitting(false)
    }
  }

  return (
    <div className="worldbook-page" data-loading={loading || undefined}>
      <nav className="worldbook-col worldbook-list" aria-label={text('世界书条目', 'Worldbook entries')}>
        <header className="worldbook-list-head">
          <div>
            <p className="worldbook-eyebrow">{text('作品知识', 'Living canon')}</p>
            <h1>{text('世界书', 'Worldbook')}</h1>
          </div>
          <Button variant="icon" size="sm" aria-label={text('刷新世界书', 'Refresh worldbook')} onClick={() => void load(selectedId ?? undefined)}>
            <RefreshCw size={14} aria-hidden />
          </Button>
        </header>
        <div className="worldbook-list-actions">
          <Button variant="primary" size="sm" onClick={() => startNew()}><Plus size={14} aria-hidden />{text('新建条目', 'New entry')}</Button>
          <Button variant="secondary" size="sm" disabled={importing} onClick={() => void openImportDialog()}>
            <FolderInput size={14} aria-hidden />{importing ? text('读取中…', 'Loading…') : text('从作品导入', 'Import from work')}
          </Button>
        </div>
        <label className="worldbook-search">
          <Search size={14} aria-hidden />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={text('标题、正文、关键词…', 'Title, text, keys…')}
            aria-label={text('搜索世界书', 'Search worldbook')}
          />
        </label>
        <div className="worldbook-filters">
          <label>
            <Filter size={12} aria-hidden />
            <select value={kindFilter} onChange={event => setKindFilter(event.target.value as typeof kindFilter)} aria-label={text('条目类型', 'Entry type')}>
              <option value="all">{text('全部类型', 'All types')}</option>
              {WORLD_BOOK_ENTRY_KINDS.map(kind => <option key={kind} value={kind}>{text(...KIND_NAMES[kind])}</option>)}
            </select>
          </label>
          <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value as typeof sourceFilter)} aria-label={text('条目来源', 'Entry source')}>
            <option value="all">{text('全部来源', 'All sources')}</option>
            <option value="author">{text('作者新建', 'Authored')}</option>
            <option value="import">{text('从作品导入', 'Imported')}</option>
          </select>
          <label className="worldbook-check">
            <input type="checkbox" checked={onlyEnabled} onChange={event => setOnlyEnabled(event.target.checked)} />
            {text('只看启用', 'Enabled only')}
          </label>
        </div>
        <div className="worldbook-list-meta">
          <span>{text(`${filtered.length} 条`, `${filtered.length} entries`)}</span>
          <span>{text(`${filtered.filter(entry => entry.activation.alwaysOn).length} 常驻`, `${filtered.filter(entry => entry.activation.alwaysOn).length} always on`)}</span>
        </div>
        <ol className="worldbook-entry-list">
          {filtered.map(entry => (
            <li key={entry.id}>
              <button
                type="button"
                className="worldbook-entry-row"
                aria-current={entry.id === selectedId ? 'true' : undefined}
                onClick={() => guardedSelect(entry)}
              >
                <span className="worldbook-entry-icon" data-kind={entry.kind}>
                  {entry.kind === 'chapter' || entry.kind === 'reference' ? <FileText size={14} aria-hidden /> : <BookOpen size={14} aria-hidden />}
                </span>
                <span className="worldbook-entry-copy">
                  <b>{entry.title || text('未命名条目', 'Untitled entry')}</b>
                  <small>{text(...KIND_NAMES[entry.kind])} · {entry.activation.enabled ? text('启用', 'On') : text('停用', 'Off')}{entry.needsReview ? text(' · 待核对', ' · Review') : ''}</small>
                </span>
                {entry.activation.alwaysOn && <span className="worldbook-always" title={text('常驻条目', 'Always on')}><Check size={12} aria-hidden /></span>}
              </button>
            </li>
          ))}
        </ol>
        {!loading && filtered.length === 0 && <p className="worldbook-empty">{text('没有符合条件的条目。', 'No entries match these filters.')}</p>}
      </nav>

      <section className="worldbook-col worldbook-detail" aria-label={text('条目内容', 'Entry detail')}>
        <div className="worldbook-editor">
          {error && <Notice tone="danger" title={text('世界书读取失败', 'Could not load the worldbook')}>{error}</Notice>}
          {!selected ? (
            <div className="worldbook-empty-state">
              <Sparkles size={28} aria-hidden />
              <h2>{text('世界书条目随时可改', 'Editable lore entries')}</h2>
              <p>{text('新建一条，或从作品设定、人物、蓝图、定稿摘要拷贝进来。拷进世界书后就是独立条目，改动不会回写正文。', 'Create an entry, or copy from setup, cast, blueprints, and finalized summaries. Copies stay editable here and do not write back to the manuscript.')}</p>
            </div>
          ) : (
            <>
              <header className="worldbook-editor-head">
                <div className="worldbook-editor-meta">
                  <span className="worldbook-kind-chip">{text(...KIND_NAMES[selected.kind])}</span>
                  <span>{sourceLabel(selected, text)}</span>
                  {selected.needsReview && <span className="worldbook-review-chip">{text('待核对', 'Needs review')}</span>}
                </div>
                <div className="worldbook-editor-actions">
                  {(selected.kind === 'reference' || selected.source.kind === 'import') && selected.content.length > 400 && (
                    <Button variant="text" size="sm" disabled={splitting} onClick={() => void proposeSplit()}>
                      <Sparkles size={13} aria-hidden />{splitting ? text('拆条中…', 'Splitting…') : text('AI 拆成条目', 'AI split')}
                    </Button>
                  )}
                  {selected.id !== '__new__' && (
                    <Button variant="text" size="sm" onClick={() => void remove()}><Trash2 size={13} aria-hidden />{text('删除', 'Delete')}</Button>
                  )}
                  <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
                    {saving ? text('保存中…', 'Saving…') : text('保存', 'Save')}
                  </Button>
                </div>
              </header>
              <input
                className="worldbook-title-input"
                value={draftTitle}
                aria-label={text('条目标题', 'Entry title')}
                placeholder={text('条目标题', 'Entry title')}
                onChange={event => setDraftTitle(event.target.value)}
              />
              <div className="worldbook-content-frame">
                <textarea
                  className="worldbook-content-input"
                  value={draftContent}
                  aria-label={text('条目正文', 'Entry content')}
                  placeholder={text('写下正文、事实、设定或参考资料摘录。', 'Write the entry text, facts, lore, or reference notes.')}
                  onChange={event => setDraftContent(event.target.value)}
                />
              </div>
            </>
          )}
        </div>

        {selected && (
          <aside className="worldbook-trigger" aria-label={text('触发与上下文预览', 'Activation and context preview')}>
            <header className="worldbook-trigger-head">
              <p className="worldbook-eyebrow">{text('激活方式', 'Activation')}</p>
              <h2>{text('何时进入上下文', 'When this enters context')}</h2>
            </header>
            <label className="worldbook-toggle-row">
              <span><b>{text('启用条目', 'Enabled')}</b><small>{text('关闭后完全不参与匹配。', 'Disabled entries never match.')}</small></span>
              <input type="checkbox" checked={draftActivation.enabled} onChange={event => setDraftActivation(current => ({ ...current, enabled: event.target.checked }))} />
            </label>
            <label className="worldbook-toggle-row">
              <span><b>{text('常驻', 'Always on')}</b><small>{text('在适用阶段始终进入提示词。', 'Always enters the prompt in applicable stages.')}</small></span>
              <input type="checkbox" checked={draftActivation.alwaysOn} onChange={event => setDraftActivation(current => ({ ...current, alwaysOn: event.target.checked }))} />
            </label>
            <div className="worldbook-field">
              <label>{text('主关键词', 'Primary keys')}</label>
              <input
                value={draftActivation.primaryKeys.join('，')}
                onChange={event => setDraftActivation(current => ({ ...current, primaryKeys: parseKeys(event.target.value) }))}
                placeholder={text('灯塔，林岚，潮汐', 'lighthouse, Lin Lan, tide')}
              />
              <small>{text('用逗号或换行分隔。名称和别名最适合做主关键词。', 'Separate with commas or new lines. Names and aliases work best.')}</small>
            </div>
            <div className="worldbook-field">
              <label>{text('次关键词', 'Secondary keys')}</label>
              <input
                value={draftActivation.secondaryKeys.join('，')}
                onChange={event => setDraftActivation(current => ({ ...current, secondaryKeys: parseKeys(event.target.value) }))}
                placeholder={text('只在特定场景使用的词', 'Scene-specific terms')}
              />
            </div>
            <div className="worldbook-grid-2">
              <label className="worldbook-field">
                <span>{text('匹配方式', 'Match mode')}</span>
                <select value={draftActivation.matchMode} onChange={event => setDraftActivation(current => ({ ...current, matchMode: event.target.value as WorldbookActivation['matchMode'] }))}>
                  <option value="any">{text('任一关键词', 'Any key')}</option>
                  <option value="all">{text('主次都命中', 'Primary and secondary')}</option>
                </select>
              </label>
              <label className="worldbook-field">
                <span>{text('提示词内容', 'Prompt content')}</span>
                <select value={draftActivation.promptPolicy} onChange={event => setDraftActivation(current => ({ ...current, promptPolicy: event.target.value as WorldbookActivation['promptPolicy'] }))}>
                  <option value="full">{text('完整正文', 'Full')}</option>
                  <option value="excerpt">{text('摘要/按预算', 'Summary / budgeted')}</option>
                  <option value="browse-only">{text('只浏览', 'Browse only')}</option>
                </select>
              </label>
            </div>
            <div className="worldbook-grid-2">
              <label className="worldbook-field">
                <span>{text('优先级', 'Priority')}</span>
                <input type="number" step={1} value={draftActivation.priority} onChange={event => setDraftActivation(current => ({ ...current, priority: Math.trunc(Number(event.target.value)) || 0 }))} />
              </label>
              <label className="worldbook-field">
                <span>{text('插入顺序', 'Order')}</span>
                <input type="number" step={1} value={draftActivation.insertionOrder} onChange={event => setDraftActivation(current => ({ ...current, insertionOrder: Math.trunc(Number(event.target.value)) || 0 }))} />
              </label>
            </div>
            <div className="worldbook-field">
              <label>{text('适用阶段', 'Stages')}</label>
              <div className="worldbook-stage-list">
                {WORLD_BOOK_STAGES.map(stage => (
                  <label key={stage}>
                    <input
                      type="checkbox"
                      checked={draftActivation.stages.includes(stage)}
                      onChange={event => setDraftActivation(current => ({
                        ...current,
                        stages: event.target.checked
                          ? [...current.stages, stage]
                          : current.stages.filter(item => item !== stage),
                      }))}
                    />
                    {text(...STAGE_NAMES[stage])}
                  </label>
                ))}
              </div>
            </div>
            <div className="worldbook-field">
              <label>{text('分组', 'Group')}</label>
              <input value={draftActivation.group} onChange={event => setDraftActivation(current => ({ ...current, group: event.target.value }))} />
            </div>

            <div className="worldbook-preview-box">
              <div className="worldbook-preview-head">
                <b>{text('本章预演', 'Chapter preview')}</b>
                <Button variant="secondary" size="sm" disabled={previewing} onClick={() => void runPreview()}>
                  <Sparkles size={13} aria-hidden />{previewing ? text('分析中…', 'Resolving…') : text('预演', 'Preview')}
                </Button>
              </div>
              <label className="worldbook-field">
                <span>{text('写作阶段', 'Writing stage')}</span>
                <select value={previewStage} onChange={event => setPreviewStage(event.target.value as WorldbookStage)}>
                  {WORLD_BOOK_STAGES.map(stage => <option key={stage} value={stage}>{text(...STAGE_NAMES[stage])}</option>)}
                </select>
              </label>
              <div className="worldbook-grid-2">
                <label className="worldbook-field">
                  <span>{text('当前章', 'Chapter')}</span>
                  <input type="number" min={1} value={previewChapter} onChange={event => setPreviewChapter(event.target.value)} />
                </label>
                <label className="worldbook-field">
                  <span>{text('预算', 'Budget')}</span>
                  <input value="约 4000 tokens" readOnly />
                </label>
              </div>
              <label className="worldbook-field">
                <span>{text('本章上下文', 'Chapter context')}</span>
                <textarea value={previewContext} onChange={event => setPreviewContext(event.target.value)} placeholder={text('粘贴本章蓝图、标题或作者指导，预演哪些条目会命中。', 'Paste the blueprint, title, or author guidance to preview matching entries.')} />
              </label>
              {preview && (
                <div className="worldbook-preview-result" data-overflow={preview.requiredOverflow || undefined}>
                  <p>
                    <b>{text(`${preview.selections.length} 条将进入上下文`, `${preview.selections.length} entries selected`)}</b>
                    <span>{text(`约 ${preview.tokenEstimate} / ${preview.budgetTokens} tokens`, `~${preview.tokenEstimate} / ${preview.budgetTokens} tokens`)}</span>
                  </p>
                  {preview.requiredOverflow && <Notice tone="danger" title={text('常驻或关键词条目超过预算', 'Required entries exceed the budget')}>{text('请停用或缩短必要条目；系统不会静默丢掉它们。', 'Disable or shorten required entries. They are never dropped silently.')}</Notice>}
                  <ol>
                    {preview.selections.map(item => <li key={item.entryId}><b>{item.title}</b><span>{item.reason}{item.matchedKeys.length ? ` · ${item.matchedKeys.join('、')}` : ''}</span></li>)}
                  </ol>
                  {preview.omitted.length > 0 && (
                    <details>
                      <summary>{text(`未进入 ${preview.omitted.length} 条`, `${preview.omitted.length} omitted`)}</summary>
                      <ul>{preview.omitted.map(item => <li key={`${item.entryId}:${item.reason}`}>{item.title} · {item.reason}</li>)}</ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </section>
      {importCandidates && (
        <div className="worldbook-split-backdrop" role="presentation">
          <section className="worldbook-split-dialog" role="dialog" aria-modal="true" aria-label={text('从作品导入世界书', 'Import worldbook from work')}>
            <header>
              <div>
                <p className="worldbook-eyebrow">{text('拷贝为可编辑条目', 'Copy as editable entries')}</p>
                <h2>{text(`可选 ${importCandidates.length} 项作品材料`, `${importCandidates.length} work materials available`)}</h2>
              </div>
              <Button variant="text" size="sm" onClick={() => setImportCandidates(null)}>{text('取消', 'Cancel')}</Button>
            </header>
            <p className="worldbook-split-help">{text('勾选后拷进世界书，之后可随时改标题与正文；不会改动设定页或定稿正文。已导入过的会标出并默认跳过。', 'Selected items become editable worldbook entries. They do not change setup pages or finalized prose. Already imported items are marked and skipped by default.')}</p>
            <ol className="worldbook-split-list">
              {importCandidates.map((candidate, index) => (
                <li key={candidate.id} data-selected={candidate.selected || undefined}>
                  <label className="worldbook-split-check">
                    <input
                      type="checkbox"
                      checked={candidate.selected}
                      disabled={candidate.alreadyImported}
                      onChange={event => setImportCandidates(current => current?.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, selected: event.target.checked } : item) ?? null)}
                    />
                    <span>{text(...KIND_NAMES[candidate.kind])}{candidate.alreadyImported ? text(' · 已导入', ' · Imported') : ''}</span>
                  </label>
                  <b>{candidate.title}</b>
                  <pre className="worldbook-split-preview">{candidate.content.slice(0, 360)}{candidate.content.length > 360 ? '…' : ''}</pre>
                </li>
              ))}
            </ol>
            <footer>
              <span>{text(
                `将导入 ${importCandidates.filter(item => item.selected && !item.alreadyImported).length} 条`,
                `${importCandidates.filter(item => item.selected && !item.alreadyImported).length} to import`,
              )}</span>
              <Button
                variant="primary"
                disabled={importing || !importCandidates.some(item => item.selected && !item.alreadyImported)}
                onClick={() => void confirmImport()}
              >
                {importing ? text('正在导入…', 'Importing…') : text('确认导入', 'Import')}
              </Button>
            </footer>
          </section>
        </div>
      )}
      {splitProposals && (
        <div className="worldbook-split-backdrop" role="presentation">
          <section className="worldbook-split-dialog" role="dialog" aria-modal="true" aria-label={text('确认世界书拆条', 'Confirm worldbook split')}>
            <header>
              <div>
                <p className="worldbook-eyebrow">{text('导入确认', 'Import review')}</p>
                <h2>{text(`从「${selected?.title ?? ''}」拆出 ${splitProposals.length} 条`, `${splitProposals.length} entries from “${selected?.title ?? ''}”`)}</h2>
              </div>
              <Button variant="text" size="sm" onClick={() => setSplitProposals(null)}>{text('取消', 'Cancel')}</Button>
            </header>
            <p className="worldbook-split-help">{text('取消勾选不要的条目；标题、正文和关键词可直接修改。来源文件会继续保留。', 'Uncheck unwanted entries. Edit titles, text, and keys directly. The source file is preserved.')}</p>
            <ol className="worldbook-split-list">
              {splitProposals.map((proposal, index) => (
                <li key={`${proposal.title}:${index}`} data-selected={proposal.selected || undefined}>
                  <label className="worldbook-split-check">
                    <input
                      type="checkbox"
                      checked={proposal.selected}
                      onChange={event => setSplitProposals(current => current?.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, selected: event.target.checked } : item) ?? null)}
                    />
                    <span>{text(...KIND_NAMES[proposal.kind])}</span>
                  </label>
                  <input
                    value={proposal.title}
                    aria-label={text('拆条标题', 'Split entry title')}
                    onChange={event => setSplitProposals(current => current?.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, title: event.target.value } : item) ?? null)}
                  />
                  <textarea
                    value={proposal.content}
                    aria-label={text('拆条正文', 'Split entry content')}
                    onChange={event => setSplitProposals(current => current?.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, content: event.target.value } : item) ?? null)}
                  />
                  <input
                    value={proposal.primaryKeys.join('，')}
                    aria-label={text('拆条关键词', 'Split entry keys')}
                    placeholder={text('主关键词', 'Primary keys')}
                    onChange={event => setSplitProposals(current => current?.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, primaryKeys: parseKeys(event.target.value) } : item) ?? null)}
                  />
                </li>
              ))}
            </ol>
            <footer>
              <span>{text(`已选 ${splitProposals.filter(item => item.selected).length} 条`, `${splitProposals.filter(item => item.selected).length} selected`)}</span>
              <Button variant="primary" disabled={splitting || !splitProposals.some(item => item.selected)} onClick={() => void confirmSplit()}>
                {splitting ? text('正在加入…', 'Adding…') : text('确认加入世界书', 'Add to worldbook')}
              </Button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}

