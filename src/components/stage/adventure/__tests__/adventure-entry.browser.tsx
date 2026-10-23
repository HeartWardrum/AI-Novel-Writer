import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { StoreApi } from 'zustand'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useLayoutStore } from '../../../../stores/layout-store'
import { useLLMStore } from '../../../../stores/llm-store'
import { useProjectStore } from '../../../../stores/project-store'
import StageLibrary from '../../library/StageLibrary'
import AdventureShell from '../AdventureShell'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Api = { invoke: (channel: string, ...args: unknown[]) => Promise<unknown>; on: () => () => void }
const win = window as unknown as { aiNovelAPI?: Api }

function snapshot<T>(store: StoreApi<T>): () => void {
  const state = store.getState()
  return () => store.setState(state, true)
}
const restores = [snapshot(useLayoutStore), snapshot(useProjectStore), snapshot(useLLMStore)]

let root: Root | undefined
let host: HTMLDivElement | undefined

async function mount(node: ReactNode) {
  host = document.createElement('div')
  host.className = 'paper-ink stage-shell'
  host.style.cssText = 'width: 1440px; height: 900px;'
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
}

const button = (name: string) => [...host!.ownerDocument.querySelectorAll<HTMLButtonElement>('button')]
  .find(candidate => (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === name)

async function click(element: HTMLElement | undefined) {
  expect(element, '要点击的元素存在').toBeTruthy()
  await act(async () => element!.click())
}

beforeEach(async () => {
  await page.viewport(1440, 900)
  win.aiNovelAPI = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'character-preset:list') return { success: true, presets: [] }
      if (channel === 'update:get-state') return { status: 'disabled', currentVersion: '1.2.2', isReminderDeferred: false }
      return undefined
    }),
    on: () => () => undefined,
  }
  useLayoutStore.setState({ sidebarView: 'home', settingsOpen: false })
  useLLMStore.setState({ loaded: true, defaultModelId: 'model' })
  useProjectStore.setState({
    currentProject: null,
    recentProjects: [{ name: '灯塔', path: 'C:\\novels\\lighthouse', updatedAt: '2026-10-11T21:14:00.000Z', previewCapabilityId: 'cap-lighthouse' }],
    recentProjectsLoaded: true,
    legacyImportBusy: false,
    legacyImportNotice: '',
  } as never)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  delete win.aiNovelAPI
  for (const restore of restores) restore()
})

describe('山海经捉妖入口', () => {
  it('书房开始卡点进冒险，占位页可回书房', async () => {
    await mount(<div className="stage-library"><StageLibrary /></div>)
    await click(button('山海经捉妖'))
    expect(useLayoutStore.getState().sidebarView).toBe('adventure')

    await act(async () => root?.unmount())
    await mount(<AdventureShell />)
    expect(host!.querySelector('[data-testid="adventure-shell"]')).toBeTruthy()
    expect(host!.textContent).toContain('山海经捉妖')
    expect(host!.textContent).toContain('回合玩法稍后接入')

    await click(button('回书房'))
    expect(useLayoutStore.getState().sidebarView).toBe('home')
  })

  it('空书房文字入口也能进入冒险', async () => {
    useProjectStore.setState({ recentProjects: [], recentProjectsLoaded: true } as never)
    await mount(<div className="stage-library"><StageLibrary /></div>)
    expect(host!.querySelector('h1')?.textContent).toBe('书架还是空的')
    await click(button('山海经捉妖'))
    expect(useLayoutStore.getState().sidebarView).toBe('adventure')
  })
})
