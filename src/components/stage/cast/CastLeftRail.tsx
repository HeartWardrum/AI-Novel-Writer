import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus, Save, Search } from 'lucide-react'
import { CHARACTER_ROLES, getCharacterRoleLabels, type CharacterRole } from '../../../shared/character-role'
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
  type CharacterCard,
} from '../../../stores/character-store'
import { useAgentStore } from '../../../stores/agent-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { Button } from '../../ui/Button'
import { toast } from '../../ui/Toast'
import {
  groupCharactersByRole,
  isCharacterMentionedInText,
  recentChatHaystack,
} from './cast-rail-model'
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

type EditTarget = { key: string; field: 'name' | 'role' } | null
type DropHint = { key: string; place: 'before' | 'after' } | null
type DropShift = 'up' | 'down' | null

function flatKeysFromGroups(
  groups: ReturnType<typeof groupCharactersByRole>,
): string[] {
  return groups.flatMap(group => group.items.map(item => item.key))
}

function insertKeyBefore(
  keys: readonly string[],
  fromKey: string,
  toKey: string,
  place: 'before' | 'after',
): string[] {
  const without = keys.filter(key => key !== fromKey)
  let index = without.indexOf(toKey)
  if (index < 0) return [...keys]
  if (place === 'after') index += 1
  without.splice(index, 0, fromKey)
  return without
}

/** 按落点缝隙给邻行微移：缝上略上、缝下略下。 */
function resolveDropShift(
  flatKeys: readonly string[],
  itemKey: string,
  draggingKey: string | null,
  dropHint: DropHint,
): DropShift {
  if (!draggingKey || !dropHint || itemKey === draggingKey) return null
  const itemIndex = flatKeys.indexOf(itemKey)
  const hintIndex = flatKeys.indexOf(dropHint.key)
  if (itemIndex < 0 || hintIndex < 0) return null
  const gapIndex = dropHint.place === 'before' ? hintIndex : hintIndex + 1
  return itemIndex >= gapIndex ? 'down' : 'up'
}

