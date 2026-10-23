/**
 * 单条消息渲染组件（升级版）
 *
 * 支持三种渲染模式：
 * - 用户消息：右对齐气泡
 * - 助手消息：左侧 Markdown 风格渲染
 * - Tool 调用：ToolCallBlock / ConfirmCard / ArtifactCard
 */
import { useState, type ReactNode } from 'react'
import { Check, Copy, Pencil, Trash2, RotateCw } from 'lucide-react'
import {
  formatAgentContextReceiptHint,
  type AgentContextReceipt,
} from '../../../shared/agent-chat'
import {
  useAgentStore,
  type AgentMessage as AgentMessageType,
  type AgentRequestDebug,
} from '../../../stores/agent-store'
import { useLocaleStore } from '../../../stores/locale-store'
import MarkdownContent, { StreamingCursor } from '../../ui/MarkdownContent'
import ToolCallBlock from './ToolCallBlock'
import ConfirmCard from './ConfirmCard'
import ArtifactCard from './ArtifactCard'
import '../../../styles/agent-tools.css'

interface Props {
  message: AgentMessageType
}

function ContextReceiptHint({ receipt }: { receipt: AgentContextReceipt }) {
  const text = useLocaleStore(state => state.text)
  const hint = formatAgentContextReceiptHint(receipt, text)
  if (!hint) return null
  return (
    <p
      className="mb-1.5 text-[0.68rem] leading-relaxed"
      style={{ color: 'var(--color-text-muted)' }}
      data-testid="agent-context-receipt"
    >
      {hint}
    </p>
  )
}

function RequestDebugPanel({ debug }: { debug: AgentRequestDebug }) {
  const text = useLocaleStore(state => state.text)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const metaParts = [
    `${text('模型', '模型')}: ${debug.modelId}`,
    `${text('历史', '历史')}: ${debug.meta.historyCount}`,
    `purpose: ${debug.meta.purpose}`,
    `stage: ${debug.meta.reasoningStage}`,
  ]
  if (debug.meta.creativeStrategy) {
    metaParts.push(`strategy: ${debug.meta.creativeStrategy}`)
  }

  const copyDebug = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(debug, null, 2))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <details className="my-2 rounded border border-[var(--color-border)] px-2 py-1">
      <summary className="cursor-pointer text-[0.7rem] font-medium text-[var(--color-text-secondary)]">
        {text('本次请求上下文', '本次请求上下文')}
      </summary>
      <div className="mt-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[0.68rem] leading-relaxed text-[var(--color-text-muted)]">
            {metaParts.join(' · ')}
          </p>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[0.68rem]"
            style={{
              color: 'var(--color-text-secondary)',
              background: 'var(--color-hover)',
              border: '1px solid var(--color-border)',
            }}
            onClick={() => void copyDebug()}
          >
            {copyState === 'copied' ? text('已复制', '已复制') : text('复制', '复制')}
          </button>
          {copyState === 'failed' && (
            <span role="alert" className="text-[0.68rem] text-[var(--color-text-muted)]">
              {text('复制失败', '复制失败')}
            </span>
          )}
        </div>
        {debug.messages.map((msg, index) => (
          <div key={`${msg.role}-${index}`} className="space-y-0.5">
            <p className="text-[0.68rem] font-medium text-[var(--color-text-secondary)]">
              [{msg.role}] · {msg.content.length} {text('字', '字')}
            </p>
            <pre
              className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded px-2 py-1 text-[0.68rem] leading-relaxed"
              style={{
                background: 'var(--color-hover)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
              }}
            >
              {msg.content}
            </pre>
          </div>
        ))}
      </div>
    </details>
  )
}

function MessageActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
      style={{ color: 'var(--color-text-muted)', background: 'var(--color-hover)' }}
    >
      {children}
    </button>
  )
}

