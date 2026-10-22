import { useEffect, useRef, useState } from 'react'
import { ArrowDown, Trash2 } from 'lucide-react'
import { useAgentStore } from '../../../stores/agent-store'
import { useProjectStore } from '../../../stores/project-store'
import { APP_BRAND } from '../../../shared/brand'
import { projectSessionContextFromProject } from '../../../shared/project-session-context'
import { listHomeworkCharacters } from '../../../services/agent/assign-worldbook-homework'
import { listWorldbookEntries } from '../../../services/worldbook-service'
import type { WorldbookEntry } from '../../../shared/worldbook'
import AgentMessage from './AgentMessage'
import AgentInputBox from './AgentInputBox'
import RecruitForm from './RecruitForm'
import { formatRelativeTime } from '../../../utils/time'
import { useLocaleStore } from '../../../stores/locale-store'

/**
 * 对话区域主组件
 * - 空状态：居中显示欢迎词 + 输入框 + 最近会话（参考 agent1.html pt-[30vh] 设计）
 * - 有会话：消息列表 + 底部固定输入框
 * - 酒馆招新：临时消息列表（不进主会话）
 */
export default function AgentConversation() {
  const showHistory = useAgentStore(s => s.showHistory)
  const recruitActive = useAgentStore(s => s.recruitActive)
  const activeConv = useAgentStore(s => s.getActiveConversation())

  if (showHistory) {
    return <AgentHistoryPanel />
  }

  if (recruitActive) {
    return <RecruitConversation />
  }

  if (!activeConv || activeConv.messages.length === 0) {
    return <EmptyState />
  }

  return <ActiveConversation />
}

