import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { StoreApi } from 'zustand'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ProjectData, ProjectSessionContext } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useDraftStore } from '../../../stores/draft-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useStageStore } from '../../../stores/navigation/stage-store'
import { useProjectStore } from '../../../stores/project-store'
import DraftAdoptBanner from '../DraftAdoptBanner'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session: ProjectSessionContext = { projectId: '灯塔', projectPath: 'C:/novels/lighthouse', leaseId: '本次' }
const project = {
  id: session.projectId, name: '灯塔', path: session.projectPath, sessionLease: session.leaseId,
  novelConfig: { totalChapters: 3, wordsPerChapter: 2000, writingLanguage: 'zh-CN' },
} as unknown as ProjectData

const restores = [useDraftStore, useLocaleStore, useStageStore, useProjectStore].map(store => {
  const state = (store as StoreApi<unknown>).getState()
  return () => (store as StoreApi<unknown>).setState(state, true)
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN' })
  useProjectStore.setState({ currentProject: project })
  setActiveProjectSessionContext(session)
  useStageStore.setState({
    pendingDraftAdopt: {
      session, chapterNumber: 2, draftId: 20, version: 1, runId: 'run-1',
    },
  })
  useDraftStore.setState({
    draftsByChapter: {
      2: [{
        id: 20, chapterNumber: 2, version: 1, status: 'draft', source: 'write',
        createdAt: '2026-10-21', updatedAt: '2026-10-21',
        filePath: 'ai-novel://draft/20', fileName: 'draft_v1.md',
      }],
    },
    dataProjectSession: session,
    loading: false,
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  setActiveProjectSessionContext(null)
  for (const restore of restores) restore()
})

describe('候选稿采用条', () => {
  it('显示采用与丢弃，采用后清除待办', async () => {
    await act(async () => root.render(<DraftAdoptBanner />))
    expect(host.textContent).toMatch(/候选稿/)
    const adopt = [...host.querySelectorAll('button')].find(button => button.textContent === '采用')
    expect(adopt).toBeTruthy()
    await act(async () => adopt!.click())
    expect(useStageStore.getState().pendingDraftAdopt).toBeNull()
  })
})
