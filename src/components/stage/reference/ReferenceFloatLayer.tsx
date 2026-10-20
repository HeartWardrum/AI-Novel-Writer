import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useLocaleStore } from '../../../stores/locale-store'
import { useReferenceFloatStore } from '../../../stores/reference-float-store'

/**
 * 人设参考小窗层：Portal 到 document.body，z-index 高于写作壳与侧页，可拖、可叠。
 */
export default function ReferenceFloatLayer() {
  const text = useLocaleStore(s => s.text)
  const windows = useReferenceFloatStore(s => s.windows)
  if (typeof document === 'undefined' || windows.length === 0) return null

  return createPortal(
    <div className="ref-float-layer" aria-label={text('写作参考图', 'Writing reference images')}>
      {windows.map(window => (
        <ReferenceFloatCard key={window.id} id={window.id} />
      ))}
    </div>,
    document.body,
  )
}

function ReferenceFloatCard({ id }: { id: string }) {
  const text = useLocaleStore(s => s.text)
  const window = useReferenceFloatStore(s => s.windows.find(item => item.id === id))
  const bringToFront = useReferenceFloatStore(s => s.bringToFront)
  const move = useReferenceFloatStore(s => s.move)
  const close = useReferenceFloatStore(s => s.close)
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  if (!window) return null

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    bringToFront(id)
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: window.x,
      originY: window.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return
    const dx = event.clientX - drag.current.startX
    const dy = event.clientY - drag.current.startY
    const maxX = Math.max(8, globalThis.innerWidth - window.width - 8)
    const maxY = Math.max(8, globalThis.innerHeight - 80)
    move(
      id,
      Math.min(maxX, Math.max(8, drag.current.originX + dx)),
      Math.min(maxY, Math.max(8, drag.current.originY + dy)),
    )
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    drag.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
  }

  return (
    <aside
      className="ref-float-window paper-ink"
      role="dialog"
      aria-label={window.title}
      style={{
        left: window.x,
        top: window.y,
        width: window.width,
        zIndex: window.zIndex,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <header className="ref-float-head">
        <span className="ref-float-title">{window.title}</span>
        <button
          type="button"
          className="ref-float-close"
          aria-label={text('关闭', 'Close')}
          onClick={() => close(id)}
        >
          <X size={14} aria-hidden />
        </button>
      </header>
      <div className="ref-float-body">
        <img src={window.imageUrl} alt="" draggable={false} />
      </div>
      <p className="ref-float-kind">{text('人设', 'Cast')}</p>
    </aside>
  )
}
