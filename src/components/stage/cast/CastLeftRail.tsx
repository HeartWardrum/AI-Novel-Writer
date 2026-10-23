import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus, Save, Search } from 'lucide-react'
import { getCharacterRoleLabels } from '../../../shared/character-role'
import {
  defaultWorldbookActivation,
  type WorldbookActivation,
  type WorldbookEntry,
} from '../../../shared/worldbook'
import { projectSessionContextFromProject } from '../../../shared/project-session-context'
import { listWorldbookEntries, saveWorldbookEntry } from '../../../services/worldbook-service'
import { useCharacterAvatars } from '../../editor/use-character-avatars'
import { useCharacterPortraits } from '../../editor/use-character-portraits'
import { useCharacterProfile } from '../../editor/use-character-profile'
import {
  characterSelectionKey,
  useCharacterStore,
} from '../../../stores/character-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { Button } from '../../ui/Button'
import { toast } from '../../ui/Toast'
import './cast-left-rail.css'

const RAIL_WIDTH_KEY = 'ai-novel.cast-left-rail-width'
const RAIL_WIDTH_DEFAULT = 320
const RAIL_WIDTH_MIN = 220
const RAIL_WIDTH_MAX = 520

function clampRailWidth(value: number): number {
  return Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, Math.round(value)))
}

function readStoredRailWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(RAIL_WIDTH_KEY))
    if (Number.isFinite(raw)) return clampRailWidth(raw)
  } catch {
    // ignore
  }
  return RAIL_WIDTH_DEFAULT
}

function writeStoredRailWidth(width: number): void {
  try {
    window.localStorage.setItem(RAIL_WIDTH_KEY, String(clampRailWidth(width)))
  } catch {
    // ignore
  }
}

