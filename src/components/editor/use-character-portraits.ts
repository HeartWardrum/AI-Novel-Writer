import { useCallback, useEffect, useRef, useState } from 'react'
import { getActiveProjectSessionContext } from '../../shared/project-session-context'
import type { CharacterPortraitView } from '../../shared/character-portraits'
import { ipc } from '../../services/ipc-client'
import { useLocaleStore } from '../../stores/locale-store'
import { base64ToObjectUrl, revokeObjectUrl } from './use-character-avatar'

export interface CharacterPortraitItem {
  portraitId: string
  sortIndex: number
  url: string
  createdAt: string
}

export interface CharacterPortraitsState {
  portraits: CharacterPortraitItem[]
  busy: boolean
  notice: string | null
  canEdit: boolean
  reload(): void
  addPortraits(): Promise<void>
  removePortrait(portraitId: string): Promise<void>
  movePortrait(portraitId: string, direction: -1 | 1): Promise<void>
}

function toItems(views: CharacterPortraitView[]): CharacterPortraitItem[] {
  return views.map(view => ({
    portraitId: view.portraitId,
    sortIndex: view.sortIndex,
    url: base64ToObjectUrl(view.base64, view.mime) ?? '',
    createdAt: view.createdAt,
  })).filter(item => item.url)
}

export function useCharacterPortraits(characterId: string | null, editing: boolean): CharacterPortraitsState {
  const context = getActiveProjectSessionContext()
  const text = useLocaleStore(state => state.text)
  const persisted = Boolean(characterId && !characterId.startsWith('draft:'))
  const key = context && characterId
    ? `${context.projectId}\u0000${context.leaseId}\u0000${characterId}`
    : ''
  const [portraits, setPortraits] = useState<CharacterPortraitItem[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const urlsRef = useRef<string[]>([])

  const clearUrls = () => {
    for (const url of urlsRef.current) revokeObjectUrl(url)
    urlsRef.current = []
  }

  useEffect(() => {
    let cancelled = false
    clearUrls()
    setPortraits([])
    setNotice(null)
    void Promise.resolve().then(async () => {
      if (cancelled || !context || !characterId || !persisted || !editing) return
      try {
        const response = await ipc.invokeWithProjectSession(context, 'character-portrait:list', characterId)
        if (cancelled) return
        if (!response.success) {
          setNotice(response.error.message)
          return
        }
        const items = toItems(response.portraits)
        urlsRef.current = items.map(item => item.url)
        setPortraits(items)
      } catch {
        if (!cancelled) setNotice(text('人设图读取失败。', 'Could not load portraits.'))
      }
    })
    return () => { cancelled = true; clearUrls() }
  }, [characterId, context, editing, key, persisted, refresh, text])

  const reload = useCallback(() => setRefresh(value => value + 1), [])

  const addPortraits = useCallback(async () => {
    if (!context || !characterId || !persisted || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await ipc.invokeWithProjectSession(context, 'character-portrait:choose-add', characterId)
      if (!response.success) {
        setNotice(response.error.message)
        return
      }
      if (!response.cancelled) reload()
    } catch {
      setNotice(text('人设图添加失败。', 'Could not add portraits.'))
    } finally {
      setBusy(false)
    }
  }, [busy, characterId, context, persisted, reload, text])

  const removePortrait = useCallback(async (portraitId: string) => {
    if (!context || !persisted || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await ipc.invokeWithProjectSession(context, 'character-portrait:remove', portraitId)
      if (!response.success) {
        setNotice(response.error.message)
        return
      }
      reload()
    } catch {
      setNotice(text('人设图删除失败。', 'Could not delete the portrait.'))
    } finally {
      setBusy(false)
    }
  }, [busy, context, persisted, reload, text])

  const movePortrait = useCallback(async (portraitId: string, direction: -1 | 1) => {
    if (!context || !characterId || !persisted || busy) return
    const index = portraits.findIndex(item => item.portraitId === portraitId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= portraits.length) return
    const nextIds = portraits.map(item => item.portraitId)
    ;[nextIds[index], nextIds[target]] = [nextIds[target]!, nextIds[index]!]
    setBusy(true)
    setNotice(null)
    try {
      const response = await ipc.invokeWithProjectSession(
        context,
        'character-portrait:reorder',
        characterId,
        nextIds,
      )
      if (!response.success) {
        setNotice(response.error.message)
        return
      }
      reload()
    } catch {
      setNotice(text('人设图排序失败。', 'Could not reorder portraits.'))
    } finally {
      setBusy(false)
    }
  }, [busy, characterId, context, persisted, portraits, reload, text])

  return {
    portraits,
    busy,
    notice,
    canEdit: Boolean(editing && persisted),
    reload,
    addPortraits,
    removePortrait,
    movePortrait,
  }
}
