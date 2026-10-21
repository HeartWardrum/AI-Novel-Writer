import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { page } from 'vitest/browser'
import { createRoot, type Root } from 'react-dom/client'
import type { StoreApi } from 'zustand'

import '../../../../index.css'
import '../../../../styles/paper-ink/index.css'
import '../../stage.css'
import type { ProjectData } from '../../../../shared/ipc-channels'
import { defaultWorldbookActivation, type WorldbookEntry, type WorldbookSourceCandidate } from '../../../../shared/worldbook'
import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import { useLocaleStore } from '../../../../stores/locale-store'
import { useProjectStore } from '../../../../stores/project-store'
import StageWorldbook from '../StageWorldbook'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session = { projectId: 'lighthouse', projectPath: 'C:/novels/lighthouse', leaseId: 'lease' }

function snapshot<T>(store: StoreApi<T>): () => void {
  const state = store.getState()
  return () => store.setState(state, true)
}

const restores = [useProjectStore, useLocaleStore].map(store => snapshot(store as StoreApi<unknown>))
let root: Root | undefined
let host: HTMLDivElement | undefined
let invoke: ReturnType<typeof vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>>
let entries: WorldbookEntry[]
let sources: WorldbookSourceCandidate[]

beforeEach(async () => {
  await page.viewport(1280, 960)
  const activation = defaultWorldbookActivation('world')
  activation.primaryKeys = ['灯塔']
  entries = [{
    id: 'wb:world',
    kind: 'world',
    title: '世界观',
    content: '旧港以潮汐计时。',
    promptContent: '旧港以潮汐计时。',
    activation,
    source: { kind: 'author', id: '', revision: '' },
    editable: true,
    needsReview: false,
    revision: 1,
    updatedAt: '',
  }, {
    id: 'wb:1',
    kind: 'custom',
    title: '雾钟',
    content: '雾钟每晚提前一刻响起。',
    promptContent: '雾钟每晚提前一刻响起。',
    activation: defaultWorldbookActivation('custom'),
    source: { kind: 'author', id: '', revision: '' },
    editable: true,
    needsReview: false,
    revision: 1,
    updatedAt: '',
  }]
  sources = [{
    id: 'project:world-setting',
    kind: 'world',
    title: '世界观设定',
    content: '世界观原文',
    activation: defaultWorldbookActivation('world'),
    origin: { kind: 'project', id: 'project:world-setting', revision: '1' },
    alreadyImported: false,
  }]
  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'worldbook:list') return entries
    if (channel === 'worldbook:list-sources') return sources
    if (channel === 'worldbook:import-sources') {
      const request = args[0] as { sourceIds: string[] }
      const imported = request.sourceIds.map(id => {
        const source = sources.find(item => item.id === id)!
        return {
          id: `wb:import-${id}`,
          kind: source.kind,
          title: source.title,
          content: source.content,
          promptContent: source.content,
          activation: source.activation,
          source: { kind: 'import' as const, id: `${id}:hash`, revision: '1' },
          editable: true,
          needsReview: true,
          revision: 1,
          updatedAt: '',
        }
      })
      entries = [...imported, ...entries]
      sources = sources.map(item => request.sourceIds.includes(item.id) ? { ...item, alreadyImported: true } : item)
      return { success: true, entries: imported }
    }
    if (channel === 'worldbook:save') {
      const request = args[0] as { id?: string; title: string; content: string; kind: WorldbookEntry['kind']; activation: WorldbookEntry['activation'] }
      const saved = {
        id: request.id ?? 'wb:new',
        kind: request.kind,
        title: request.title,
        content: request.content,
        promptContent: request.content,
        activation: request.activation,
        source: { kind: 'author' as const, id: '', revision: '' },
        editable: true,
        needsReview: false,
        revision: 2,
        updatedAt: '',
      }
      entries = entries.map(entry => entry.id === saved.id ? saved : entry)
      return { success: true, entry: saved }
    }
    if (channel === 'worldbook:resolve') return {
      selections: [{ entryId: 'wb:world', title: '世界观', kind: 'world', content: entries[0]!.content,
        source: entries[0]!.source, revision: 1, reason: 'primary-key', matchedKeys: ['灯塔'], score: 20, estimatedTokens: 8 }],
      omitted: [], tokenEstimate: 8, budgetTokens: 4000, requiredOverflow: false, resolvedQuery: '灯塔',
    }
    throw new Error(`unexpected channel: ${channel}`)
  })
  Object.defineProperty(window, 'aiNovelAPI', { configurable: true, value: { invoke, on: () => () => {} } })
  useProjectStore.setState({
    currentProject: {
      id: session.projectId, path: session.projectPath, sessionLease: session.leaseId,
      name: '灯塔', novelConfig: { writingLanguage: 'zh-CN' },
    } as unknown as ProjectData,
  })
  useLocaleStore.setState({ locale: 'zh-CN' })
  setActiveProjectSessionContext(session)
  host = document.createElement('div')
  host.className = 'paper-ink stage-shell'
  host.style.cssText = 'width: 1200px; height: 900px'
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  setActiveProjectSessionContext(null)
  for (const restore of restores) restore()
  vi.restoreAllMocks()
})

