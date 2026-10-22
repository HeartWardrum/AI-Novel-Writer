import { useEffect, useRef, useState } from 'react'
import { useLLMStore } from '../../stores/llm-store'
import AgentHeader from './agent/AgentHeader'
import AgentConversation from './agent/AgentConversation'
import {
  applyChatZoomWheel,
  readChatFontScale,
} from './ai-panel-zoom-wheel'
import './ai-panel-chat-font.css'

/**
 * 右侧 AI Agent 面板
 * 重构后采用多会话管理架构，参考 Antigravity agent-side-panel 设计
 * - 顶部：AgentHeader（新建/历史/更多/关闭）
 * - 主体：AgentConversation（空状态/对话/历史三态）
 */
export default function AIPanel() {
  // 确保 LLM store 已初始化
  const init = useLLMStore(s => s.init)
  const loaded = useLLMStore(s => s.loaded)
  const panelRef = useRef<HTMLDivElement>(null)
  const [chatFontScale, setChatFontScale] = useState(readChatFontScale)
  const chatFontScaleRef = useRef(chatFontScale)
  chatFontScaleRef.current = chatFontScale

  useEffect(() => {
    if (!loaded) init()
  }, [init, loaded])

  // Ctrl/Cmd + 滚轮：只调对话字号（非 passive，才能挡住浏览器页面缩放）
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      const next = applyChatZoomWheel(event, chatFontScaleRef.current)
      if (next == null) return
      chatFontScaleRef.current = next
      setChatFontScale(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      ref={panelRef}
      className="writer-ai-panel w-full h-full flex flex-col overflow-hidden"
      style={{ ['--chat-font-scale' as string]: String(chatFontScale) }}
    >
      {/* 顶部工具栏（不随对话字号缩放） */}
      <AgentHeader />

      {/* 主对话区：占满剩余高度 */}
      <div className="flex-1 overflow-hidden">
        <AgentConversation />
      </div>
    </div>
  )
}