/** 输入框上方：酒馆招新 / 分配作业，或招募中的确定/炒掉/重开 */
function RecruitToolbar() {
  const text = useLocaleStore(s => s.text)
  const recruitActive = useAgentStore(s => s.recruitActive)
  const generating = useAgentStore(s => s.generating)
  const recruitBusy = useAgentStore(s => s.recruitBusy)
  const assignHomework = useAgentStore(s => s.assignHomework)
  const startRecruit = useAgentStore(s => s.startRecruit)
  const startAssignHomework = useAgentStore(s => s.startAssignHomework)
  const cancelAssignHomework = useAgentStore(s => s.cancelAssignHomework)
  const finishRecruit = useAgentStore(s => s.finishRecruit)
  const cancelRecruit = useAgentStore(s => s.cancelRecruit)
  const restartRecruit = useAgentStore(s => s.restartRecruit)
  const setChatMode = useAgentStore(s => s.setChatMode)
  const setCharacterEntryId = useAgentStore(s => s.setCharacterEntryId)
  const setFocusChapterNumber = useAgentStore(s => s.setFocusChapterNumber)
  const continueCurrentChapter = useAgentStore(s => s.continueCurrentChapter)
  const activeConv = useAgentStore(s => {
    const id = s.activeConversationId
    return id ? (s.conversations.find(c => c.id === id) ?? null) : null
  })
  const project = useProjectStore(s => s.currentProject)
  const [characters, setCharacters] = useState<WorldbookEntry[]>([])
  const busy = generating || recruitBusy || assignHomework.active
  const modeLocked = recruitActive || assignHomework.active || recruitBusy
  const chatMode = activeConv?.chatMode === 'character' ? 'character' : 'author'
  const characterEntryId = activeConv?.characterEntryId ?? null
  const focusChapterNumber = activeConv?.focusChapterNumber && activeConv.focusChapterNumber >= 1
    ? Math.floor(activeConv.focusChapterNumber)
    : 1
  const canContinueChapter = !busy && !modeLocked && chatMode === 'author'

  useEffect(() => {
    if (chatMode !== 'character' || recruitActive) {
      setCharacters([])
      return
    }
    const session = projectSessionContextFromProject(project)
    if (!session) {
      setCharacters([])
      return
    }
    let cancelled = false
    void listWorldbookEntries(session).then(entries => {
      if (cancelled) return
      setCharacters(listHomeworkCharacters(entries))
    }).catch(() => {
      if (!cancelled) setCharacters([])
    })
    return () => { cancelled = true }
  }, [chatMode, project, recruitActive, assignHomework.active])

  if (assignHomework.active) {
    const ratio = assignHomework.total > 0
      ? Math.min(1, (assignHomework.index + 1) / assignHomework.total)
      : 0
    const title = assignHomework.currentTitle.trim() || text('某人', '某人')
    const statusLine = assignHomework.phase === 'preparing'
      ? title
      : text(`「${title}」正在仔细学习…`, `「${title}」正在仔细学习…`)
    return (
      <div
        className="mb-2 rounded-md px-2.5 py-2"
        style={{
          border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
          background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
        }}
        role="status"
        aria-live="polite"
        data-testid="assign-homework-progress"
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[0.7rem]" style={{ color: 'var(--color-text-secondary)' }}>
            {statusLine}
          </span>
          <button
            type="button"
            onClick={() => cancelAssignHomework()}
            className="rounded px-2 py-0.5 text-[0.7rem] disabled:opacity-50"
            style={{
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          >
            {text('取消', '取消')}
          </button>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full"
          style={{ background: 'var(--color-hover)' }}
          aria-valuemin={0}
          aria-valuemax={assignHomework.total}
          aria-valuenow={Math.min(assignHomework.index + 1, assignHomework.total)}
          role="progressbar"
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${Math.round(ratio * 100)}%`,
              background: 'var(--color-accent)',
            }}
          />
        </div>
        <p className="mt-1 text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
          {text(
            `${Math.min(assignHomework.index + 1, assignHomework.total)} / ${assignHomework.total}`,
            `${Math.min(assignHomework.index + 1, assignHomework.total)} / ${assignHomework.total}`,
          )}
        </p>
      </div>
    )
  }

  if (!recruitActive) {
    const modeBtn = (mode: 'author' | 'character', label: string) => {
      const active = chatMode === mode
      return (
        <button
          type="button"
          disabled={modeLocked}
          onClick={() => setChatMode(mode)}
          className="rounded px-2 py-0.5 text-[0.7rem] font-medium transition-colors disabled:opacity-50"
          style={{
            color: active ? 'var(--color-accent-contrast, #fff)' : 'var(--color-text-secondary)',
            background: active ? 'var(--color-accent)' : 'transparent',
          }}
          data-testid={`chat-mode-${mode}`}
        >
          {label}
        </button>
      )
    }
    return (
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-0.5 rounded-md p-0.5"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-hover)' }}
          role="group"
          aria-label={text('对话模式', '对话模式')}
        >
          {modeBtn('author', text('作者', '作者'))}
          {modeBtn('character', text('角色', '角色'))}
        </div>
        {chatMode === 'character' && (
          <select
            value={characterEntryId ?? ''}
            disabled={modeLocked}
            onChange={e => setCharacterEntryId(e.target.value || null)}
            className="max-w-[10rem] rounded-md px-2 py-1 text-xs disabled:opacity-50"
            style={{
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-sidebar)',
            }}
            data-testid="character-mode-select"
            aria-label={text('扮演角色', '扮演角色')}
          >
            <option value="">{text('先选要扮的角色', '先选要扮的角色')}</option>
            {characters.map(entry => (
              <option key={entry.id} value={entry.id}>
                {entry.title.trim() || entry.id}
              </option>
            ))}
          </select>
        )}
        {chatMode === 'author' && (
          <div
            className="flex items-center gap-0.5 rounded-md px-1 py-0.5"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-sidebar)' }}
            data-testid="focus-chapter-stepper"
          >
            <button
              type="button"
              disabled={modeLocked || focusChapterNumber <= 1}
              onClick={() => setFocusChapterNumber(focusChapterNumber - 1)}
              className="rounded px-1.5 py-0.5 text-[0.7rem] disabled:opacity-40"
              style={{ color: 'var(--color-text-secondary)' }}
              aria-label={text('上一章', '上一章')}
            >
              −
            </button>
            <span className="min-w-[3.5rem] text-center text-[0.7rem]" style={{ color: 'var(--color-text)' }}>
              {text(`第 ${focusChapterNumber} 章`, `第 ${focusChapterNumber} 章`)}
            </span>
            <button
              type="button"
              disabled={modeLocked}
              onClick={() => setFocusChapterNumber(focusChapterNumber + 1)}
              className="rounded px-1.5 py-0.5 text-[0.7rem] disabled:opacity-40"
              style={{ color: 'var(--color-text-secondary)' }}
              aria-label={text('下一章', '下一章')}
            >
              +
            </button>
          </div>
        )}
        <button
          type="button"
          disabled={!canContinueChapter}
          onClick={() => { void continueCurrentChapter() }}
          className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
          style={{
            color: 'var(--color-accent-contrast, #fff)',
            background: 'var(--color-accent)',
          }}
          data-testid="continue-chapter-button"
        >
          {text('续写本章', '续写本章')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => startRecruit()}
          className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
          style={{
            color: 'var(--color-accent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
            background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
          }}
        >
          {text('酒馆招新', '酒馆招新')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => { void startAssignHomework() }}
          className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
          style={{
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-hover)',
          }}
        >
          {text('分配作业', '分配作业')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md px-2 py-1.5"
      style={{
        border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
        background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
      }}
    >
      <span className="mr-1 text-[0.7rem]" style={{ color: 'var(--color-text-secondary)' }}>
        {text('正在酒馆招新', '正在酒馆招新')}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => { void finishRecruit() }}
        className="rounded px-2 py-0.5 text-[0.7rem] font-medium disabled:opacity-50"
        style={{
          color: 'var(--color-accent-contrast, #fff)',
          background: 'var(--color-accent)',
        }}
      >
        {text('确定招募', '确定招募')}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => cancelRecruit()}
        className="rounded px-2 py-0.5 text-[0.7rem] disabled:opacity-50"
        style={{
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
        }}
      >
        {text('你被炒了', '你被炒了')}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => restartRecruit()}
        className="rounded px-2 py-0.5 text-[0.7rem] disabled:opacity-50"
        style={{
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        {text('重新招募', '重新招募')}
      </button>
    </div>
  )
}

function ComposerFooter() {
  return (
    <div
      className="flex-shrink-0 px-3 pb-3 pt-2"
      style={{ borderTop: '1px solid var(--color-border)' }}
    >
      <RecruitToolbar />
      <AgentInputBox />
    </div>
  )
}

// ===== 空状态视图 =====

function EmptyState() {
  const text = useLocaleStore(s => s.text)
  const { conversations, selectConversation } = useAgentStore()
  const recentConvs = conversations
    .filter(c => c && c.messages.length > 0)
    .slice(0, 3)

  return (
    <div className="h-full overflow-y-auto flex flex-col justify-center">
      <div className="px-4 py-6">
        <div className="mb-1 pl-1 text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          {text(APP_BRAND.zhName, APP_BRAND.enName)}
        </div>
        <div className="mb-3 pl-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {text('你的 AI 创作助手 — 支持', 'Your AI creative assistant — use')} <code className="px-1 py-0.5 rounded text-[0.68rem]" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-accent)' }}>/</code> {text('命令', 'commands')}
        </div>

        <RecruitToolbar />
        <AgentInputBox />

        {recentConvs.length > 0 && (
          <div className="mt-6">
            <div className="flex flex-col gap-0">
              {recentConvs.map(conv => (
                <RecentConversationItem
                  key={conv.id}
                  title={conv.title}
                  updatedAt={conv.updatedAt}
                  onClick={() => selectConversation(conv.id)}
                  onDelete={() => useAgentStore.getState().deleteConversation(conv.id)}
                />
              ))}
            </div>
            {conversations.filter(c => c.messages.length > 0).length > 3 && (
              <button
                onClick={() => useAgentStore.getState().setShowHistory(true)}
                className="mt-4 text-left text-xs transition-all hover:underline"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                {text('查看全部对话', 'View all conversations')}
              </button>
            )}
          </div>
        )}

        <div className="pt-8 text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {text('AI 生成内容仅供参考，重要信息请自行核实。', 'AI-generated content is for reference only. Verify important information.')}
        </div>
      </div>
    </div>
  )
}

// ===== 酒馆招新临时对话 =====

function RecruitConversation() {
  const text = useLocaleStore(s => s.text)
  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {text(
            '答卷不会记入主聊天；确定招募后写入世界书并丢弃答卷。下方仍可切换模型。',
            '答卷不会记入主聊天；确定招募后写入世界书并丢弃答卷。下方仍可切换模型。',
          )}
        </div>
        <RecruitForm />
      </div>
      <ComposerFooter />
    </div>
  )
}

// ===== 活跃对话视图 =====

function ActiveConversation() {
  const text = useLocaleStore(s => s.text)
  const { getActiveConversation, generating } = useAgentStore()
  const activeConv = getActiveConversation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  useEffect(() => {
    if (isAtBottom && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [activeConv?.messages, generating, isAtBottom])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setIsAtBottom(distanceFromBottom < 60)
  }

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }

  if (!activeConv) return null

  return (
    <div className="flex flex-col h-full relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="flex flex-col">
          {activeConv.messages
            .filter(m => m.role !== 'system')
            .map(msg => (
              <AgentMessage key={msg.id} message={msg} />
            ))}
        </div>
        <div className="h-4" />
      </div>

      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute z-10 flex items-center justify-center w-7 h-7 rounded-full shadow-md transition-all"
          style={{
            right: 16,
            bottom: 100,
            backgroundColor: 'var(--color-sidebar)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
          title={text('回到底部', 'Back to bottom')}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--color-accent)'
            e.currentTarget.style.color = 'var(--color-accent)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.color = 'var(--color-text-secondary)'
          }}
        >
          <ArrowDown size={13} strokeWidth={2.25} />
        </button>
      )}

      <ComposerFooter />
    </div>
  )
}

// ===== 历史面板 =====

function AgentHistoryPanel() {
  const text = useLocaleStore(s => s.text)
  const { conversations, activeConversationId, selectConversation, deleteConversation, setShowHistory } = useAgentStore()

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {text('全部对话', 'All conversations')}
        </span>
        <button
          onClick={() => setShowHistory(false)}
          className="text-xs px-2 py-0.5 rounded transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          {text('关闭', 'Close')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {text('暂无对话', 'No conversations yet')}
          </div>
        ) : (
          sorted.map(conv => (
            <RecentConversationItem
              key={conv.id}
              title={conv.title}
              updatedAt={conv.updatedAt}
              active={conv.id === activeConversationId}
              onClick={() => selectConversation(conv.id)}
              onDelete={() => deleteConversation(conv.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function RecentConversationItem({
  title,
  updatedAt,
  onClick,
  onDelete,
  active,
}: {
  title: string
  updatedAt: number
  onClick: () => void
  onDelete: () => void
  active?: boolean
}) {
  const text = useLocaleStore(s => s.text)
  return (
    <div
      className="group w-full flex flex-row items-center justify-between overflow-hidden rounded py-1.5 text-left px-2 box-border transition-colors"
      style={{
        backgroundColor: active ? 'var(--color-hover)' : 'transparent',
      }}
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.backgroundColor = 'var(--color-hover)'
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      <button type="button" onClick={onClick} className="flex items-center gap-x-1 overflow-hidden flex-1 min-w-0 text-left">
        <div className="truncate text-xs" style={{ color: 'var(--color-text)' }}>
          {title}
        </div>
        <div className="text-[0.65rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {formatRelativeTime(updatedAt)}
        </div>
      </button>
      <button
        type="button"
        title={text('删除对话', 'Delete conversation')}
        onClick={e => {
          e.stopPropagation()
          onDelete()
        }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}
