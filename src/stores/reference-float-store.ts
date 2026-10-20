import { create } from 'zustand'

export type ReferenceFloatKind = 'character'

export interface ReferenceFloatWindow {
  id: string
  kind: ReferenceFloatKind
  /** characterId (or characterId:portraitId) */
  subjectId: string
  title: string
  imageUrl: string
  mime?: string
  x: number
  y: number
  width: number
  zIndex: number
  chapterNumber?: number
}

interface ReferenceFloatState {
  windows: ReferenceFloatWindow[]
  topZ: number
  open: (input: Omit<ReferenceFloatWindow, 'id' | 'zIndex' | 'x' | 'y' | 'width'> & {
    x?: number
    y?: number
    width?: number
  }) => void
  close: (id: string) => void
  closeAll: () => void
  bringToFront: (id: string) => void
  move: (id: string, x: number, y: number) => void
}

let nextOffset = 0

export const useReferenceFloatStore = create<ReferenceFloatState>()((set, get) => ({
  windows: [],
  topZ: 12000,
  open: input => {
    const existing = get().windows.find(
      window => window.kind === input.kind && window.subjectId === input.subjectId && window.imageUrl === input.imageUrl,
    )
    if (existing) {
      get().bringToFront(existing.id)
      return
    }
    const stagger = (nextOffset++ % 8) * 28
    const zIndex = get().topZ + 1
    const window: ReferenceFloatWindow = {
      id: `${input.kind}:${input.subjectId}:${Date.now()}`,
      kind: input.kind,
      subjectId: input.subjectId,
      title: input.title,
      imageUrl: input.imageUrl,
      mime: input.mime,
      chapterNumber: input.chapterNumber,
      x: input.x ?? 72 + stagger,
      y: input.y ?? 96 + stagger,
      width: input.width ?? 220,
      zIndex,
    }
    set({ windows: [...get().windows, window], topZ: zIndex })
  },
  close: id => set({ windows: get().windows.filter(window => window.id !== id) }),
  closeAll: () => set({ windows: [] }),
  bringToFront: id => {
    const zIndex = get().topZ + 1
    set({
      topZ: zIndex,
      windows: get().windows.map(window => window.id === id ? { ...window, zIndex } : window),
    })
  },
  move: (id, x, y) => set({
    windows: get().windows.map(window => window.id === id ? { ...window, x, y } : window),
  }),
}))
