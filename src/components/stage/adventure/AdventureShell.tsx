import { ChevronLeft } from 'lucide-react'
import { leaveSettingsThen } from '../../settings/unsaved-settings'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { SHAN_HAI_YAO_PRESET } from '../../../shared/adventure-presets'
import { Button } from '../../ui/Button'
import './adventure.css'

const backToLibrary = () => leaveSettingsThen(() => {
  useLayoutStore.getState().setSidebarView('home')
})

/** 冒险占位壳：展示内置预设开场，回合玩法尚未接入。 */
export default function AdventureShell() {
  const text = useLocaleStore(s => s.text)
  const preset = SHAN_HAI_YAO_PRESET

  return (
    <div className="adventure-shell" data-testid="adventure-shell">
      <header className="adventure-topbar">
        <Button variant="secondary" size="sm" onClick={backToLibrary} aria-label={text('回书房', '回书房')}>
          <ChevronLeft size={14} aria-hidden="true" />
          {text('回书房', '回书房')}
        </Button>
        <h1 className="adventure-topbar-title">{preset.title}</h1>
      </header>
      <main className="adventure-main">
        <p className="stage-eyebrow">{text('冒险', '冒险')}</p>
        <h2 className="adventure-title">{preset.title}</h2>
        <p className="adventure-lede">{preset.lede}</p>
        <div className="adventure-beat">
          {preset.openingBeat.split('\n\n').map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        <p className="adventure-stub-note" role="note">{text('回合玩法稍后接入', '回合玩法稍后接入')}</p>
      </main>
    </div>
  )
}
