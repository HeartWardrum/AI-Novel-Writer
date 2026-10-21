/* eslint-disable react-refresh/only-export-components */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { NovelConfig, ProjectData, ProjectSessionContext } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useStageStore } from '../../../stores/navigation/stage-store'
import { refreshChapterFacts } from '../../../stores/navigation/chapter-facts'
import { navigate } from '../../../stores/navigation/navigation-intents'
import { useProjectStore } from '../../../stores/project-store'
import StageSpine from '../StageSpine'
import { refreshStageWork, useLandingPage, useStageView } from '../use-stage-work'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PATH = 'C:\\novels\\landing'
const READY: Partial<NovelConfig> = { coreOutline: '雾钟每晚提前一刻响起。', genre: '悬疑', targetAudience: '成年读者', totalChapters: 12, wordsPerChapter: 3000 }
function snapshot<T>(store: StoreApi<T>): () => void {
  const state = store.getState()
  return () => store.setState(state, true)
}
const restores = [snapshot(useDraftStore), snapshot(useEditorStore), snapshot(useLayoutStore), snapshot(useStageStore), snapshot(useProjectStore)]

let root: Root | undefined
let host: HTMLDivElement | undefined

function Landing() {
  useLandingPage(useStageView())
  return null
}

/** 流程脊仍读同一份视图；聊天优先外壳不再自动打开正文标签。 */
function Spine() {
  const view = useStageView()
  useLandingPage(view)
  const ignore = () => undefined
  return <StageSpine stages={view.stages} chapters={view.chapters} location={view.location} onStage={ignore} onChapter={ignore} onResource={ignore} onSettings={ignore} />
}

function session(leaseId: string): ProjectSessionContext {
  return { projectId: 'landing', leaseId, projectPath: PATH }
}

/** 像 openProject 一样换上这次打开：主进程签发的会话、新的项目对象（标签已被清掉）。 */
async function open(context: ProjectSessionContext, novelConfig: Partial<NovelConfig>) {
  await act(async () => {
    setActiveProjectSessionContext(context)
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useProjectStore.setState({ currentProject: { id: context.projectId, sessionLease: context.leaseId, name: '灯塔', path: PATH, novelConfig } as unknown as ProjectData })
  })
}

const tabTypes = () => useEditorStore.getState().tabs.map(tab => tab.type)

beforeEach(async () => {
  useStageStore.setState({ work: null, focus: false, palette: null, sheet: null, closingTabId: null, chatOverlay: null })
  useDraftStore.setState({ draftsByChapter: {}, dataProjectSession: null, loading: false })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  setActiveProjectSessionContext(null)
  for (const restore of restores) restore()
})

describe('打开作品时的落点（聊天优先：不自动开正文）', () => {
  it('同一部作品重新打开（新的项目会话）时再标记一次，且不打开正文标签', async () => {
    const first = session('first')
    await open(first, { ...READY, coreOutline: '' })
    await act(async () => {
      useStageStore.setState({ work: { session: first, architecture: {}, blueprints: [] } })
      useDraftStore.setState({ dataProjectSession: first, loading: false, draftsByChapter: {} })
    })
    await act(async () => root!.render(<Landing />))
    await act(async () => { await Promise.resolve() })
    expect(tabTypes()).toEqual([])

    const reopened = session('reopened')
    await open(reopened, { ...READY, coreOutline: '' })
    await act(async () => {
      useStageStore.setState({ work: { session: reopened, architecture: {}, blueprints: [] } })
      useDraftStore.setState({ dataProjectSession: reopened, loading: false, draftsByChapter: {} })
    })
    await act(async () => { await Promise.resolve() })
    expect(tabTypes()).toEqual([])
  })

  it('草稿还没按这次会话载入完时不落；载入完也不打开正文', async () => {
    const current = session('current')
    await open(current, READY)
    await act(async () => {
      useStageStore.setState({ work: { session: current, architecture: { premise: true }, blueprints: [] } })
      useDraftStore.setState({ dataProjectSession: session('stale'), loading: false })
    })
    await act(async () => root!.render(<Landing />))
    expect(tabTypes()).toEqual([])

    await act(async () => useDraftStore.setState({ dataProjectSession: current, loading: true }))
    expect(tabTypes()).toEqual([])

    await act(async () => useDraftStore.setState({ loading: false }))
    await act(async () => { await Promise.resolve() })
    expect(tabTypes()).toEqual([])
  })

  it('作者在落点之前打开了搜索：标记落地后搜索不被关掉，也不打开正文', async () => {
    const current = session('current')
    await open(current, READY)
    await act(async () => {
      useStageStore.setState({ work: { session: current, architecture: { premise: true }, blueprints: [] } })
      useDraftStore.setState({ dataProjectSession: current, loading: true })
    })
    await act(async () => root!.render(<Landing />))
    await act(async () => useStageStore.setState({ palette: 'commands' }))

    await act(async () => useDraftStore.setState({ loading: false }))
    await act(async () => { await Promise.resolve() })
    expect(tabTypes()).toEqual([])
    expect(useStageStore.getState().palette).toBe('commands')
  })

  it('上一次打开留下的架构与蓝图数据不算这次的', async () => {
    const current = session('current')
    await open(current, READY)
    await act(async () => {
      useStageStore.setState({ work: { session: session('previous'), architecture: { premise: true }, blueprints: [] } })
      useDraftStore.setState({ dataProjectSession: current, loading: false })
    })
    await act(async () => root!.render(<Landing />))
    expect(tabTypes()).toEqual([])
  })
})