function parseKeys(value: string): string[] {
  return value.split(/[,，\n]/u).map(item => item.trim()).filter(Boolean)
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

async function ensureCharacterWorldbookEntry(
  name: string,
): Promise<WorldbookEntry | null> {
  const project = useProjectStore.getState().currentProject
  const session = projectSessionContextFromProject(project)
  if (!session || !name.trim()) return null
  const entries = await listWorldbookEntries(session)
  const found = entries.find(
    entry => entry.kind === 'character' && entry.editable && entry.title === name,
  )
  if (found) return found
  return saveWorldbookEntry(session, {
    kind: 'character',
    title: name,
    content: '',
    privateContent: '',
    activation: defaultWorldbookActivation('character'),
  })
}

function CastExpandPanel({
  projectKey,
  selectionKey,
}: {
  projectKey: string
  selectionKey: string
}) {
  const text = useLocaleStore(s => s.text)
  const profile = useCharacterProfile(projectKey)
  const card = profile.selectedId === selectionKey ? profile.selectedCard : null
  const portraits = useCharacterPortraits(
    card?.characterId ?? null,
    Boolean(card?.characterId && !card.characterId.startsWith('draft:')),
  )

  const [wbEntry, setWbEntry] = useState<WorldbookEntry | null>(null)
  const [wbContent, setWbContent] = useState('')
  const [wbPrivate, setWbPrivate] = useState('')
  const [wbActivation, setWbActivation] = useState<WorldbookActivation>(
    () => defaultWorldbookActivation('character'),
  )
  const [wbLoading, setWbLoading] = useState(false)
  const [wbSaving, setWbSaving] = useState(false)
  const [wbDirty, setWbDirty] = useState(false)
  const [wbError, setWbError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setWbLoading(true)
    setWbError(null)
    setWbDirty(false)
    void (async () => {
      try {
        const name = card?.name?.trim()
        if (!name) {
          if (!cancelled) {
            setWbEntry(null)
            setWbContent('')
            setWbPrivate('')
            setWbActivation(defaultWorldbookActivation('character'))
          }
          return
        }
        const entry = await ensureCharacterWorldbookEntry(name)
        if (cancelled) return
        if (!entry) {
          setWbError(text('无法加载世界书人物条目。', '无法加载世界书人物条目。'))
          return
        }
        setWbEntry(entry)
        setWbContent(entry.content)
        setWbPrivate(entry.privateContent ?? '')
        setWbActivation(cloneActivation(entry.activation))
      } catch (cause) {
        if (!cancelled) {
          setWbError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        if (!cancelled) setWbLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [card?.name, text])

  if (!card) return null

  const primaryPortrait = portraits.portraits[0]

  const saveAll = async () => {
    setWbError(null)
    try {
      await profile.handleSave()
      const project = useProjectStore.getState().currentProject
      const session = projectSessionContextFromProject(project)
      if (!session) throw new Error(text('请先打开作品。', '请先打开作品。'))
      const title = card.name.trim()
      if (!title) throw new Error(text('姓名不能为空。', '姓名不能为空。'))
      setWbSaving(true)
      const saved = await saveWorldbookEntry(session, {
        ...(wbEntry ? { id: wbEntry.id, expectedRevision: wbEntry.revision } : {}),
        kind: 'character',
        title,
        content: wbContent,
        privateContent: wbPrivate,
        activation: {
          ...wbActivation,
          secondaryKeys: [],
          group: '人物',
        },
      })
      setWbEntry(saved)
      setWbActivation(cloneActivation(saved.activation))
      setWbDirty(false)
      toast.success(text('角色与人设已保存', '角色与人设已保存'))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setWbError(message)
      toast.error(message)
    } finally {
      setWbSaving(false)
    }
  }

  return (
    <div className="cast-left-rail-expand" data-testid="cast-left-rail-expand">
      <button
        type="button"
        className="cast-left-rail-portrait-frame"
        data-testid="cast-left-rail-portrait"
        disabled={!portraits.canEdit || portraits.busy || profile.identityBusy}
        onClick={() => { void portraits.addPortraits() }}
        title={portraits.canEdit
          ? text('点击添加或更换人设图', '点击添加或更换人设图')
          : text('先保存角色，再添加人设图。', '先保存角色，再添加人设图。')}
      >
        {primaryPortrait
          ? <img src={primaryPortrait.url} alt={text(`${card.name}人设图`, `${card.name}人设图`)} />
          : <span className="cast-left-rail-portrait-empty">{text('添加人设图', '添加人设图')}</span>}
      </button>
      {portraits.notice && <p className="cast-left-rail-error" role="alert">{portraits.notice}</p>}

      <div className="cast-left-rail-fields">
        <label className="cast-left-rail-toggle">
          <span>{text('常驻', '常驻')}</span>
          <input
            type="checkbox"
            checked={wbActivation.alwaysOn}
            disabled={wbLoading}
            onChange={event => {
              setWbActivation(current => ({ ...current, alwaysOn: event.target.checked }))
              setWbDirty(true)
            }}
          />
        </label>

        <div className="cast-left-rail-match-row">
          <div className="cast-left-rail-field cast-left-rail-field--grow">
            <label htmlFor={`cast-rail-keys-${selectionKey}`}>{text('关键词', '关键词')}</label>
            <input
              id={`cast-rail-keys-${selectionKey}`}
              className="pi-input"
              disabled={wbLoading}
              value={wbActivation.primaryKeys.join('，')}
              placeholder={text('灯塔，林岚', '灯塔，林岚')}
              onChange={event => {
                setWbActivation(current => ({
                  ...current,
                  primaryKeys: parseKeys(event.target.value),
                  secondaryKeys: [],
                }))
                setWbDirty(true)
              }}
            />
          </div>
          <div className="cast-left-rail-field cast-left-rail-field--match">
            <label htmlFor={`cast-rail-match-${selectionKey}`}>{text('匹配', '匹配')}</label>
            <select
              id={`cast-rail-match-${selectionKey}`}
              className="pi-input"
              disabled={wbLoading}
              value={wbActivation.matchMode}
              onChange={event => {
                setWbActivation(current => ({
                  ...current,
                  matchMode: event.target.value as WorldbookActivation['matchMode'],
                }))
                setWbDirty(true)
              }}
            >
              <option value="any">{text('任一', '任一')}</option>
              <option value="all">{text('全部', '全部')}</option>
            </select>
          </div>
        </div>

        <div className="cast-left-rail-field">
          <label htmlFor={`cast-rail-setting-${selectionKey}`}>{text('设定', '设定')}</label>
          <textarea
            id={`cast-rail-setting-${selectionKey}`}
            className="pi-input cast-left-rail-setting"
            rows={5}
            data-testid="cast-rail-public-content"
            disabled={wbLoading}
            value={wbContent}
            placeholder={text('外貌、性格、身份…', '外貌、性格、身份…')}
            onChange={event => {
              setWbContent(event.target.value)
              setWbDirty(true)
            }}
          />
        </div>

        {(wbError || profile.saveError) && (
          <p className="cast-left-rail-error" role="alert">{wbError || profile.saveError}</p>
        )}
      </div>

      <div className="cast-left-rail-actions">
        <span className="cast-left-rail-note" aria-live="polite">
          {wbLoading
            ? text('加载中…', '加载中…')
            : profile.saving || wbSaving
              ? text('保存中…', '保存中…')
              : profile.dirty || wbDirty
                ? text('未保存', '未保存')
                : ''}
        </span>
        <Button
          variant="primary"
          size="sm"
          disabled={profile.identityBusy || !profile.dataReady || profile.saving || wbSaving || wbLoading}
          onClick={() => { void saveAll() }}
        >
          <Save size={13} aria-hidden />
          {text('保存', '保存')}
        </Button>
      </div>
    </div>
  )
}

/** 聊天壳左侧人物栏：名单行可向下展开编辑档案 + 世界书人设。 */
export default function CastLeftRail({ projectKey }: { projectKey: string }) {
  const text = useLocaleStore(s => s.text)
  const characters = useCharacterStore(s => s.characters)
  const dataProjectKey = useCharacterStore(s => s.dataProjectKey)
  const loadingProjectKey = useCharacterStore(s => s.loadingProjectKey)
  const lastError = useCharacterStore(s => s.lastError)
  const identityBusy = useCharacterStore(s => s.identityBusy)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [railWidth, setRailWidth] = useState(RAIL_WIDTH_DEFAULT)
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    setRailWidth(readStoredRailWidth())
  }, [])

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    dragRef.current = { startX: event.clientX, startWidth: railWidth }
    setResizing(true)
    handle.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      setRailWidth(clampRailWidth(drag.startWidth + (moveEvent.clientX - drag.startX)))
    }
    const onUp = (upEvent: PointerEvent) => {
      dragRef.current = null
      setResizing(false)
      handle.releasePointerCapture(upEvent.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      setRailWidth(current => {
        writeStoredRailWidth(current)
        return current
      })
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }, [railWidth])

  const dataReady = dataProjectKey === projectKey && loadingProjectKey === null && lastError === null
  const pageIds = characters.flatMap(character => (character.characterId ? [character.characterId] : []))
  const { avatarUrls } = useCharacterAvatars(pageIds, dataReady)

  const roleLabel = (role: unknown) => {
    const { zhCN, enUS } = getCharacterRoleLabels(role)
    return text(zhCN, enUS)
  }

  const normalized = searchQuery.trim().toLocaleLowerCase()
  const rows = (dataReady ? characters : []).filter(character => (
    !normalized || character.name.toLocaleLowerCase().includes(normalized)
  ))

  const toggle = (key: string) => {
    if (expandedId === key) {
      setExpandedId(null)
      return
    }
    useCharacterStore.getState().setSelectedId(key)
    setExpandedId(key)
  }

  return (
    <aside
      className="cast-left-rail"
      data-testid="cast-left-rail"
      data-expanded={expandedId ? 'true' : 'false'}
      data-resizing={resizing ? 'true' : 'false'}
      style={{ width: railWidth }}
      aria-label={text('人物', '人物')}
    >
      <div className="cast-left-rail-head">
        <div className="cast-left-rail-head-row">
          <h2 className="cast-left-rail-title">{text('人物', '人物')}</h2>
          <Button
            variant="text"
            size="sm"
            className="cast-left-rail-add"
            disabled={identityBusy || !dataReady}
            onClick={() => useCharacterStore.getState().addCharacter()}
            aria-label={text('新建角色', '新建角色')}
          >
            <Plus size={16} aria-hidden />
          </Button>
        </div>
        <label className="cast-left-rail-search">
          <Search size={14} aria-hidden />
          <input
            className="cast-left-rail-search-input"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            aria-label={text('搜索角色', '搜索角色')}
            placeholder={text('搜索…', '搜索…')}
          />
        </label>
      </div>

      <ul className="cast-left-rail-list">
        {rows.map((character, index) => {
          const key = characterSelectionKey(character, characters.indexOf(character) >= 0
            ? characters.indexOf(character)
            : index)
          const avatar = character.characterId ? avatarUrls[character.characterId] : undefined
          const expanded = expandedId === key
          return (
            <li key={key} className="cast-left-rail-item" data-expanded={expanded ? 'true' : 'false'}>
              <button
                type="button"
                className="cast-left-rail-row"
                data-testid={`cast-left-rail-row-${key}`}
                data-character-id={character.characterId}
                aria-expanded={expanded}
                onClick={() => toggle(key)}
              >
                {avatar
                  ? <img className="cast-left-rail-avatar" src={avatar} alt="" />
                  : (
                    <span className="cast-left-rail-avatar cast-left-rail-avatar--fallback" aria-hidden>
                      {Array.from(character.name || '?')[0]}
                    </span>
                  )}
                <span className="cast-left-rail-row-text">
                  <span className="cast-left-rail-row-name">{character.name || text('未命名', '未命名')}</span>
                  <span className="cast-left-rail-row-role">{roleLabel(character.role)}</span>
                </span>
              </button>
              {expanded && (
                <CastExpandPanel projectKey={projectKey} selectionKey={key} />
              )}
            </li>
          )
        })}
        {dataReady && rows.length === 0 && (
          <li className="cast-left-rail-empty">
            {lastError
              ? text(`角色列表读取失败：${lastError}`, `角色列表读取失败：${lastError}`)
              : searchQuery.trim()
                ? text('没有匹配的角色', '没有匹配的角色')
                : text('还没有角色。点右上角添加。', '还没有角色。点右上角添加。')}
          </li>
        )}
        {!dataReady && !lastError && (
          <li className="cast-left-rail-empty">{text('加载角色中…', '加载角色中…')}</li>
        )}
      </ul>

      <div
        className="cast-left-rail-resizer"
        data-testid="cast-left-rail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={text('拖拽调整人物栏宽度', '拖拽调整人物栏宽度')}
        aria-valuemin={RAIL_WIDTH_MIN}
        aria-valuemax={RAIL_WIDTH_MAX}
        aria-valuenow={railWidth}
        tabIndex={0}
        onPointerDown={onResizePointerDown}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const next = clampRailWidth(railWidth + (event.key === 'ArrowRight' ? 16 : -16))
          setRailWidth(next)
          writeStoredRailWidth(next)
        }}
      />
    </aside>
  )
}
