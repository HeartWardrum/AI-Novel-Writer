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
  saveWorldbookActivation,
  saveWorldbookEntry,
} from '../../../services/worldbook-service'
import { useLLMStore } from '../../../stores/llm-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import {
  WORLD_BOOK_ENTRY_KINDS,
  defaultWorldbookActivation,
  isWorldbookSystemEntry,
  type WorldbookActivation,
  type WorldbookEntry,
  type WorldbookEntryKind,
  type WorldbookSourceCandidate,
} from '../../../shared/worldbook'
import { resolveWritingLanguage } from '../../../shared/writing-language'
import { composeDirectChatSystemSeed } from '../../../services/agent/direct-chat-prompt'
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
  if (isWorldbookSystemEntry(entry) || entry.source.kind === 'system') return text('系统内置', 'Built-in system')
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
  const [sourceFilter, setSourceFilter] = useState<'all' | 'author' | 'import' | 'system'>('all')
  const [onlyEnabled, setOnlyEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftKind, setDraftKind] = useState<WorldbookEntryKind>('custom')
  const [draftContent, setDraftContent] = useState('')
  const [draftPrivateContent, setDraftPrivateContent] = useState('')
  const [draftActivation, setDraftActivation] = useState<WorldbookActivation>(defaultWorldbookActivation())
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
    || draftKind !== selected.kind
    || draftContent !== selected.content
    || draftPrivateContent !== (selected.privateContent ?? '')
    || JSON.stringify(draftActivation) !== JSON.stringify(selected.activation)
  ))

  const applyEntry = (entry: WorldbookEntry | null) => {
    selectedIdRef.current = entry?.id ?? null
    if (entry?.id !== '__new__') newDraftRef.current = null
    setSelectedId(entry?.id ?? null)
    setDraftTitle(entry?.title ?? '')
    setDraftKind(entry?.kind ?? 'custom')
    setDraftContent(entry?.content ?? '')
    setDraftPrivateContent(entry?.kind === 'character' ? (entry.privateContent ?? '') : '')
    setDraftActivation(cloneActivation(entry?.activation ?? defaultWorldbookActivation()))
  }

  const load = useCallback(async (preferredEntryId?: string) => {
    if (!session) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const writingLanguage = resolveWritingLanguage(project?.novelConfig.writingLanguage)
      const systemPromptSeed = await composeDirectChatSystemSeed({
        writingLanguage,
        projectSession: session,
      }).catch(() => undefined)
      const loaded = await listWorldbookEntries(session, {
        ...(systemPromptSeed ? { systemPromptSeed } : {}),
      })
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
  }, [project?.novelConfig.writingLanguage, session])

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
      privateContent: '',
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
    setDraftKind(kind)
    setDraftContent('')
    setDraftPrivateContent('')
    setDraftActivation(activation)
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
      const system = isWorldbookSystemEntry(selected)
      const activation = cloneActivation({
        ...draftActivation,
        ...(system ? { alwaysOn: true, enabled: true } : {}),
        secondaryKeys: [],
        promptPolicy: draftActivation.promptPolicy || 'full',
      })
      const kind = system ? 'rule' : draftKind
      const saved = await saveWorldbookEntry(session, {
        ...(selected.id === '__new__' ? {} : { id: selected.id, expectedRevision: selected.revision }),
        kind,
        title: draftTitle,
        content: draftContent,
        privateContent: kind === 'character' ? draftPrivateContent : '',
        activation,
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

  const toggleEnabled = async (entry: WorldbookEntry, enabled: boolean) => {
    if (isWorldbookSystemEntry(entry) || entry.deletable === false) return
    const activation = cloneActivation({ ...entry.activation, enabled })
    if (entry.id === '__new__') {
      const next = { ...entry, activation }
      newDraftRef.current = next
      setEntries(current => current.map(item => item.id === entry.id ? next : item))
      if (selectedId === entry.id) setDraftActivation(activation)
      return
    }
    if (!session) {
      toast.error(text('当前作品会话未就绪，请重新打开作品后再保存', 'Project session is not ready. Reopen the project and try again.'))
      return
    }
    try {
      await saveWorldbookActivation(session, entry.id, activation)
      if (!isProjectSessionCurrent(session)) return
      setEntries(current => current.map(item => item.id === entry.id ? { ...item, activation } : item))
      if (selectedId === entry.id) setDraftActivation(activation)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const remove = async () => {
    if (!session || selected?.id === '__new__' || !selected) return
    if (isWorldbookSystemEntry(selected) || selected.deletable === false) {
      toast.error(text('系统提示不可删除', 'The system prompt cannot be deleted'))
      return
    }
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
            <option value="system">{text('系统内置', 'Built-in system')}</option>
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
            <li key={entry.id} className="worldbook-entry-item">
              <label className="worldbook-entry-enabled" title={text('启用条目', 'Enable entry')}>
                <input
                  type="checkbox"
                  checked={entry.activation.enabled}
                  disabled={isWorldbookSystemEntry(entry) || entry.deletable === false}
                  aria-label={text(`启用「${entry.title || '未命名条目'}」`, `Enable “${entry.title || 'Untitled entry'}”`)}
                  onClick={event => event.stopPropagation()}
                  onChange={event => void toggleEnabled(entry, event.target.checked)}
                />
              </label>
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
                  <small>
                    {isWorldbookSystemEntry(entry)
                      ? text('系统提示 · 置顶常驻', 'System prompt · pinned')
                      : text(...KIND_NAMES[entry.kind])}
                    {entry.needsReview ? text(' · 待核对', ' · Review') : ''}
                  </small>
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
                  <label className="worldbook-kind-field">
                    <span className="sr-only">{text('条目类型', '条目类型')}</span>
                    <select
                      value={draftKind}
                      disabled={isWorldbookSystemEntry(selected) || selected.deletable === false}
                      aria-label={text('条目类型', '条目类型')}
                      onChange={event => {
                        const next = event.target.value as WorldbookEntryKind
                        setDraftKind(next)
                        if (next !== 'character') setDraftPrivateContent('')
                        if (selected.id === '__new__' && newDraftRef.current) {
                          newDraftRef.current = { ...newDraftRef.current, kind: next, privateContent: next === 'character' ? draftPrivateContent : '' }
                        }
                      }}
                    >
                      {WORLD_BOOK_ENTRY_KINDS.map(kind => (
                        <option key={kind} value={kind}>{text(...KIND_NAMES[kind])}</option>
                      ))}
                    </select>
                  </label>
                  <span>{sourceLabel(selected, text)}</span>
                  {selected.needsReview && <span className="worldbook-review-chip">{text('待核对', 'Needs review')}</span>}
                </div>
                <div className="worldbook-editor-actions">
                  {(selected.kind === 'reference' || selected.source.kind === 'import') && selected.content.length > 400 && (
                    <Button variant="text" size="sm" disabled={splitting} onClick={() => void proposeSplit()}>
                      <Sparkles size={13} aria-hidden />{splitting ? text('拆条中…', 'Splitting…') : text('AI 拆成条目', 'AI split')}
                    </Button>
                  )}
                  {selected.id !== '__new__' && selected.deletable !== false && !isWorldbookSystemEntry(selected) && (
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
                  aria-label={draftKind === 'character'
                    ? text('公开人设', '公开人设')
                    : text('条目正文', '条目正文')}
                  placeholder={draftKind === 'character'
                    ? text('公开人设：外貌、身份等别人可能知道的内容。', '公开人设：外貌、身份等别人可能知道的内容。')
                    : text('写下正文、事实、设定或参考资料摘录。', '写下正文、事实、设定或参考资料摘录。')}
                  onChange={event => setDraftContent(event.target.value)}
                />
              </div>
              {draftKind === 'character' && (
                <div className="worldbook-content-frame worldbook-private-frame">
                  <label className="worldbook-private-label" htmlFor="worldbook-private-content">
                    {text('私有认知（只有此人知道）', '私有认知（只有此人知道）')}
                  </label>
                  <textarea
                    id="worldbook-private-content"
                    className="worldbook-content-input"
                    value={draftPrivateContent}
                    aria-label={text('私有认知', '私有认知')}
                    placeholder={text('分配作业写入，也可手改。不要把全书通用设定整段粘进来。', '分配作业写入，也可手改。不要把全书通用设定整段粘进来。')}
                    onChange={event => setDraftPrivateContent(event.target.value)}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {selected && (
          <aside className="worldbook-trigger" aria-label={text('匹配设置', 'Matching')}>
            <header className="worldbook-trigger-head">
              <p className="worldbook-eyebrow">{text('匹配', 'Match')}</p>
              <h2>{text('何时进入对话', 'When this enters chat')}</h2>
            </header>
            <label className="worldbook-toggle-row">
              <span><b>{text('常驻', 'Always on')}</b><small>{text('不依赖关键词，始终进入提示词。', 'Always enters the prompt without needing keywords.')}</small></span>
              <input
                type="checkbox"
                checked={draftActivation.alwaysOn}
                disabled={Boolean(selected && (isWorldbookSystemEntry(selected) || selected.deletable === false))}
                onChange={event => setDraftActivation(current => ({ ...current, alwaysOn: event.target.checked }))}
              />
            </label>
            <div className="worldbook-field">
              <label>{text('关键词', 'Keywords')}</label>
              <input
                value={draftActivation.primaryKeys.join('，')}
                onChange={event => setDraftActivation(current => ({ ...current, primaryKeys: parseKeys(event.target.value), secondaryKeys: [] }))}
                placeholder={text('灯塔，林岚，潮汐', 'lighthouse, Lin Lan, tide')}
              />
              <small>{text('用逗号或换行分隔。对话里出现这些词时才会带入（常驻除外）。', 'Separate with commas or new lines. Matched when the chat mentions them (unless always on).')}</small>
            </div>
            <label className="worldbook-field">
              <span>{text('匹配方式', 'Match mode')}</span>
              <select value={draftActivation.matchMode} onChange={event => setDraftActivation(current => ({ ...current, matchMode: event.target.value as WorldbookActivation['matchMode'] }))}>
                <option value="any">{text('命中任一', 'Match any')}</option>
                <option value="all">{text('命中全部关键词', 'Match all keywords')}</option>
              </select>
            </label>
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

