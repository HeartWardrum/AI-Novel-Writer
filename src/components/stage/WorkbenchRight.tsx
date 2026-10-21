import { useLocaleStore } from '../../stores/locale-store'
import { useStageStore, type StageSheet } from '../../stores/navigation/stage-store'
import { ErrorBoundary } from '../ErrorBoundary'
import AIPanel from '../panels/AIPanel'
import RunSheet from './run/RunSheet'
import DraftAdoptBanner from './DraftAdoptBanner'
import ChatWriteActions from './ChatWriteActions'

/** 右栏：对话为主，运行为子页；工作流进行中可从顶栏胶囊切到运行。 */
export default function WorkbenchRight({
  mode,
  onMode,
  sheet,
  focus,
}: {
  mode: 'chat' | 'run'
  onMode: (mode: 'chat' | 'run') => void
  sheet: StageSheet | null
  focus: boolean
}) {
  const text = useLocaleStore(s => s.text)

  if (focus) return null

  const runSheet = sheet?.kind === 'run' ? sheet : { kind: 'run' as const, tab: 'active' as const }

  return (
    <aside className="workbench-right" aria-label={text('写作助手', 'Writing assistant')}>
      <div className="workbench-right-tabs" role="tablist" aria-label={text('右侧面板', 'Right panel')}>
        <button
          type="button"
          role="tab"
          className="workbench-right-tab"
          aria-selected={mode === 'chat'}
          onClick={() => onMode('chat')}
        >
          {text('对话', 'Chat')}
        </button>
        <button
          type="button"
          role="tab"
          className="workbench-right-tab"
          aria-selected={mode === 'run'}
          onClick={() => {
            onMode('run')
            if (useStageStore.getState().sheet?.kind !== 'run') {
              useStageStore.setState({ sheet: { kind: 'run', tab: 'active' } })
            }
          }}
        >
          {text('运行', 'Run')}
        </button>
      </div>
      <div className="workbench-right-body" role="tabpanel">
        {mode === 'chat' ? (
          <ErrorBoundary fallbackLabel={text('对话面板渲染失败', 'Chat panel failed to render')}>
            <div className="workbench-chat">
              <DraftAdoptBanner />
              <ChatWriteActions />
              <div className="workbench-chat-panel">
                <AIPanel />
              </div>
            </div>
          </ErrorBoundary>
        ) : (
          <ErrorBoundary fallbackLabel={text('运行侧页渲染失败', 'Run sheet failed to render')}>
            <div className="workbench-run" data-wide={runSheet.tab === 'diagnostics' || undefined}>
              <RunSheet sheet={runSheet} />
            </div>
          </ErrorBoundary>
        )}
      </div>
    </aside>
  )
}