function CastRailRow({
  projectKey,
  character,
  selectionKey,
  groupRole,
  avatarUrl,
  expanded,
  mentioned,
  dragEnabled,
  dragging,
  dropPlace,
  dropShift,
  editing,
  onToggle,
  onStartEdit,
  onStopEdit,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  projectKey: string
  character: CharacterCard
  selectionKey: string
  groupRole: CharacterRole
  avatarUrl?: string
  expanded: boolean
  mentioned: boolean
  dragEnabled: boolean
  dragging: boolean
  dropPlace: 'before' | 'after' | null
  dropShift: DropShift
  editing: EditTarget
  onToggle: () => void
  onStartEdit: (field: 'name' | 'role') => void
  onStopEdit: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: (place: 'before' | 'after') => void
  onDrop: (place: 'before' | 'after') => void
}) {
  const text = useLocaleStore(s => s.text)
  const identityBusy = useCharacterStore(s => s.identityBusy)
  const [nameDraft, setNameDraft] = useState(character.name)
  const didDragRef = useRef(false)
  const editingName = editing?.key === selectionKey && editing.field === 'name'
  const editingRole = editing?.key === selectionKey && editing.field === 'role'
  const rowDraggable = dragEnabled && !editingName && !editingRole

  useEffect(() => {
    if (editingName) setNameDraft(character.name)
  }, [character.name, editingName])

  const roleLabel = (role: unknown) => {
    const { zhCN, enUS } = getCharacterRoleLabels(role)
    return text(zhCN, enUS)
  }

  const commitName = () => {
    const next = nameDraft.trim()
    if (next && next !== character.name) {
      useCharacterStore.getState().renameCharacter(selectionKey, next)
    }
    onStopEdit()
  }

  return (
    <li
      className="cast-left-rail-item"
      data-expanded={expanded ? 'true' : 'false'}
      data-mentioned={mentioned ? 'true' : 'false'}
      data-role-group={groupRole}
      data-dragging={dragging ? 'true' : 'false'}
      data-drop-place={dropPlace ?? undefined}
      data-drop-shift={dropShift ?? undefined}
      onDragOver={event => {
        if (!dragEnabled || dragging) return
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        onDragOver(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
      onDrop={event => {
        if (!dragEnabled || dragging) return
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        onDrop(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
    >
      <div
        className="cast-left-rail-row"
        data-testid={`cast-left-rail-row-${selectionKey}`}
        data-character-id={character.characterId}
        data-mentioned={mentioned ? 'true' : 'false'}
        data-drag-source={rowDraggable ? 'true' : 'false'}
      >
        <button
          type="button"
          className="cast-left-rail-row-main"
          data-testid={`cast-left-rail-drag-${selectionKey}`}
          aria-expanded={expanded}
          aria-label={rowDraggable ? text('拖拽排序或展开', '拖拽排序或展开') : undefined}
          draggable={rowDraggable}
          onDragStart={event => {
            if (!rowDraggable) return
            const target = event.target as HTMLElement | null
            if (target?.closest('input, select, textarea')) {
              event.preventDefault()
              return
            }
            didDragRef.current = true
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', selectionKey)
            onDragStart()
          }}
          onDragEnd={onDragEnd}
          onClick={event => {
            // 双击改名/身份时忽略第二次 click；拖拽松手后的 click 也吞掉
            if (event.detail > 1) return
            if (didDragRef.current) {
              didDragRef.current = false
              return
            }
            onToggle()
          }}
        >
          {avatarUrl
            ? <img className="cast-left-rail-avatar" src={avatarUrl} alt="" draggable={false} />
            : (
              <span className="cast-left-rail-avatar cast-left-rail-avatar--fallback" aria-hidden>
                {Array.from(character.name || '?')[0]}
              </span>
            )}
          <span className="cast-left-rail-row-text">
            {editingName ? (
              <input
                className="cast-left-rail-inline-input"
                value={nameDraft}
                autoFocus
                disabled={identityBusy}
                draggable={false}
                aria-label={text('姓名', '姓名')}
                onClick={event => event.stopPropagation()}
                onDragStart={event => event.preventDefault()}
                onChange={event => setNameDraft(event.target.value)}
                onBlur={commitName}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitName()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setNameDraft(character.name)
                    onStopEdit()
                  }
                }}
              />
            ) : (
              <span
                className="cast-left-rail-row-name"
                onDoubleClick={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  onStartEdit('name')
                }}
              >
                {character.name || text('未命名', '未命名')}
              </span>
            )}
            {editingRole ? (
              <select
                className="cast-left-rail-inline-select"
                value={character.role}
                autoFocus
                draggable={false}
                aria-label={text('身份', '身份')}
                onClick={event => event.stopPropagation()}
                onDragStart={event => event.preventDefault()}
                onChange={event => {
                  useCharacterStore.getState().updateField(
                    selectionKey,
                    'role',
                    event.target.value as CharacterCard['role'],
                  )
                  onStopEdit()
                }}
                onBlur={onStopEdit}
              >
                {CHARACTER_ROLES.map(role => (
                  <option key={role} value={role}>{roleLabel(role)}</option>
                ))}
              </select>
            ) : (
              <span
                className="cast-left-rail-row-role"
                onDoubleClick={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  onStartEdit('role')
                }}
              >
                {roleLabel(character.role)}
              </span>
            )}
          </span>
        </button>
      </div>
      {expanded && (
        <CastExpandPanel projectKey={projectKey} selectionKey={selectionKey} />
      )}
    </li>
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
  const activeMessages = useAgentStore(s => {
    const activeId = s.activeConversationId
    return s.conversations.find(conversation => conversation.id === activeId)?.messages
  })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [railWidth, setRailWidth] = useState(RAIL_WIDTH_DEFAULT)
  const [resizing, setResizing] = useState(false)
  const [editing, setEditing] = useState<EditTarget>(null)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<DropHint>(null)
  const widthDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    setRailWidth(readStoredRailWidth())
  }, [])

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    widthDragRef.current = { startX: event.clientX, startWidth: railWidth }
    setResizing(true)
    handle.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      const drag = widthDragRef.current
      if (!drag) return
      setRailWidth(clampRailWidth(drag.startWidth + (moveEvent.clientX - drag.startX)))
    }
    const onUp = (upEvent: PointerEvent) => {
      widthDragRef.current = null
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
  const filtering = Boolean(normalized)
  const groups = useMemo(() => {
    const all = groupCharactersByRole(dataReady ? characters : [])
    if (!normalized) return all
    return all
      .map(group => ({
        ...group,
        items: group.items.filter(item => (
          item.character.name.toLocaleLowerCase().includes(normalized)
        )),
      }))
      .filter(group => group.items.length > 0)
  }, [characters, dataReady, normalized])

  const visibleCount = groups.reduce((sum, group) => sum + group.items.length, 0)
  const flatVisibleKeys = useMemo(() => flatKeysFromGroups(groups), [groups])

  const haystack = useMemo(
    () => recentChatHaystack(activeMessages ?? []),
    [activeMessages],
  )

  const clearDrag = () => {
    setDraggingKey(null)
    setDropHint(null)
  }

  const toggle = (key: string) => {
    if (editing) return
    if (expandedId === key) {
      setExpandedId(null)
      return
    }
    useCharacterStore.getState().setSelectedId(key)
    setExpandedId(key)
  }

  const applyDrop = (fromKey: string, toKey: string, place: 'before' | 'after', targetRole: CharacterRole) => {
    if (fromKey === toKey) return
    const fullGroups = groupCharactersByRole(characters)
    const ordered = insertKeyBefore(flatKeysFromGroups(fullGroups), fromKey, toKey, place)
    const fromCard = characters.find((character, index) => characterSelectionKey(character, index) === fromKey)
    const roleByKey = fromCard && fromCard.role !== targetRole
      ? { [fromKey]: targetRole }
      : undefined
    useCharacterStore.getState().reorderCharacters(ordered, roleByKey)
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

      <ul
        className="cast-left-rail-list"
        data-drag-active={draggingKey ? 'true' : 'false'}
      >
        {groups.map(group => (
          <Fragment key={group.role}>
            <li className="cast-left-rail-group-label" role="presentation">
              <span>{roleLabel(group.role)}</span>
            </li>
            {group.items.map(item => (
              <CastRailRow
                key={item.key}
                projectKey={projectKey}
                character={item.character}
                selectionKey={item.key}
                groupRole={group.role}
                avatarUrl={item.character.characterId ? avatarUrls[item.character.characterId] : undefined}
                expanded={expandedId === item.key}
                mentioned={isCharacterMentionedInText(item.character.name, haystack)}
                dragEnabled={!filtering && dataReady}
                dragging={draggingKey === item.key}
                dropPlace={
                  dropHint?.key === item.key && draggingKey && draggingKey !== item.key
                    ? dropHint.place
                    : null
                }
                dropShift={resolveDropShift(flatVisibleKeys, item.key, draggingKey, dropHint)}
                editing={editing}
                onToggle={() => toggle(item.key)}
                onStartEdit={field => setEditing({ key: item.key, field })}
                onStopEdit={() => setEditing(null)}
                onDragStart={() => {
                  setDraggingKey(item.key)
                  setDropHint(null)
                }}
                onDragEnd={clearDrag}
                onDragOver={place => {
                  setDropHint(current => (
                    current?.key === item.key && current.place === place
                      ? current
                      : { key: item.key, place }
                  ))
                }}
                onDrop={place => {
                  if (!draggingKey) return
                  applyDrop(draggingKey, item.key, place, group.role)
                  clearDrag()
                }}
              />
            ))}
          </Fragment>
        ))}
        {dataReady && visibleCount === 0 && (
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
