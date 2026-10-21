import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { StoreApi } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import type { Locale } from '../i18n/types'
import type { ProjectData } from '../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../shared/project-session-context'
import { useLayoutStore } from '../stores/layout-store'
import { useLocaleStore } from '../stores/locale-store'
import { navigate } from '../stores/navigation/navigation-intents'
import { useStageStore } from '../stores/navigation/stage-store'
import { useProjectStore } from '../stores/project-store'
import { useWorkflowStore } from '../stores/workflow-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session = { projectId: '灯塔', projectPath: 'C:/novels/lighthouse', leaseId: '本次打开' }
const project = { id: session.projectId, name: '灯塔', path: session.projectPath, sessionLease: session.leaseId, novelConfig: {
  coreOutline: '雾钟', genre: '悬疑', subGenre: '', targetAudience: '成年读者', totalChapters: 24, wordsPerChapter: 3000, worldSetting: '', goldenFinger: '',
  protagonistProfile: '', globalGuidance: '', writingStyle: '', referenceWorks: '', narrativePOV: 'third_limited', plotStructure: 'three_act', writingLanguage: 'zh-CN',
} } as unknown as ProjectData

const restores = [useLayoutStore, useLocaleStore, useProjectStore, useWorkflowStore, useStageStore].map(store => {
  const state = (store as StoreApi<unknown>).getState()
  return () => (store as StoreApi<unknown>).setState(state, true)
})

let configLocale: Locale
let host: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>>

function reply(channel: string): unknown {
  if (channel === 'config:get') return { locale: configLocale }
  if (channel === 'project:smoke-open-request') return null
  if (/list|history|models/i.test(channel)) return []
  if (channel === 'fs:check-exists') return false
  if (channel === 'db:blueprint-get-all') return []
  if (channel === 'db:project-core-get') return { premise: '', worldbuilding: '', synopsis: '' }
  if (channel === 'db:character-roster-read') return { status: 'empty' }
  if (channel === 'db:draft-list-all') return []
  return { success: true }
}

beforeEach(() => {
  configLocale = 'zh-CN'
  invoke = vi.fn(async (channel: string) => reply(channel))
  Object.defineProperty(window, 'aiNovelAPI', { configurable: true, value: { invoke, on: () => () => {}, once: () => {}, send: () => {} } })
  useProjectStore.setState({ currentProject: project })
  setActiveProjectSessionContext(session)
  useLayoutStore.setState({ sidebarView: 'project' })
  useWorkflowStore.setState({ activeRuns: [], history: [] })
  useStageStore.setState({ rightRail: 'chat', sheet: null, pendingDraftAdopt: null })
  host = document.createElement('div')
  host.style.cssText = 'width: 1440px; height: 900px; display: flex'
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  setActiveProjectSessionContext(null)
  for (const restore of restores) restore()
  vi.restoreAllMocks()
  delete window.aiNovelAPI
})

describe('三栏写作台的对话', () => {
  it('打开作品后可见对话栏与材料栏', async () => {
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(host.querySelector('.stage-shell')).not.toBeNull())
    await vi.waitFor(() => expect(host.querySelector('.workbench-right')).not.toBeNull())
    expect(host.querySelector('.materials-rail')).not.toBeNull()
    expect(host.textContent).toMatch(/对话|AI 写作助手/)
  })

  it('运行子页可从对话栏切换打开', async () => {
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(host.querySelector('.workbench-right')).not.toBeNull())
    await act(async () => navigate({ kind: 'run', facet: 'output' }))
    await vi.waitFor(() => expect(useStageStore.getState().rightRail).toBe('run'))
    expect(host.querySelector('.workbench-run')).not.toBeNull()
  })

  it('书房不显示写作对话栏', async () => {
    useLayoutStore.setState({ sidebarView: 'home' })
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(host.querySelector('.stage-shell')).not.toBeNull())
    expect(host.querySelector('.workbench-right')).toBeNull()
    expect(host.querySelector('.materials-rail')).toBeNull()
  })

  it('启动时不连接 MCP 服务器', async () => {
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(invoke.mock.calls.map(([channel]) => channel)).toContain('project:recent-list'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(invoke.mock.calls.map(([channel]) => channel).filter(channel => channel.startsWith('mcp:'))).toEqual([])
  })
})