describe('worldbook workspace', () => {
  it('shows editable two-column entries and import action', async () => {
    await act(async () => root!.render(<StageWorldbook projectKey={session.projectPath} />))
    await vi.waitFor(() => expect(host!.querySelector('.worldbook-entry-list')).toBeTruthy())
    expect(host!.querySelector('.worldbook-list')?.textContent).toContain('世界书')
    expect(host!.querySelector('.worldbook-detail')).toBeTruthy()
    expect(host!.querySelector('.worldbook-entry-list')?.textContent).toContain('世界观')
    expect(host!.querySelector('.worldbook-entry-list')?.textContent).toContain('雾钟')
    expect(host!.querySelector<HTMLInputElement>('.worldbook-title-input')?.value).toBe('世界观')
    expect(host!.querySelector<HTMLInputElement>('.worldbook-title-input')?.readOnly).toBe(false)
    expect(host!.querySelector('.worldbook-trigger')?.textContent).toContain('何时进入上下文')
    expect([...host!.querySelectorAll('button')].some(button => button.textContent?.includes('从作品导入'))).toBe(true)
  })

  it('imports work materials into editable entries', async () => {
    await act(async () => root!.render(<StageWorldbook projectKey={session.projectPath} />))
    await vi.waitFor(() => expect(host!.querySelector('.worldbook-entry-list')).toBeTruthy())
    const importButton = [...host!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('从作品导入'))!
    await act(async () => importButton.click())
    await vi.waitFor(() => expect(host!.querySelector('.worldbook-split-dialog')?.textContent).toContain('世界观设定'))
    const confirm = [...host!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('确认导入'))!
    await act(async () => confirm.click())
    await vi.waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === 'worldbook:import-sources')).toBe(true))
    await vi.waitFor(() => expect(host!.querySelector('.worldbook-entry-list')?.textContent).toContain('世界观设定'))
  })

  it('previews exact-key activation with reason and token budget', async () => {
    await act(async () => root!.render(<StageWorldbook projectKey={session.projectPath} />))
    await vi.waitFor(() => expect(host!.querySelector('.worldbook-preview-box')).toBeTruthy())
    const context = host!.querySelector<HTMLTextAreaElement>('.worldbook-preview-box textarea')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(context, '灯塔的夜')
      context.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const previewButton = [...host!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('预演'))!
    await act(async () => previewButton.click())
    await vi.waitFor(() => expect(host!.querySelector('.worldbook-preview-result')?.textContent).toContain('世界观'))
    expect(host!.querySelector('.worldbook-preview-result')?.textContent).toContain('primary-key')
    expect(invoke.mock.calls.some(([channel]) => channel === 'worldbook:resolve')).toBe(true)
  })
})