describe('打开作品时流程脊等各稿的审稿与修稿记录', () => {
  const LONG = '雾'.repeat(60)
  const meta = (id: number, chapterNumber: number, status: string) => ({ id, chapterNumber, version: 1, status, source: 'write',
    createdAt: '2026-10-13 20:00:00', updatedAt: '2026-10-13 20:00:00' })
  /**
   * 第 1 章定稿，第 3 章草稿已有一份审稿：没读到它的记录时只能按稿状态估计成「待审稿」。
   * 聊天优先不再自动开正文；流程脊仍等这次打开的记录全部读完才出现。
   */
  function installProject(landing: 'chapter-4' | 'reviewed-chapter-3') {
    const drafts = landing === 'chapter-4'
      ? [meta(11, 1, 'finalized'), meta(21, 2, 'draft'), meta(31, 3, 'draft'), meta(41, 4, 'draft')]
      : [meta(11, 1, 'finalized'), meta(21, 2, 'finalized'), meta(31, 3, 'draft')]
    const releases: (() => void)[] = []
    const holds = [0, 1].map(() => new Promise<void>(resolve => { releases.push(resolve) }))
    let reads = 0
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      const id = args[0]
      switch (channel) {
        case 'db:project-core-get': return { premise: LONG, worldbuilding: LONG, synopsis: LONG }
        case 'db:character-roster-read': return { status: 'ready' }
        case 'db:blueprint-get-all': return [1, 2, 3, 4].map(chapterNumber => ({ chapterNumber, title: `第${chapterNumber}章` }))
        case 'db:draft-list-all': return drafts
        case 'db:revision-list': return []
        case 'db:review-list':
          if (id !== 31) return []
          await holds[reads++]
          return [{ id: 5, reviewIndex: 1, createdAt: '2026-10-13 20:00:01' }]
        case 'db:review-get-full': return { id, content: '' }
        case 'db:review-cycle-get': return null
        case 'db:draft-get-full': return { ...drafts.find(draft => draft.id === id), content: '雾是从海面上爬上来的。' }
        default: throw new Error(`unexpected IPC ${channel}`)
      }
    })
    Object.defineProperty(window, 'aiNovelAPI', { configurable: true, value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() } })
    return { release: (read: number) => releases[read]() }
  }

  /** 流程脊上看得到的阶段与各章的阶段。 */
  const spine = () => [...host!.querySelectorAll<HTMLElement>('[data-stage], .stage-chapter')]
    .map(element => element.dataset.stage ?? `${element.querySelector('.stage-chapter-no')?.textContent}:${element.dataset.phase}`)
  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

  afterEach(() => {
    Reflect.deleteProperty(window, 'aiNovelAPI')
  })

  it('落点不等记录、也不开正文；流程脊等这次打开的记录全部读完才出现', async () => {
    const { release } = installProject('chapter-4')
    const current = session('current')
    await open(current, { ...READY, totalChapters: 4 })
    await act(async () => root!.render(<Spine />))
    let refreshed = false
    void refreshStageWork((zh: string) => zh).then(() => { refreshed = true })
    await flush()

    expect(useEditorStore.getState().tabs).toEqual([])
    expect(spine()).toEqual([])

    await act(async () => refreshChapterFacts([{ id: 41 }], current))
    expect(spine()).toEqual([])
    expect(refreshed).toBe(false)

    release(0)
    await flush()
    expect(refreshed).toBe(true)
    // 聊天优先不再自动开正文；章节列表只在位置落在「正文」时展开，这里显式跳过去核对各章阶段。
    await act(async () => navigate({ kind: 'stage', stage: 'manuscript' }))
    await flush()
    expect(spine()).toEqual(['setup', 'architecture', 'manuscript', '1:final', '2:draft', '3:reviewed', '4:draft'])
  })

  it('有审稿的章：单章视图对同一稿的读取还没回来，流程脊出现时这一章也已是读到的阶段', async () => {
    const { release } = installProject('reviewed-chapter-3')
    const current = session('current')
    await open(current, { ...READY, totalChapters: 4 })
    await act(async () => root!.render(<Spine />))
    void refreshStageWork((zh: string) => zh)
    await flush()
    expect(useEditorStore.getState().tabs).toEqual([])

    void refreshChapterFacts([{ id: 31 }], current)
    await flush()
    expect(spine()).toEqual([])

    release(0)
    await flush()
    await act(async () => navigate({ kind: 'stage', stage: 'manuscript' }))
    await flush()
    expect(spine()).toEqual(['setup', 'architecture', 'manuscript', '1:final', '2:final', '3:reviewed', '4:todo'])

    release(1)
    await flush()
    expect(spine()).toEqual(['setup', 'architecture', 'manuscript', '1:final', '2:final', '3:reviewed', '4:todo'])
  })
})
