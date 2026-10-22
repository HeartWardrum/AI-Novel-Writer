import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useEditorStore } from '../../stores/editor-store'
import { navigate } from '../../stores/navigation/navigation-intents'
import { useStageStore } from '../../stores/navigation/stage-store'
import { chapterLabel } from '../../shared/chapter-label'
import type { Theme } from '../../stores/theme-store'
import ClearProjectDataDialog from '../dialogs/ClearProjectDataDialog'
import { leaveSettingsThen, openProjectFolder } from '../settings/unsaved-settings'
import type { MenuGroupSpec } from '../ui/Menu'
import NewWorkDialog from './library/NewWorkDialog'
import { SETTINGS_PAGES } from './settings/settings-pages'
import { preloadStagePages } from './stage-pages'
import StagePalette from './StagePalette'
import { paletteItem, type PaletteItem } from './palette-filter'
import ChatTopBar from './ChatTopBar'
import ChatWorkbench from './ChatWorkbench'
import StageTopBar from './StageTopBar'
import StageWorkspace from './StageWorkspace'
import ReferenceFloatLayer from './reference/ReferenceFloatLayer'
import { RESOURCE_NAMES, STAGE_NAMES, stageTabName } from './stage-text'
import { refreshStageWork, useLandingPage, useStageView, useStageWorkRefresh, type StageView } from './use-stage-work'
import { useStageShortcuts } from './use-stage-shortcuts'
import './chat-workbench.css'

type Text = (zh: string, en: string) => string

const backToLibrary = () => leaveSettingsThen(() => {
  useStageStore.setState({ chatOverlay: null })
  useLayoutStore.getState().setSidebarView('home')
})
const newBook = () => leaveSettingsThen(() => useLayoutStore.getState().openNewProject())

function crumbsFor(view: StageView, library: boolean, activeName: string | undefined, text: Text): string[] {
  if (library) return []
  const location = view.location
  if (!location) return []
  if (location.kind === 'resource') return [text('作品资料', 'Reference'), text(...RESOURCE_NAMES[location.page])]
  const stage = text(...STAGE_NAMES[location.stage])
  if (location.stage === 'manuscript' && location.chapter !== undefined) return [stage, chapterLabel(location.chapter, text)]
  if (location.stage === 'architecture' && activeName && activeName !== stage) return [stage, activeName]
  return [stage]
}

