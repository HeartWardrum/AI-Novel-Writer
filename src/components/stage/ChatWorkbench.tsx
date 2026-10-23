import { useLocaleStore } from '../../stores/locale-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { useStageStore, type StageSheet } from '../../stores/navigation/stage-store'
import { ErrorBoundary } from '../ErrorBoundary'
import AIPanel from '../panels/AIPanel'
import ChatMessageRail from '../panels/agent/ChatMessageRail'
import { Button } from '../ui/Button'
import CastLeftRail from './cast/CastLeftRail'
import { SettingsPage } from './stage-pages'
import StageWorldbook from './worldbook/StageWorldbook'
import './chat-workbench.css'

/** 聊天优先工作台：全幅对话；设置与世界书为覆盖层。 */
export default function ChatWorkbench({
  mode: _mode,
  onMode: _onMode,
  sheet: _sheet,
}: {
  mode: 'chat' | 'run'
  onMode: (mode: 'chat' | 'run') => void
  sheet: StageSheet | null
}) {
  const text = useLocaleStore(s => s.text)
  const settingsOpen = useLayoutStore(s => s.settingsOpen)
  const chatOverlay = useStageStore(s => s.chatOverlay)
  const projectKey = useProjectStore(s => s.currentProject?.path)

  return (
    <div className="chat-shell-frame" data-shell-presentation="chat">
      <div className="chat-workbench">
        <div className="chat-workbench-body" role="tabpanel">
          {projectKey && (
            <ErrorBoundary fallbackLabel={text('人物栏渲染失败', '人物栏渲染失败')}>
              <CastLeftRail projectKey={projectKey} />
            </ErrorBoundary>
          )}
          <ErrorBoundary fallbackLabel={text('对话面板渲染失败', 'Chat panel failed to render')}>
            <div className="workbench-chat chat-workbench-chat">
              <div className="workbench-chat-panel chat-workbench-chat-panel">
                <AIPanel />
              </div>
            </div>
          </ErrorBoundary>
          {/* 迷你轴在对话列外侧右边栏，不叠在气泡上 */}
          <ChatMessageRail />
        </div>

        {chatOverlay === 'worldbook' && projectKey && (
          <div className="chat-overlay" role="dialog" aria-modal="true" aria-label={text('世界书', 'Worldbook')}>
            <div className="chat-overlay-head">
              <h2>{text('世界书', 'Worldbook')}</h2>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => useStageStore.setState({ chatOverlay: null })}
              >
                {text('关闭', 'Close')}
              </Button>
            </div>
            <div className="chat-overlay-body">
              <ErrorBoundary fallbackLabel={text('世界书渲染失败', 'Worldbook failed to render')}>
                <StageWorldbook projectKey={projectKey} />
              </ErrorBoundary>
            </div>
          </div>
        )}

        {settingsOpen && (
          <div className="chat-settings-layer" data-page="settings">
            <SettingsPage library={false} />
          </div>
        )}
      </div>
    </div>
  )
}