export default function AgentMessage({ message }: Props) {
  const { id, role, content, streaming, toolCalls, artifacts, requestDebug, contextReceipt } = message
  const text = useLocaleStore(state => state.text)
  const generating = useAgentStore(state => state.generating)
  const deleteMessage = useAgentStore(state => state.deleteMessage)
  const updateMessageContent = useAgentStore(state => state.updateMessageContent)
  const resendUserMessage = useAgentStore(state => state.resendUserMessage)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const busy = generating || Boolean(streaming)
  const canMutate = !busy && !editing

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const startEdit = () => {
    setDraft(content)
    setEditing(true)
  }

  const cancelEdit = () => {
    setDraft(content)
    setEditing(false)
  }

  const saveEdit = () => {
    const next = draft.trim()
    if (!next || next === content) {
      setEditing(false)
      return
    }
    updateMessageContent(id, next)
    setEditing(false)
  }

  const saveAndResend = () => {
    const next = draft.trim()
    if (!next) return
    setEditing(false)
    void resendUserMessage(id, next)
  }

  const actionBar = (
    <div className={`absolute top-1 flex gap-0.5 ${role === 'user' ? 'left-1' : 'right-1'}`}>
      <MessageActionButton
        label={copyState === 'copied' ? text('已复制', 'Copied') : text('复制消息', 'Copy message')}
        disabled={!content || streaming}
        onClick={() => void copyMessage()}
      >
        {copyState === 'copied' ? <Check size={13} /> : <Copy size={13} />}
      </MessageActionButton>
      <MessageActionButton
        label={text('编辑', 'Edit')}
        disabled={!canMutate || !content}
        onClick={startEdit}
      >
        <Pencil size={13} />
      </MessageActionButton>
      {role === 'user' && (
        <MessageActionButton
          label={text('重新发送', 'Resend')}
          disabled={!canMutate || !content.trim()}
          onClick={() => void resendUserMessage(id, content)}
        >
          <RotateCw size={13} />
        </MessageActionButton>
      )}
      <MessageActionButton
        label={text('删除', 'Delete')}
        disabled={!canMutate}
        onClick={() => deleteMessage(id)}
      >
        <Trash2 size={13} />
      </MessageActionButton>
      {copyState === 'failed' && (
        <span role="alert" className="sr-only">{text('无法复制这条消息', 'Could not copy this message')}</span>
      )}
    </div>
  )

  const editor = (
    <div className="w-full space-y-2">
      <textarea
        value={draft}
        onChange={event => setDraft(event.target.value)}
        rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
        className="w-full rounded-lg px-3 py-2 text-xs leading-relaxed"
        style={{
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          resize: 'vertical',
        }}
        aria-label={text('编辑消息', 'Edit message')}
      />
      <div className="flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          className="rounded-md px-2.5 py-1 text-[0.7rem]"
          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
          onClick={cancelEdit}
        >
          {text('取消', 'Cancel')}
        </button>
        <button
          type="button"
          className="rounded-md px-2.5 py-1 text-[0.7rem]"
          style={{ color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
          disabled={!draft.trim()}
          onClick={saveEdit}
        >
          {text('仅保存', 'Save')}
        </button>
        {role === 'user' && (
          <button
            type="button"
            className="rounded-md px-2.5 py-1 text-[0.7rem] font-medium"
            style={{
              color: 'var(--color-accent-contrast, #fff)',
              background: 'var(--color-accent)',
              border: '1px solid transparent',
            }}
            disabled={!draft.trim() || busy}
            onClick={saveAndResend}
          >
            {text('保存并重发', 'Save & resend')}
          </button>
        )}
      </div>
    </div>
  )

  if (role === 'user') {
    return (
      <div
        id={`agent-msg-${id}`}
        data-message-id={id}
        data-role="user"
        className="group relative flex justify-end mb-2"
      >
        <div
          className="chat-readable-zoom max-w-[88%] px-3 py-2 rounded-2xl text-xs leading-relaxed break-words whitespace-pre-wrap"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
            color: 'var(--color-text)',
          }}
        >
          {editing ? editor : content}
        </div>
        {!editing && actionBar}
      </div>
    )
  }

  // 助手消息
  return (
    <div
      id={`agent-msg-${id}`}
      data-message-id={id}
      data-role="assistant"
      className="group relative flex justify-start mb-2"
    >
      <div
        className="chat-readable-zoom max-w-full text-xs leading-relaxed break-words w-full"
        style={{ color: 'var(--color-text)' }}
      >
        {editing ? editor : (
          <>
            {contextReceipt ? <ContextReceiptHint receipt={contextReceipt} /> : null}

            {content ? (
              <MarkdownContent content={content} streaming={streaming} />
            ) : streaming ? (
              <span className="inline-flex items-center h-4">
                <StreamingCursor />
              </span>
            ) : null}

            {toolCalls && toolCalls.length > 0 && (
              <div className="mt-2">
                {toolCalls.map(tc => (
                  tc.status === 'waiting_confirm' ? (
                    <ConfirmCard key={tc.id} toolCall={tc} />
                  ) : (
                    <ToolCallBlock key={tc.id} toolCall={tc} />
                  )
                ))}
              </div>
            )}

            {artifacts && artifacts.length > 0 && (
              <div className="mt-2">
                {artifacts.map((a, i) => (
                  <ArtifactCard key={`artifact-${i}`} artifact={a} />
                ))}
              </div>
            )}

            {requestDebug ? <RequestDebugPanel debug={requestDebug} /> : null}
          </>
        )}
      </div>
      {!editing && actionBar}
    </div>
  )
}