export default function StageShell({ theme }: { theme: Theme }) {
  const text = useLocaleStore(s => s.text)
  const hasProject = useProjectStore(s => Boolean(s.currentProject))
  const recentProjects = useProjectStore(s => s.recentProjects)
  const home = useLayoutStore(s => s.sidebarView === 'home')
  const library = !hasProject || home
  const focus = useStageStore(s => s.focus) && !library
  const palette = useStageStore(s => s.palette)
  const rightRail = useStageStore(s => s.rightRail)
  const sheet = useStageStore(s => s.sheet)
  const activeName = useEditorStore(s => {
    const tab = s.tabs.find(candidate => candidate.id === s.activeTabId)
    return tab ? stageTabName(tab, text) : undefined
  })
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const view = useStageView()

  useStageWorkRefresh()
  useLandingPage(view)
  useStageShortcuts({ library, focus })

  useEffect(() => {
    if (library && useStageStore.getState().focus) useStageStore.setState({ focus: false })
    if (library && useStageStore.getState().chatOverlay) useStageStore.setState({ chatOverlay: null })
  }, [library])

  useEffect(() => {
    const handle = requestIdleCallback(preloadStagePages, { timeout: 2000 })
    return () => cancelIdleCallback(handle)
  }, [])

  // 设置页属于打开它时的书房或作品；在书房与作品之间切换时收起。
  const settingsOpen = useLayoutStore(s => s.settingsOpen)
  const settingsSection = useLayoutStore(s => s.settingsSection)
  const wasLibrary = useRef(library)
  useEffect(() => {
    if (wasLibrary.current !== library && useLayoutStore.getState().settingsOpen) useLayoutStore.getState().closeSettings()
    wasLibrary.current = library
  }, [library])

  const toggleFocus = useCallback(() => useStageStore.setState(state => ({ focus: !state.focus, palette: null })), [])

  const workMenu = useMemo<MenuGroupSpec[]>(() => [
    { id: 'work', items: [
      { id: 'library', label: text('回到书房', 'Back to library'), onSelect: backToLibrary },
      { id: 'open', label: text('打开其他作品…', 'Open another book…'), onSelect: openProjectFolder },
      { id: 'new', label: text('新建作品…', 'New book…'), onSelect: newBook },
    ] },
    { id: 'files', items: [
      { id: 'backup', label: text('项目备份', 'Project backup'), onSelect: () => navigate({ kind: 'settings', section: 'backup' }) },
    ] },
    { id: 'danger', tone: 'danger', items: [
      { id: 'clear', label: text('清除生成内容…', 'Clear generated content…'), onSelect: () => setClearOpen(true) },
    ] },
  ], [text])

  // 命令面板只留：新建/打开/回书房/对话/世界书/设置/备份；不进舞台写稿、运行、导出、拆解。
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const books = recentProjects.map(project => paletteItem('action', {
      id: `book-${project.path}`, label: text(`打开《${project.name}》`, `Open “${project.name}”`), keywords: project.name,
      run: () => leaveSettingsThen(() => void useProjectStore.getState().openProject(project.path)),
    }))
    const actions = [
      paletteItem('action', { id: 'new', label: text('新建作品', 'New book'), run: newBook }),
      paletteItem('action', { id: 'open', label: text('打开作品', 'Open a book'), run: openProjectFolder }),
      ...(hasProject ? [
        paletteItem('action', { id: 'library', label: text('回到书房', 'Back to library'), run: backToLibrary }),
        paletteItem('action', { id: 'chat', label: text('对话', 'Chat'), keywords: '助手 AI 聊天',
          run: () => useStageStore.setState({ rightRail: 'chat', chatOverlay: null }) }),
        ...(library ? [] : [
          paletteItem('action', {
            id: 'worldbook', label: text('世界书', 'Worldbook'), keywords: 'worldbook 设定',
            run: () => leaveSettingsThen(() => useStageStore.setState({ chatOverlay: 'worldbook' })),
          }),
        ]),
        paletteItem('action', { id: 'backup', label: text('项目备份', 'Project backup'),
          run: () => navigate({ kind: 'settings', section: 'backup' }) }),
      ] : []),
      paletteItem('action', { id: 'settings', label: text('设置', 'Settings'),
        run: () => navigate({ kind: 'settings', section: 'llm' }) }),
    ]
    return [...actions, ...(library ? books : [])]
  }, [hasProject, library, text, recentProjects])

  const settingsName = SETTINGS_PAGES.find(page => page.id === settingsSection)?.name
  const crumbs = settingsOpen && settingsName ? [text('设置', 'Settings'), text(...settingsName)] : crumbsFor(view, library, activeName, text)
  const focusChapter = view.location?.kind === 'stage' ? view.location.chapter : undefined
  const focusRow = view.chapters.find(row => row.number === focusChapter)
  const focusTitle = focusRow ? { chapter: focusRow.number, title: focusRow.title || chapterLabel(focusRow.number, text) } : { title: activeName ?? '' }

  return (
    <div
      ref={setRoot}
      className="paper-ink stage-shell"
      data-theme={theme}
      data-shell-presentation={library ? 'stage' : 'chat'}
      data-focus={focus || undefined}
      data-library={library || undefined}
    >
      {library ? (
        <>
          <StageTopBar
            crumbs={crumbs}
            library={library}
            focus={focus}
            focusTitle={focusTitle}
            workMenu={workMenu}
            onToggleFocus={toggleFocus}
          />
          <div className="stage-frame">
            <StageWorkspace library focus={false} />
          </div>
        </>
      ) : (
        <>
          <ChatTopBar
            onLibrary={backToLibrary}
            onWorldbook={() => leaveSettingsThen(() => useStageStore.setState({ chatOverlay: 'worldbook' }))}
            onSettings={() => navigate({ kind: 'settings', section: 'llm' })}
          />
          <ChatWorkbench
            mode={rightRail}
            onMode={mode => useStageStore.setState({ rightRail: mode })}
            sheet={sheet}
          />
        </>
      )}
      <StagePalette mode={palette} items={paletteItems} container={root} onClose={() => useStageStore.setState({ palette: null })} />
      <ClearProjectDataDialog open={clearOpen} onClose={() => setClearOpen(false)} onCleared={() => refreshStageWork(text)} />
      <NewWorkDialog />
      <ReferenceFloatLayer />
    </div>
  )
}
