import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import '../../../index.css'
import '../../../styles/paper-ink/index.css'
import '../stage.css'
import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useAgentStore } from '../../../stores/agent-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useStageStore } from '../../../stores/navigation/stage-store'
import { useProjectStore } from '../../../stores/project-store'
import StageShell from '../StageShell'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function snapshot<T>(store: StoreApi<T>): () => void {
  const state = store.getState()
  return () => store.setState(state, true)
}
const restores = [useAgentStore, useEditorStore, useLayoutStore, useLLMStore, useLocaleStore, useStageStore, useProjectStore]
  .map(store => snapshot(store as StoreApi<unknown>))

const chatColumn = () => host!.querySelector<HTMLElement>('.chat-workbench-chat-panel')!
const chatInput = () => host!.querySelector<HTMLTextAreaElement>('.chat-workbench-chat-panel textarea')!
const shellFrame = () => host!.querySelector<HTMLElement>('.chat-shell-frame')!

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(async () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'config:get') return {}
    if (channel === 'config:set') return { success: true }
    if (channel === 'character-preset:list') return { success: true, presets: [] }
    if (channel === 'update:get-state') {
      return { status: 'disabled', currentVersion: '1.2.2', isReminderDeferred: false }
    }
    if (channel === 'project:overview-current') {
      return {
        state: 'ready',
        projectId: 'harbor',
        name: '港湾',
        setupReady: true,
        totalWords: 0,
        finalizedChapters: 0,
        characters: 0,
        excerpt: '',
      }
    }
    return channel.endsWith('-list') || channel.endsWith('get-all') ? [] : undefined
  })
  Object.defineProperty(window, 'aiNovelAPI', { configurable: true, value: { invoke, on: () => () => undefined } })
  useLocaleStore.setState({ locale: 'zh-CN' })
  useLLMStore.setState({ loaded: true, models: [], defaultModelId: null })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useStageStore.setState({ sheet: null, focus: false, palette: null, work: null, rightRail: 'chat', chatOverlay: null })
  useAgentStore.setState({ conversations: [], activeConversationId: null, showHistory: false, generating: false })
  setActiveProjectSessionContext({ projectId: 'harbor', leaseId: 'lease-1', projectPath: 'C:\\novels\\harbor' })
  useProjectStore.setState({
    currentProject: {
      id: 'harbor',
      sessionLease: 'lease-1',
      name: '港湾',
      path: 'C:\\novels\\harbor',
      novelConfig: { totalChapters: 12, wordsPerChapter: 3000 },
    } as unknown as ProjectData,
    recentProjects: [],
    recentProjectsLoaded: true,
  })
  useLayoutStore.setState({ sidebarView: 'project', settingsOpen: false })
  host = document.createElement('div')
  host.style.cssText = 'width: 1280px; height: 800px; display: flex;'
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<StageShell theme="light" />))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  setActiveProjectSessionContext(null)
  Reflect.deleteProperty(window, 'aiNovelAPI')
  for (const restore of restores) restore()
  vi.restoreAllMocks()
})

describe('聊天优先外壳', () => {
  it('打开作品后是全幅对话，不挂载流程脊与正文栏', async () => {
    await vi.waitFor(() => expect(host!.querySelector('[data-shell-presentation="chat"]')).not.toBeNull())
    expect(host!.querySelector('.stage-spine')).toBeNull()
    expect(host!.querySelector('.stage-panel')).toBeNull()
    expect(host!.querySelector('.materials-rail')).toBeNull()
    expect(host!.querySelector('.chat-workbench')).not.toBeNull()
    expect(host!.querySelector('.chat-topbar')).not.toBeNull()
    expect(host!.querySelector('[data-testid="cast-left-rail"]')).not.toBeNull()
  })

  it('顶栏可回书房、开世界书与设置', async () => {
    const library = [...host!.querySelectorAll('button')].find(button => button.textContent?.includes('回书房'))
    const worldbook = [...host!.querySelectorAll('button')].find(button => button.textContent?.includes('世界书'))
    const settings = [...host!.querySelectorAll('button')].find(button => button.textContent?.includes('设置'))
    expect(library && worldbook && settings).toBeTruthy()

    await act(async () => worldbook!.click())
    expect(useStageStore.getState().chatOverlay).toBe('worldbook')
    await vi.waitFor(() => expect(host!.querySelector('.chat-overlay')).not.toBeNull())

    await act(async () => settings!.click())
    expect(useLayoutStore.getState().settingsOpen).toBe(true)
    await vi.waitFor(() => expect(host!.querySelector('.chat-settings-layer')).not.toBeNull())

    await act(async () => {
      useLayoutStore.getState().closeSettings()
      library!.click()
    })
    expect(useLayoutStore.getState().sidebarView).toBe('home')
    expect(useStageStore.getState().chatOverlay).toBeNull()
    await vi.waitFor(() => expect(host!.querySelector('[data-library]')).not.toBeNull())
  })

  it('空态对话列整壳居中；左栏定宽；有消息后输入沉到底部', async () => {
    await vi.waitFor(() => expect(chatInput()).toBeTruthy())
    const frame = shellFrame().getBoundingClientRect()
    const railEl = host!.querySelector<HTMLElement>('[data-testid="cast-left-rail"]')!
    const rail = railEl.getBoundingClientRect()
    const column = chatColumn().getBoundingClientRect()
    const emptyInput = chatInput().getBoundingClientRect()

    expect(column.width).toBeLessThan(frame.width - 24)
    // 对话列相对整壳水平居中（左栏绝对定位不占 flex）
    expect(Math.abs((column.left + column.right) / 2 - (frame.left + frame.right) / 2)).toBeLessThan(8)
    expect(rail.width).toBeGreaterThanOrEqual(220)
    expect(rail.width).toBeLessThanOrEqual(520)
    expect(host!.querySelector('[data-testid="cast-left-rail-resizer"]')).not.toBeNull()
    // 空态：输入大致在壳的中段，而不是贴底
    expect(emptyInput.top).toBeGreaterThan(frame.top + frame.height * 0.2)
    expect(emptyInput.bottom).toBeLessThan(frame.bottom - frame.height * 0.15)

    const now = Date.now()
    await act(async () => {
      useAgentStore.setState({
        conversations: [{
          id: 'conv-1',
          title: '雾钟',
          createdAt: now,
          updatedAt: now,
          modelId: null,
          messages: [
            { id: 'm1', role: 'user', content: '写一段开场', createdAt: now },
            { id: 'm2', role: 'assistant', content: '雾从海面上爬上来。', createdAt: now + 1 },
          ],
        }],
        activeConversationId: 'conv-1',
        showHistory: false,
        generating: false,
      })
    })

    await vi.waitFor(() => expect(host!.textContent).toContain('雾从海面上爬上来。'))
    const activeInput = chatInput().getBoundingClientRect()
    expect(frame.bottom - activeInput.bottom).toBeLessThan(80)
    expect(activeInput.top).toBeGreaterThan(frame.top + frame.height * 0.45)
  })
})
