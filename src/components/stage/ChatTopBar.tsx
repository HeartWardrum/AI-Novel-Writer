import { BookMarked, ChevronLeft, Minus, Settings, Square, X } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { Button } from '../ui/Button'
import './chat-workbench.css'

function WindowControls() {
  const text = useLocaleStore(s => s.text)
  return (
    <div className="stage-window-controls">
      <button type="button" aria-label={text('最小化', 'Minimize')} onClick={() => void ipc.invoke('window:minimize')}>
        <Minus size={14} aria-hidden="true" />
      </button>
      <button type="button" aria-label={text('最大化', 'Maximize')} onClick={() => void ipc.invoke('window:toggle-maximize')}>
        <Square size={12} aria-hidden="true" />
      </button>
      <button type="button" className="stage-window-close" aria-label={text('关闭', 'Close')} onClick={() => void ipc.invoke('window:close')}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

export default function ChatTopBar({
  onLibrary,
  onWorldbook,
  onSettings,
}: {
  onLibrary: () => void
  onWorldbook: () => void
  onSettings: () => void
}) {
  const text = useLocaleStore(s => s.text)
  const projectName = useProjectStore(s => s.currentProject?.name)

  return (
    <header className="chat-topbar">
      <Button variant="secondary" size="sm" onClick={onLibrary}>
        <ChevronLeft size={14} aria-hidden="true" />
        {text('回书房', 'Library')}
      </Button>
      <h1 className="chat-topbar-title" title={projectName}>{projectName || text('作品', 'Book')}</h1>
      <span className="chat-topbar-gap" />
      <div className="chat-topbar-actions">
        <Button variant="secondary" size="sm" onClick={onWorldbook}>
          <BookMarked size={14} aria-hidden="true" />
          {text('世界书', 'Worldbook')}
        </Button>
        <Button variant="secondary" size="sm" onClick={onSettings}>
          <Settings size={14} aria-hidden="true" />
          {text('设置', 'Settings')}
        </Button>
      </div>
      <WindowControls />
    </header>
  )
}
